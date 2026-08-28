import {
  and,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  type SQL,
} from "drizzle-orm";

import type { CommissionRule, CommissionScope } from "../../shared/commission/types.js";
import type { UserScope } from "../auth/authorization.js";
import type { AppDatabase, DbClient } from "../db/client.js";
import {
  commissionLedger,
  commissionPolicyVersions,
  commissionRules,
  customers,
  orderAttributions,
  orderCommissionSnapshots,
  orderLines,
  orders,
  settlementBatches,
  settlementItems,
  users,
} from "../db/schema.js";
import type { CommissionPolicyForAccrual } from "./ledgerService.js";
import { buildFttrCommissionLine } from "./ledgerRepository.js";
import type {
  CommissionDashboardRepository,
  CommissionDashboardRepositoryFilters,
  DashboardLedgerEntryType,
  DashboardLedgerRecord,
  EstimatedCommissionAttribution,
  EstimatedCommissionOrder,
  MissingCommissionOrder,
} from "./dashboardService.js";

type QueryExecutor = AppDatabase;
type RuleRow = typeof commissionRules.$inferSelect;
const POLICY_CODE = "HAINAN_FTTR_HEARTLINK";

const mapScope = (row: RuleRow): CommissionScope => {
  if (row.salespersonId) return { kind: "salesperson", value: row.salespersonId };
  if (row.storeId) return { kind: "store", value: row.storeId };
  if (row.personnelType) {
    return { kind: "personnel_type", value: row.personnelType };
  }
  return { kind: "global" };
};

const mapSku = (row: RuleRow): string => {
  if (row.targetType !== "fttr_plan") return row.targetSku!;
  return row.targetSku === "CUSTOM" ? "FTTR_CUSTOM" : `FTTR_${row.fttrPlan}`;
};

const mapRule = (row: RuleRow): CommissionRule => ({
  id: row.id,
  sku: mapSku(row),
  amountFen: row.amountFen,
  paymentMode: row.paymentModeScope,
  scope: mapScope(row),
  enabled: row.status === "active",
});

const ruleSkuExpression = (row: {
  targetType: RuleRow["targetType"] | null;
  targetSku: string | null;
  fttrPlan: number | null;
}): string | null => {
  if (!row.targetType) return null;
  if (row.targetType !== "fttr_plan") return row.targetSku;
  return row.targetSku === "CUSTOM" ? "FTTR_CUSTOM" : `FTTR_${row.fttrPlan}`;
};

const isDashboardLedgerEntryType = (
  value: typeof commissionLedger.$inferSelect.entryType,
): value is DashboardLedgerEntryType =>
  value === "accrual" ||
  value === "return_reversal" ||
  value === "manual_positive" ||
  value === "manual_negative";

const ledgerScopeCondition = (scope: UserScope): SQL | undefined => {
  if (scope.kind === "global") return undefined;
  if (scope.kind === "store") return eq(commissionLedger.storeId, scope.storeId);
  if (scope.kind === "region") return inArray(commissionLedger.storeId, [...scope.storeIds]);
  return and(
    eq(commissionLedger.storeId, scope.storeId),
    eq(commissionLedger.beneficiaryId, scope.sellerId),
  );
};

const orderHasBeneficiary = (
  executor: QueryExecutor,
  beneficiaryId: string,
): SQL =>
  exists(
    executor
      .select({ id: orderAttributions.id })
      .from(orderAttributions)
      .where(
        and(
          eq(orderAttributions.orderId, orders.id),
          eq(orderAttributions.beneficiaryId, beneficiaryId),
        ),
      ),
  );

const estimatedOrderScopeConditions = (
  executor: QueryExecutor,
  scope: UserScope,
): SQL[] => {
  if (scope.kind === "global") return [];
  if (scope.kind === "store") return [eq(orders.storeId, scope.storeId)];
  if (scope.kind === "region") return [inArray(orders.storeId, [...scope.storeIds])];
  return [
    eq(orders.storeId, scope.storeId),
    orderHasBeneficiary(executor, scope.sellerId),
  ];
};

