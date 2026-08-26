import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReturnDialog } from "./ReturnDialog";
import type { OrderDetail } from "./types";

afterEach(cleanup);

const order: OrderDetail = {
  signedAt: "2026-08-13T08:00:00.000Z",
  id: "order-1",
  orderNo: "XLXDD-001",
  customerMasked: "测*",
  customerPhoneMasked: "138****8000",
  sellerId: "seller-1",
  sellerName: "销售员",
  storeId: "store-1",
  storeName: "营业厅",
  status: "signed",
  paymentMode: "one_time",
  oneTimeFen: 119800,
  monthlyTotalFen: 0,
  refundedFen: 0,
  createdAt: "2026-08-14T02:14:00.000Z",
  deletedAt: null,
  version: 1,
  permissions: { canDelete: false, canRestore: false, canRequestReturn: true },
  customerAddress: "未提供",
  fttrLabel: "未新增 FTTR",
  heartMonthlyFen: 0,
  contract36Fen: 0,
  timeline: [],
  returns: [],
  lines: [
    {
      id: "package-line",
      lineType: "charge",
      sku: "HOME_DUAL",
      label: "心连心·居家双护",
      unit: "套",
      quantity: 1,
      returnedQuantity: 0,
      refundableQuantity: 1,
      refundableUnitFen: 89900,
      monthlyUnitFen: 0,
      oneTimeSubtotalFen: 89900,
      monthlySubtotalFen: 0,
      locations: [],
    },
    {
      id: "motion-line",
      lineType: "charge",
      sku: "MOTION",
      label: "人体传感器",
      unit: "个",
      quantity: 1,
      returnedQuantity: 0,
      refundableQuantity: 1,
      refundableUnitFen: 29900,
      monthlyUnitFen: 0,
      oneTimeSubtotalFen: 29900,
      monthlySubtotalFen: 0,
      locations: [],
    },
    {
      id: "gateway-component",
      lineType: "component",
      sku: "gateway",
      label: "迷你网关",
      unit: "个",
      quantity: 1,
      returnedQuantity: 0,
      refundableQuantity: 0,
      refundableUnitFen: 0,
      monthlyUnitFen: 0,
      oneTimeSubtotalFen: 0,
      monthlySubtotalFen: 0,
      locations: ["客厅路由器附近"],
    },
  ],
};

describe("整单退单商品明细", () => {
  it("同时展示套餐和自购商品", () => {
    render(
      <ReturnDialog
        open
        order={order}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const list = screen.getByRole("region", { name: "整单退回商品" });
    expect(within(list).getByText("心连心·居家双护（套餐整套退回）")).toBeInTheDocument();
    expect(within(list).getByText("人体传感器")).toBeInTheDocument();
    const components = screen.getByRole("region", { name: "套餐内设备" });
    expect(within(components).getByText("迷你网关 × 1个")).toBeInTheDocument();
    expect(within(components).getByText("套餐内含 · 不另收费")).toBeInTheDocument();
    expect(within(components).getByText("随整套一并退回")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "申请退款金额（元）" })).not.toHaveAttribute("placeholder");
    expect(screen.queryByText(/系统参考/)).not.toBeInTheDocument();
  });

  it("月付商品只要求填写申请退款金额", () => {
    render(
      <ReturnDialog
        open
        order={{
          ...order,
          paymentMode: "contract_36",
          oneTimeFen: 0,
          monthlyTotalFen: 19_800,
          lines: [{
            ...order.lines[1]!,
            label: "睡眠监测床垫",
            refundableUnitFen: 4_000,
            monthlyUnitFen: 4_000,
            oneTimeSubtotalFen: 0,
            monthlySubtotalFen: 4_000,
          }],
        }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("spinbutton", { name: "申请退款金额（元）" })).toBeInTheDocument();
    expect(screen.queryByText(/系统参考/)).not.toBeInTheDocument();
  });

  it("退货退款超过7日自动切换为特殊处理并禁用普通处理", () => {
    render(
      <ReturnDialog
        open
        order={{ ...order, signedAt: "2026-07-01T02:00:00.000Z" }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /普通处理/ })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: /特殊处理/ })).toBeChecked();
    expect(within(dialog).getByText(/特殊.*退货退款.*单独标识/)).toBeInTheDocument();
  });

  it("只提供退货退款，不显示换货入口", () => {
    render(<ReturnDialog open order={{ ...order, signedAt: new Date().toISOString() }} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "申请退货退款" })).toBeInTheDocument();
    expect(screen.queryByText("换货")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "申请退款金额（元）" })).toBeInTheDocument();
  });
});
