import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";

import { DEFAULT_COMMISSION_RULES } from "../../shared/commission/commissionEngine.js";
import { DrizzleCommissionRuleRepository } from "../commissions/ruleRepository.js";
import { createCommissionRuleService } from "../commissions/ruleService.js";
import { createDatabaseClient } from "./client.js";
import { stores, users } from "./schema.js";

export interface BootstrapAdminInput {
  sqlitePath: string;
  username: string;
  password: string;
}

export interface BootstrapAdminResult {
  created: boolean;
  userId: string;
  storeId: string;
}

export const seedBootstrapAdmin = async (
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> => {
  const sqlitePath = input.sqlitePath.trim();
  const username = input.username.trim().toUpperCase();
  const password = input.password;

  if (!sqlitePath || !username || !password) {
    throw new Error(
      "运行种子前必须配置 SQLITE_PATH、BOOTSTRAP_ADMIN_USERNAME 和 BOOTSTRAP_ADMIN_PASSWORD",
    );
  }

  if (password.length < 12) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD 至少需要 12 个字符");
  }

  const client = createDatabaseClient(sqlitePath);
  try {
    const [store] = await client.db
      .insert(stores)
      .values({ code: "HQ", name: "公司总部" })
      .onConflictDoUpdate({
        target: stores.code,
        set: { name: "公司总部", updatedAt: new Date() },
      })
      .returning({ id: stores.id });

    if (!store) {
      throw new Error("无法创建或读取公司总部营业厅");
    }

    const [existing] = await client.db
      .select({ id: users.id, storeId: users.storeId, role: users.role })
      .from(users)
      .where(eq(users.workNo, username))
      .limit(1);

    if (existing && existing.role !== "admin") {
      throw new Error("BOOTSTRAP_ADMIN_USERNAME 已被非管理员账号占用");
    }

    let userId = existing?.id;
    let createdAdmin = false;
    if (!userId) {
      const [created] = await client.db
        .insert(users)
        .values({
          workNo: username,
          displayName: "系统管理员",
          passwordHash: await hash(password),
          role: "admin",
          personnelType: "admin",
          storeId: store.id,
          mustChangePassword: true,
        })
        .returning({ id: users.id });

      if (!created) throw new Error("无法创建初始管理员");
      userId = created.id;
      createdAdmin = true;
    }

    const policyService = createCommissionRuleService({
      repository: new DrizzleCommissionRuleRepository(client),
    });
    const actor = {
      id: userId,
      displayName: "系统管理员",
      role: "admin" as const,
      storeId: existing?.storeId ?? store.id,
      mustChangePassword: true,
    };
    if ((await policyService.listVersions(actor)).length === 0) {
      const effectiveFrom = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const draft = await policyService.createDraft(actor, {
        name: "海南心连心默认提成",
        effectiveFrom,
        reason: "系统初始化默认提成规则",
        rules: DEFAULT_COMMISSION_RULES.map(({ id: _id, ...rule }) => ({
          ...rule,
          scope:
            rule.scope.kind === "global"
              ? { kind: "global" as const }
              : { ...rule.scope },
        })),
      });
      await policyService.publish(actor, draft.id, "启用系统默认提成规则");
    }

    return {
      created: createdAdmin,
      userId,
      storeId: existing?.storeId ?? store.id,
    };
  } finally {
    await client.close();
  }
};

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  await seedBootstrapAdmin({
    sqlitePath: process.env.SQLITE_PATH ?? "",
    username: process.env.BOOTSTRAP_ADMIN_USERNAME ?? "",
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "",
  });
}
