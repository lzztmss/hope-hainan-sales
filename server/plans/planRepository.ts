import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase, DbClient, DbTransaction } from "../db/client.js";
import {
  auditLogs,
  subscriptionPlanItems,
  subscriptionPlans,
} from "../db/schema.js";
import type {
  SubscriptionPlanRecord,
  SubscriptionPlanRepository,
  SubscriptionPlanWrite,
} from "./planService.js";

export class DrizzleSubscriptionPlanRepository
  implements SubscriptionPlanRepository
{
  constructor(private readonly client: DbClient) {}

  private async hydrate(
    row: typeof subscriptionPlans.$inferSelect,
    executor: AppDatabase | DbTransaction = this.client.db,
  ): Promise<SubscriptionPlanRecord> {
    const items = await executor
      .select()
      .from(subscriptionPlanItems)
      .where(eq(subscriptionPlanItems.planId, row.id))
      .orderBy(asc(subscriptionPlanItems.createdAt), asc(subscriptionPlanItems.id));
    return {
      ...row,
      contractMonths: 36,
      items: items.map((item) => ({
        sku: item.productSku as SubscriptionPlanRecord["items"][number]["sku"],
        quantity: item.quantity,
      })),
    };
  }

  async list(includeInactive: boolean): Promise<readonly SubscriptionPlanRecord[]> {
    const rows = await this.client.db
      .select()
      .from(subscriptionPlans)
      .where(includeInactive ? undefined : eq(subscriptionPlans.active, true))
      .orderBy(asc(subscriptionPlans.name), asc(subscriptionPlans.code));
    if (rows.length === 0) return [];

    const items = await this.client.db
      .select()
      .from(subscriptionPlanItems)
      .where(inArray(subscriptionPlanItems.planId, rows.map((row) => row.id)))
      .orderBy(asc(subscriptionPlanItems.createdAt), asc(subscriptionPlanItems.id));
    const itemsByPlan = new Map<string, SubscriptionPlanRecord["items"][number][]>();
    for (const item of items) {
      const planItems = itemsByPlan.get(item.planId) ?? [];
      planItems.push({
        sku: item.productSku as SubscriptionPlanRecord["items"][number]["sku"],
        quantity: item.quantity,
      });
      itemsByPlan.set(item.planId, planItems);
    }

    return rows.map((row) => ({
      ...row,
      contractMonths: 36 as const,
      items: itemsByPlan.get(row.id) ?? [],
    }));
  }

  async findById(id: string): Promise<SubscriptionPlanRecord | null> {
    const [row] = await this.client.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, id))
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  async findByCode(code: string): Promise<SubscriptionPlanRecord | null> {
    const [row] = await this.client.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.code, code))
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  async create(input: SubscriptionPlanWrite): Promise<SubscriptionPlanRecord> {
    return this.client.withTransaction(async (tx) => {
      const [created] = await tx
        .insert(subscriptionPlans)
        .values({
          code: input.code,
          name: input.name,
          description: input.description,
          monthlyFen: input.monthlyFen,
          contractMonths: 36,
          active: input.active,
          createdBy: input.createdBy,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .returning();
      if (!created) throw new Error("套餐创建失败");
      await tx.insert(subscriptionPlanItems).values(
        input.items.map((item) => ({
          planId: created.id,
          productSku: item.sku,
          quantity: item.quantity,
          createdAt: input.at,
        })),
      );
      return this.hydrate(created, tx);
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    input: SubscriptionPlanWrite,
  ): Promise<SubscriptionPlanRecord | null> {
    return this.client.withTransaction(async (tx) => {
      const [updated] = await tx
        .update(subscriptionPlans)
        .set({
          code: input.code,
          name: input.name,
          description: input.description,
          monthlyFen: input.monthlyFen,
          active: input.active,
          updatedAt: input.at,
          version: sql`${subscriptionPlans.version} + 1`,
        })
        .where(sql`${subscriptionPlans.id} = ${id} AND ${subscriptionPlans.version} = ${expectedVersion}`)
        .returning();
      if (!updated) return null;
      await tx.delete(subscriptionPlanItems).where(eq(subscriptionPlanItems.planId, id));
      await tx.insert(subscriptionPlanItems).values(
        input.items.map((item) => ({
          planId: id,
          productSku: item.sku,
          quantity: item.quantity,
          createdAt: input.at,
        })),
      );
      return this.hydrate(updated, tx);
    });
  }

  async delete(id: string, expectedVersion: number): Promise<boolean> {
    return this.client.withTransaction(async (tx) => {
      const [deleted] = await tx
        .delete(subscriptionPlans)
        .where(and(
          eq(subscriptionPlans.id, id),
          eq(subscriptionPlans.version, expectedVersion),
        ))
        .returning({ id: subscriptionPlans.id });
      return Boolean(deleted);
    });
  }

  async writeAudit(input: Parameters<SubscriptionPlanRepository["writeAudit"]>[0]) {
    await this.client.db.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      entityType: "subscription_plan",
      entityId: input.planId,
      action: input.action,
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
      reason: input.reason,
    });
  }
}
