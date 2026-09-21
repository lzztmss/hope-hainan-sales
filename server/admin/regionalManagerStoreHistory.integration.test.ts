import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
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
  const setup = async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-regional-history-"));
    temporaryDirectories.push(directory);
    const client = createDatabaseClient(join(directory, "app.sqlite"));
    await client.close();
    await migrateDatabase(join(directory, "app.sqlite"));
    return createDatabaseClient(join(directory, "app.sqlite"));
  };

  it("调整管理范围时保留旧关系并闭合生效区间", async () => {
    const database = await setup();
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

  it("首次绑定营业厅时归属生效日取入职日期而不是操作时刻", async () => {
    const database = await setup();
    const managerId = "00000000-0000-4000-8000-000000000311";
    const storeId = "00000000-0000-4000-8000-000000000312";
    await database.db.insert(stores).values({ id: storeId, code: "RG011", name: "入职起算营业厅" });
    await database.db.insert(users).values({
      id: managerId,
      workNo: "REGIONAL-HIRE-START",
      displayName: "回填入职日大区经理",
      passwordHash: "not-used",
      role: "regional_manager",
      personnelType: "unicom",
      active: true,
      mustChangePassword: false,
      employmentStartDate: "2026-07-01",
    });
    const repository = new DrizzleAdminRepository(database);
    const hiredAt = new Date("2026-07-01T00:00:00+08:00");
    const createdAt = new Date("2026-08-05T10:30:00+08:00");
    await repository.replaceRegionalManagerStores(managerId, [storeId], createdAt, hiredAt);

    const history = await database.db.select().from(regionalManagerStoreHistory);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ storeId, effectiveFrom: hiredAt, effectiveTo: null });
    await database.close();
  });

  it("首次绑定的归属起点不早于该营业厅上一段归属的结束日", async () => {
    const database = await setup();
    const predecessorId = "00000000-0000-4000-8000-000000000321";
    const managerId = "00000000-0000-4000-8000-000000000322";
    const handedOverStoreId = "00000000-0000-4000-8000-000000000323";
    const freshStoreId = "00000000-0000-4000-8000-000000000324";
    await database.db.insert(stores).values([
      { id: handedOverStoreId, code: "RG021", name: "前任移交营业厅" },
      { id: freshStoreId, code: "RG022", name: "全新营业厅" },
    ]);
    await database.db.insert(users).values([
      {
        id: predecessorId,
        workNo: "REGIONAL-PREDECESSOR",
        displayName: "前任大区经理",
        passwordHash: "not-used",
        role: "regional_manager",
        personnelType: "unicom",
        active: true,
        mustChangePassword: false,
        employmentStartDate: "2026-05-01",
      },
      {
        id: managerId,
        workNo: "REGIONAL-SUCCESSOR",
        displayName: "继任大区经理",
        passwordHash: "not-used",
        role: "regional_manager",
        personnelType: "unicom",
        active: true,
        mustChangePassword: false,
        employmentStartDate: "2026-07-01",
      },
    ]);
    await database.db.insert(regionalManagerStoreHistory).values({
      regionalManagerId: predecessorId,
      storeId: handedOverStoreId,
      effectiveFrom: new Date("2026-05-01T00:00:00+08:00"),
      effectiveTo: new Date("2026-07-20T00:00:00+08:00"),
    });
    const repository = new DrizzleAdminRepository(database);
    const hiredAt = new Date("2026-07-01T00:00:00+08:00");
    const createdAt = new Date("2026-08-05T10:30:00+08:00");
    await repository.replaceRegionalManagerStores(
      managerId,
      [handedOverStoreId, freshStoreId],
      createdAt,
      hiredAt,
    );

    const history = await database.db.select().from(regionalManagerStoreHistory)
      .where(eq(regionalManagerStoreHistory.regionalManagerId, managerId));
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        storeId: handedOverStoreId,
        effectiveFrom: new Date("2026-07-20T00:00:00+08:00"),
        effectiveTo: null,
      }),
      expect.objectContaining({ storeId: freshStoreId, effectiveFrom: hiredAt, effectiveTo: null }),
    ]));
    await database.close();
  });

  it("已有管理历史后中途新增营业厅仍按操作时刻归属", async () => {
    const database = await setup();
    const managerId = "00000000-0000-4000-8000-000000000331";
    const firstStoreId = "00000000-0000-4000-8000-000000000332";
    const secondStoreId = "00000000-0000-4000-8000-000000000333";
    await database.db.insert(stores).values([
      { id: firstStoreId, code: "RG031", name: "中途加厅一厅" },
      { id: secondStoreId, code: "RG032", name: "中途加厅二厅" },
    ]);
    await database.db.insert(users).values({
      id: managerId,
      workNo: "REGIONAL-MIDTERM",
      displayName: "中途扩围大区经理",
      passwordHash: "not-used",
      role: "regional_manager",
      personnelType: "unicom",
      active: true,
      mustChangePassword: false,
      employmentStartDate: "2026-06-15",
    });
    const repository = new DrizzleAdminRepository(database);
    const hiredAt = new Date("2026-06-15T00:00:00+08:00");
    const startedAt = new Date("2026-07-01T00:00:00+08:00");
    const expandedAt = new Date("2026-09-01T09:00:00+08:00");
    await repository.replaceRegionalManagerStores(managerId, [firstStoreId], startedAt, hiredAt);
    await repository.replaceRegionalManagerStores(managerId, [firstStoreId, secondStoreId], expandedAt, hiredAt);

    const history = await database.db.select().from(regionalManagerStoreHistory)
      .where(eq(regionalManagerStoreHistory.storeId, secondStoreId));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ storeId: secondStoreId, effectiveFrom: expandedAt, effectiveTo: null });
    await database.close();
  });
});
