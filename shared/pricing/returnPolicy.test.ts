import { describe, expect, it } from "vitest";

import {
  isNonReturnablePackageSku,
  refundableUnitFenFor,
} from "./returnPolicy.js";

describe("退单商品策略", () => {
  it("组合套餐不可部分退，独立单品与配件可部分退", () => {
    expect(isNonReturnablePackageSku("HOME_DUAL")).toBe(true);
    expect(isNonReturnablePackageSku("STANDARD_BUNDLE")).toBe(true);
    expect(isNonReturnablePackageSku("WATCH")).toBe(false);
    expect(isNonReturnablePackageSku("MOTION")).toBe(false);
  });
});

describe("退单现金退款单价", () => {
  it("36 个月月付商品按一个计费月的月费核算", () => {
    expect(
      refundableUnitFenFor({
        paymentMode: "contract_36",
        oneTimeUnitFen: 0,
        monthlyUnitFen: 4_000,
      }),
    ).toBe(4_000);
  });

  it("月付订单中的一次性配件仍按一次性实收价核算", () => {
    expect(
      refundableUnitFenFor({
        paymentMode: "contract_36",
        oneTimeUnitFen: 39_900,
        monthlyUnitFen: 0,
      }),
    ).toBe(39_900);
  });

  it("一次性购买订单不使用商品参考月费", () => {
    expect(
      refundableUnitFenFor({
        paymentMode: "one_time",
        oneTimeUnitFen: 139_900,
        monthlyUnitFen: 4_000,
      }),
    ).toBe(139_900);
  });
});
