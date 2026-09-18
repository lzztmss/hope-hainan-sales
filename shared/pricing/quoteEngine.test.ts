import { describe, expect, it } from "vitest";

import { calculateQuote } from "./quoteEngine.js";
import type { SubscriptionPlanDefinition } from "./types.js";

const plan: SubscriptionPlanDefinition = {
  id: "plan-a",
  code: "A",
  name: "月付套餐A",
  description: null,
  monthlyFen: 9_900,
  contractMonths: 36,
  active: true,
  version: 3,
  items: [
    { sku: "WATCH", quantity: 1 },
    { sku: "MATTRESS", quantity: 1 },
    { sku: "MOTION", quantity: 2 },
  ],
};

describe("新售卖模式核价", () => {
  it("月付只生成一条套餐计价行，并保存内含设备快照", () => {
    const result = calculateQuote({
      mode: "contract_36",
      subscriptionPlanId: plan.id,
      selection: {},
    }, undefined, plan);

    expect(result.chargeLines).toEqual([
      expect.objectContaining({ sku: "PLAN:plan-a", monthlySubtotalFen: 9_900 }),
    ]);
    expect(result.monthlyTotalFen).toBe(9_900);
    expect(result.contract36Fen).toBe(356_400);
    expect(Object.fromEntries(result.componentLines.map((line) => [line.componentId, line.quantity])))
      .toMatchObject({ watch: 1, mattress: 1, motion: 2 });
  });

  it("月付套餐禁止混入一次性商品", () => {
    expect(() => calculateQuote({
      mode: "contract_36",
      subscriptionPlanId: plan.id,
      selection: { watch: 1 },
    }, undefined, plan)).toThrow("不能混入一次性设备");
  });

  it("一次性购买可同时选择套装和任意单独设备", () => {
    const result = calculateQuote({
      mode: "one_time",
      subscriptionPlanId: null,
      selection: { standardBundle: 1, watch: 1, mattress: 1, door: 2 },
    });
    expect(result.monthlyTotalFen).toBe(0);
    expect(result.chargeLines.map((line) => line.sku)).toEqual([
      "WATCH", "MATTRESS", "STANDARD_BUNDLE", "DOOR",
    ]);
  });
});
