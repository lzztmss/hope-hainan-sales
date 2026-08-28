import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import { createCommissionDashboardService } from "../commissions/dashboardService.js";
import { DrizzleCommissionDashboardRepository } from "../commissions/dashboardRepository.js";
import { DrizzleCommissionLedgerRepository } from "../commissions/ledgerRepository.js";
import { createCommissionLedgerService } from "../commissions/ledgerService.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  commissionPolicyVersions,
  commissionRules,
  customers,
  orderAttributions,
  orderLines,
  orders,
  quotes,
  stores,
  users,
} from "../db/schema.js";
import { DrizzleOrderRepository } from "../orders/orderRepository.js";
import { createOrderService } from "../orders/orderService.js";
import { DrizzleSalesReportRepository } from "../reports/salesReportRepository.js";
import { createSalesReportService } from "../reports/salesReportService.js";
import { DrizzleReturnRepository } from "../returns/returnRepository.js";
import { createReturnService } from "../returns/returnService.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("订单、售后、收款与提成全流程", () => {
  it("普通退货在发放前冲减提成，特殊退货在发放后保留扣回并同步报表", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-financial-flow-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");
    await migrateDatabase(databasePath);
    const client = createDatabaseClient(databasePath);

    const ids = {
      store: "00000000-0000-4000-8000-000000000201",
      seller: "00000000-0000-4000-8000-000000000202",
      manager: "00000000-0000-4000-8000-000000000203",
      hr: "00000000-0000-4000-8000-000000000204",
      finance: "00000000-0000-4000-8000-000000000205",
      admin: "00000000-0000-4000-8000-000000000206",
      customer: "00000000-0000-4000-8000-000000000207",
      policy: "00000000-0000-4000-8000-000000000208",
      ruleA: "00000000-0000-4000-8000-000000000209",
      ruleB: "00000000-0000-4000-8000-000000000210",
    };
    const actor = (
      id: string,
      role: AuthenticatedUser["role"],
      displayName: string,
    ): AuthenticatedUser => ({
      id,
      displayName,
      role,
      storeId: role === "admin" || role === "hr" || role === "finance" ? null : ids.store,
      storeName: role === "admin" || role === "hr" || role === "finance" ? null : "全流程测试营业厅",
      mustChangePassword: false,
    });
    const seller = actor(ids.seller, "sales", "测试销售员");
    const manager = actor(ids.manager, "store_manager", "测试营业厅经理");
    const hr = actor(ids.hr, "hr", "测试人事");
    const finance = actor(ids.finance, "finance", "测试财务");
    const admin = actor(ids.admin, "admin", "测试管理员");

    await client.db.insert(stores).values({
      id: ids.store,
      code: "FLOW001",
      name: "全流程测试营业厅",
    });
    await client.db.insert(users).values([
      { id: ids.seller, workNo: "FLOW-SALES", displayName: seller.displayName, passwordHash: "not-used", role: "sales", personnelType: "unicom", storeId: ids.store, active: true, mustChangePassword: false },
      { id: ids.manager, workNo: "FLOW-MANAGER", displayName: manager.displayName, passwordHash: "not-used", role: "store_manager", personnelType: "unicom", storeId: ids.store, active: true, mustChangePassword: false },
      { id: ids.hr, workNo: "FLOW-HR", displayName: hr.displayName, passwordHash: "not-used", role: "hr", personnelType: "admin", active: true, mustChangePassword: false },
      { id: ids.finance, workNo: "FLOW-FINANCE", displayName: finance.displayName, passwordHash: "not-used", role: "finance", personnelType: "admin", active: true, mustChangePassword: false },
      { id: ids.admin, workNo: "FLOW-ADMIN", displayName: admin.displayName, passwordHash: "not-used", role: "admin", personnelType: "admin", active: true, mustChangePassword: false },
    ]);
    await client.db.insert(customers).values({
      id: ids.customer,
      storeId: ids.store,
      ownerUserId: ids.seller,
      nameEncrypted: "test",
      phoneEncrypted: "test",
      phoneLookupHash: "financial-flow-phone",
      phoneTail: "8000",
      elderCount: 1,
      createdBy: ids.seller,
    });
    const policyStart = new Date("2026-07-01T00:00:00.000Z");
    await client.db.insert(commissionPolicyVersions).values({
      id: ids.policy,
      policyCode: "HAINAN_FTTR_HEARTLINK",
      versionNo: 1,
      name: "全流程测试规则",
      status: "published",
      effectiveFrom: policyStart,
      createdBy: ids.admin,
      publishedBy: ids.admin,
      publishedAt: policyStart,
      changeNote: "全流程自动化测试",
    });
    await client.db.insert(commissionRules).values([
      {
        id: ids.ruleA,
        policyVersionId: ids.policy,
        ruleCode: "FLOW-DEVICE-A",
        ruleName: "设备A提成",
        businessDomain: "heartlink",
        targetType: "product",
        targetSku: "DEVICE_A",
        paymentModeScope: "all",
        calculationBasis: "per_unit",
        packageMode: "additive",
        amountFen: 1_000,
        effectiveFrom: policyStart,
        createdBy: ids.admin,
      },
      {
        id: ids.ruleB,
        policyVersionId: ids.policy,
        ruleCode: "FLOW-DEVICE-B",
        ruleName: "设备B提成",
        businessDomain: "heartlink",
        targetType: "product",
        targetSku: "DEVICE_B",
        paymentModeScope: "all",
        calculationBasis: "per_unit",
        packageMode: "additive",
        amountFen: 2_000,
        effectiveFrom: policyStart,
        createdBy: ids.admin,
      },
    ]);

    const createdAt = new Date("2026-08-01T01:00:00.000Z");
    const createOrder = async (suffix: string) => {
      const quoteId = `00000000-0000-4000-8000-0000000003${suffix}`;
      const orderId = `00000000-0000-4000-8000-0000000004${suffix}`;
      await client.db.insert(quotes).values({
        id: quoteId,
        quoteNo: `XLX-FLOW-${suffix}`,
        idempotencyKey: `quote-financial-flow-${suffix}`,
        customerId: ids.customer,
        storeId: ids.store,
        sellerId: ids.seller,
        status: "converted",
        paymentMode: "one_time",
        fttrKind: "none",
        fttrMonthlyFen: 0,
        heartMonthlyFen: 0,
        oneTimeFen: 30_000,
        monthlyTotalFen: 0,
        contract36Fen: 0,
        catalogVersion: "test",
        customerSnapshot: { name: "全流程客户" },
        quoteSnapshot: {},
        confirmedAt: createdAt,
        createdAt,
      });
      await client.db.insert(orders).values({
        id: orderId,
        orderNo: `XLXDD-FLOW-${suffix}`,
        quoteId,
        customerId: ids.customer,
        idempotencyKey: `order-financial-flow-${suffix}`,
        storeId: ids.store,
        sellerId: ids.seller,
        status: "accepted",
        salesChannel: "online",
        paymentMode: "one_time",
        fttrKind: "none",
        fttrMonthlyFen: 0,
        heartMonthlyFen: 0,
        oneTimeFen: 30_000,
        monthlyTotalFen: 0,
        contract36Fen: 0,
        catalogVersion: "test",
        catalogSnapshot: {},
        customerSnapshot: { name: "全流程客户" },
        quoteSnapshot: {},
        storeSnapshot: {},
        sellerSnapshot: {},
        createdBy: ids.seller,
        acceptedAt: createdAt,
        createdAt,
      });
      await client.db.insert(orderAttributions).values({
        orderId,
        beneficiaryId: ids.seller,
        attributionRole: "primary",
        basisPoints: 10_000,
        beneficiarySnapshot: { displayName: seller.displayName },
      });
      const lineRows = await client.db.insert(orderLines).values([
        { orderId, lineType: "charge", sku: "DEVICE_A", label: "自选设备A", unit: "个", quantity: 1, oneTimeUnitFen: 10_000, oneTimeSubtotalFen: 10_000, monthlyUnitFen: 0, monthlySubtotalFen: 0, locations: [] },
        { orderId, lineType: "charge", sku: "DEVICE_B", label: "自选设备B", unit: "个", quantity: 1, oneTimeUnitFen: 20_000, oneTimeSubtotalFen: 20_000, monthlyUnitFen: 0, monthlySubtotalFen: 0, locations: [] },
      ]).returning();
      return { orderId, lineAId: lineRows.find((line) => line.sku === "DEVICE_A")!.id };
    };
    const normal = await createOrder("01");
    const special = await createOrder("02");

    let clock = new Date("2026-08-01T02:00:00.000Z");
    const ledgerService = createCommissionLedgerService({
      repository: new DrizzleCommissionLedgerRepository(client),
      now: () => clock,
    });
    const orderRepository = new DrizzleOrderRepository(client);
    const orderService = createOrderService({
      repository: orderRepository,
      activeCatalogVersion: "test",
      commissionAccrual: ledgerService,
      now: () => clock,
    });
    let returnSuffix = 0;
    const returnService = createReturnService({
      repository: new DrizzleReturnRepository(client),
      commissionReversal: ledgerService,
      now: () => clock,
      numberSuffix: () => `FLOW${++returnSuffix}`,
    });
    const reload = async (orderId: string) => {
      const order = await orderRepository.findById(orderId, { kind: "global" });
      if (!order) throw new Error("测试订单不存在");
      return order;
    };

    for (const orderId of [normal.orderId, special.orderId]) {
      const activated = await orderService.transitionOrder(manager, orderId, "ACTIVATE", 1);
      expect(activated.status).toBe("activated");
      const signed = await orderService.transitionOrder(seller, orderId, "SIGN", activated.version);
      expect(signed.status).toBe("signed");
    }

    // 普通退货先完成，再进入批量对账、批量收款和批量提成发放。
    clock = new Date("2026-08-03T02:00:00.000Z");
    const normalReturn = await returnService.requestReturn(
      seller,
      normal.orderId,
      { serviceType: "refund", type: "partial", kind: "normal", reasonCategory: "quality", requestedRefundFen: 5_000, reason: "设备A质量问题", items: [{ orderLineId: normal.lineAId, quantity: 1 }] },
      "financial-flow-normal-request",
    );
    expect((await reload(normal.orderId)).status).toBe("return_pending");
    await returnService.decideReturn(manager, normalReturn.id, "approved", "同意普通退货");
    await returnService.completeReturn(manager, normalReturn.id, 5_000, "financial-flow-normal-complete");
    expect((await reload(normal.orderId)).status).toBe("signed");

    clock = new Date("2026-08-04T02:00:00.000Z");
    let normalOrder = await reload(normal.orderId);
    await orderService.batchTransitionOrders(hr, [{ orderId: normal.orderId, expectedVersion: normalOrder.version }], "RECONCILE");
    normalOrder = await reload(normal.orderId);
    await orderService.batchTransitionOrders(finance, [{ orderId: normal.orderId, expectedVersion: normalOrder.version }], "MARK_PAID");
    await orderService.batchPayCommissions(hr, [normal.orderId], "financial-flow-normal-payout");
    expect(await reload(normal.orderId)).toMatchObject({
      status: "paid",
      commissionNetFen: 2_000,
      commissionPaidFen: 2_000,
      commissionReversedFen: 1_000,
    });

    // 特殊退货在完成对账、收款和提成发放后发生，历史发放额应保留。
    let specialOrder = await reload(special.orderId);
    await orderService.batchTransitionOrders(hr, [{ orderId: special.orderId, expectedVersion: specialOrder.version }], "RECONCILE");
    specialOrder = await reload(special.orderId);
    await orderService.batchTransitionOrders(finance, [{ orderId: special.orderId, expectedVersion: specialOrder.version }], "MARK_PAID");
    await orderService.batchPayCommissions(hr, [special.orderId], "financial-flow-special-payout");

    clock = new Date("2026-08-20T02:00:00.000Z");
    await expect(returnService.requestReturn(
      seller,
      special.orderId,
      { serviceType: "refund", type: "partial", kind: "normal", reasonCategory: "quality", requestedRefundFen: 6_000, reason: "期限外设备A质量问题", items: [{ orderLineId: special.lineAId, quantity: 1 }] },
      "financial-flow-special-wrong-kind",
    )).rejects.toThrow("签收已超过7日");
    const specialReturn = await returnService.requestReturn(
      seller,
      special.orderId,
      { serviceType: "refund", type: "partial", kind: "special", reasonCategory: "quality", requestedRefundFen: 6_000, reason: "期限外设备A质量问题", items: [{ orderLineId: special.lineAId, quantity: 1 }] },
      "financial-flow-special-request",
    );
    expect(specialReturn.returnKind).toBe("special");
    await returnService.decideReturn(manager, specialReturn.id, "approved", "同意特殊退货");
    await returnService.completeReturn(manager, specialReturn.id, 6_000, "financial-flow-special-complete");
    expect(await reload(special.orderId)).toMatchObject({
      status: "paid",
      commissionNetFen: 2_000,
      commissionPaidFen: 3_000,
      commissionReversedFen: 1_000,
    });

    const dashboard = await createCommissionDashboardService({
      repository: new DrizzleCommissionDashboardRepository(client),
      now: () => clock,
    }).getDashboard(seller, { month: "2026-08", limit: 20 });
    expect(dashboard.summary).toMatchObject({
      accruedNetFen: 4_000,
      pendingSettlementFen: 0,
      pendingPaymentFen: 0,
      pendingDeductionFen: 1_000,
      paidThisMonthFen: 5_000,
      paidLifetimeFen: 5_000,
      reversedLifetimeFen: 2_000,
      netLifetimeFen: 4_000,
    });
    expect(dashboard.orders).toHaveLength(2);

    const report = await createSalesReportService({
      repository: new DrizzleSalesReportRepository(client),
      now: () => clock,
    }).getReport(admin, {
      from: "2026-08-01",
      to: "2026-08-31",
      groupBy: "seller",
    });
    expect(report.totals).toMatchObject({
      quoteCount: 2,
      orderCount: 2,
      oneTimeOriginalFen: 60_000,
      returnedFen: 11_000,
      oneTimeNetFen: 49_000,
      commissionPaidFen: 5_000,
      commissionReversedFen: 2_000,
      commissionNetFen: 4_000,
    });

    await client.close();
  });
});
