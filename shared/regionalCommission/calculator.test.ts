import { describe, expect, it } from "vitest";

import {
  completionReward,
  milestoneReward,
  personalProductCommission,
  revenueAccelerationReward,
  tieredOrderReward,
  topUpReward,
} from "./calculator.js";
import { DEFAULT_REGIONAL_COMMISSION_RULES as rules } from "./types.js";

describe("regional commission calculator", () => {
  it("compares completion boundaries without rounding", () => {
    expect(completionReward(799, 1_000, rules)).toBe(0);
    expect(completionReward(800, 1_000, rules)).toBe(100_000);
    expect(completionReward(899, 1_000, rules)).toBe(100_000);
    expect(completionReward(900, 1_000, rules)).toBe(150_000);
    expect(completionReward(1_000, 1_000, rules)).toBe(200_000);
  });

  it("calculates progressive order tiers", () => {
    expect(tieredOrderReward(30_000, rules)).toBe(3_000_000);
    expect(tieredOrderReward(30_001, rules)).toBe(3_000_200);
    expect(tieredOrderReward(40_001, rules)).toBe(5_000_400);
    expect(tieredOrderReward(75_000, rules)).toBe(23_000_000);
    expect(tieredOrderReward(80_000, rules)).toBe(23_000_000);
  });

  it("returns only the highest reached milestone and completion top-up", () => {
    expect(milestoneReward(49_999, rules)).toBe(0);
    expect(milestoneReward(60_000, rules)).toBe(4_000_000);
    expect(topUpReward(900_000, 50_000, true, rules)).toBe(300_000);
    expect(topUpReward(900_000, 50_000, false, rules)).toBe(0);
  });

  it("rounds revenue reward to fen, ignores negatives and caps it", () => {
    expect(revenueAccelerationReward(-100, true, rules)).toBe(0);
    expect(revenueAccelerationReward(12_345, true, rules)).toBe(6);
    expect(revenueAccelerationReward(12_345, false, rules)).toBe(0);
    expect(revenueAccelerationReward(9_000_000_000, true, rules)).toBe(3_000_000);
  });

  it("calculates the standard home bundle from independent components", () => {
    expect(personalProductCommission([
      { sku: "GATEWAY", quantity: 1 },
      { sku: "MOTION", quantity: 3 },
      { sku: "DOOR", quantity: 1 },
      { sku: "PORTABLE_BUTTON", quantity: 1 },
      { sku: "WALL_BUTTON", quantity: 1 },
    ], rules)).toBe(6_000);
  });
});
