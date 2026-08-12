import {
  calculateCommission,
} from "../../shared/commission/commissionEngine.js";
import type {
  CommissionCalculation,
  CommissionOrderLine,
  CommissionRule,
  SellerCommissionContext,
} from "../../shared/commission/types.js";
import type { ReturnRequestRecord } from "../returns/returnService.js";

export interface CommissionOrderAttribution {
  beneficiaryId: string;
  role: "primary" | "collaborator";
  basisPoints: number;
}

export interface CommissionAccrualOrder {
  id: string;
  status: string;
  activatedAt: Date | null;
  storeId: string;
  sellerContext: SellerCommissionContext;
  lines: readonly CommissionOrderLine[];
  attributions: readonly CommissionOrderAttribution[];
}

export interface CommissionPolicyForAccrual {
  id: string;
  version: number;
  rules: readonly CommissionRule[];
}

export interface CommissionLedgerCredit {
  orderId: string;
  snapshotId?: string;
  ruleId: string;
  beneficiaryId: string;
  storeId: string;
  entryType: "accrual";
  eventKey: string;
  amountFen: number;
  occurredAt: Date;
}

export interface CommissionAccrualWrite {
  orderId: string;
  eventKey: string;
  policyVersionId: string;
  policyVersion: number;
  totalFen: number;
  calculation: CommissionCalculation;
  attributionSnapshot: readonly CommissionOrderAttribution[];
  ledgerEntries: readonly CommissionLedgerCredit[];
  accruedAt: Date;
}

export interface CommissionAccrualResult extends CommissionAccrualWrite {
  snapshotId: string;
}

export interface CommissionLedgerReversal {
  orderId: string;
  returnId: string;
  snapshotId: string;
  ruleId: string;
  beneficiaryId: string;
  storeId: string;
  entryType: "return_reversal";
  eventKey: string;
  amountFen: number;
  occurredAt: Date;
}

export interface CommissionReversalWrite {
  orderId: string;
  returnId: string;
  snapshotId: string;
  eventKey: string;
  totalFen: number;
  ledgerEntries: readonly CommissionLedgerReversal[];
  reversedAt: Date;
}

export interface CommissionReversalResult extends CommissionReversalWrite {
  id: string;
}

export interface CommissionLedgerRepository {
  runTransaction<T>(
    work: (repository: CommissionLedgerRepository) => Promise<T>,
  ): Promise<T>;
  findOrderForAccrual(orderId: string): Promise<CommissionAccrualOrder | null>;
  findAccrualByOrder(orderId: string): Promise<CommissionAccrualResult | null>;
  findEffectivePolicy(at: Date): Promise<CommissionPolicyForAccrual | null>;
  createAccrual(input: CommissionAccrualWrite): Promise<CommissionAccrualResult>;
  findReversalByReturn(
    returnId: string,
  ): Promise<CommissionReversalResult | null>;
  createReversal(
    input: CommissionReversalWrite,
  ): Promise<CommissionReversalResult>;
}

export interface CommissionLedgerServiceOptions {
  repository: CommissionLedgerRepository;
  now?: () => Date;
}

const validateActivationInputs = async (
  repository: CommissionLedgerRepository,
  orderId: string,
  activatedAt: Date,
): Promise<void> => {
  const order = await repository.findOrderForAccrual(orderId);
  if (!order) throw new Error("订单不存在");
  validateAttributions(order.attributions);
  const policy = await repository.findEffectivePolicy(activatedAt);
  if (!policy) throw new Error("未找到生效的提成规则版本");
  calculateCommission(order.lines, policy.rules, order.sellerContext);
};

const validateEventKey = (eventKey: string): void => {
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(eventKey)) {
    throw new Error("提成事件键格式不正确");
  }
};

