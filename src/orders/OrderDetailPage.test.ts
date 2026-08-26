import { describe, expect, it } from "vitest";

import {
  availableTransitions,
  describeReturnAvailability,
  monthlyAmountAfterCompletedReturns,
} from "./OrderDetailPage";
import type { OrderDetail, OrderViewer } from "./types";

const order = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
  id: "order-1",
  orderNo: "XLXDD-001",
  customerMasked: "测*",
  customerPhoneMasked: "138****8000",
  sellerId: "seller-1",
  sellerName: "销售员",
  storeId: "store-1",
  storeName: "营业厅",
  status: "signed",
  paymentMode: "contract_36",
  oneTimeFen: 0,
  monthlyTotalFen: 18900,
  refundedFen: 0,
  createdAt: "2026-08-13T08:00:00.000Z",
  deletedAt: null,
  version: 1,
  permissions: { canDelete: false, canRestore: false, canRequestReturn: true },
  signedAt: "2026-08-13T08:00:00.000Z",
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
  it("仅有套餐时仍允许申请整单退单", () => {
    const result = describeReturnAvailability(order({
      lines: [{
        id: "line-package", lineType: "charge", sku: "HOME_DUAL",
        label: "心连心·居家双护", unit: "套", quantity: 1,
        returnedQuantity: 0, monthlyUnitFen: 3000,
        refundableQuantity: 1, refundableUnitFen: 0,
        oneTimeSubtotalFen: 0, monthlySubtotalFen: 3000, locations: [],
      }],
    }));
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it("存在剩余独立计价商品时允许申请", () => {
    const result = describeReturnAvailability(order({
      lines: [{
        id: "line-watch", lineType: "charge", sku: "WATCH",
        label: "AI 健康智能手表", unit: "块", quantity: 1,
        returnedQuantity: 0, monthlyUnitFen: 2000,
        refundableQuantity: 1, refundableUnitFen: 2000,
        oneTimeSubtotalFen: 0, monthlySubtotalFen: 2000, locations: [],
      }],
    }));
    expect(result).toEqual({ allowed: true, reason: null });
  });

  it("退单审批中时提示等待审批", () => {
    const result = describeReturnAvailability(order({
      status: "return_pending",
      permissions: {
        canDelete: false,
        canRestore: false,
        canRequestReturn: false,
      },
    }));
    expect(result.reason).toContain("正在审批");
    expect(result.reason).not.toContain("没有申请");
  });

  it("全部计价商品退完后提示已完成整单退单", () => {
    const result = describeReturnAvailability(order({
      status: "returned",
      permissions: {
        canDelete: false,
        canRestore: false,
        canRequestReturn: false,
      },
    }));
    expect(result).toEqual({
      allowed: false,
      reason: "该订单已完成整单退单",
    });
  });

  it("部分退单完成后仍有剩余商品时允许再次申请", () => {
    const result = describeReturnAvailability(order({
      status: "partially_returned",
      lines: [{
        id: "line-watch", lineType: "charge", sku: "WATCH",
        label: "AI 健康智能手表", unit: "块", quantity: 2,
        returnedQuantity: 1, monthlyUnitFen: 2000,
        refundableQuantity: 1, refundableUnitFen: 59900,
        oneTimeSubtotalFen: 119800, monthlySubtotalFen: 4000, locations: [],
      }],
    }));
    expect(result).toEqual({ allowed: true, reason: null });
  });
});

describe("订单状态操作按钮", () => {
  const viewer = (role: OrderViewer["role"]): OrderViewer => ({
    id: `${role}-1`,
    displayName: role,
    role,
    storeId: "store-1",
  });

  it("已受理订单只向经理和管理员展示激活", () => {
    const accepted = order({ status: "accepted" });
    expect(availableTransitions(accepted, viewer("sales")).map((item) => item.command))
      .not.toContain("ACTIVATE");
    expect(availableTransitions(accepted, viewer("store_manager")).map((item) => item.command))
      .toContain("ACTIVATE");
    expect(availableTransitions(accepted, viewer("admin")).map((item) => item.command))
      .toContain("ACTIVATE");
    expect(availableTransitions(accepted, viewer("regional_manager")).map((item) => item.command))
      .toEqual(["ACTIVATE"]);
    expect(availableTransitions(accepted, viewer("hr"))).toEqual([]);
    expect(availableTransitions(accepted, viewer("finance"))).toEqual([]);
  });

  it("已激活订单向所有可操作角色展示确认签收", () => {
    const activated = order({ status: "activated" });
    expect(availableTransitions(activated, viewer("sales")).map((item) => item.command))
      .toEqual(["SIGN"]);
    expect(availableTransitions(activated, viewer("store_manager")).map((item) => item.command)).toEqual(["SIGN"]);
    expect(availableTransitions(activated, viewer("admin")).map((item) => item.command)).toEqual(["SIGN"]);
  });

  it("签收后由人事或管理员对账，对账后由财务或管理员收款", () => {
    expect(availableTransitions(order({ status: "signed" }), viewer("hr")).map((item) => item.command)).toEqual(["RECONCILE"]);
    expect(availableTransitions(order({ status: "signed" }), viewer("finance"))).toEqual([]);
    expect(availableTransitions(order({ status: "reconciled" }), viewer("finance")).map((item) => item.command)).toEqual(["MARK_PAID"]);
    expect(availableTransitions(order({ status: "reconciled" }), viewer("hr"))).toEqual([]);
  });
});

describe("月付退单后的调整月费", () => {
  it("保留原订单月费，并计算扣除已完成退单商品后的月费", () => {
    const current = order({
      monthlyTotalFen: 19_800,
      lines: [{
        id: "line-watch", lineType: "charge", sku: "WATCH",
        label: "AI 健康智能手表", unit: "块", quantity: 1,
        returnedQuantity: 1, refundableQuantity: 0, refundableUnitFen: 0,
        monthlyUnitFen: 2_000, oneTimeSubtotalFen: 0,
        monthlySubtotalFen: 2_000, locations: [],
      }],
    });

    expect(current.monthlyTotalFen).toBe(19_800);
    expect(monthlyAmountAfterCompletedReturns(current)).toBe(17_800);
  });

  it("整单退回后扣除已退商品的月费为零", () => {
    expect(monthlyAmountAfterCompletedReturns(order({ status: "returned" }))).toBe(0);
  });
});
