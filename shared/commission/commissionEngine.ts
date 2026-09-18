import type {
  CommissionCalculation,
  CommissionOrderLine,
  CommissionRule,
  CommissionScope,
  SellerCommissionContext,
} from "./types.js";

const defaultRule = (sku: string, amountFen: number): CommissionRule => ({
  id: `default-v1-${sku.toLowerCase()}`,
  sku,
  amountFen,
  paymentMode: "all",
  scope: { kind: "global" },
  enabled: true,
});

export const DEFAULT_COMMISSION_RULES: readonly CommissionRule[] = Object.freeze(
  [
    defaultRule("WATCH", 2_000),
    defaultRule("MATTRESS", 4_000),
    defaultRule("GATEWAY", 600),
    defaultRule("MOTION", 900),
    defaultRule("DOOR", 900),
    defaultRule("PORTABLE_BUTTON", 900),
    defaultRule("WALL_BUTTON", 900),
  ].map((rule) => Object.freeze({ ...rule, scope: Object.freeze(rule.scope) })),
);

export const COMMISSION_DEVICE_SKUS = [
  "WATCH",
  "MATTRESS",
  "GATEWAY",
  "MOTION",
  "DOOR",
  "PORTABLE_BUTTON",
  "WALL_BUTTON",
] as const;

const COMPONENT_DEVICE_SKU: Readonly<Record<string, string>> = {
  watch: "WATCH",
  mattress: "MATTRESS",
  gateway: "GATEWAY",
  motion: "MOTION",
  door: "DOOR",
  portableButton: "PORTABLE_BUTTON",
  wallButton: "WALL_BUTTON",
};

const scopeMatches = (
  scope: CommissionScope,
  context: SellerCommissionContext,
): boolean => {
  switch (scope.kind) {
    case "global":
      return true;
    case "personnel_type":
      return scope.value === context.personnelType;
    case "store":
      return scope.value === context.storeId;
    case "salesperson":
      return scope.value === context.salespersonId;
  }
};

const scopeRank = (scope: CommissionScope): number => {
  switch (scope.kind) {
    case "global":
      return 0;
    case "personnel_type":
      return 1;
    case "store":
      return 2;
    case "salesperson":
      return 3;
  }
};

const selectRule = (
  sku: string,
  rules: readonly CommissionRule[],
  context: SellerCommissionContext,
): CommissionRule | null => {
  const matches = rules
    .filter(
      (rule) =>
        rule.enabled &&
        rule.sku === sku &&
        (rule.paymentMode === "all" ||
          rule.paymentMode === context.paymentMode) &&
        scopeMatches(rule.scope, context),
    )
    .sort((left, right) => {
      const scopeDifference = scopeRank(right.scope) - scopeRank(left.scope);
      if (scopeDifference !== 0) return scopeDifference;
      const rightExact = right.paymentMode === context.paymentMode ? 1 : 0;
      const leftExact = left.paymentMode === context.paymentMode ? 1 : 0;
      if (rightExact !== leftExact) return rightExact - leftExact;
      return left.id.localeCompare(right.id);
    });

  const selected = matches[0];
  if (!selected) return null;

  const duplicate = matches[1];
  if (
    duplicate &&
    scopeRank(duplicate.scope) === scopeRank(selected.scope) &&
    (duplicate.paymentMode === context.paymentMode) ===
      (selected.paymentMode === context.paymentMode)
  ) {
    throw new Error(`提成规则冲突：${sku}`);
  }
  return selected;
};

const validateLine = (line: CommissionOrderLine): void => {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new Error(`提成计算数量不合法：${line.sku}`);
  }
};

const validateRule = (rule: CommissionRule): void => {
  if (!Number.isSafeInteger(rule.amountFen) || rule.amountFen < 0) {
    throw new Error(`提成金额不合法：${rule.id}`);
  }
};

export const calculateCommission = (
  orderLines: readonly CommissionOrderLine[],
  rules: readonly CommissionRule[],
  sellerContext: SellerCommissionContext,
): CommissionCalculation => {
  rules.forEach(validateRule);

  const calculation: CommissionCalculation = {
    totalFen: 0,
    items: [],
    unconfigured: [],
    ignoredComponentCount: 0,
  };

  const hasComponentSnapshot = orderLines.some((line) => line.lineType === "component");
  const commissionableLines = hasComponentSnapshot
    ? orderLines.flatMap((line): CommissionOrderLine[] => {
        if (line.lineType !== "component") return [];
        const sku = COMPONENT_DEVICE_SKU[line.sku];
        if (!sku) throw new Error(`未知的套餐设备：${line.sku}`);
        return [{ ...line, sku, lineType: "charge" }];
      })
    : orderLines;

  for (const line of commissionableLines) {
    validateLine(line);
    const rule = selectRule(line.sku, rules, sellerContext);
    if (!rule) {
      calculation.unconfigured.push({
        sku: line.sku,
        label: line.label,
        quantity: line.quantity,
      });
      continue;
    }

    const subtotalFen = rule.amountFen * line.quantity;
    if (!Number.isSafeInteger(subtotalFen)) {
      throw new Error(`提成金额超出安全范围：${line.sku}`);
    }
    calculation.items.push({
      sku: line.sku,
      label: line.label,
      quantity: line.quantity,
      ruleId: rule.id,
      unitAmountFen: rule.amountFen,
      subtotalFen,
    });
    calculation.totalFen += subtotalFen;
  }

  if (!Number.isSafeInteger(calculation.totalFen)) {
    throw new Error("提成合计超出安全范围");
  }
  return calculation;
};
