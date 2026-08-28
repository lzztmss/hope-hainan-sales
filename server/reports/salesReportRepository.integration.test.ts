import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  customers,
  orderLines,
  orders,
  quotes,
  returnItems,
  returns,
  stores,
  users,
} from "../db/schema.js";
import { DrizzleSalesReportRepository } from "./salesReportRepository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("销售报表退货后的月费口径", () => {
  it("部分退货保留FTTR并扣减心连心月增费，整单退货将月费归零", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-sales-report-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");
    await migrateDatabase(databasePath);
    const client = createDatabaseClient(databasePath);
    const storeId = "00000000-0000-4000-8000-000000000501";
    const sellerId = "00000000-0000-4000-8000-000000000502";
    const customerId = "00000000-0000-4000-8000-000000000503";
    const at = new Date("2026-08-10T02:00:00.000Z");

    await client.db.insert(stores).values({ id: storeId, code: "REPORT01", name: "报表测试营业厅" });
    await client.db.insert(users).values({
      id: sellerId,
      workNo: "REPORT-SALES",
      displayName: "报表测试销售",
      passwordHash: "not-used",
      role: "sales",
      personnelType: "unicom",
      storeId,
      active: true,
      mustChangePassword: false,
    });
    await client.db.insert(customers).values({
      id: customerId,
      storeId,
      ownerUserId: sellerId,
      nameEncrypted: "test",
      phoneEncrypted: "test",
      phoneLookupHash: "report-monthly-phone",
      phoneTail: "8000",
      elderCount: 1,
      createdBy: sellerId,
    });

    const makeOrder = async (suffix: "1" | "2", status: "paid" | "returned") => {
      const quoteId = `00000000-0000-4000-8000-00000000051${suffix}`;
      const orderId = `00000000-0000-4000-8000-00000000052${suffix}`;
      await client.db.insert(quotes).values({
        id: quoteId,
        quoteNo: `XLX-REPORT-${suffix}`,
        idempotencyKey: `quote-report-${suffix}`,
        customerId,
        storeId,
        sellerId,
        status: "converted",
        paymentMode: "contract_36",
        fttrKind: "standard",
        fttrPlan: 159,
        fttrMonthlyFen: 15_900,
        heartMonthlyFen: 3_000,
        oneTimeFen: 0,
        monthlyTotalFen: 18_900,
        contract36Fen: 680_400,
        catalogVersion: "test",
        customerSnapshot: {},
        quoteSnapshot: {},
        confirmedAt: at,
        createdAt: at,
      });
      await client.db.insert(orders).values({
        id: orderId,
        orderNo: `XLXDD-REPORT-${suffix}`,
        quoteId,
        customerId,
        idempotencyKey: `order-report-${suffix}`,
        storeId,
        sellerId,
        status,
        salesChannel: "offline",
        paymentMode: "contract_36",
        fttrKind: "standard",
        fttrPlan: 159,
        fttrMonthlyFen: 15_900,
        heartMonthlyFen: 3_000,
        oneTimeFen: 0,
        monthlyTotalFen: 18_900,
        contract36Fen: 680_400,
        catalogVersion: "test",
        catalogSnapshot: {},
        customerSnapshot: {},
        quoteSnapshot: {},
        storeSnapshot: {},
        sellerSnapshot: {},
        createdBy: sellerId,
        activatedAt: at,
        signedAt: at,
        reconciledAt: at,
        paidAt: at,
        createdAt: at,
      });
      return orderId;
    };

    const partialOrderId = await makeOrder("1", "paid");
    await makeOrder("2", "returned");
    const [returnedLine] = await client.db.insert(orderLines).values({
      orderId: partialOrderId,
      lineType: "charge",
      sku: "MONTHLY_DEVICE",
      label: "月付设备",
      unit: "个",
      quantity: 1,
      oneTimeUnitFen: 0,
      oneTimeSubtotalFen: 0,
      monthlyUnitFen: 1_000,
      monthlySubtotalFen: 1_000,
      locations: [],
    }).returning();
    const [completedReturn] = await client.db.insert(returns).values({
      returnNo: "XLX-RT-REPORT-1",
      idempotencyKey: "return-report-1",
      completionIdempotencyKey: "return-complete-report-1",
      orderId: partialOrderId,
      serviceType: "refund",
      returnType: "partial",
      returnKind: "normal",
      reasonCategory: "quality",
      orderStatusBefore: "paid",
      status: "completed",
      reason: "月付设备退货",
      requestedBy: sellerId,
      requestedAt: at,
      decidedBy: sellerId,
      decidedAt: at,
      completedBy: sellerId,
      completedAt: at,
      requestedRefundFen: 1_000,
      refundFen: 1_000,
    }).returning();
    await client.db.insert(returnItems).values({
      returnId: completedReturn!.id,
      orderLineId: returnedLine!.id,
      orderLineQuantity: 1,
      sku: "MONTHLY_DEVICE",
      label: "月付设备",
      quantity: 1,
      refundFen: 1_000,
      itemSnapshot: {},
    });

    const facts = await new DrizzleSalesReportRepository(client).loadFacts(
      { kind: "global" },
      {
        from: "2026-08-01",
        to: "2026-08-31",
        start: new Date("2026-07-31T16:00:00.000Z"),
        endExclusive: new Date("2026-08-31T16:00:00.000Z"),
      },
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      fttrMonthlyFen: 15_900,
      heartMonthlyFen: 2_000,
      contract36Fen: 644_400,
    });
    await client.close();
  });
});
