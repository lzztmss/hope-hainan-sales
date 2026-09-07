import type { RegionalCommissionRules, RegionalProductLine } from "./types.js";

export const completionReward = (
  orderCount: number,
  targetCount: number,
  rules: RegionalCommissionRules,
): number => {
  if (targetCount <= 0 || orderCount < 0) throw new Error("订单数和目标值不合法");
  return [...rules.completionRewards]
    .sort((left, right) => right.thresholdBasisPoints - left.thresholdBasisPoints)
    .find((tier) => orderCount * 10_000 >= targetCount * tier.thresholdBasisPoints)
    ?.amountFen ?? 0;
};

export const tieredOrderReward = (
  cumulativeOrders: number,
  rules: RegionalCommissionRules,
): number => {
  if (cumulativeOrders < 0) throw new Error("累计订单数不合法");
  let previousLimit = 0;
  let total = 0;
  for (const tier of [...rules.orderTiers].sort((a, b) => a.upToOrders - b.upToOrders)) {
    const count = Math.max(0, Math.min(cumulativeOrders, tier.upToOrders) - previousLimit);
    total += count * tier.amountFenPerOrder;
    previousLimit = tier.upToOrders;
  }
  return total;
};

export const milestoneReward = (
  cumulativeOrders: number,
  rules: RegionalCommissionRules,
): number => [...rules.milestones]
  .sort((a, b) => b.orderCount - a.orderCount)
  .find((milestone) => cumulativeOrders >= milestone.orderCount)
  ?.cumulativeAmountFen ?? 0;

export const topUpReward = (
  cumulativeCompletionRewardFen: number,
  cumulativeOrders: number,
  verified: boolean,
  rules: RegionalCommissionRules,
): number => verified && cumulativeOrders >= rules.topUp.orderCount
  ? Math.max(0, rules.topUp.cumulativeCompletionRewardFen - cumulativeCompletionRewardFen)
  : 0;

export const revenueAccelerationReward = (
  netReceiptFen: number,
  unlocked: boolean,
  rules: RegionalCommissionRules,
): number => {
  if (!unlocked || netReceiptFen <= 0) return 0;
  const amount = Math.round(
    netReceiptFen * rules.revenueAcceleration.ratePartsPerMillion / 1_000_000,
  );
  return Math.min(amount, rules.revenueAcceleration.monthlyCapFen);
};

export const personalProductCommission = (
  lines: readonly RegionalProductLine[],
  rules: RegionalCommissionRules,
): number => lines.reduce((sum, line) => {
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error("商品数量不合法");
  return sum + rules.productCommissionFen[line.sku] * line.quantity;
}, 0);
