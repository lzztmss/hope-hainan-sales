import type { ChargeSku, PaymentMode } from "./types.js";

/**
 * 套装作为一个完整销售方案交付，只能随整单退回，不能部分退套装或拆退套装内设备。
 * 单品及配件仍可按订单剩余数量申请部分退货。
 */
export const NON_RETURNABLE_PACKAGE_SKUS: ReadonlySet<ChargeSku> = new Set([
  "FULL_FAMILY",
  "WATCH_MATTRESS",
  "WATCH_STANDARD",
  "MATTRESS_STANDARD",
  "STANDARD_BUNDLE",
  "ONE_KEY",
  "HOME_DUAL",
]);

export const isNonReturnablePackageSku = (sku: string): boolean =>
  NON_RETURNABLE_PACKAGE_SKUS.has(sku as ChargeSku);

/**
 * 客户现金退款上限的单件口径：
 * - 36 个月月付商品按已收取的本计费月月费退回；
 * - 月付订单中的一次性配件仍按一次性实收价退回；
 * - 一次性购买订单按一次性实收价退回。
 *
 * 退单完成后的后续月份停收属于订单月费调整，不在这里重复计算。
 */
export const refundableUnitFenFor = (input: {
  paymentMode: PaymentMode;
  oneTimeUnitFen: number;
  monthlyUnitFen: number;
}): number =>
  input.paymentMode === "contract_36" && input.monthlyUnitFen > 0
    ? input.monthlyUnitFen
    : input.oneTimeUnitFen;