export class DrizzleCommissionDashboardRepository
  implements CommissionDashboardRepository
{
  constructor(
    private readonly client: DbClient,
    private readonly executor: QueryExecutor = client.db,
  ) {}

  async listLedger(
    scope: UserScope,
    filters: CommissionDashboardRepositoryFilters,
  ): Promise<readonly DashboardLedgerRecord[]> {
    const conditions: SQL[] = [
      inArray(commissionLedger.entryType, [
        "accrual",
        "return_reversal",
        "manual_positive",
        "manual_negative",
      ]),
    ];
    const scoped = ledgerScopeCondition(scope);
    if (scoped) conditions.push(scoped);
    if (filters.storeId) conditions.push(eq(commissionLedger.storeId, filters.storeId));
    if (filters.beneficiaryId) {
      conditions.push(eq(commissionLedger.beneficiaryId, filters.beneficiaryId));
    }
    if (filters.orderId) conditions.push(eq(commissionLedger.orderId, filters.orderId));

    const rows = await this.executor
      .select({
        id: commissionLedger.id,
        orderId: commissionLedger.orderId,
        orderNo: orders.orderNo,
        orderStatus: orders.status,
        customerNameEncrypted: customers.nameEncrypted,
        customerPhoneTail: customers.phoneTail,
        customerSnapshot: orders.customerSnapshot,
        beneficiaryId: commissionLedger.beneficiaryId,
        beneficiaryName: users.displayName,
        storeId: commissionLedger.storeId,
        entryType: commissionLedger.entryType,
        eventKey: commissionLedger.eventKey,
        amountFen: commissionLedger.amountFen,
        reason: commissionLedger.reason,
        occurredAt: commissionLedger.occurredAt,
        ruleId: commissionLedger.ruleId,
        ruleTargetType: commissionRules.targetType,
        ruleTargetSku: commissionRules.targetSku,
        ruleFttrPlan: commissionRules.fttrPlan,
        ruleName: commissionRules.ruleName,
        activatedAt: orders.activatedAt,
        signedAt: orders.signedAt,
        reconciledAt: orders.reconciledAt,
        orderPaidAt: orders.paidAt,
        orderCreatedAt: orders.createdAt,
        calculationSnapshot: orderCommissionSnapshots.calculationSnapshot,
        settlementStatus: settlementBatches.status,
        settlementAmountFen: settlementItems.amountFen,
        paidAt: settlementBatches.paidAt,
      })
      .from(commissionLedger)
      .innerJoin(users, eq(users.id, commissionLedger.beneficiaryId))
      .leftJoin(orders, eq(orders.id, commissionLedger.orderId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(commissionRules, eq(commissionRules.id, commissionLedger.ruleId))
      .leftJoin(
        orderCommissionSnapshots,
        eq(orderCommissionSnapshots.id, commissionLedger.snapshotId),
      )
      .leftJoin(
        settlementItems,
        eq(settlementItems.ledgerEntryId, commissionLedger.id),
      )
      .leftJoin(
        settlementBatches,
        eq(settlementBatches.id, settlementItems.batchId),
      )
      .where(and(...conditions))
      .orderBy(desc(commissionLedger.occurredAt), desc(commissionLedger.id));

    return rows.map((row): DashboardLedgerRecord => {
      if (!isDashboardLedgerEntryType(row.entryType)) {
        throw new Error("提成看板查询到了非计提类账本流水");
      }
      return {
        id: row.id,
        orderId: row.orderId,
        orderNo: row.orderNo,
        orderStatus: row.orderStatus,
        customerNameEncrypted: row.customerNameEncrypted,
        customerPhoneTail: row.customerPhoneTail,
        customerSnapshot: row.customerSnapshot,
        beneficiaryId: row.beneficiaryId,
        beneficiaryName: row.beneficiaryName,
        storeId: row.storeId,
        entryType: row.entryType,
        eventKey: row.eventKey,
        amountFen: row.amountFen,
        reason: row.reason,
        occurredAt: row.occurredAt,
        ruleId: row.ruleId,
        ruleSku: ruleSkuExpression({
          targetType: row.ruleTargetType,
          targetSku: row.ruleTargetSku,
          fttrPlan: row.ruleFttrPlan,
        }),
        ruleName: row.ruleName,
        activatedAt: row.activatedAt,
        signedAt: row.signedAt,
        reconciledAt: row.reconciledAt,
        orderPaidAt: row.orderPaidAt,
        orderCreatedAt: row.orderCreatedAt,
        calculationSnapshot: row.calculationSnapshot,
        settlementStatus: row.settlementStatus,
        settlementAmountFen: row.settlementAmountFen,
        paidAt: row.paidAt,
      };
    });
  }

  async listEstimatedOrders(
    scope: UserScope,
    filters: CommissionDashboardRepositoryFilters,
  ): Promise<readonly EstimatedCommissionOrder[]> {
    const conditions: SQL[] = [
      inArray(orders.status, ["pending", "accepted"]),
      isNull(orders.deletedAt),
      ...estimatedOrderScopeConditions(this.executor, scope),
    ];
    if (filters.storeId) conditions.push(eq(orders.storeId, filters.storeId));
    if (filters.beneficiaryId) {
      conditions.push(orderHasBeneficiary(this.executor, filters.beneficiaryId));
    }
    if (filters.orderId) conditions.push(eq(orders.id, filters.orderId));

    const orderRows = await this.executor
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        status: orders.status,
        storeId: orders.storeId,
        sellerId: orders.sellerId,
        paymentMode: orders.paymentMode,
        fttrKind: orders.fttrKind,
        fttrPlan: orders.fttrPlan,
        personnelType: users.personnelType,
        customerNameEncrypted: customers.nameEncrypted,
        customerPhoneTail: customers.phoneTail,
        customerSnapshot: orders.customerSnapshot,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.sellerId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt), desc(orders.id));
    if (orderRows.length === 0) return [];

    const orderIds = orderRows.map((row) => row.id);
    const [lineRows, attributionRows] = await Promise.all([
      this.executor
        .select({
          orderId: orderLines.orderId,
          sku: orderLines.sku,
          label: orderLines.label,
          quantity: orderLines.quantity,
          lineType: orderLines.lineType,
        })
        .from(orderLines)
        .where(inArray(orderLines.orderId, orderIds))
        .orderBy(orderLines.createdAt, orderLines.id),
      this.executor
        .select({
          orderId: orderAttributions.orderId,
          beneficiaryId: orderAttributions.beneficiaryId,
          role: orderAttributions.attributionRole,
          basisPoints: orderAttributions.basisPoints,
        })
        .from(orderAttributions)
        .where(inArray(orderAttributions.orderId, orderIds))
        .orderBy(orderAttributions.createdAt, orderAttributions.id),
    ]);
    const linesByOrder = new Map<string, typeof lineRows>();
    for (const line of lineRows) {
      const entries = linesByOrder.get(line.orderId) ?? [];
      entries.push(line);
      linesByOrder.set(line.orderId, entries);
    }
    const attributionsByOrder = new Map<string, EstimatedCommissionAttribution[]>();
    for (const attribution of attributionRows) {
      const entries = attributionsByOrder.get(attribution.orderId) ?? [];
      entries.push({
        beneficiaryId: attribution.beneficiaryId,
        role: attribution.role,
        basisPoints: attribution.basisPoints,
      });
      attributionsByOrder.set(attribution.orderId, entries);
    }
    return orderRows.map((row): EstimatedCommissionOrder => {
      if (row.status !== "pending" && row.status !== "accepted") {
        throw new Error("预计提成订单状态不正确");
      }
      const fttrLine = buildFttrCommissionLine(row);
      return {
        id: row.id,
        orderNo: row.orderNo,
        status: row.status,
        storeId: row.storeId,
        sellerId: row.sellerId,
        paymentMode: row.paymentMode,
        personnelType: row.personnelType,
        customerNameEncrypted: row.customerNameEncrypted,
        customerPhoneTail: row.customerPhoneTail,
        customerSnapshot: row.customerSnapshot,
        createdAt: row.createdAt,
        lines: [
          ...(fttrLine ? [fttrLine] : []),
          ...(linesByOrder.get(row.id) ?? []).map((line) => ({
            sku: line.sku,
            label: line.label,
            quantity: line.quantity,
            lineType: line.lineType,
          })),
        ],
        attributions: attributionsByOrder.get(row.id) ?? [],
      };
    });
  }

  async listMissingAccrualOrders(
    scope: UserScope,
    filters: CommissionDashboardRepositoryFilters,
  ): Promise<readonly MissingCommissionOrder[]> {
    const conditions: SQL[] = [
      inArray(orders.status, ["activated", "signed", "reconciled", "paid", "return_pending", "partially_returned", "returned"]),
      isNull(orders.deletedAt),
      notExists(
        this.executor
          .select({ id: orderCommissionSnapshots.id })
          .from(orderCommissionSnapshots)
          .where(eq(orderCommissionSnapshots.orderId, orders.id)),
      ),
      ...estimatedOrderScopeConditions(this.executor, scope),
    ];
    if (filters.storeId) conditions.push(eq(orders.storeId, filters.storeId));
    if (filters.beneficiaryId) {
      conditions.push(orderHasBeneficiary(this.executor, filters.beneficiaryId));
    }
    if (filters.orderId) conditions.push(eq(orders.id, filters.orderId));

    const rows = await this.executor
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        customerNameEncrypted: customers.nameEncrypted,
        customerPhoneTail: customers.phoneTail,
        customerSnapshot: orders.customerSnapshot,
        activatedAt: orders.activatedAt,
        signedAt: orders.signedAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...conditions))
      .orderBy(desc(orders.activatedAt), desc(orders.id));

    return rows.map((row) => ({
      id: row.id,
      orderNo: row.orderNo,
      customerNameEncrypted: row.customerNameEncrypted,
      customerPhoneTail: row.customerPhoneTail,
      customerSnapshot: row.customerSnapshot,
      activatedAt: row.activatedAt,
      referenceAt: row.activatedAt ?? row.signedAt ?? row.createdAt,
      issue: row.activatedAt ? "missing_policy" as const : "missing_activation" as const,
    }));
  }

  async findEffectivePolicy(
    at: Date,
  ): Promise<CommissionPolicyForAccrual | null> {
    const [version] = await this.executor
      .select()
      .from(commissionPolicyVersions)
      .where(
        and(
          eq(commissionPolicyVersions.policyCode, POLICY_CODE),
          inArray(commissionPolicyVersions.status, ["published", "stopped"]),
          lte(commissionPolicyVersions.effectiveFrom, at),
          or(
            isNull(commissionPolicyVersions.effectiveTo),
            gt(commissionPolicyVersions.effectiveTo, at),
          ),
        ),
      )
      .orderBy(desc(commissionPolicyVersions.versionNo))
      .limit(1);
    if (!version) return null;
    const rows = await this.executor
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.policyVersionId, version.id));
    return {
      id: version.id,
      version: version.versionNo,
      rules: rows.map(mapRule),
    };
  }
}
