import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

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

const createFixture = async (
  initialStatus: "signed",
  signedAt = new Date(),
) => {
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
    signedAt,
    signedBy: sellerId,
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
  it("普通退货退款超过7日必须走特殊处理，并保留独立业务标识", async () => {
    const signedAt = new Date("2026-08-01T02:00:00.000Z");
    const current = new Date("2026-08-20T02:00:00.000Z");
    const { client, order, seller } = await createFixture("signed", signedAt);
    const service = createReturnService({
      repository: new DrizzleReturnRepository(client),
      commissionReversal: {
        validateReversalForCompletedReturn: async () => undefined,
        reverseForCompletedReturn: async () => undefined,
      },
      now: () => current,
      numberSuffix: () => "SPECIAL",
    });

    await expect(service.requestReturn(
      seller,
      order.id,
      { type: "full", kind: "normal", reasonCategory: "quality", reason: "超过十五日质量退款", items: [] },
      "return-request-too-late-normal-001",
    )).rejects.toThrow("签收已超过7日");

    const requested = await service.requestReturn(
      seller,
      order.id,
      { type: "full", kind: "special", reasonCategory: "quality", reason: "超过十五日质量退款", items: [] },
      "return-request-special-001",
    );
    expect(requested.returnKind).toBe("special");
    expect(requested.serviceType).toBe("refund");
    expect(requested.reasonCategory).toBe("quality");
    expect(requested.orderStatusBefore).toBe("signed");
    await client.close();
  });

  it("拒绝通过服务层直接创建换货申请", async () => {
    const { client, order, seller } = await createFixture("signed");
    const repository = new DrizzleReturnRepository(client);
    const service = createReturnService({
      repository,
      numberSuffix: () => "EXCHANGE",
    });
    await expect(service.requestReturn(
      seller,
      order.id,
      { serviceType: "exchange", type: "full", kind: "normal", reasonCategory: "quality", requestedRefundFen: 0, reason: "尝试申请换货", items: [] },
      "after-sales-exchange-request-001",
    )).rejects.toThrow("系统仅支持退货退款申请");
    await client.close();
  });

  it("实际退款可高于系统参考金额并保留实际值", async () => {
    const { client, order, seller, admin } = await createFixture("signed");
    const repository = new DrizzleReturnRepository(client);
    const service = createReturnService({
      repository,
      commissionReversal: {
        validateReversalForCompletedReturn: async () => undefined,
        reverseForCompletedReturn: async () => undefined,
      },
      numberSuffix: () => "OVERREF",
    });
    const requested = await service.requestReturn(
      seller,
      order.id,
      { serviceType: "refund", type: "full", kind: "normal", reasonCategory: "quality", requestedRefundFen: 50000, reason: "按实际业务金额申请退款", items: [] },
      "after-sales-over-reference-request-001",
    );
    expect(requested.maxRefundFen).toBe(39900);
    expect(requested.requestedRefundFen).toBe(50000);
    await service.decideReturn(admin, requested.id, "approved", "同意按实际金额退款");
    const completed = await service.completeReturn(admin, requested.id, 55000, "after-sales-over-reference-complete-001");
    expect(completed.refundFen).toBe(55000);
    expect((await repository.findOrderForReturn(order.id))?.refundedFen).toBe(55000);
    await client.close();
  });

  it("整单退单可同时退回完整套餐和自购商品", async () => {
    const { client, order, seller } = await createFixture("signed");
    await client.db.insert(orderLines).values({
      orderId: order.id,
      lineType: "charge",
      sku: "HOME_DUAL",
      label: "心连心·居家双护",
      unit: "套",
      quantity: 1,
      oneTimeUnitFen: 89900,
      oneTimeSubtotalFen: 89900,
      monthlyUnitFen: 0,
      monthlySubtotalFen: 0,
      locations: [],
    });
    const service = createReturnService({
      repository: new DrizzleReturnRepository(client),
      commissionReversal: {
        validateReversalForCompletedReturn: async () => undefined,
        reverseForCompletedReturn: async () => undefined,
      },
      numberSuffix: () => "PACKAGE",
    });

    const requested = await service.requestReturn(
      seller,
      order.id,
      { type: "full", reason: "客户申请整单退回", items: [] },
      "return-request-package-full-001",
    );

    expect(requested.orderNo).toBe("XLXDD-TEST-RETURN");
    expect(requested.items.map((item) => item.sku).sort()).toEqual([
      "GATEWAY",
      "HOME_DUAL",
    ]);
    expect(requested.maxRefundFen).toBe(129800);
    await client.close();
  });

  it("管理员可审批自己提交的退单并保留审计", async () => {
    const { client, order, admin } = await createFixture("signed");
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
    const { client, order, seller, admin } = await createFixture("signed");
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
      "signed",
    );
    await client.close();
  });

  it("部分退单完成后可继续退剩余商品并重新计算金额", async () => {
    const { client, order, seller, admin } = await createFixture("signed");
    await client.db.insert(orderLines).values({
      orderId: order.id,
      lineType: "charge",
      sku: "WATCH",
      label: "AI 健康智能手表",
      unit: "块",
      quantity: 1,
      oneTimeUnitFen: 59900,
      oneTimeSubtotalFen: 59900,
      monthlyUnitFen: 0,
      monthlySubtotalFen: 0,
      locations: [],
    });
    const repository = new DrizzleReturnRepository(client);
    let suffix = 0;
    const service = createReturnService({
      repository,
      commissionReversal: {
        validateReversalForCompletedReturn: async () => undefined,
        reverseForCompletedReturn: async () => undefined,
      },
      numberSuffix: () => `SEQ${++suffix}`,
    });
    const initial = await repository.findOrderForReturn(order.id);
    const gateway = initial?.lines.find((line) => line.sku === "GATEWAY");
    const watch = initial?.lines.find((line) => line.sku === "WATCH");
    expect(gateway).toBeDefined();
    expect(watch).toBeDefined();

    const first = await service.requestReturn(
      seller,
      order.id,
      {
        type: "partial",
        reason: "先退回迷你网关",
        items: [{ orderLineId: gateway!.id, quantity: 1 }],
      },
      "return-request-sequence-first-001",
    );
    expect(first.maxRefundFen).toBe(39900);
    await expect(
      service.requestReturn(
        seller,
        order.id,
        {
          type: "partial",
          reason: "审批中再次申请",
          items: [{ orderLineId: watch!.id, quantity: 1 }],
        },
        "return-request-sequence-block-001",
      ),
    ).rejects.toThrow("当前订单状态不可退单");
    await service.decideReturn(admin, first.id, "approved", "同意第一笔退单");
    await service.completeReturn(
      admin,
      first.id,
      39900,
      "return-complete-sequence-first-001",
    );
    expect((await repository.findOrderForReturn(order.id))?.status).toBe(
      "signed",
    );

    const second = await service.requestReturn(
      seller,
      order.id,
      {
        type: "partial",
        reason: "继续退回剩余手表",
        items: [{ orderLineId: watch!.id, quantity: 1 }],
      },
      "return-request-sequence-second-001",
    );
    expect(second.maxRefundFen).toBe(59900);
    await service.decideReturn(admin, second.id, "approved", "同意第二笔退单");
    await service.completeReturn(
      admin,
      second.id,
      59900,
      "return-complete-sequence-second-001",
    );
    const finished = await repository.findOrderForReturn(order.id);
    expect(finished?.status).toBe("returned");
    expect(finished?.refundedFen).toBe(99800);
    expect(finished?.lines.every((line) => line.returnedQuantity === line.quantity))
      .toBe(true);
    await client.close();
  });

  it("36 个月月付商品按本计费月月费计算退款上限", async () => {
    const { client, order, seller } = await createFixture("signed");
    await client.db
      .update(orders)
      .set({
        paymentMode: "contract_36",
        heartMonthlyFen: 4_000,
        monthlyTotalFen: 4_000,
        contract36Fen: 144_000,
      })
      .where(eq(orders.id, order.id));
    await client.db
      .update(orderLines)
      .set({
        sku: "MATTRESS",
        label: "睡眠监测床垫",
        oneTimeUnitFen: 0,
        oneTimeSubtotalFen: 0,
        monthlyUnitFen: 4_000,
        monthlySubtotalFen: 4_000,
      })
      .where(eq(orderLines.orderId, order.id));
    const repository = new DrizzleReturnRepository(client);
    const service = createReturnService({
      repository,
      commissionReversal: {
        validateReversalForCompletedReturn: async () => undefined,
        reverseForCompletedReturn: async () => undefined,
      },
      numberSuffix: () => "MONTHLY",
    });
    const line = (await repository.findOrderForReturn(order.id))?.lines[0];
    expect(line?.refundableUnitFen).toBe(4_000);

    const requested = await service.requestReturn(
      seller,
      order.id,
      {
        type: "partial",
        reason: "退回当月已收费的床垫",
        items: [{ orderLineId: line!.id, quantity: 1 }],
      },
      "return-request-monthly-fee-001",
    );

    expect(requested.maxRefundFen).toBe(4_000);
    expect(requested.items[0]?.maxRefundFen).toBe(4_000);
    await client.close();
  });

  it("冲销预检失败不会提前完成退单，重试后完整收口", async () => {
    const { client, order, seller, admin } = await createFixture("signed");
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
