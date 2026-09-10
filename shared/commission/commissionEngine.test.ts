import { describe, expect, it } from "vitest";

import { DEFAULT_COMMISSION_RULES } from "./commissionEngine.js";

describe("默认提成规则", () => {
  it("启用单独销售配件并设置正确的单件提成", () => {
    const accessoryAmounts = new Map(
      DEFAULT_COMMISSION_RULES.map((rule) => [
        rule.sku,
        { amountFen: rule.amountFen, enabled: rule.enabled },
      ]),
    );

    expect(accessoryAmounts.get("GATEWAY")).toEqual({
      amountFen: 600,
      enabled: true,
    });
    for (const sku of [
      "MOTION",
      "DOOR",
      "PORTABLE_BUTTON",
      "WALL_BUTTON",
    ]) {
      expect(accessoryAmounts.get(sku)).toEqual({
        amountFen: 900,
        enabled: true,
      });
    }
  });
});
