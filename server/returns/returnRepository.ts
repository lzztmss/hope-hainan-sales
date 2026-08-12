import { and, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase, DbClient, DbTransaction } from "../db/client.js";
import type { UserScope } from "../auth/authorization.js";
import {
  auditLogs,
  orderLines,
  orders,
  returnItems,
  returns as returnTable,
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
): ReturnRequestRecord => {
  const items = itemRows.map(mapItem);
  return {
    id: row.id,
    returnNo: row.returnNo,
    idempotencyKey: row.idempotencyKey,
    completionIdempotencyKey: row.completionIdempotencyKey,
    orderId: row.orderId,
    returnType: row.returnType,
    status: row.status,
    reason: row.reason,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    completedBy: row.completedBy,
    completedAt: row.completedAt,
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
    const items = await this.executor
      .select()
      .from(returnItems)
      .where(eq(returnItems.returnId, row.id));
    return mapRequest(row, items);
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
        and(eq(returnTable.orderId, orderId), eq(returnTable.status, "completed")),
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
        refundableUnitFen: line.oneTimeUnitFen,
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
        returnType: input.returnType,
        status: "requested",
        reason: input.reason,
        requestedBy: input.requestedBy,
        requestedAt: input.requestedAt,
      })
      .returning();
    if (!created) throw new Error("退单创建失败");
    const itemRows = await this.executor
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
          inArray(orders.status, ["activated", "completed", "partially_returned"]),
        ),
      );
    return mapRequest(created, itemRows);
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
    filters: { orderId?: string; status?: ReturnRequestRecord["status"] },
  ): Promise<ReturnRequestRecord[]> {
    const conditions = [];
    if (scope.kind === "store") conditions.push(eq(orders.storeId, scope.storeId));
    if (scope.kind === "seller") {
      conditions.push(
        eq(orders.storeId, scope.storeId),
        eq(orders.sellerId, scope.sellerId),
      );
    }
    if (filters.orderId) conditions.push(eq(returnTable.orderId, filters.orderId));
    if (filters.status) conditions.push(eq(returnTable.status, filters.status));
    const rows = await this.executor
      .select({ request: returnTable })
      .from(returnTable)
      .innerJoin(orders, eq(orders.id, returnTable.orderId))
      .where(and(...conditions))
      .orderBy(sql`${returnTable.requestedAt} DESC`, sql`${returnTable.id} DESC`);
    return Promise.all(rows.map(({ request }) => this.loadRequest(request)));
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
      const [order] = await this.executor
        .select({ completedAt: orders.completedAt })
        .from(orders)
        .where(eq(orders.id, updated.orderId))
        .limit(1);
      const completedReturns = await this.executor
        .select({ id: returnTable.id })
        .from(returnTable)
        .where(
          and(
            eq(returnTable.orderId, updated.orderId),
            eq(returnTable.status, "completed"),
          ),
        );
      await this.executor
        .update(orders)
        .set({
          status:
            completedReturns.length > 0
              ? "partially_returned"
              : order?.completedAt
                ? "completed"
                : "activated",
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
    let remainingRefund = completion.refundFen;
    for (let index = 0; index < itemRows.length; index += 1) {
      const item = itemRows[index]!;
      const isLast = index === itemRows.length - 1;
      const allocated = isLast
        ? remainingRefund
        : current.maxRefundFen === 0
          ? 0
          : Math.floor(
              (completion.refundFen * snapshotMaxRefund(item)) /
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
        refundFen: completion.refundFen,
        updatedAt: completion.completedAt,
        version: sql`${returnTable.version} + 1`,
      })
      .where(and(eq(returnTable.id, id), eq(returnTable.status, "approved")))
      .returning();
    if (!updated) throw new Error("退单已被其他操作更新");

    await this.executor
      .update(orders)
      .set({
        refundedFen: sql`${orders.refundedFen} + ${completion.refundFen}`,
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
        status: fullyReturned ? "returned" : "partially_returned",
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
