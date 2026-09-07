import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { regionalManagerStoreHistory, stores, users } from "../db/schema.js";
import { DrizzleAdminRepository } from "./adminRepository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("大区经理营业厅历史关系", () => {
  it("调整管理范围时保留旧关系并闭合生效区间", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-regional-history-"));
    temporaryDirectories.push(directory);
    const client = createDatabaseClient(join(directory, "app.sqlite"));
    await client.close();
    await migrateDatabase(join(directory, "app.sqlite"));
    const database = createDatabaseClient(join(directory, "app.sqlite"));
    const managerId = "00000000-0000-4000-8000-000000000301";
    const firstStoreId = "00000000-0000-4000-8000-000000000302";
    const secondStoreId = "00000000-0000-4000-8000-000000000303";
    await database.db.insert(stores).values([
      { id: firstStoreId, code: "RG001", name: "大区历史一厅" },
      { id: secondStoreId, code: "RG002", name: "大区历史二厅" },
    ]);
    await database.db.insert(users).values({
      id: managerId,
      workNo: "REGIONAL-HISTORY",
      displayName: "历史测试大区经理",
      passwordHash: "not-used",
      role: "regional_manager",
      personnelType: "unicom",
      active: true,
      mustChangePassword: false,
      employmentStartDate: "2026-08-01",
    });
    const repository = new DrizzleAdminRepository(database);
    const startedAt = new Date("2026-08-01T00:00:00+08:00");
    const changedAt = new Date("2026-09-01T00:00:00+08:00");
    await repository.replaceRegionalManagerStores(managerId, [firstStoreId], startedAt);
    await repository.replaceRegionalManagerStores(managerId, [secondStoreId], changedAt);

    const history = await database.db.select().from(regionalManagerStoreHistory);
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeId: firstStoreId, effectiveFrom: startedAt, effectiveTo: changedAt }),
      expect.objectContaining({ storeId: secondStoreId, effectiveFrom: changedAt, effectiveTo: null }),
    ]));
    await database.close();
  });
});
