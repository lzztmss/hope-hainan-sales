import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import {
  createCommissionDashboardService,
  type DashboardLedgerRecord,
} from "./dashboardService.js";

const sales: AuthenticatedUser = {
  id: "sales-1",
  displayName: "销售员",
  role: "sales",
  storeId: "store-1",
  storeName: "测试营业厅",
  mustChangePassword: false,
};

const ledger = (
  id: string,
  amountFen: number,
  lifecycle: Partial<Pick<DashboardLedgerRecord, "orderStatus" | "signedAt" | "reconciledAt" | "orderPaidAt" | "settlementStatus" | "paidAt">>,
): DashboardLedgerRecord => ({
  id,
  orderId: `order-${id}`,
  orderNo: `XLXDD-${id}`,
  orderStatus: lifecycle.orderStatus ?? "activated",
  customerNameEncrypted: null,
  customerPhoneTail: "8000",
  customerSnapshot: { name: "测试客户" },
  beneficiaryId: sales.id,
  beneficiaryName: sales.displayName,
  storeId: sales.storeId,
  entryType: "accrual",
  eventKey: `activation:order-${id}`,
  amountFen,
  reason: null,
  occurredAt: new Date("2026-08-10T02:00:00.000Z"),
  ruleId: "rule-1",
  ruleSku: "SKU-1",
  ruleName: "测试规则",
  activatedAt: new Date("2026-08-10T02:00:00.000Z"),
  signedAt: lifecycle.signedAt ?? null,
  reconciledAt: lifecycle.reconciledAt ?? null,
  orderPaidAt: lifecycle.orderPaidAt ?? null,
  orderCreatedAt: new Date("2026-08-09T02:00:00.000Z"),
  calculationSnapshot: { items: [] },
  settlementStatus: lifecycle.settlementStatus ?? null,
  settlementAmountFen: null,
  paidAt: lifecycle.paidAt ?? null,
});

describe("提成按订单资金阶段汇总", () => {
  it("未签收进入预计，已签收进入待结算，已收款进入待发放", async () => {
    const signedAt = new Date("2026-08-12T02:00:00.000Z");
    const orderPaidAt = new Date("2026-08-20T02:00:00.000Z");
    const rows = [
      ledger("ACTIVATED", 10_000, { orderStatus: "activated" }),
      ledger("SIGNED", 20_000, { orderStatus: "signed", signedAt }),
      ledger("PAID", 30_000, { orderStatus: "paid", signedAt, orderPaidAt }),
    ];
    const service = createCommissionDashboardService({
      now: () => new Date("2026-08-26T02:00:00.000Z"),
      repository: {
        listLedger: async () => rows,
        listEstimatedOrders: async () => [],
        listMissingAccrualOrders: async () => [],
        findEffectivePolicy: async () => null,
      },
    });

    const dashboard = await service.getDashboard(sales, { month: "2026-08" });
    expect(dashboard.summary.estimatedFen).toBe(10_000);
    expect(dashboard.summary.pendingSettlementFen).toBe(20_000);
    expect(dashboard.summary.pendingPaymentFen).toBe(30_000);
    expect(dashboard.orders.find((order) => order.orderId === "order-SIGNED")?.statusLabel).toBe("已签收 · 待结算");
    expect(dashboard.orders.find((order) => order.orderId === "order-PAID")?.statusLabel).toBe("已收款 · 待发放");
  });

  it("单笔订单缺少激活时间时标记异常而不是导致整页失败", async () => {
    const referenceAt = new Date("2026-08-20T02:00:00.000Z");
    const service = createCommissionDashboardService({
      now: () => new Date("2026-08-26T02:00:00.000Z"),
      repository: {
        listLedger: async () => [],
        listEstimatedOrders: async () => [],
        listMissingAccrualOrders: async () => [{
          id: "order-missing-activation",
          orderNo: "XLXDD-MISSING-ACTIVATION",
          customerNameEncrypted: null,
          customerPhoneTail: "8000",
          customerSnapshot: { name: "测试客户" },
          activatedAt: null,
          referenceAt,
          issue: "missing_activation",
        }],
        findEffectivePolicy: async () => null,
      },
    });

    const dashboard = await service.getDashboard(sales, { month: "2026-08" });
    expect(dashboard.orders[0]).toMatchObject({
      orderNo: "XLXDD-MISSING-ACTIVATION",
      activatedAt: "未记录",
      status: "exception",
      statusLabel: "提成异常 · 缺少激活时间 · 待管理员处理",
    });
  });
});
