import {
  and,
  desc,
  eq,
  exists,
  gte,
  like,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type {
  AppDatabase,
  DbClient,
  DbTransaction,
} from "../db/client.js";
import type { UserScope } from "../auth/authorization.js";
import {
  auditLogs,
  commissionLedger,
  customers,
  orderAttributions,
  orderLines,
  orders,
  quoteLines,
  quotes,
  stores,
  users,
} from "../db/schema.js";
import type {
  AttributionCandidate,
  OrderAttributionRecord,
  OrderAuditInput,
  OrderLineRecord,
  OrderListFilters,
  OrderListResult,
  OrderFilterOptions,
  OrderRecord,
  OrderRepository,
  OrderWriteRecord,
  SourceQuoteForOrder,
} from "./orderService.js";
import type { OrderStatus } from "./orderStateMachine.js";

type QueryExecutor = AppDatabase | DbTransaction;
type OrderRow = typeof orders.$inferSelect;

const scopeCondition = (scope: UserScope): SQL | undefined => {
  if (scope.kind === "global") return undefined;
  if (scope.kind === "store") return eq(orders.storeId, scope.storeId);
  return and(
    eq(orders.storeId, scope.storeId),
    eq(orders.sellerId, scope.sellerId),
  );
};

const encodeCursor = (row: OrderRow): string =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString(
    "base64url",
  );

const decodeCursor = (
  value: string,
): { createdAt: Date; id: string } => {
  try {
    const [dateValue, id] = Buffer.from(value, "base64url")
      .toString("utf8")
      .split("|");
    const createdAt = new Date(dateValue ?? "");
    if (!id || Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt, id };
  } catch {
    throw new Error("分页游标格式不正确");
  }
};

const baseOrder = (row: OrderRow): Omit<OrderRecord, "lines" | "attributions"> => ({
  id: row.id,
  orderNo: row.orderNo,
  idempotencyKey: row.idempotencyKey,
  quoteId: row.quoteId,
  customerId: row.customerId,
  storeId: row.storeId,
  sellerId: row.sellerId,
  status: row.status,
  paymentMode: row.paymentMode,
  fttrKind: row.fttrKind,
  fttrPlan: row.fttrPlan,
  customFttrNote: row.customFttrNote,
  fttrMonthlyFen: row.fttrMonthlyFen,
  heartMonthlyFen: row.heartMonthlyFen,
  oneTimeFen: row.oneTimeFen,
  monthlyTotalFen: row.monthlyTotalFen,
  contract36Fen: row.contract36Fen,
  refundedFen: row.refundedFen,
  catalogVersion: row.catalogVersion,
  catalogSnapshot: row.catalogSnapshot,
  customerSnapshot: row.customerSnapshot,
  quoteSnapshot: row.quoteSnapshot,
  storeSnapshot: row.storeSnapshot,
  sellerSnapshot: row.sellerSnapshot,
  createdBy: row.createdBy,
  acceptedAt: row.acceptedAt,
  activatedAt: row.activatedAt,
  completedAt: row.completedAt,
  cancelledAt: row.cancelledAt,
  deletedAt: row.deletedAt,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class DrizzleOrderRepository implements OrderRepository {
  constructor(
    private readonly client: DbClient,
    private readonly executor: QueryExecutor = client.db,
    private readonly insideTransaction = false,
  ) {}

  async runTransaction<T>(
    work: (repository: OrderRepository) => Promise<T>,
  ): Promise<T> {
    if (this.insideTransaction) return work(this);
    return this.client.withTransaction((tx) =>
      work(new DrizzleOrderRepository(this.client, tx, true)),
    );
  }

  private async hydrate(row: OrderRow): Promise<OrderRecord> {
    const [lineRows, attributionRows] = await Promise.all([
      this.executor
        .select()
        .from(orderLines)
        .where(eq(orderLines.orderId, row.id))
        .orderBy(orderLines.createdAt, orderLines.id),
      this.executor
        .select()
        .from(orderAttributions)
        .where(eq(orderAttributions.orderId, row.id))
        .orderBy(orderAttributions.createdAt, orderAttributions.id),
    ]);
    return {
      ...baseOrder(row),
      lines: lineRows.map((line): OrderLineRecord => ({
        id: line.id,
        quoteLineId: line.quoteLineId,
        lineType: line.lineType,
        sku: line.sku,
        label: line.label,
        unit: line.unit,
        quantity: line.quantity,
        oneTimeUnitFen: line.oneTimeUnitFen,
        monthlyUnitFen: line.monthlyUnitFen,
        oneTimeSubtotalFen: line.oneTimeSubtotalFen,
        monthlySubtotalFen: line.monthlySubtotalFen,
        locations: line.locations,
        reason: line.reason,
        lineSnapshot: line.lineSnapshot,
      })),
      attributions: attributionRows.map(
        (entry): OrderAttributionRecord => ({
          beneficiaryId: entry.beneficiaryId,
          attributionRole: entry.attributionRole,
          basisPoints: entry.basisPoints,
          beneficiarySnapshot: entry.beneficiarySnapshot,
        }),
      ),
    };
  }

  private async findOne(condition: SQL): Promise<OrderRecord | null> {
    const [row] = await this.executor
      .select()
      .from(orders)
      .where(condition)
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  findByIdempotencyKey(key: string): Promise<OrderRecord | null> {
    return this.findOne(eq(orders.idempotencyKey, key));
  }

  findByQuoteId(quoteId: string): Promise<OrderRecord | null> {
    return this.findOne(eq(orders.quoteId, quoteId));
  }

  findById(id: string, scope: UserScope): Promise<OrderRecord | null> {
    return this.findOne(and(eq(orders.id, id), scopeCondition(scope))!);
  }

  async findSourceQuoteForUpdate(
    quoteId: string,
    scope: UserScope,
  ): Promise<SourceQuoteForOrder | null> {
    const quoteScope =
      scope.kind === "global"
        ? undefined
        : scope.kind === "store"
          ? eq(quotes.storeId, scope.storeId)
          : and(
              eq(quotes.storeId, scope.storeId),
              eq(quotes.sellerId, scope.sellerId),
            );
    const [quote] = await this.executor
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), quoteScope))
      .limit(1);
    if (!quote) return null;

    const [storeRows, sellerRows, lineRows] = await Promise.all([
      this.executor
        .select({
          code: stores.code,
          name: stores.name,
          active: stores.active,
        })
        .from(stores)
        .where(eq(stores.id, quote.storeId))
        .limit(1),
      this.executor
        .select({
          workNo: users.workNo,
          displayName: users.displayName,
          personnelType: users.personnelType,
        })
        .from(users)
        .where(eq(users.id, quote.sellerId))
        .limit(1),
      this.executor
        .select()
        .from(quoteLines)
        .where(eq(quoteLines.quoteId, quote.id))
        .orderBy(quoteLines.createdAt, quoteLines.id),
    ]);
    const store = storeRows[0];
    const seller = sellerRows[0];
    if (!store || !seller) throw new Error("报价归属快照缺失");

    return {
      id: quote.id,
      quoteNo: quote.quoteNo,
      customerId: quote.customerId,
      storeId: quote.storeId,
      sellerId: quote.sellerId,
      status: quote.status,
      deletedAt: quote.deletedAt,
      paymentMode: quote.paymentMode,
      fttrKind: quote.fttrKind,
      fttrPlan: quote.fttrPlan,
      customFttrNote: quote.customFttrNote,
      fttrMonthlyFen: quote.fttrMonthlyFen,
      heartMonthlyFen: quote.heartMonthlyFen,
      oneTimeFen: quote.oneTimeFen,
      monthlyTotalFen: quote.monthlyTotalFen,
      contract36Fen: quote.contract36Fen,
      catalogVersion: quote.catalogVersion,
      customerSnapshot: quote.customerSnapshot,
      quoteSnapshot: quote.quoteSnapshot,
      storeSnapshot: store,
      sellerSnapshot: seller,
      lines: lineRows.map((line) => ({
        quoteLineId: line.id,
        lineType: line.lineType,
        sku: line.sku,
        label: line.label,
        unit: line.unit,
        quantity: line.quantity,
        oneTimeUnitFen: line.oneTimeUnitFen,
        monthlyUnitFen: line.monthlyUnitFen,
        oneTimeSubtotalFen: line.oneTimeSubtotalFen,
        monthlySubtotalFen: line.monthlySubtotalFen,
        locations: line.locations,
        reason: line.reason,
      })),
    };
  }

  async findAttributionCandidates(
    ids: string[],
  ): Promise<AttributionCandidate[]> {
    if (ids.length === 0) return [];
    return this.executor
      .select({
        id: users.id,
        storeId: users.storeId,
        workNo: users.workNo,
        displayName: users.displayName,
        role: users.role,
        personnelType: users.personnelType,
        active: users.active,
      })
      .from(users)
      .where(inArray(users.id, ids));
  }

  async createOrder(
    input: OrderWriteRecord,
    lines: OrderLineRecord[],
    attributions: OrderAttributionRecord[],
  ): Promise<OrderRecord> {
    const [created] = await this.executor
      .insert(orders)
      .values(input)
      .returning();
    if (!created) throw new Error("订单创建失败");

    if (lines.length > 0) {
      await this.executor.insert(orderLines).values(
        lines.map((line) => ({
          orderId: created.id,
          quoteLineId: line.quoteLineId,
          lineType: line.lineType,
          sku: line.sku,
          label: line.label,
          unit: line.unit,
          quantity: line.quantity,
          oneTimeUnitFen: line.oneTimeUnitFen,
          monthlyUnitFen: line.monthlyUnitFen,
          oneTimeSubtotalFen: line.oneTimeSubtotalFen,
          monthlySubtotalFen: line.monthlySubtotalFen,
          locations: line.locations,
          reason: line.reason,
          lineSnapshot: line.lineSnapshot,
        })),
      );
    }
    await this.executor.insert(orderAttributions).values(
      attributions.map((entry) => ({
        orderId: created.id,
        beneficiaryId: entry.beneficiaryId,
        attributionRole: entry.attributionRole,
        basisPoints: entry.basisPoints,
        beneficiarySnapshot: entry.beneficiarySnapshot,
      })),
    );
    return this.hydrate(created);
  }

  async markQuoteConverted(quoteId: string): Promise<void> {
    const [updated] = await this.executor
      .update(quotes)
      .set({
        status: "converted",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.status, "confirmed"),
          isNull(quotes.deletedAt),
        ),
      )
      .returning({ id: quotes.id });
    if (!updated) throw new Error("报价单状态更新失败");
  }

  async transition(
    id: string,
    expectedVersion: number,
    status: OrderStatus,
    at: Date,
  ): Promise<OrderRecord | null> {
    const lifecycle: Partial<typeof orders.$inferInsert> = {};
    if (status === "accepted") lifecycle.acceptedAt = at;
    if (status === "activated") lifecycle.activatedAt = at;
    if (status === "completed") lifecycle.completedAt = at;
    if (status === "cancelled" || status === "voided") {
      lifecycle.cancelledAt = at;
    }
    const [row] = await this.executor
      .update(orders)
      .set({
        status,
        ...lifecycle,
        updatedAt: at,
        version: sql`${orders.version} + 1`,
      })
      .where(and(eq(orders.id, id), eq(orders.version, expectedVersion)))
      .returning();
    return row ? this.hydrate(row) : null;
  }

  async setDeletedAt(
    id: string,
    expectedVersion: number,
    deletedAt: Date | null,
  ): Promise<OrderRecord | null> {
    const [row] = await this.executor
      .update(orders)
      .set({
        deletedAt,
        updatedAt: new Date(),
        version: sql`${orders.version} + 1`,
      })
      .where(and(eq(orders.id, id), eq(orders.version, expectedVersion)))
      .returning();
    return row ? this.hydrate(row) : null;
  }

  async hasCommissionLedger(orderId: string): Promise<boolean> {
    const [row] = await this.executor
      .select({ id: commissionLedger.id })
      .from(commissionLedger)
      .where(eq(commissionLedger.orderId, orderId))
      .limit(1);
    return Boolean(row);
  }

  async list(
    scope: Parameters<OrderRepository["list"]>[0],
    filters: OrderListFilters,
  ): Promise<OrderListResult> {
    const conditions: SQL[] = [];
    if (scope.kind === "seller") {
      conditions.push(
        eq(orders.storeId, scope.storeId),
        eq(orders.sellerId, scope.sellerId),
      );
    } else if (scope.kind === "store") {
      conditions.push(eq(orders.storeId, scope.storeId));
    }
    conditions.push(filters.deletedOnly ? isNotNull(orders.deletedAt) : isNull(orders.deletedAt));
    if (filters.orderNo) {
      conditions.push(like(orders.orderNo, `%${filters.orderNo}%`));
    }
    if (filters.storeQuery) {
      conditions.push(
        exists(
          this.executor
            .select({ id: stores.id })
            .from(stores)
            .where(
              and(
                eq(stores.id, orders.storeId),
                or(
                  eq(stores.id, filters.storeQuery),
                  like(stores.name, `%${filters.storeQuery}%`),
                  like(stores.code, `%${filters.storeQuery}%`),
                ),
              ),
            ),
        ),
      );
    }
    if (filters.sellerQuery) {
      conditions.push(
        exists(
          this.executor
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.id, orders.sellerId),
                or(
                  eq(users.id, filters.sellerQuery),
                  like(users.displayName, `%${filters.sellerQuery}%`),
                  like(users.workNo, `%${filters.sellerQuery}%`),
                ),
              ),
            ),
        ),
      );
    }
    if (filters.status) conditions.push(eq(orders.status, filters.status));
    if (filters.paymentMode) {
      conditions.push(eq(orders.paymentMode, filters.paymentMode));
    }
    if (filters.fttrKind) {
      conditions.push(eq(orders.fttrKind, filters.fttrKind));
    }
    if (filters.fttrPlan !== undefined) {
      conditions.push(eq(orders.fttrPlan, filters.fttrPlan));
    }
    if (filters.roomType) {
      conditions.push(
        sql`json_extract(${orders.customerSnapshot}, '$.roomType') = ${filters.roomType}`,
      );
    }
    if (filters.customerPhoneTail) {
      conditions.push(
        exists(
          this.executor
            .select({ id: customers.id })
            .from(customers)
            .where(
              and(
                eq(customers.id, orders.customerId),
                eq(customers.phoneTail, filters.customerPhoneTail),
              ),
            ),
        ),
      );
    }
    if (filters.productSku) {
      conditions.push(
        exists(
          this.executor
            .select({ id: orderLines.id })
            .from(orderLines)
            .where(
              and(
                eq(orderLines.orderId, orders.id),
                eq(orderLines.sku, filters.productSku),
              ),
            ),
        ),
      );
    }
    if (filters.dateFrom) conditions.push(gte(orders.createdAt, filters.dateFrom));
    if (filters.dateTo) conditions.push(lt(orders.createdAt, filters.dateTo));
    if (filters.cursor) {
      const cursor = decodeCursor(filters.cursor);
      conditions.push(
        or(
          lt(orders.createdAt, cursor.createdAt),
          and(eq(orders.createdAt, cursor.createdAt), lt(orders.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.executor
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(filters.query ? 500 : filters.limit + 1);
    if (filters.query) {
      return { items: await Promise.all(rows.map((row) => this.hydrate(row))), nextCursor: null };
    }
    const hasNext = rows.length > filters.limit;
    const pageRows = hasNext ? rows.slice(0, filters.limit) : rows;
    return {
      items: await Promise.all(pageRows.map((row) => this.hydrate(row))),
      nextCursor:
        hasNext && pageRows.length > 0
          ? encodeCursor(pageRows[pageRows.length - 1]!)
          : null,
    };
  }

  async listFilterOptions(scope: Parameters<OrderRepository["listFilterOptions"]>[0]): Promise<OrderFilterOptions> {
    if (scope.kind === "seller") return { stores: [], sellers: [] };
    const storeCondition = scope.kind === "store" ? eq(stores.id, scope.storeId) : eq(stores.active, true);
    const sellerCondition =
      scope.kind === "store"
        ? and(eq(users.storeId, scope.storeId), eq(users.active, true), inArray(users.role, ["sales", "store_manager"]))
        : and(eq(users.active, true), isNotNull(users.storeId), inArray(users.role, ["sales", "store_manager"]));
    const [storeRows, sellerRows] = await Promise.all([
      this.executor
        .select({ id: stores.id, code: stores.code, name: stores.name })
        .from(stores)
        .where(storeCondition)
        .orderBy(stores.code),
      this.executor
        .select({ id: users.id, workNo: users.workNo, name: users.displayName, storeId: users.storeId })
        .from(users)
        .where(sellerCondition)
        .orderBy(users.displayName, users.workNo),
    ]);
    return {
      stores: storeRows.map((row) => ({ id: row.id, label: `${row.name}（${row.code}）` })),
      sellers: sellerRows.flatMap((row) =>
        row.storeId
          ? [{ id: row.id, label: `${row.name}（${row.workNo}）`, storeId: row.storeId }]
          : [],
      ),
    };
  }

  async writeAudit(input: OrderAuditInput): Promise<void> {
    await this.executor.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      storeId: input.storeId,
      entityType: "order",
      entityId: input.orderId,
      action: input.action,
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
      reason: input.reason,
    });
  }
}
