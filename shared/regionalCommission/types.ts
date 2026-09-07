export const REGIONAL_PRODUCT_COMMISSION_FEN = {
  WATCH: 2_000,
  MATTRESS: 4_000,
  GATEWAY: 600,
  MOTION: 900,
  DOOR: 900,
  PORTABLE_BUTTON: 900,
  WALL_BUTTON: 900,
} as const;

export type RegionalProductSku = keyof typeof REGIONAL_PRODUCT_COMMISSION_FEN;

export interface RegionalCommissionRules {
  completionRewards: readonly { thresholdBasisPoints: number; amountFen: number }[];
  orderTiers: readonly { upToOrders: number; amountFenPerOrder: number }[];
  milestones: readonly { orderCount: number; cumulativeAmountFen: number }[];
  topUp: { orderCount: number; cumulativeCompletionRewardFen: number };
  revenueAcceleration: {
    unlockOrderCount: number;
    ratePartsPerMillion: number;
    monthlyCapFen: number;
  };
  cooperationStages: readonly { code: string; label: string; amountFen: number }[];
  productCommissionFen: Readonly<Record<RegionalProductSku, number>>;
}

export const DEFAULT_REGIONAL_COMMISSION_RULES: RegionalCommissionRules = {
  completionRewards: [
    { thresholdBasisPoints: 10_000, amountFen: 200_000 },
    { thresholdBasisPoints: 9_000, amountFen: 150_000 },
    { thresholdBasisPoints: 8_000, amountFen: 100_000 },
  ],
  orderTiers: [
    { upToOrders: 30_000, amountFenPerOrder: 100 },
    { upToOrders: 40_000, amountFenPerOrder: 200 },
    { upToOrders: 50_000, amountFenPerOrder: 400 },
    { upToOrders: 60_000, amountFenPerOrder: 500 },
    { upToOrders: 75_000, amountFenPerOrder: 600 },
  ],
  milestones: [
    { orderCount: 50_000, cumulativeAmountFen: 2_000_000 },
    { orderCount: 60_000, cumulativeAmountFen: 4_000_000 },
    { orderCount: 75_000, cumulativeAmountFen: 7_000_000 },
  ],
  topUp: { orderCount: 50_000, cumulativeCompletionRewardFen: 1_200_000 },
  revenueAcceleration: {
    unlockOrderCount: 50_000,
    ratePartsPerMillion: 500,
    monthlyCapFen: 3_000_000,
  },
  cooperationStages: [
    { code: "PROJECT", label: "省级项目立项", amountFen: 300_000 },
    { code: "CONTRACT", label: "商务签约及系统准入", amountFen: 1_000_000 },
    { code: "PILOT", label: "首批试点上线", amountFen: 700_000 },
    { code: "SCALE", label: "规模验证", amountFen: 1_000_000 },
  ],
  productCommissionFen: REGIONAL_PRODUCT_COMMISSION_FEN,
};

export interface RegionalProductLine {
  sku: RegionalProductSku;
  quantity: number;
}
