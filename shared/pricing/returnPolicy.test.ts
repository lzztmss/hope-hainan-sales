import { describe, expect, it } from "vitest";

import { isNonReturnablePackageSku } from "./returnPolicy";

describe("退单商品策略", () => {
  it("组合套餐不可退，独立单品与配件可退", () => {
    expect(isNonReturnablePackageSku("HOME_DUAL")).toBe(true);
    expect(isNonReturnablePackageSku("STANDARD_BUNDLE")).toBe(true);
    expect(isNonReturnablePackageSku("WATCH")).toBe(false);
    expect(isNonReturnablePackageSku("MOTION")).toBe(false);
  });
});
