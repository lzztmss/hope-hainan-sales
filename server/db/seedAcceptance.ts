import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";

import { migrateDatabase } from "./migrate.js";
import { createDatabaseClient } from "./client.js";
import { stores, users } from "./schema.js";
import { seedBootstrapAdmin } from "./seed.js";

const sqlitePath = process.env.ACCEPTANCE_SQLITE_PATH?.trim();
const password = process.env.ACCEPTANCE_PASSWORD ?? "Hainan@2026Test";

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
  username: "ADMIN001",
  password,
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
    .insert(users)
    .values({
      workNo: "ADMIN001",
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
      workNo: "MANAGER001",
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
      workNo: "SALES001",
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

  console.log("验收数据已就绪：ADMIN001 / MANAGER001 / SALES001");
} finally {
  await client.close();
}
