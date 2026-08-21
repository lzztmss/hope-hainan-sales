import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import type { UserScope } from "../auth/authorization.js";
import type { DbClient } from "../db/client.js";
import { customers, orders, quotes, stores, users } from "../db/schema.js";
import type { CustomerListRecord, CustomerRepository } from "./customerService.js";

const scopeCondition = (scope: UserScope): SQL | undefined => {
  if (scope.kind === "global") return undefined;
  if (scope.kind === "store") return eq(customers.storeId, scope.storeId);
  return and(
    eq(customers.storeId, scope.storeId),
    eq(customers.ownerUserId, scope.sellerId),
  );
};

export class DrizzleCustomerRepository implements CustomerRepository {
  constructor(private readonly client: DbClient) {}

  async list(
    scope: UserScope,
    filters: { storeId?: string; ownerUserId?: string },
    paging: { page: number; pageSize: number; unpaged?: boolean },
  ): Promise<{ items: readonly CustomerListRecord[]; total: number }> {
    const scoped = scopeCondition(scope);
    const ownershipFilters = [scoped];
    if (filters.storeId) ownershipFilters.push(eq(customers.storeId, filters.storeId));
    if (filters.ownerUserId) ownershipFilters.push(eq(customers.ownerUserId, filters.ownerUserId));
    const where = and(isNull(customers.deletedAt), ...ownershipFilters);
    const [totalRow] = await this.client.db
      .select({ value: count() })
      .from(customers)
      .where(where);
    let query = this.client.db
      .select({
        id: customers.id,
        storeId: customers.storeId,
        storeName: stores.name,
        ownerUserId: customers.ownerUserId,
        ownerName: users.displayName,
        nameEncrypted: customers.nameEncrypted,
        phoneEncrypted: customers.phoneEncrypted,
        roomType: customers.roomType,
        elderCount: customers.elderCount,
        quoteCount: sql<number>`COUNT(DISTINCT ${quotes.id})`,
        orderCount: sql<number>`COUNT(DISTINCT ${orders.id})`,
        lastQuoteAt: sql<Date | null>`MAX(${quotes.confirmedAt})`,
        updatedAt: customers.updatedAt,
      })
      .from(customers)
      .innerJoin(stores, eq(stores.id, customers.storeId))
      .innerJoin(users, eq(users.id, customers.ownerUserId))
      .leftJoin(quotes, and(eq(quotes.customerId, customers.id), isNull(quotes.deletedAt)))
      .leftJoin(orders, and(eq(orders.customerId, customers.id), isNull(orders.deletedAt)))
      .where(where)
      .groupBy(customers.id, stores.name, users.displayName)
      .orderBy(desc(customers.updatedAt), desc(customers.id));
    if (!paging.unpaged) {
      query = query.limit(paging.pageSize).offset((paging.page - 1) * paging.pageSize) as typeof query;
    }
    const rows = await query;
    return { items: rows.map((row) => ({
      ...row,
      quoteCount: Number(row.quoteCount),
      orderCount: Number(row.orderCount),
      lastQuoteAt: row.lastQuoteAt ? new Date(row.lastQuoteAt) : null,
    })), total: Number(totalRow?.value ?? 0) };
  }
}
