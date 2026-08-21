import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  type SQL,
} from "drizzle-orm";

import type { AppDatabase, DbClient, DbTransaction } from "../db/client.js";
import { auditLogs, regionalManagerStores, sessions, stores, users } from "../db/schema.js";
import type {
  AdminAuditInput,
  AdminRepository,
  AdminStorePatch,
  AdminStoreRecord,
  AdminStoreWrite,
  AdminUserFilters,
  AdminUserPatch,
  AdminUserRecord,
  AdminUserWrite,
} from "./adminService.js";

type QueryExecutor = AppDatabase | DbTransaction;
type StoreRow = typeof stores.$inferSelect;

const toStoreRecord = (
  row: StoreRow,
  activeUserCount: number,
  manager?: { id: string; displayName: string } | null,
  regionalManager?: { id: string; displayName: string } | null,
): AdminStoreRecord => ({
  id: row.id,
  code: row.code,
  name: row.name,
  active: row.active,
  activeUserCount,
  managerUserId: manager?.id ?? null,
  managerName: manager?.displayName ?? null,
  regionalManagerUserId: regionalManager?.id ?? null,
  regionalManagerName: regionalManager?.displayName ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const userSelection = {
  id: users.id,
  workNo: users.workNo,
  displayName: users.displayName,
  passwordHash: users.passwordHash,
  phoneEncrypted: users.phoneEncrypted,
  phoneLookupHash: users.phoneLookupHash,
  role: users.role,
  personnelType: users.personnelType,
  storeId: users.storeId,
  storeName: stores.name,
  active: users.active,
  isPrimaryStoreManager: users.isPrimaryStoreManager,
  mustChangePassword: users.mustChangePassword,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export class DrizzleAdminRepository implements AdminRepository {
  constructor(
    private readonly client: DbClient,
    private readonly executor: QueryExecutor = client.db,
    private readonly insideTransaction = false,
  ) {}

  async runTransaction<T>(
    work: (repository: AdminRepository) => Promise<T>,
  ): Promise<T> {
    if (this.insideTransaction) return work(this);
    return this.client.withTransaction((tx) =>
      work(new DrizzleAdminRepository(this.client, tx, true)),
    );
  }

  async lockAdministration(): Promise<void> {
    // SQLite 写事务由 BEGIN IMMEDIATE 串行化，无需额外的数据库级锁。
  }

  private async activeUserCount(storeId: string): Promise<number> {
    const [row] = await this.executor
      .select({ value: count(users.id) })
      .from(users)
      .where(and(eq(users.storeId, storeId), eq(users.active, true)));
    return row?.value ?? 0;
  }

  private async primaryManager(storeId: string) {
    const [manager] = await this.executor
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(
        and(
          eq(users.storeId, storeId),
          eq(users.isPrimaryStoreManager, true),
        ),
      )
      .limit(1);
    return manager ?? null;
  }

  private async regionalManager(storeId: string) {
    const [manager] = await this.executor
      .select({ id: users.id, displayName: users.displayName })
      .from(regionalManagerStores)
      .innerJoin(users, eq(users.id, regionalManagerStores.regionalManagerId))
      .where(eq(regionalManagerStores.storeId, storeId))
      .limit(1);
    return manager ?? null;
  }

  async listStores(): Promise<readonly AdminStoreRecord[]> {
    const [storeRows, countRows] = await Promise.all([
      this.executor.select().from(stores).orderBy(desc(stores.active), asc(stores.code)),
      this.executor
        .select({ storeId: users.storeId, value: count(users.id) })
        .from(users)
        .where(and(eq(users.active, true)))
        .groupBy(users.storeId),
    ]);
    const counts = new Map(
      countRows.flatMap((row): Array<[string, number]> =>
        row.storeId ? [[row.storeId, row.value]] : [],
      ),
    );
    return Promise.all(
      storeRows.map(async (row) =>
        toStoreRecord(
          row,
          counts.get(row.id) ?? 0,
          await this.primaryManager(row.id),
          await this.regionalManager(row.id),
        ),
      ),
    );
  }

  async findStoreForUpdate(id: string): Promise<AdminStoreRecord | null> {
    const [row] = await this.executor
      .select()
      .from(stores)
      .where(eq(stores.id, id))
      .limit(1);
    return row
      ? toStoreRecord(
          row,
          await this.activeUserCount(row.id),
          await this.primaryManager(row.id),
          await this.regionalManager(row.id),
        )
      : null;
  }

  async createStore(input: AdminStoreWrite): Promise<AdminStoreRecord> {
    const [row] = await this.executor.insert(stores).values(input).returning();
    if (!row) throw new Error("营业厅创建失败");
    return toStoreRecord(row, 0);
  }

  async updateStore(
    id: string,
    patch: AdminStorePatch,
  ): Promise<AdminStoreRecord | null> {
    const [row] = await this.executor
      .update(stores)
      .set(patch)
      .where(eq(stores.id, id))
      .returning();
    return row
      ? toStoreRecord(
          row,
          await this.activeUserCount(row.id),
          await this.primaryManager(row.id),
          await this.regionalManager(row.id),
        )
      : null;
  }

  async assignStoreManager(storeId: string, userId: string | null): Promise<void> {
    await this.executor
      .update(users)
      .set({ isPrimaryStoreManager: false, updatedAt: new Date() })
      .where(
        and(
          eq(users.storeId, storeId),
          eq(users.isPrimaryStoreManager, true),
        ),
      );
    if (userId) {
      await this.executor
        .update(users)
        .set({ isPrimaryStoreManager: true, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.storeId, storeId)));
    }
  }

  async listActiveUsersInStoreForUpdate(
    storeId: string,
  ): Promise<readonly string[]> {
    const rows = await this.executor
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.storeId, storeId), eq(users.active, true)))
      .orderBy(users.id);
    return rows.map((row) => row.id);
  }

  async listUsers(
    filters: AdminUserFilters,
  ): Promise<{ items: readonly AdminUserRecord[]; total: number; activeTotal: number; mustChangePasswordTotal: number }> {
    const conditions: SQL[] = [];
    if (filters.allowedStoreIds) {
      conditions.push(
        filters.allowedStoreIds.length > 0
          ? inArray(users.storeId, [...filters.allowedStoreIds])
          : eq(users.id, "__no_access__"),
      );
    }
    if (filters.storeId) conditions.push(eq(users.storeId, filters.storeId));
    if (filters.role) conditions.push(eq(users.role, filters.role));
    if (filters.active !== undefined) {
      conditions.push(eq(users.active, filters.active));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [[totalRow], [activeRow], [mustChangeRow]] = await Promise.all([
      this.executor.select({ value: count() }).from(users).where(where),
      this.executor.select({ value: count() }).from(users).where(and(where, eq(users.active, true))),
      this.executor.select({ value: count() }).from(users).where(and(where, eq(users.mustChangePassword, true))),
    ]);
    let query = this.executor
      .select(userSelection)
      .from(users)
      .leftJoin(stores, eq(stores.id, users.storeId))
      .where(where)
      .orderBy(desc(users.active), asc(users.workNo));
    if (!filters.query) {
      query = query
        .limit(filters.pageSize ?? 20)
        .offset(((filters.page ?? 1) - 1) * (filters.pageSize ?? 20)) as typeof query;
    }
    const rows = await query;
    const items = await Promise.all(
      rows.map(async (row) => {
        const assignments = await this.executor
          .select({ storeId: regionalManagerStores.storeId })
          .from(regionalManagerStores)
          .where(eq(regionalManagerStores.regionalManagerId, row.id));
        return { ...row, managedStoreIds: assignments.map((entry) => entry.storeId) };
      }),
    );
    return {
      items,
      total: Number(totalRow?.value ?? 0),
      activeTotal: Number(activeRow?.value ?? 0),
      mustChangePasswordTotal: Number(mustChangeRow?.value ?? 0),
    };
  }

  private async loadUser(id: string): Promise<AdminUserRecord | null> {
    const [row] = await this.executor
      .select(userSelection)
      .from(users)
      .leftJoin(stores, eq(stores.id, users.storeId))
      .where(eq(users.id, id))
      .limit(1);
    if (!row) return null;
    const assignments = await this.executor
      .select({ storeId: regionalManagerStores.storeId })
      .from(regionalManagerStores)
      .where(eq(regionalManagerStores.regionalManagerId, row.id));
    return { ...row, managedStoreIds: assignments.map((entry) => entry.storeId) };
  }

  async findUserForUpdate(id: string): Promise<AdminUserRecord | null> {
    const [locked] = await this.executor
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return locked ? this.loadUser(locked.id) : null;
  }

  async createUser(input: AdminUserWrite): Promise<AdminUserRecord> {
    const [row] = await this.executor.insert(users).values(input).returning({
      id: users.id,
    });
    if (!row) throw new Error("账号创建失败");
    const created = await this.loadUser(row.id);
    if (!created) throw new Error("账号创建后读取失败");
    return created;
  }

  async updateUser(
    id: string,
    patch: AdminUserPatch,
  ): Promise<AdminUserRecord | null> {
    const [row] = await this.executor
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return row ? this.loadUser(row.id) : null;
  }

  async replaceRegionalManagerStores(
    userId: string,
    storeIds: readonly string[],
    at: Date,
  ): Promise<void> {
    await this.executor
      .delete(regionalManagerStores)
      .where(eq(regionalManagerStores.regionalManagerId, userId));
    if (storeIds.length > 0) {
      await this.executor.insert(regionalManagerStores).values(
        storeIds.map((storeId) => ({
          regionalManagerId: userId,
          storeId,
          createdAt: at,
          updatedAt: at,
        })),
      );
    }
  }

  async listActiveAdminsForUpdate(): Promise<readonly string[]> {
    const rows = await this.executor
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true)))
      .orderBy(users.id);
    return rows.map((row) => row.id);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.executor.delete(sessions).where(eq(sessions.userId, userId));
  }

  async writeAudit(input: AdminAuditInput): Promise<void> {
    await this.executor.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      storeId: input.storeId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
      reason: input.reason,
      createdAt: input.createdAt,
    });
  }
}
