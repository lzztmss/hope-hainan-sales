import type { ChargeSku } from "./types.js";

/**
 * 套装作为一个完整销售方案交付，当前业务不支持整套或拆分退货。
 * 单品及配件仍可按订单剩余数量申请退货。
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
