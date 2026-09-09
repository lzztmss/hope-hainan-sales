import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGIONAL_COMMISSION_RULES,
  normalizeRegionalCommissionRules,
} from "./types.js";

describe("大区经理提成模板规则兼容", () => {
  it("目标周期作为模板规则的一部分被归一化并保留", () => {
    const normalized = normalizeRegionalCommissionRules({
      ...DEFAULT_REGIONAL_COMMISSION_RULES,
      targetCycle: { planType: "quarter", periodTargets: [1, 2, 3] },
    } as Record<string, unknown>);

    expect(normalized.targetCycle).toEqual({
      startsOn: null,
      planType: "quarter",
      periodTargets: [1, 2, 3],
    });
    expect(normalized.completionRewards).toEqual(
      DEFAULT_REGIONAL_COMMISSION_RULES.completionRewards,
    );
  });
});
