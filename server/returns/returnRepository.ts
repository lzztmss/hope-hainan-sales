import { and, count, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase, DbClient, DbTransaction } from "../db/client.js";
import type { UserScope } from "../auth/authorization.js";
import { refundableUnitFenFor } from "../../shared/pricing/returnPolicy.js";
import {
  auditLogs,
  orderLines,
  orders,
  returnItems,
  returns as returnTable,
  users,
} from "../db/schema.js";
import type {
  ReturnCompletionWrite,
  ReturnAuditInput,
  ReturnDecisionWrite,
  ReturnItemRecord,
  ReturnOrderRecord,
  ReturnRepository,
  ReturnRequestRecord,
  ReturnRequestWrite,
} from "./returnService.js";

type QueryExecutor = AppDatabase | DbTransaction;
type ReturnRow = typeof returnTable.$inferSelect;
type ReturnItemRow = typeof returnItems.$inferSelect;

const snapshotMaxRefund = (row: ReturnItemRow): number => {
  const value = row.itemSnapshot.maxRefundFen;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("退单明细缺少可退金额快照");
  }
  return value as number;
};

const mapItem = (row: ReturnItemRow): ReturnItemRecord => ({
  orderLineId: row.orderLineId,
  orderLineQuantity: row.orderLineQuantity,
  sku: row.sku,
  label: row.label,
  quantity: row.quantity,
  maxRefundFen: snapshotMaxRefund(row),
});

const mapRequest = (
  row: ReturnRow,
  itemRows: readonly ReturnItemRow[],
  orderNo: string,
  requestedByName: string | null,
): ReturnRequestRecord => {
  const items = itemRows.map(mapItem);
  return {
    id: row.id,
    returnNo: row.returnNo,
    orderNo,
    idempotencyKey: row.idempotencyKey,
    completionIdempotencyKey: row.completionIdempotencyKey,
    orderId: row.orderId,
    serviceType: row.serviceType,
    returnType: row.returnType,
    returnKind: row.returnKind,
    reasonCategory: row.reasonCategory,
    orderStatusBefore: row.orderStatusBefore,
    status: row.status,
    reason: row.reason,
    requestedBy: row.requestedBy,
    requestedByName,
    requestedAt: row.requestedAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    completedBy: row.completedBy,
    completedAt: row.completedAt,
    requestedRefundFen: row.requestedRefundFen,
    refundFen: row.refundFen,
    maxRefundFen: items.reduce((sum, item) => sum + item.maxRefundFen, 0),
    items,
  };
};

export class DrizzleReturnRepository implements ReturnRepository {
  constructor(
    private readonly client: DbClient,
    private readonly executor: QueryExecutor = client.db,
    private readonly insideTransaction = false,
  ) {}

  async runTransaction<T>(
    work: (repository: ReturnRepository) => Promise<T>,
  ): Promise<T> {
    if (this.insideTransaction) return work(this);
    return this.client.withTransaction((tx) =>
      work(new DrizzleReturnRepository(this.client, tx, true)),
    );
  }

