import { describe, expect, it } from "vitest";

import { calculateCommission, DEFAULT_COMMISSION_RULES } from "./commissionEngine.js";

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

  it("套餐按实际包含的物理设备逐件汇总提成", () => {
    const result = calculateCommission([
      { sku: "PLAN:plan-a", label: "月付套餐A", quantity: 1, lineType: "charge" },
      { sku: "watch", label: "AI 健康智能手表", quantity: 1, lineType: "component" },
      { sku: "mattress", label: "睡眠监测床垫", quantity: 1, lineType: "component" },
      { sku: "motion", label: "人体传感器", quantity: 2, lineType: "component" },
    ], DEFAULT_COMMISSION_RULES, {
      salespersonId: "seller-1",
      storeId: "store-1",
      personnelType: "unicom",
      paymentMode: "contract_36",
    });

    expect(result.totalFen).toBe(7_800);
    expect(result.items.map((item) => item.sku)).toEqual(["WATCH", "MATTRESS", "MOTION"]);
    expect(result.unconfigured).toEqual([]);
  });

  it("新默认版本不再包含 FTTR、套装或英文垃圾 SKU", () => {
    expect(DEFAULT_COMMISSION_RULES.map((rule) => rule.sku)).toEqual([
      "WATCH", "MATTRESS", "GATEWAY", "MOTION", "DOOR", "PORTABLE_BUTTON", "WALL_BUTTON",
    ]);
  });
});