const validateAttributions = (
  attributions: readonly CommissionOrderAttribution[],
): readonly CommissionOrderAttribution[] => {
  if (attributions.length === 0) throw new Error("订单缺少销售归属");
  const primaryCount = attributions.filter(
    (entry) => entry.role === "primary",
  ).length;
  if (primaryCount !== 1) throw new Error("订单必须且只能有一位主销售");

  let total = 0;
  const beneficiaries = new Set<string>();
  for (const attribution of attributions) {
    if (
      !Number.isInteger(attribution.basisPoints) ||
      attribution.basisPoints < 1 ||
      attribution.basisPoints > 10_000
    ) {
      throw new Error("销售归属比例不合法");
    }
    if (beneficiaries.has(attribution.beneficiaryId)) {
      throw new Error("销售归属人不能重复");
    }
    beneficiaries.add(attribution.beneficiaryId);
    total += attribution.basisPoints;
  }
  if (total !== 10_000) throw new Error("销售归属比例合计必须为100%");
  return attributions;
};

const splitAmount = (
  amountFen: number,
  attributions: readonly CommissionOrderAttribution[],
): Array<{ beneficiaryId: string; amountFen: number }> => {
  const primary = attributions.find((entry) => entry.role === "primary")!;
  const allocations = attributions
    .filter((entry) => entry.role !== "primary")
    .map((entry) => ({
      beneficiaryId: entry.beneficiaryId,
      amountFen: Math.floor((amountFen * entry.basisPoints) / 10_000),
    }));
  const allocated = allocations.reduce((sum, entry) => sum + entry.amountFen, 0);
  return [
    { beneficiaryId: primary.beneficiaryId, amountFen: amountFen - allocated },
    ...allocations,
  ];
};

const creditsForCalculation = (
  order: CommissionAccrualOrder,
  calculation: CommissionCalculation,
  eventKey: string,
  occurredAt: Date,
): CommissionLedgerCredit[] => {
  const byRule = new Map<string, number>();
  for (const item of calculation.items) {
    byRule.set(item.ruleId, (byRule.get(item.ruleId) ?? 0) + item.subtotalFen);
  }

  return Array.from(byRule.entries()).flatMap(([ruleId, amountFen]) =>
    splitAmount(amountFen, order.attributions)
      .filter((allocation) => allocation.amountFen > 0)
      .map((allocation) => ({
        orderId: order.id,
        ruleId,
        beneficiaryId: allocation.beneficiaryId,
        storeId: order.storeId,
        entryType: "accrual" as const,
        eventKey,
        amountFen: allocation.amountFen,
        occurredAt,
      })),
  );
};

const reversalAmountsByRule = (
  calculation: CommissionCalculation,
  returnedItems: ReturnRequestRecord["items"],
): Map<string, number> => {
  const returnedBySku = new Map<string, number>();
  for (const item of returnedItems) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("退货数量不合法");
    }
    returnedBySku.set(
      item.sku,
      (returnedBySku.get(item.sku) ?? 0) + item.quantity,
    );
  }

  const byRule = new Map<string, number>();
  for (const [sku, quantity] of returnedBySku) {
    let remaining = quantity;
    const configuredItems = calculation.items.filter((item) => item.sku === sku);
    for (const item of configuredItems) {
      if (remaining === 0) break;
      const reversedQuantity = Math.min(remaining, item.quantity);
      const amountFen = reversedQuantity * item.unitAmountFen;
      if (!Number.isSafeInteger(amountFen)) {
        throw new Error(`退单提成金额超出安全范围：${sku}`);
      }
      byRule.set(item.ruleId, (byRule.get(item.ruleId) ?? 0) + amountFen);
      remaining -= reversedQuantity;
    }

    if (
      remaining > 0 &&
      !calculation.unconfigured.some((item) => item.sku === sku)
    ) {
      throw new Error(`退货商品不在提成快照中：${sku}`);
    }
  }
  return byRule;
};

const reversalsForReturn = (
  accrual: CommissionAccrualResult,
  completedReturn: ReturnRequestRecord,
  eventKey: string,
): CommissionLedgerReversal[] => {
  const amountsByRule = reversalAmountsByRule(
    accrual.calculation,
    completedReturn.items,
  );
  return Array.from(amountsByRule.entries()).flatMap(([ruleId, amountFen]) =>
    splitAmount(amountFen, validateAttributions(accrual.attributionSnapshot))
      .filter((allocation) => allocation.amountFen > 0)
      .map((allocation) => ({
        orderId: completedReturn.orderId,
        returnId: completedReturn.id,
        snapshotId: accrual.snapshotId,
        ruleId,
        beneficiaryId: allocation.beneficiaryId,
        storeId:
          accrual.ledgerEntries.find(
            (entry) => entry.beneficiaryId === allocation.beneficiaryId,
          )?.storeId ?? accrual.ledgerEntries[0]?.storeId ?? "",
        entryType: "return_reversal" as const,
        eventKey,
        amountFen: -allocation.amountFen,
        occurredAt: completedReturn.completedAt!,
      })),
  );
};

