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

const configurableRule = (sku: string): CommissionRule => ({
  id: `default-v1-${sku.toLowerCase()}`,
  sku,
  amountFen: 0,
  paymentMode: "all",
  scope: { kind: "global" },
  enabled: false,
});

export const DEFAULT_COMMISSION_RULES: readonly CommissionRule[] = Object.freeze(
  [
    defaultRule("WATCH", 2_000),
    defaultRule("MATTRESS", 4_000),
    defaultRule("ONE_KEY", 2_000),
    defaultRule("HOME_DUAL", 3_000),
    defaultRule("STANDARD_BUNDLE", 6_000),
    defaultRule("WATCH_MATTRESS", 6_000),
    defaultRule("WATCH_STANDARD", 8_000),
    defaultRule("MATTRESS_STANDARD", 10_000),
    defaultRule("FULL_FAMILY", 12_000),
    configurableRule("GATEWAY"),
    configurableRule("MOTION"),
    configurableRule("DOOR"),
    configurableRule("PORTABLE_BUTTON"),
    configurableRule("WALL_BUTTON"),
    configurableRule("FTTR_129"),
    configurableRule("FTTR_159"),
    configurableRule("FTTR_199"),
    configurableRule("FTTR_239"),
    configurableRule("FTTR_299"),
    configurableRule("FTTR_399"),
    configurableRule("FTTR_CUSTOM"),
  ].map((rule) => Object.freeze({ ...rule, scope: Object.freeze(rule.scope) })),
);

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

  for (const line of orderLines) {
    validateLine(line);
    if (line.lineType === "component") {
      calculation.ignoredComponentCount += line.quantity;
      continue;
    }

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
