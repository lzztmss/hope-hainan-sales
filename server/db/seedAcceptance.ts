import { hash } from "@node-rs/argon2";
import { eq, inArray } from "drizzle-orm";

import { migrateDatabase } from "./migrate.js";
import { createDatabaseClient } from "./client.js";
import { stores, users } from "./schema.js";
import { regionalCommissionTemplateAssignments, regionalCommissionTemplateVersions, regionalManagerStoreHistory, regionalManagerStores } from "./schema.js";
import { seedBootstrapAdmin } from "./seed.js";
import { DEFAULT_REGIONAL_COMMISSION_RULES } from "../../shared/regionalCommission/types.js";

const sqlitePath = process.env.ACCEPTANCE_SQLITE_PATH?.trim();
const password = process.env.ACCEPTANCE_PASSWORD ?? "11223344";

if (!sqlitePath) {
  throw new Error("ACCEPTANCE_SQLITE_PATH 未配置");
}
if (!/(^|[/\\])acceptance(?:[.-]|$)/i.test(sqlitePath)) {
  throw new Error("验收库文件名必须以 acceptance 开头，避免误写日常数据库");
}
if (password.length < 8 || password.length > 128) {
  throw new Error("ACCEPTANCE_PASSWORD 长度必须为 8 至 128 个字符");
}

await migrateDatabase(sqlitePath);
await seedBootstrapAdmin({
  sqlitePath,
  username: "admin",
  password: "AcceptanceBootstrap123",
});

const client = createDatabaseClient(sqlitePath);
try {
  const passwordHash = await hash(password);
  const now = new Date();
  const [headquarters] = await client.db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.code, "HQ"))
    .limit(1);
  if (!headquarters) throw new Error("公司总部初始化失败");

  const [acceptanceStore] = await client.db
    .insert(stores)
    .values({ code: "ACCEPT001", name: "海口验收营业厅" })
    .onConflictDoUpdate({
      target: stores.code,
      set: { name: "海口验收营业厅", active: true, updatedAt: now },
    })
    .returning({ id: stores.id });
  if (!acceptanceStore) throw new Error("验收营业厅初始化失败");

  await client.db
    .update(users)
    .set({ active: false, isPrimaryStoreManager: false, updatedAt: now })
    .where(inArray(users.workNo, ["ADMIN001", "MANAGER001", "SALES001"]));

  await client.db
    .insert(users)
    .values({
      workNo: "ADMIN",
      displayName: "验收管理员",
      passwordHash,
      role: "admin",
      personnelType: "admin",
      storeId: headquarters.id,
      active: true,
      mustChangePassword: false,
    })
    .onConflictDoUpdate({
      target: users.workNo,
      set: {
        displayName: "验收管理员",
        passwordHash,
        role: "admin",
        personnelType: "admin",
        storeId: headquarters.id,
        active: true,
        mustChangePassword: false,
        isPrimaryStoreManager: false,
        updatedAt: now,
      },
    });

  await client.db
    .update(users)
    .set({ isPrimaryStoreManager: false, updatedAt: now })
    .where(eq(users.storeId, acceptanceStore.id));

  await client.db
    .insert(users)
    .values({
      workNo: "MANAGE",
      displayName: "验收营业厅经理",
      passwordHash,
      role: "store_manager",
      personnelType: "unicom",
      storeId: acceptanceStore.id,
      active: true,
      mustChangePassword: false,
      isPrimaryStoreManager: true,
    })
    .onConflictDoUpdate({
      target: users.workNo,
      set: {
        displayName: "验收营业厅经理",
        passwordHash,
        role: "store_manager",
        personnelType: "unicom",
        storeId: acceptanceStore.id,
        active: true,
        mustChangePassword: false,
        isPrimaryStoreManager: true,
        updatedAt: now,
      },
    });

  await client.db
    .insert(users)
    .values({
      workNo: "SALE",
      displayName: "验收营业员",
      passwordHash,
      role: "sales",
      personnelType: "unicom",
      storeId: acceptanceStore.id,
      active: true,
      mustChangePassword: false,
    })
    .onConflictDoUpdate({
      target: users.workNo,
      set: {
        displayName: "验收营业员",
        passwordHash,
        role: "sales",
        personnelType: "unicom",
        storeId: acceptanceStore.id,
        active: true,
        mustChangePassword: false,
        isPrimaryStoreManager: false,
        updatedAt: now,
      },
    });

  for (const account of [
    { workNo: "HR", displayName: "验收人力资源", role: "hr" as const },
    {
      workNo: "FINANCE",
      displayName: "验收财务",
      role: "finance" as const,
    },
  ]) {
    await client.db
      .insert(users)
      .values({
        ...account,
        passwordHash,
        personnelType: "admin",
        storeId: null,
        active: true,
        mustChangePassword: false,
      })
      .onConflictDoUpdate({
        target: users.workNo,
        set: {
          displayName: account.displayName,
          passwordHash,
          role: account.role,
          personnelType: "admin",
          storeId: null,
          active: true,
          mustChangePassword: false,
          isPrimaryStoreManager: false,
          updatedAt: now,
        },
      });
  }

  const [admin] = await client.db.select({ id: users.id }).from(users).where(eq(users.workNo, "ADMIN")).limit(1);
  const [regional] = await client.db.insert(users).values({
    workNo: "REGIONAL", displayName: "验收大区经理", passwordHash,
    role: "regional_manager", personnelType: "admin", storeId: null,
    employmentStartDate: "2026-01-15", active: true, mustChangePassword: false,
  }).onConflictDoUpdate({ target: users.workNo, set: { passwordHash, active: true, mustChangePassword: false, updatedAt: now } }).returning({ id: users.id });
  if (!admin || !regional) throw new Error("验收大区账号初始化失败");
  await client.db.insert(regionalManagerStores).values({ regionalManagerId: regional.id, storeId: acceptanceStore.id }).onConflictDoNothing();
  await client.db.insert(regionalManagerStoreHistory).values({ regionalManagerId: regional.id, storeId: acceptanceStore.id, effectiveFrom: new Date("2026-01-15T00:00:00+08:00") }).onConflictDoNothing();
  const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({ templateCode: "REGIONAL_DEFAULT", versionNo: 1, name: "海南大区经理默认提成", status: "published", effectiveFrom: "2026-01-15", rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>, createdBy: admin.id, publishedBy: admin.id, publishedAt: now, changeReason: "验收预置" }).onConflictDoNothing().returning({ id: regionalCommissionTemplateVersions.id });
  if (template) await client.db.insert(regionalCommissionTemplateAssignments).values({ regionalManagerId: regional.id, templateVersionId: template.id, effectiveFrom: "2026-01-15", assignedBy: admin.id, reason: "验收预置" });

  console.log("验收数据已就绪：admin / manage / sale / regional / hr / finance");
} finally {
  await client.close();
}
