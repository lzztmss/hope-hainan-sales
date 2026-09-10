import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  regionalCommissionTargetPlans,
  users,
} from "../db/schema.js";
import { DrizzleAdminRepository } from "./adminRepository.js";
import { createAdminService } from "./adminService.js";
import { buildPresetHalfYearPlan } from "./regionalCommissionTargetPlan.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("大区经理首个半年目标计划", () => {
  it("月末入职跨短月份时保持周期连续", () => {
    const plan = buildPresetHalfYearPlan("2026-01-31");
    expect(plan.periods.slice(0, 3)).toEqual([
      { sequence: 1, startsOn: "2026-01-31", endsOn: "2026-02-27", targetOrderCount: 1000, cumulativeTargetOrderCount: 1000 },
      { sequence: 2, startsOn: "2026-02-28", endsOn: "2026-03-30", targetOrderCount: 4000, cumulativeTargetOrderCount: 5000 },
      { sequence: 3, startsOn: "2026-03-31", endsOn: "2026-04-29", targetOrderCount: 8000, cumulativeTargetOrderCount: 13000 },
    ]);
  });

  it("创建账号时不再自动生成独立目标计划", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-regional-plan-"));
    temporaryDirectories.push(directory);
    const sqlitePath = join(directory, "app.sqlite");
    await migrateDatabase(sqlitePath);
    const database = createDatabaseClient(sqlitePath);
    const adminId = "00000000-0000-4000-8000-000000000401";
    await database.db.insert(users).values({
      id: adminId,
      workNo: "PLAN-ADMIN",
      displayName: "计划管理员",
      passwordHash: "not-used",
      role: "admin",
      personnelType: "admin",
      active: true,
      mustChangePassword: false,
    });
    const actor: AuthenticatedUser = {
      id: adminId,
      displayName: "计划管理员",
      role: "admin",
      storeId: null,
      mustChangePassword: false,
    };
    const service = createAdminService({
      repository: new DrizzleAdminRepository(database),
      pii: {
        encryptPii: (value) => value,
        decryptPii: (value) => value,
        phoneLookupHash: (value) => value,
      },
      hashPassword: async () => "hashed-for-test",
      now: () => new Date("2026-09-03T12:00:00+08:00"),
    });

    const manager = await service.createUser(actor, {
      workNo: "REGIONAL-PLAN",
      displayName: "半年计划大区经理",
      role: "regional_manager",
      personnelType: "unicom",
      storeId: null,
      managedStoreIds: [],
      employmentStartDate: "2026-09-06",
      initialPassword: "password-for-test",
      reason: "验证半年目标计划",
    });

    const plans = await database.db
      .select()
      .from(regionalCommissionTargetPlans)
      .where(eq(regionalCommissionTargetPlans.regionalManagerId, manager.id));
    expect(plans).toHaveLength(0);
    await database.close();
  });
});
