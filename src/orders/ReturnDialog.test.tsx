import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReturnDialog } from "./ReturnDialog";
import type { OrderDetail } from "./types";

const order: OrderDetail = {
  id: "order-1",
  orderNo: "XLXDD-001",
  customerMasked: "测*",
  customerPhoneMasked: "138****8000",
  sellerId: "seller-1",
  sellerName: "销售员",
  storeId: "store-1",
  storeName: "营业厅",
  status: "completed",
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
    expect(screen.getByText("客户最高可退 ¥1,198.00")).toBeInTheDocument();
  });
});
