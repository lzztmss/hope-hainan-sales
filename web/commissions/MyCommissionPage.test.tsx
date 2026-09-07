import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MyCommissionPage, type MyCommissionDashboard } from "./MyCommissionPage";

describe("我的提成异常订单", () => {
  it("展示未生成提成快照的订单且不补算金额", () => {
    const dashboard: MyCommissionDashboard = {
      periodLabel: "2026年8月",
      summary: {
        estimatedFen: 0,
        accruedNetFen: 0,
        pendingSettlementFen: 0,
        pendingPaymentFen: 0,
        pendingDeductionFen: 0,
        paidThisMonthFen: 0,
        paidLifetimeFen: 0,
        reversedLifetimeFen: 0,
        netLifetimeFen: 0,
      },
      unconfiguredOrders: 0,
      orders: [{
        orderId: "order-missing-accrual",
        orderNo: "XLXDD-20260812-E90CDA",
        customerMasked: "主** · 139****9000",
        activatedAt: "2026-08-12 21:46",
        status: "exception",
        statusLabel: "提成异常 · 激活时无有效规则 · 待管理员处理",
        amountFen: 0,
        lines: [],
      }],
    };

    render(<MyCommissionPage dashboard={dashboard} />);

    expect(screen.getByText("XLXDD-20260812-E90CDA")).toBeInTheDocument();
    expect(
      screen.getByText("提成异常 · 激活时无有效规则 · 待管理员处理"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/该订单未生成提成快照/),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("commission-order-order-missing-accrual"),
    ).toHaveTextContent("¥0.00");
  });

  it("待发放显示正向金额，并在右上角单独显示待扣回", () => {
    const dashboard: MyCommissionDashboard = {
      periodLabel: "2026年8月",
      summary: {
        estimatedFen: 0,
        accruedNetFen: 0,
        pendingSettlementFen: 0,
        pendingPaymentFen: 30_000,
        pendingDeductionFen: 10_000,
        paidThisMonthFen: 0,
        paidLifetimeFen: 0,
        reversedLifetimeFen: 10_000,
        netLifetimeFen: 20_000,
      },
      unconfiguredOrders: 0,
      orders: [],
    };

    render(<MyCommissionPage dashboard={dashboard} />);

    const pendingCards = screen.getAllByTestId("commission-summary-待发放");
    expect(pendingCards.some((card) => card.textContent?.includes("¥300.00"))).toBe(true);
    expect(pendingCards.some((card) => card.textContent?.includes("待扣回 ¥100.00"))).toBe(true);
  });

  it("按订单区分提成商品和待扣除商品", () => {
    const dashboard: MyCommissionDashboard = {
      periodLabel: "2026年8月",
      summary: {
        estimatedFen: 0,
        accruedNetFen: 4_000,
        pendingSettlementFen: 0,
        pendingPaymentFen: 4_000,
        pendingDeductionFen: 2_000,
        paidThisMonthFen: 0,
        paidLifetimeFen: 0,
        reversedLifetimeFen: 2_000,
        netLifetimeFen: 4_000,
      },
      unconfiguredOrders: 0,
      orders: [{
        orderId: "order-with-return",
        orderNo: "XLXDD-RETURN-01",
        customerMasked: "陈** · *******8000",
        activatedAt: "2026-08-10 10:00",
        status: "reversed",
        statusLabel: "含退单扣回 · 当前净额",
        amountFen: 4_000,
        lines: [
          {
            id: "watch-accrual",
            sku: "WATCH",
            label: "AI 健康智能手表",
            quantity: 2,
            unitCommissionFen: 2_000,
            subtotalFen: 4_000,
            entryType: "accrual",
            settlementStatus: "unsettled",
          },
          {
            id: "mattress-accrual",
            sku: "MATTRESS",
            label: "睡眠监测床垫",
            quantity: 1,
            unitCommissionFen: 2_000,
            subtotalFen: 2_000,
            entryType: "accrual",
            settlementStatus: "unsettled",
          },
          {
            id: "watch-reversal",
            sku: "WATCH",
            label: "AI 健康智能手表（退单扣回）",
            quantity: 1,
            unitCommissionFen: -2_000,
            subtotalFen: -2_000,
            entryType: "return_reversal",
            settlementStatus: "unsettled",
          },
        ],
      }],
    };

    render(<MyCommissionPage dashboard={dashboard} />);

    const order = screen.getByTestId("commission-order-order-with-return");
    expect(order).toHaveTextContent("原提成¥60.00");
    expect(order).toHaveTextContent("应扣提成−¥20.00");
    expect(order).toHaveTextContent("当前净额¥40.00");
    expect(order).toHaveTextContent("本单提成商品");
    expect(order).toHaveTextContent("睡眠监测床垫");
    expect(order).toHaveTextContent("AI 健康智能手表（退单扣回）");
    expect(order).toHaveTextContent("待扣除");
  });
});
