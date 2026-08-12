import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { customers, orders, quotes, stores, users } from "../db/schema.js";
import { DrizzleOrderRepository } from "./orderRepository.js";
import { createOrderService } from "./orderService.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("订单激活一致性", () => {
  it("提成规则预检失败时订单保持已受理", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-order-activation-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");
    await migrateDatabase(databasePath);
    const client = createDatabaseClient(databasePath);
    const storeId = "00000000-0000-4000-8000-000000000011";
    const managerId = "00000000-0000-4000-8000-000000000012";
    const customerId = "00000000-0000-4000-8000-000000000014";
    const quoteId = "00000000-0000-4000-8000-000000000013";
    await client.db.insert(stores).values({ id: storeId, code: "TEST002", name: "激活测试营业厅" });
    await client.db.insert(users).values({
      id: managerId,
      workNo: "MANAGER002",
      displayName: "测试经理",
      passwordHash: "not-used",
      role: "store_manager",
      personnelType: "unicom",
      storeId,
      active: true,
      mustChangePassword: false,
    });
    await client.db.insert(customers).values({
      id: customerId,
      storeId,
      ownerUserId: managerId,
      nameEncrypted: "test",
      phoneEncrypted: "test",
      phoneLookupHash: "activation-test-phone",
      phoneTail: "0000",
      elderCount: 1,
      createdBy: managerId,
    });
    await client.db.insert(quotes).values({
      id: quoteId,
      quoteNo: "XLX-TEST-ACTIVATION",
      idempotencyKey: "quote-activation-test-key",
      customerId,
      storeId,
      sellerId: managerId,
      status: "converted",
      paymentMode: "contract_36",
      fttrKind: "standard",
      fttrPlan: 159,
      fttrMonthlyFen: 15900,
      heartMonthlyFen: 2000,
      oneTimeFen: 0,
      monthlyTotalFen: 17900,
      contract36Fen: 644400,
      catalogVersion: "test",
      customerSnapshot: {},
      quoteSnapshot: {},
      confirmedAt: new Date(),
    });
    const [created] = await client.db.insert(orders).values({
      orderNo: "XLXDD-TEST-ACTIVATION",
      quoteId,
      customerId,
      idempotencyKey: "activation-test-key-123",
      storeId,
      sellerId: managerId,
      status: "accepted",
      paymentMode: "contract_36",
      fttrKind: "standard",
      fttrPlan: 159,
      fttrMonthlyFen: 15900,
      heartMonthlyFen: 2000,
      oneTimeFen: 0,
      monthlyTotalFen: 17900,
      contract36Fen: 644400,
      catalogVersion: "test",
      catalogSnapshot: {},
      customerSnapshot: {},
      quoteSnapshot: {},
      storeSnapshot: {},
      sellerSnapshot: {},
      createdBy: managerId,
      acceptedAt: new Date(),
    }).returning();
    if (!created) throw new Error("测试订单创建失败");
    const actor: AuthenticatedUser = {
      id: managerId,
      displayName: "测试经理",
      role: "store_manager",
      storeId,
      storeName: "激活测试营业厅",
      mustChangePassword: false,
    };
    const service = createOrderService({
      repository: new DrizzleOrderRepository(client),
      activeCatalogVersion: "test",
      commissionAccrual: {
        validateActivation: async () => { throw new Error("未找到生效的提成规则版本"); },
        accrueForActivatedOrder: async () => undefined,
      },
    });

    await expect(service.transitionOrder(actor, created.id, "ACTIVATE", 1)).rejects.toThrow(
      "未找到生效的提成规则版本",
    );
    const reloaded = await new DrizzleOrderRepository(client).findById(created.id, {
      kind: "store",
      storeId,
    });
    expect(reloaded?.status).toBe("accepted");
    expect(reloaded?.version).toBe(1);
    expect(reloaded?.activatedAt).toBeNull();
    await client.close();
  });
});
