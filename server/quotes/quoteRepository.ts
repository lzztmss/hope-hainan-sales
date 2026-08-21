import { and, count, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";

import type { QuoteCalculation } from "../../shared/pricing/types.js";
import type {
  AppDatabase,
  DbClient,
  DbTransaction,
} from "../db/client.js";
import {
  customers,
  auditLogs,
  printEvents,
  quoteLines,
  quotes,
} from "../db/schema.js";
import type {
  ConfirmedQuote,
  CustomerWriteRecord,
  QuoteRepository,
  QuoteWriteRecord,
  QuoteListFilters,
} from "./quoteService.js";
import type { UserScope } from "../auth/authorization.js";

type QueryExecutor = AppDatabase | DbTransaction;
type QuoteRow = typeof quotes.$inferSelect;

const mapQuote = (row: QuoteRow): ConfirmedQuote => ({
  id: row.id,
  quoteNo: row.quoteNo,
  idempotencyKey: row.idempotencyKey,
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
  catalogVersion: row.catalogVersion,
  customerSnapshot: row.customerSnapshot,
  quoteSnapshot: row.quoteSnapshot,
  confirmedAt: row.confirmedAt,
  deletedAt: row.deletedAt,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const scopeCondition = (scope: UserScope): SQL | undefined => {
  if (scope.kind === "global") return undefined;
  if (scope.kind === "store") return eq(quotes.storeId, scope.storeId);
  return and(eq(quotes.storeId, scope.storeId), eq(quotes.sellerId, scope.sellerId));
};

const lineValuesFor = (
  quoteId: string,
  snapshot: Record<string, unknown>,
): Array<typeof quoteLines.$inferInsert> => {
  const calculation = quoteCalculationFromSnapshot(snapshot);
  return [
    ...calculation.chargeLines.map((line) => ({
      quoteId,
      lineType: "charge" as const,
      sku: line.sku,
      label: line.label,
      unit: line.unit,
      quantity: line.quantity,
      oneTimeUnitFen: line.oneTimeUnitFen,
      monthlyUnitFen: line.monthlyUnitFen,
      oneTimeSubtotalFen: line.oneTimeSubtotalFen,
      monthlySubtotalFen: line.monthlySubtotalFen,
      locations: [],
    })),
    ...calculation.componentLines.map((line) => ({
      quoteId,
      lineType: "component" as const,
      sku: line.componentId,
      label: line.label,
      unit: line.unit,
      quantity: line.quantity,
      oneTimeUnitFen: 0,
      monthlyUnitFen: 0,
      oneTimeSubtotalFen: 0,
      monthlySubtotalFen: 0,
      locations: line.locations,
      reason: line.reason,
    })),
  ];
};

const quoteCalculationFromSnapshot = (
  snapshot: Record<string, unknown>,
): QuoteCalculation => {
  const calculation = snapshot.calculation;
  if (!calculation || typeof calculation !== "object") {
    throw new Error("报价快照缺少核价结果");
  }
  return calculation as QuoteCalculation;
};

export class DrizzleQuoteRepository implements QuoteRepository {
  constructor(
    private readonly client: DbClient,
    private readonly executor: QueryExecutor = client.db,
    private readonly insideTransaction = false,
  ) {}

  async runConfirmationTransaction<T>(
    work: (repository: QuoteRepository) => Promise<T>,
  ): Promise<T> {
    if (this.insideTransaction) return work(this);
    return this.client.withTransaction((tx) =>
      work(new DrizzleQuoteRepository(this.client, tx, true)),
    );
  }

  async findByIdempotencyKey(key: string): Promise<ConfirmedQuote | null> {
    const [row] = await this.executor
      .select()
      .from(quotes)
      .where(eq(quotes.idempotencyKey, key))
      .limit(1);
    return row ? mapQuote(row) : null;
  }

  async upsertCustomer(
    input: CustomerWriteRecord,
  ): Promise<{ id: string }> {
    const [existing] = await this.executor
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.storeId, input.storeId),
          eq(customers.ownerUserId, input.ownerUserId),
          eq(customers.phoneLookupHash, input.phoneLookupHash),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await this.executor
        .update(customers)
        .set({
          nameEncrypted: input.nameEncrypted,
          phoneEncrypted: input.phoneEncrypted,
          phoneTail: input.phoneTail,
          districtEncrypted: input.districtEncrypted,
          addressEncrypted: input.addressEncrypted,
          roomType: input.roomType,
          elderCount: input.elderCount,
          source: input.source,
          notesEncrypted: input.notesEncrypted,
          updatedAt: new Date(),
          version: sql`${customers.version} + 1`,
        })
        .where(eq(customers.id, existing.id))
        .returning({ id: customers.id });
      if (!updated) throw new Error("客户更新失败");
      return updated;
    }

    const [created] = await this.executor
      .insert(customers)
      .values(input)
      .returning({ id: customers.id });
    if (!created) throw new Error("客户创建失败");
    return created;
  }

  async createQuote(input: QuoteWriteRecord): Promise<ConfirmedQuote> {
    const [created] = await this.executor
      .insert(quotes)
      .values(input)
      .returning();
    if (!created) throw new Error("报价单创建失败");

    const lineValues = lineValuesFor(created.id, input.quoteSnapshot);
    if (lineValues.length > 0) {
      await this.executor.insert(quoteLines).values(lineValues);
    }
    return mapQuote(created);
  }

  async findById(id: string): Promise<ConfirmedQuote | null> {
    const [row] = await this.executor
      .select()
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);
    return row ? mapQuote(row) : null;
  }

  async list(scope: UserScope, filters: QuoteListFilters) {
    const conditions: SQL[] = [];
    const scoped = scopeCondition(scope);
    if (scoped) conditions.push(scoped);
    if (filters.storeId) conditions.push(eq(quotes.storeId, filters.storeId));
    if (filters.sellerId) conditions.push(eq(quotes.sellerId, filters.sellerId));
    if (filters.status) conditions.push(eq(quotes.status, filters.status));
    conditions.push(filters.deletedOnly ? isNotNull(quotes.deletedAt) : isNull(quotes.deletedAt));
    if (filters.dateFrom) conditions.push(gte(quotes.confirmedAt, filters.dateFrom));
    if (filters.dateTo) conditions.push(lt(quotes.confirmedAt, filters.dateTo));
    const where = and(...conditions);
    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(quotes)
      .where(where);
    let query = this.executor
      .select()
      .from(quotes)
      .where(where)
      .orderBy(desc(quotes.updatedAt), desc(quotes.id));
    if (!filters.query) {
      query = query
        .limit(filters.pageSize)
        .offset((filters.page - 1) * filters.pageSize) as typeof query;
    }
    const rows = await query;
    return { items: rows.map(mapQuote), total: Number(totalRow?.value ?? 0) };
  }

  async updateQuote(
    id: string,
    expectedVersion: number,
    input: QuoteWriteRecord,
  ): Promise<ConfirmedQuote | null> {
    const [row] = await this.executor
      .update(quotes)
      .set({
        customerId: input.customerId,
        paymentMode: input.paymentMode,
        fttrKind: input.fttrKind,
        fttrPlan: input.fttrPlan,
        customFttrNote: input.customFttrNote,
        fttrMonthlyFen: input.fttrMonthlyFen,
        heartMonthlyFen: input.heartMonthlyFen,
        oneTimeFen: input.oneTimeFen,
        monthlyTotalFen: input.monthlyTotalFen,
        contract36Fen: input.contract36Fen,
        catalogVersion: input.catalogVersion,
        customerSnapshot: input.customerSnapshot,
        quoteSnapshot: input.quoteSnapshot,
        updatedAt: new Date(),
        version: sql`${quotes.version} + 1`,
      })
      .where(and(eq(quotes.id, id), eq(quotes.version, expectedVersion), eq(quotes.status, "confirmed"), isNull(quotes.deletedAt)))
      .returning();
    if (!row) return null;
    await this.executor.delete(quoteLines).where(eq(quoteLines.quoteId, id));
    const lineValues = lineValuesFor(id, input.quoteSnapshot);
    if (lineValues.length > 0) await this.executor.insert(quoteLines).values(lineValues);
    return mapQuote(row);
  }

  async writeAudit(input: {
    actorUserId: string;
    storeId: string;
    quoteId: string;
    beforeSnapshot: Record<string, unknown>;
    afterSnapshot: Record<string, unknown>;
  }): Promise<void> {
    await this.executor.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      storeId: input.storeId,
      entityType: "quote",
      entityId: input.quoteId,
      action: "quote.update",
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
    });
  }

  async setDeletedAt(
    id: string,
    deletedAt: Date | null,
  ): Promise<ConfirmedQuote | null> {
    const [row] = await this.executor
      .update(quotes)
      .set({
        deletedAt,
        updatedAt: new Date(),
        version: sql`${quotes.version} + 1`,
      })
      .where(eq(quotes.id, id))
      .returning();
    return row ? mapQuote(row) : null;
  }

  async recordPrint(input: {
    quoteId: string;
    userId: string;
  }): Promise<void> {
    const [previous] = await this.executor
      .select({ id: printEvents.id })
      .from(printEvents)
      .where(eq(printEvents.quoteId, input.quoteId))
      .limit(1);
    await this.executor.insert(printEvents).values({
      quoteId: input.quoteId,
      userId: input.userId,
      eventType: previous ? "reprint" : "initial",
    });
  }
}
