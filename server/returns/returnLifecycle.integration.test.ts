import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  customers,
  orderLines,
  orders,
  quotes,
  stores,
  users,
} from "../db/schema.js";
import { DrizzleReturnRepository } from "./returnRepository.js";
import { createReturnService } from "./returnService.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

const createFixture = async (initialStatus: "activated" | "completed") => {
  const directory = await mkdtemp(join(tmpdir(), "hfttr-return-lifecycle-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "app.sqlite");
  await migrateDatabase(databasePath);
  const client = createDatabaseClient(databasePath);
  const storeId = "00000000-0000-4000-8000-000000000021";
  const sellerId = "00000000-0000-4000-8000-000000000022";
  const adminId = "00000000-0000-4000-8000-000000000023";
  const customerId = "00000000-0000-4000-8000-000000000024";
  const quoteId = "00000000-0000-4000-8000-000000000025";

  await client.db.insert(stores).values({
    id: storeId,
    code: "RETURN001",
    name: "退单测试营业厅",
  });
  await client.db.insert(users).values([
    {
      id: sellerId,
      workNo: "SELLER-RETURN",
      displayName: "退单申请人",
      passwordHash: "not-used",
      role: "sales",
      personnelType: "unicom",
      storeId,
      active: true,
      mustChangePassword: false,
    },
    {
      id: adminId,
      workNo: "ADMIN-RETURN",
      displayName: "退单审批人",
      passwordHash: "not-used",
      role: "admin",
      personnelType: "unicom",
      active: true,
      mustChangePassword: false,
    },
  ]);
  await client.db.insert(customers).values({
    id: customerId,
    storeId,
    ownerUserId: sellerId,
    nameEncrypted: "test",
    phoneEncrypted: "test",
    phoneLookupHash: "return-test-phone",
    phoneTail: "0000",
    elderCount: 1,
    createdBy: sellerId,
  });
  await client.db.insert(quotes).values({
    id: quoteId,
    quoteNo: "XLX-TEST-RETURN",
    idempotencyKey: "quote-return-test-key",
    customerId,
    storeId,
    sellerId,
    status: "converted",
    paymentMode: "one_time",
    fttrKind: "none",
    fttrMonthlyFen: 0,
    heartMonthlyFen: 0,
    oneTimeFen: 39900,
    monthlyTotalFen: 0,
    contract36Fen: 39900,
    catalogVersion: "test",
    customerSnapshot: {},
    quoteSnapshot: {},
    confirmedAt: new Date(),
  });
  const [order] = await client.db.insert(orders).values({
    orderNo: "XLXDD-TEST-RETURN",
    quoteId,
    customerId,
    idempotencyKey: "order-return-test-key",
    storeId,
    sellerId,
    status: initialStatus,
    paymentMode: "one_time",
    fttrKind: "none",
    fttrMonthlyFen: 0,
    heartMonthlyFen: 0,
    oneTimeFen: 39900,
    monthlyTotalFen: 0,
    contract36Fen: 39900,
    catalogVersion: "test",
    catalogSnapshot: {},
    customerSnapshot: {},
    quoteSnapshot: {},
    storeSnapshot: {},
    sellerSnapshot: {},
    createdBy: sellerId,
    acceptedAt: new Date(),
    activatedAt: new Date(),
    completedAt: initialStatus === "completed" ? new Date() : null,
  }).returning();
  if (!order) throw new Error("测试订单创建失败");
  await client.db.insert(orderLines).values({
    orderId: order.id,
    lineType: "charge",
    sku: "GATEWAY",
    label: "迷你网关",
    unit: "个",
    quantity: 1,
    oneTimeUnitFen: 39900,
    oneTimeSubtotalFen: 39900,
    monthlyUnitFen: 0,
    monthlySubtotalFen: 0,
    locations: [],
  });

  const seller: AuthenticatedUser = {
    id: sellerId,
    displayName: "退单申请人",
    role: "sales",
    storeId,
    storeName: "退单测试营业厅",
    mustChangePassword: false,
  };
  const admin: AuthenticatedUser = {
    id: adminId,
    displayName: "退单审批人",
    role: "admin",
    storeId: null,
    storeName: null,
    mustChangePassword: false,
  };

  return { client, order, seller, admin };
};

describe("退单状态与提成冲销一致性", () => {
  it("管理员可审批自己提交的退单并保留审计", async () => {
    const { client, order, admin } = await createFixture("completed");
    const repository = new DrizzleReturnRepository(client);
    const service = createReturnService({
      repository,
      commissionReversal: {
        validateReversalForCompletedReturn: async () => undefined,
        reverseForCompletedReturn: async () => undefined,
      },
      numberSuffix: () => "ADMIN",
    });

    const requested = await service.requestReturn(
      admin,
      order.id,
      { type: "full", reason: "管理员代客户申请退货", items: [] },
      "return-request-admin-self-001",
    );
    const approved = await service.decideReturn(
      admin,
      requested.id,
      "approved",
      "管理员确认客户材料完整",
    );

    expect(approved.status).toBe("approved");
    await client.close();
  });

  it("退单被驳回后恢复原订单状态", async () => {
    const { client, order, seller, admin } = await createFixture("completed");
    const repository = new DrizzleReturnRepository(client);
    const service = createReturnService({
      repository,
      commissionReversal: {
        validateReversalForCompletedReturn: async () => undefined,
        reverseForCompletedReturn: async () => undefined,
      },
      numberSuffix: () => "REJECT",
    });

    const requested = await service.requestReturn(
      seller,
      order.id,
      { type: "full", reason: "客户申请退货", items: [] },
      "return-request-reject-001",
    );
    expect((await repository.findOrderForReturn(order.id))?.status).toBe(
      "return_pending",
    );

    await service.decideReturn(admin, requested.id, "rejected", "材料不齐全");
    expect((await repository.findOrderForReturn(order.id))?.status).toBe(
      "completed",
    );
    await client.close();
  });

  it("冲销预检失败不会提前完成退单，重试后完整收口", async () => {
    const { client, order, seller, admin } = await createFixture("activated");
    const repository = new DrizzleReturnRepository(client);
    let reversalReady = false;
    let reversalCount = 0;
    const service = createReturnService({
      repository,
      commissionReversal: {
        validateReversalForCompletedReturn: async () => {
          if (!reversalReady) throw new Error("提成冲销预检失败");
        },
        reverseForCompletedReturn: async () => {
          reversalCount += 1;
        },
      },
      numberSuffix: () => "FINISH",
    });

    const requested = await service.requestReturn(
      seller,
      order.id,
      { type: "full", reason: "客户申请退货", items: [] },
      "return-request-finish-001",
    );
    await service.decideReturn(admin, requested.id, "approved", "同意退货");

    await expect(
      service.completeReturn(
        admin,
        requested.id,
        39900,
        "return-complete-finish-001",
      ),
    ).rejects.toThrow("提成冲销预检失败");
    expect((await repository.findRequestById(requested.id))?.status).toBe(
      "approved",
    );
    expect((await repository.findOrderForReturn(order.id))?.status).toBe(
      "return_pending",
    );
    expect(reversalCount).toBe(0);

    reversalReady = true;
    const completed = await service.completeReturn(
      admin,
      requested.id,
      39900,
      "return-complete-finish-001",
    );
    expect(completed.status).toBe("completed");
    expect(completed.refundFen).toBe(39900);
    expect((await repository.findOrderForReturn(order.id))?.status).toBe(
      "returned",
    );
    expect(reversalCount).toBe(1);
    await client.close();
  });
});
