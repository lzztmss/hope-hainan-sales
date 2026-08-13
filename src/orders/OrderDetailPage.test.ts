import { describe, expect, it } from "vitest";

import { describeReturnAvailability } from "./OrderDetailPage";
import type { OrderDetail } from "./types";

const order = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
  id: "order-1",
  orderNo: "XLXDD-001",
  customerMasked: "测*",
  customerPhoneMasked: "138****8000",
  sellerId: "seller-1",
  sellerName: "销售员",
  storeId: "store-1",
  storeName: "营业厅",
  status: "completed",
  paymentMode: "contract_36",
  oneTimeFen: 0,
  monthlyTotalFen: 18900,
  refundedFen: 0,
  createdAt: "2026-08-13T08:00:00.000Z",
  deletedAt: null,
  version: 1,
  permissions: { canDelete: false, canRestore: false, canRequestReturn: true },
  customerAddress: "未提供",
  fttrLabel: "FTTR 159 元/月",
  heartMonthlyFen: 3000,
  contract36Fen: 680400,
  lines: [],
  timeline: [],
  returns: [],
  ...overrides,
});

describe("订单退单入口说明", () => {
  it("仅有不可退套餐时说明原因而不是静默隐藏", () => {
    const result = describeReturnAvailability(order({
      lines: [{
        id: "line-package", lineType: "charge", sku: "HOME_DUAL",
        label: "心连心·居家双护", unit: "套", quantity: 1,
        refundableQuantity: 1, refundableUnitFen: 0,
        oneTimeSubtotalFen: 0, monthlySubtotalFen: 3000, locations: [],
      }],
    }));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("不可退的计价套餐");
  });

  it("存在剩余独立计价商品时允许申请", () => {
    const result = describeReturnAvailability(order({
      lines: [{
        id: "line-watch", lineType: "charge", sku: "WATCH",
        label: "AI 健康智能手表", unit: "块", quantity: 1,
        refundableQuantity: 1, refundableUnitFen: 2000,
        oneTimeSubtotalFen: 0, monthlySubtotalFen: 2000, locations: [],
      }],
    }));
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it("退单审批中时提示等待审批", () => {
    const result = describeReturnAvailability(order({ status: "return_pending" }));
    expect(result.reason).toContain("正在审批");
  });
});