export const createCommissionLedgerService = (
  options: CommissionLedgerServiceOptions,
) => {
  const now = options.now ?? (() => new Date());

  return {
    async validateActivation(orderId: string, activatedAt: Date): Promise<void> {
      await validateActivationInputs(options.repository, orderId, activatedAt);
    },

    async accrueForActivatedOrder(
      orderId: string,
      eventKey: string,
    ): Promise<CommissionAccrualResult> {
      validateEventKey(eventKey);
      return options.repository.runTransaction(async (repository) => {
        const existing = await repository.findAccrualByOrder(orderId);
        if (existing) return existing;

        const order = await repository.findOrderForAccrual(orderId);
        if (!order) throw new Error("订单不存在");
        if (order.status !== "activated" || !order.activatedAt) {
          throw new Error("只有已激活订单可以计提");
        }
        validateAttributions(order.attributions);

        const policy = await repository.findEffectivePolicy(order.activatedAt);
        if (!policy) throw new Error("未找到生效的提成规则版本");
        const calculation = calculateCommission(
          order.lines,
          policy.rules,
          order.sellerContext,
        );
        const accruedAt = now();
        const ledgerEntries = creditsForCalculation(
          order,
          calculation,
          eventKey,
          accruedAt,
        );
        const ledgerTotal = ledgerEntries.reduce(
          (sum, entry) => sum + entry.amountFen,
          0,
        );
        if (ledgerTotal !== calculation.totalFen) {
          throw new Error("提成分配合计与计算结果不一致");
        }

        return repository.createAccrual({
          orderId,
          eventKey,
          policyVersionId: policy.id,
          policyVersion: policy.version,
          totalFen: calculation.totalFen,
          calculation: structuredClone(calculation),
          attributionSnapshot: structuredClone(order.attributions),
          ledgerEntries,
          accruedAt,
        });
      });
    },

    async reverseForCompletedReturn(
      completedReturn: ReturnRequestRecord,
    ): Promise<CommissionReversalResult> {
      if (completedReturn.status !== "completed" || !completedReturn.completedAt) {
        throw new Error("只有已完成退单可以冲销提成");
      }
      const completedAt = completedReturn.completedAt;
      const eventKey = `return:${completedReturn.id}`;
      validateEventKey(eventKey);

      return options.repository.runTransaction(async (repository) => {
        const existing = await repository.findReversalByReturn(completedReturn.id);
        if (existing) return existing;

        const accrual = await repository.findAccrualByOrder(
          completedReturn.orderId,
        );
        if (!accrual) throw new Error("订单尚未产生提成快照");
        const ledgerEntries = reversalsForReturn(
          accrual,
          completedReturn,
          eventKey,
        );
        const totalFen = ledgerEntries.reduce(
          (sum, entry) => sum + entry.amountFen,
          0,
        );
        if (totalFen === 0) {
          return {
            id: `no-commission:${completedReturn.id}`,
            orderId: completedReturn.orderId,
            returnId: completedReturn.id,
            snapshotId: accrual.snapshotId,
            eventKey,
            totalFen: 0,
            ledgerEntries: [],
            reversedAt: completedAt,
          };
        }
        if (totalFen > 0) throw new Error("退单提成冲销金额必须为负数");

        return repository.createReversal({
          orderId: completedReturn.orderId,
          returnId: completedReturn.id,
          snapshotId: accrual.snapshotId,
          eventKey,
          totalFen,
          ledgerEntries,
          reversedAt: completedAt,
        });
      });
    },
  };
};

export type CommissionLedgerService = ReturnType<
  typeof createCommissionLedgerService
>;
