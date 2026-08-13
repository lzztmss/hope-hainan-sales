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
});