  private async loadRequest(row: ReturnRow): Promise<ReturnRequestRecord> {
    const [items, orderRows, userRows] = await Promise.all([
      this.executor
        .select()
        .from(returnItems)
        .where(eq(returnItems.returnId, row.id)),
      this.executor
        .select({ orderNo: orders.orderNo })
        .from(orders)
        .where(eq(orders.id, row.orderId))
        .limit(1),
      this.executor
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, row.requestedBy))
        .limit(1),
    ]);
    const orderNo = orderRows[0]?.orderNo;
    if (!orderNo) throw new Error("退单关联订单不存在");
    return mapRequest(row, items, orderNo, userRows[0]?.displayName ?? null);
  }

  async findByRequestIdempotencyKey(
    key: string,
  ): Promise<ReturnRequestRecord | null> {
    const [row] = await this.executor
      .select()
      .from(returnTable)
      .where(eq(returnTable.idempotencyKey, key))
      .limit(1);
    return row ? this.loadRequest(row) : null;
  }

  async findByCompletionIdempotencyKey(
    key: string,
  ): Promise<ReturnRequestRecord | null> {
    const [row] = await this.executor
      .select()
      .from(returnTable)
      .where(eq(returnTable.completionIdempotencyKey, key))
      .limit(1);
    return row ? this.loadRequest(row) : null;
  }

  async findOrderForReturn(orderId: string): Promise<ReturnOrderRecord | null> {
    const [order] = await this.executor
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        sellerId: orders.sellerId,
        storeId: orders.storeId,
        status: orders.status,
        salesChannel: orders.salesChannel,
        signedAt: orders.signedAt,
        paymentMode: orders.paymentMode,
        refundedFen: orders.refundedFen,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return null;

    const lines = await this.executor
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, orderId));
    const completedReturns = await this.executor
      .select({ id: returnTable.id })
      .from(returnTable)
      .where(
        and(
          eq(returnTable.orderId, orderId),
          eq(returnTable.status, "completed"),
          eq(returnTable.serviceType, "refund"),
        ),
      );
    const completedIds = completedReturns.map((entry) => entry.id);
    const returnedRows =
      completedIds.length === 0
        ? []
        : await this.executor
            .select({
              orderLineId: returnItems.orderLineId,
              quantity: returnItems.quantity,
            })
            .from(returnItems)
            .where(inArray(returnItems.returnId, completedIds));
    const returnedByLine = new Map<string, number>();
    for (const row of returnedRows) {
      returnedByLine.set(
        row.orderLineId,
        (returnedByLine.get(row.orderLineId) ?? 0) + row.quantity,
      );
    }

    return {
      ...order,
      lines: lines.map((line) => ({
        id: line.id,
        lineType: line.lineType,
        sku: line.sku,
        label: line.label,
        quantity: line.quantity,
        returnedQuantity: returnedByLine.get(line.id) ?? 0,
        refundableUnitFen: refundableUnitFenFor({
          paymentMode: order.paymentMode,
          oneTimeUnitFen: line.oneTimeUnitFen,
          monthlyUnitFen: line.monthlyUnitFen,
        }),
      })),
    };
  }

  async createRequest(input: ReturnRequestWrite): Promise<ReturnRequestRecord> {
    const [created] = await this.executor
      .insert(returnTable)
      .values({
        returnNo: input.returnNo,
        idempotencyKey: input.idempotencyKey,
        orderId: input.orderId,
        serviceType: input.serviceType,
        returnType: input.returnType,
        returnKind: input.returnKind,
        reasonCategory: input.reasonCategory,
        orderStatusBefore: input.orderStatusBefore,
        status: "requested",
        reason: input.reason,
        requestedBy: input.requestedBy,
        requestedAt: input.requestedAt,
        requestedRefundFen: input.requestedRefundFen,
      })
      .returning();
    if (!created) throw new Error("退单创建失败");
    await this.executor
      .insert(returnItems)
      .values(
        input.items.map((item) => ({
          returnId: created.id,
          orderLineId: item.orderLineId,
          orderLineQuantity: item.orderLineQuantity,
          sku: item.sku,
          label: item.label,
          quantity: item.quantity,
          refundFen: 0,
          itemSnapshot: { maxRefundFen: item.maxRefundFen },
        })),
      )
      .returning();
    await this.executor
      .update(orders)
      .set({
        status: "return_pending",
        updatedAt: input.requestedAt,
        version: sql`${orders.version} + 1`,
      })
      .where(
        and(
          eq(orders.id, input.orderId),
          inArray(orders.status, ["signed", "reconciled", "paid", "partially_returned"]),
        ),
      );
    return this.loadRequest(created);
  }

  async findRequestById(id: string): Promise<ReturnRequestRecord | null> {
    const [row] = await this.executor
      .select()
      .from(returnTable)
      .where(eq(returnTable.id, id))
      .limit(1);
    return row ? this.loadRequest(row) : null;
  }

  async listRequests(
    scope: UserScope,
    filters: {
      orderId?: string;
      status?: ReturnRequestRecord["status"];
      serviceType?: ReturnRequestRecord["serviceType"];
      returnKind?: ReturnRequestRecord["returnKind"];
      storeId?: string;
      sellerId?: string;
    },
    paging?: { page: number; pageSize: number },
  ): Promise<{ items: ReturnRequestRecord[]; total: number }> {
    const conditions = [];
    if (scope.kind === "store") conditions.push(eq(orders.storeId, scope.storeId));
    if (scope.kind === "region") conditions.push(inArray(orders.storeId, [...scope.storeIds]));
    if (scope.kind === "seller") {
      conditions.push(
        eq(orders.storeId, scope.storeId),
        eq(orders.sellerId, scope.sellerId),
      );
    }
    if (filters.orderId) conditions.push(eq(returnTable.orderId, filters.orderId));
    if (filters.status) conditions.push(eq(returnTable.status, filters.status));
    if (filters.serviceType) conditions.push(eq(returnTable.serviceType, filters.serviceType));
    if (filters.returnKind) conditions.push(eq(returnTable.returnKind, filters.returnKind));
    if (filters.storeId) conditions.push(eq(orders.storeId, filters.storeId));
    if (filters.sellerId) conditions.push(eq(orders.sellerId, filters.sellerId));
    const where = and(...conditions);
    const [totalRow] = await this.executor
      .select({ value: count() })
      .from(returnTable)
      .innerJoin(orders, eq(orders.id, returnTable.orderId))
      .where(where);
    let query = this.executor
      .select({ request: returnTable })
      .from(returnTable)
      .innerJoin(orders, eq(orders.id, returnTable.orderId))
      .where(where)
      .orderBy(sql`${returnTable.requestedAt} DESC`, sql`${returnTable.id} DESC`);
    if (paging) {
      query = query.limit(paging.pageSize).offset((paging.page - 1) * paging.pageSize) as typeof query;
    }
    const rows = await query;
    return {
      items: await Promise.all(rows.map(({ request }) => this.loadRequest(request))),
      total: Number(totalRow?.value ?? 0),
    };
  }

  async saveDecision(
    id: string,
    decision: ReturnDecisionWrite,
  ): Promise<ReturnRequestRecord> {
    const [updated] = await this.executor
      .update(returnTable)
      .set({
        ...decision,
        updatedAt: decision.decidedAt,
        version: sql`${returnTable.version} + 1`,
      })
      .where(
        and(eq(returnTable.id, id), eq(returnTable.status, "requested")),
      )
      .returning();
    if (!updated) throw new Error("退单已被其他操作更新");
    if (decision.status === "rejected") {
      await this.executor
        .update(orders)
        .set({
          status: updated.orderStatusBefore ?? "signed",
          updatedAt: decision.decidedAt,
          version: sql`${orders.version} + 1`,
        })
        .where(
          and(eq(orders.id, updated.orderId), eq(orders.status, "return_pending")),
        );
    }
    return this.loadRequest(updated);
  }

  async completeRequest(
    id: string,
    completion: ReturnCompletionWrite,
  ): Promise<ReturnRequestRecord> {
    const current = await this.findRequestById(id);
    if (!current) throw new Error("退单不存在");

    const itemRows = await this.executor
      .select()
      .from(returnItems)
      .where(eq(returnItems.returnId, id));
    const completionRefundFen = current.serviceType === "refund" ? completion.refundFen : 0;
    let remainingRefund = completionRefundFen;
    for (let index = 0; index < itemRows.length; index += 1) {
      const item = itemRows[index]!;
      const isLast = index === itemRows.length - 1;
      const allocated = isLast
        ? remainingRefund
        : current.maxRefundFen === 0
          ? 0
          : Math.floor(
              (completionRefundFen * snapshotMaxRefund(item)) /
                current.maxRefundFen,
            );
      remainingRefund -= allocated;
      await this.executor
        .update(returnItems)
        .set({ refundFen: allocated })
        .where(eq(returnItems.id, item.id));
    }

    const [updated] = await this.executor
      .update(returnTable)
      .set({
        status: "completed",
        completionIdempotencyKey: completion.completionIdempotencyKey,
        completedBy: completion.completedBy,
        completedAt: completion.completedAt,
        refundFen: completionRefundFen,
        updatedAt: completion.completedAt,
        version: sql`${returnTable.version} + 1`,
      })
      .where(and(eq(returnTable.id, id), eq(returnTable.status, "approved")))
      .returning();
    if (!updated) throw new Error("退单已被其他操作更新");

    if (current.serviceType === "exchange") {
      await this.executor
        .update(orders)
        .set({
          status: current.orderStatusBefore ?? "signed",
          updatedAt: completion.completedAt,
          version: sql`${orders.version} + 1`,
        })
        .where(eq(orders.id, current.orderId));
      return this.loadRequest(updated);
    }

    await this.executor
      .update(orders)
      .set({
        refundedFen: sql`${orders.refundedFen} + ${completionRefundFen}`,
        updatedAt: completion.completedAt,
        version: sql`${orders.version} + 1`,
      })
      .where(eq(orders.id, current.orderId));
    const order = await this.findOrderForReturn(current.orderId);
    if (!order) throw new Error("订单不存在");
    const fullyReturned = order.lines
      .filter((line) => line.lineType === "charge")
      .every((line) => line.returnedQuantity === line.quantity);
    await this.executor
      .update(orders)
      .set({
        // 部分退单是订单上的业务记录，不应覆盖“已签收/已对账/已收款”资金状态。
        // 只有所有计价商品都退完时，订单主状态才进入“已退单”。
        status: fullyReturned ? "returned" : current.orderStatusBefore ?? "signed",
        updatedAt: completion.completedAt,
      })
      .where(eq(orders.id, current.orderId));
    return this.loadRequest(updated);
  }

  async writeAudit(input: ReturnAuditInput): Promise<void> {
    await this.executor.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      storeId: input.storeId,
      entityType: "return",
      entityId: input.returnId,
      action: input.action,
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
      reason: input.reason,
    });
  }
}
