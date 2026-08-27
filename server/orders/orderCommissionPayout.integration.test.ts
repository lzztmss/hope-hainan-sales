import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  commissionLedger,
  customers,
  orders,
  quotes,
  settlementBatches,
  settlementItems,
  stores,
  users,
} from "../db/schema.js";
import { DrizzleOrderRepository } from "./orderRepository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("按订单批量发放提成", () => {
  it("退款扣回先冲减净额，发放后保留完整历史且幂等", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-order-payout-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");
    await migrateDatabase(databasePath);
    const client = createDatabaseClient(databasePath);
    const storeId = "00000000-0000-4000-8000-000000000101";
    const sellerId = "00000000-0000-4000-8000-000000000102";
    const hrId = "00000000-0000-4000-8000-000000000103";
    const customerId = "00000000-0000-4000-8000-000000000104";
    const quoteId = "00000000-0000-4000-8000-000000000105";
    const orderId = "00000000-0000-4000-8000-000000000106";
    await client.db.insert(stores).values({ id: storeId, code: "PAY001", name: "发放测试营业厅" });
    await client.db.insert(users).values([
      {
        id: sellerId, workNo: "SELLER-PAY", displayName: "测试销售", passwordHash: "not-used",
        role: "sales", personnelType: "unicom", storeId, active: true, mustChangePassword: false,
      },
      {
        id: hrId, workNo: "HR-PAY", displayName: "测试人事", passwordHash: "not-used",
        role: "hr", personnelType: "hope", storeId: null, active: true, mustChangePassword: false,
      },
    ]);
    await client.db.insert(customers).values({
      id: customerId, storeId, ownerUserId: sellerId, nameEncrypted: "test", phoneEncrypted: "test",
      phoneLookupHash: "payout-phone", phoneTail: "0000", elderCount: 1, createdBy: sellerId,
    });
    await client.db.insert(quotes).values({
      id: quoteId, quoteNo: "XLX-PAYOUT", idempotencyKey: "quote-payout-key", customerId, storeId,
      sellerId, status: "converted", paymentMode: "one_time", fttrKind: "none", fttrPlan: null,
      fttrMonthlyFen: 0, heartMonthlyFen: 0, oneTimeFen: 10000, monthlyTotalFen: 0,
      contract36Fen: 0, catalogVersion: "test", customerSnapshot: {}, quoteSnapshot: {}, confirmedAt: new Date(),
    });
    const paidAt = new Date("2026-08-27T02:00:00.000Z");
    await client.db.insert(orders).values({
      id: orderId, orderNo: "XLXDD-PAYOUT", quoteId, customerId, idempotencyKey: "order-payout-key",
      storeId, sellerId, status: "paid", salesChannel: "offline", paymentMode: "one_time",
      fttrKind: "none", fttrPlan: null, fttrMonthlyFen: 0, heartMonthlyFen: 0, oneTimeFen: 10000,
      monthlyTotalFen: 0, contract36Fen: 0, catalogVersion: "test", catalogSnapshot: {},
      customerSnapshot: {}, quoteSnapshot: {}, storeSnapshot: {}, sellerSnapshot: {}, createdBy: sellerId,
      signedAt: paidAt, reconciledAt: paidAt, paidAt,
    });
    await client.db.insert(commissionLedger).values([
      {
        orderId, beneficiaryId: sellerId, storeId, entryType: "accrual", eventKey: "activation:payout",
        amountFen: 10000, occurredAt: paidAt, createdBy: sellerId,
      },
      {
        orderId, beneficiaryId: sellerId, storeId, entryType: "return_reversal", eventKey: "return:payout",
        amountFen: -2000, occurredAt: paidAt, createdBy: sellerId,
      },
    ]);
    const repository = new DrizzleOrderRepository(client);
    const first = await repository.payCommissionsForOrders([orderId], hrId, paidAt, "payout-idempotency-key");
    const repeated = await repository.payCommissionsForOrders([orderId], hrId, paidAt, "payout-idempotency-key");
    expect(first).toEqual({ paidOrders: 1, totalFen: 8000 });
    expect(repeated).toEqual(first);
    expect((await client.db.select().from(settlementBatches))).toHaveLength(1);
    expect((await client.db.select().from(settlementItems))).toHaveLength(2);
    const order = await repository.findById(orderId, { kind: "global" });
    expect(order).toMatchObject({
      commissionPayoutStatus: "paid",
      commissionNetFen: 8000,
      commissionPaidFen: 8000,
      commissionReversedFen: 2000,
    });
    await client.db.update(orders).set({ status: "returned" });
    const paidOrders = await repository.list(
      { kind: "global" },
      { collectionStatus: "paid", page: 1, limit: 20 },
    );
    expect(paidOrders.items.map((item) => item.orderNo)).toEqual(["XLXDD-PAYOUT"]);
    expect(paidOrders.items[0]?.status).toBe("returned");
    await client.close();
  });
});
