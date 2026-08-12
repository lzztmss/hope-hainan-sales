import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import type {
  CommissionOrderLine,
  CommissionRule,
  CommissionScope,
} from "../../shared/commission/types.js";
import type { AppDatabase, DbClient, DbTransaction } from "../db/client.js";
import {
  commissionLedger,
  commissionPolicyVersions,
  commissionRules,
  orderAttributions,
  orderCommissionSnapshots,
  orderLines,
  orders,
  users,
} from "../db/schema.js";
import type {
  CommissionAccrualOrder,
  CommissionAccrualResult,
  CommissionAccrualWrite,
  CommissionLedgerCredit,
  CommissionLedgerRepository,
  CommissionPolicyForAccrual,
  CommissionReversalResult,
  CommissionReversalWrite,
} from "./ledgerService.js";

type QueryExecutor = AppDatabase | DbTransaction;
type RuleRow = typeof commissionRules.$inferSelect;

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

const calculationSnapshot = (
  input: CommissionAccrualWrite,
): Record<string, unknown> => ({
  policyVersion: input.policyVersion,
  calculation: input.calculation,
  attributionSnapshot: input.attributionSnapshot,
});

export const buildFttrCommissionLine = (source: {
  fttrKind: "none" | "standard" | "custom";
  fttrPlan: number | null;
}): CommissionOrderLine | null => {
  if (source.fttrKind === "none") return null;
  if (!Number.isInteger(source.fttrPlan) || source.fttrPlan === null) {
    throw new Error("订单 FTTR 档位快照不完整");
  }
  if (source.fttrKind === "custom") {
    return {
      sku: "FTTR_CUSTOM",
      label: `FTTR 自定义档位（${source.fttrPlan} 元/月）`,
      quantity: 1,
      lineType: "charge",
    };
  }
  return {
    sku: `FTTR_${source.fttrPlan}`,
    label: `FTTR ${source.fttrPlan} 元套餐`,
    quantity: 1,
    lineType: "charge",
  };
};

export class DrizzleCommissionLedgerRepository
  implements CommissionLedgerRepository
{
  constructor(
    private readonly client: DbClient,
    private readonly executor: QueryExecutor = client.db,
    private readonly insideTransaction = false,
  ) {}

  async runTransaction<T>(
    work: (repository: CommissionLedgerRepository) => Promise<T>,
  ): Promise<T> {
    if (this.insideTransaction) return work(this);
    return this.client.withTransaction((tx) =>
      work(new DrizzleCommissionLedgerRepository(this.client, tx, true)),
    );
  }

  async findOrderForAccrual(
    orderId: string,
  ): Promise<CommissionAccrualOrder | null> {
    const [order] = await this.executor
      .select({
        id: orders.id,
        status: orders.status,
        activatedAt: orders.activatedAt,
        storeId: orders.storeId,
        sellerId: orders.sellerId,
        paymentMode: orders.paymentMode,
        fttrKind: orders.fttrKind,
        fttrPlan: orders.fttrPlan,
        personnelType: users.personnelType,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.sellerId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return null;

    const [lines, attributionRows] = await Promise.all([
      this.executor
        .select({
          sku: orderLines.sku,
          label: orderLines.label,
          quantity: orderLines.quantity,
          lineType: orderLines.lineType,
        })
        .from(orderLines)
        .where(eq(orderLines.orderId, orderId)),
      this.executor
        .select({
          beneficiaryId: orderAttributions.beneficiaryId,
          role: orderAttributions.attributionRole,
          basisPoints: orderAttributions.basisPoints,
        })
        .from(orderAttributions)
        .where(eq(orderAttributions.orderId, orderId)),
    ]);

    const fttrLine = buildFttrCommissionLine(order);
    return {
      id: order.id,
      status: order.status,
      activatedAt: order.activatedAt,
      storeId: order.storeId,
      sellerContext: {
        salespersonId: order.sellerId,
        storeId: order.storeId,
        personnelType: order.personnelType,
        paymentMode: order.paymentMode,
      },
      lines: fttrLine ? [fttrLine, ...lines] : lines,
      attributions: attributionRows,
    };
  }

  async findAccrualByOrder(
    orderId: string,
  ): Promise<CommissionAccrualResult | null> {
    const [snapshot] = await this.executor
      .select()
      .from(orderCommissionSnapshots)
      .where(eq(orderCommissionSnapshots.orderId, orderId))
      .limit(1);
    if (!snapshot) return null;
    const ledger = await this.executor
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.orderId, orderId),
          eq(commissionLedger.entryType, "accrual"),
        ),
      );
    const stored = snapshot.calculationSnapshot;
    const calculation = stored.calculation;
    const attributions = stored.attributionSnapshot;
    const policyVersion = stored.policyVersion;
    if (
      !calculation ||
      typeof calculation !== "object" ||
      !Array.isArray(attributions) ||
      !Number.isInteger(policyVersion)
    ) {
      throw new Error("订单提成快照不完整");
    }
    return {
      snapshotId: snapshot.id,
      orderId,
      eventKey: snapshot.eventKey,
      policyVersionId: snapshot.policyVersionId,
      policyVersion: policyVersion as number,
      totalFen: snapshot.totalFen,
      calculation: calculation as CommissionAccrualResult["calculation"],
      attributionSnapshot:
        attributions as unknown as CommissionAccrualResult["attributionSnapshot"],
      ledgerEntries: ledger.map(
        (entry): CommissionLedgerCredit => ({
          orderId,
          snapshotId: snapshot.id,
          ruleId: entry.ruleId!,
          beneficiaryId: entry.beneficiaryId,
          storeId: entry.storeId!,
          entryType: "accrual",
          eventKey: entry.eventKey,
          amountFen: entry.amountFen,
          occurredAt: entry.occurredAt,
        }),
      ),
      accruedAt: snapshot.createdAt,
    };
  }

  async findEffectivePolicy(
    at: Date,
  ): Promise<CommissionPolicyForAccrual | null> {
    const [version] = await this.executor
      .select()
      .from(commissionPolicyVersions)
      .where(
        and(
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
    const rules = await this.executor
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.policyVersionId, version.id));
    return {
      id: version.id,
      version: version.versionNo,
      rules: rules.map(mapRule),
    };
  }

  async createAccrual(
    input: CommissionAccrualWrite,
  ): Promise<CommissionAccrualResult> {
    const [snapshot] = await this.executor
      .insert(orderCommissionSnapshots)
      .values({
        orderId: input.orderId,
        policyVersionId: input.policyVersionId,
        eventKey: input.eventKey,
        totalFen: input.totalFen,
        calculationSnapshot: calculationSnapshot(input),
        createdAt: input.accruedAt,
      })
      .returning();
    if (!snapshot) throw new Error("提成快照创建失败");

    if (input.ledgerEntries.length > 0) {
      await this.executor.insert(commissionLedger).values(
        input.ledgerEntries.map((entry) => ({
          orderId: entry.orderId,
          snapshotId: snapshot.id,
          ruleId: entry.ruleId,
          beneficiaryId: entry.beneficiaryId,
          storeId: entry.storeId,
          entryType: entry.entryType,
          eventKey: entry.eventKey,
          amountFen: entry.amountFen,
          occurredAt: entry.occurredAt,
        })),
      );
    }
    return {
      snapshotId: snapshot.id,
      ...input,
      ledgerEntries: input.ledgerEntries.map((entry) => ({
        ...entry,
        snapshotId: snapshot.id,
      })),
    };
  }

  async findReversalByReturn(
    returnId: string,
  ): Promise<CommissionReversalResult | null> {
    const rows = await this.executor
      .select()
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.returnId, returnId),
          eq(commissionLedger.entryType, "return_reversal"),
        ),
      )
      .orderBy(commissionLedger.createdAt);
    const first = rows[0];
    if (!first) return null;
    if (!first.orderId || !first.snapshotId || !first.ruleId || !first.storeId) {
      throw new Error("退单提成冲销账本不完整");
    }
    const ledgerEntries = rows.map((entry) => {
      if (
        !entry.orderId ||
        !entry.returnId ||
        !entry.snapshotId ||
        !entry.ruleId ||
        !entry.storeId ||
        entry.entryType !== "return_reversal"
      ) {
        throw new Error("退单提成冲销账本不完整");
      }
      return {
        orderId: entry.orderId,
        returnId: entry.returnId,
        snapshotId: entry.snapshotId,
        ruleId: entry.ruleId,
        beneficiaryId: entry.beneficiaryId,
        storeId: entry.storeId,
        entryType: "return_reversal" as const,
        eventKey: entry.eventKey,
        amountFen: entry.amountFen,
        occurredAt: entry.occurredAt,
      };
    });
    return {
      id: first.id,
      orderId: first.orderId,
      returnId,
      snapshotId: first.snapshotId,
      eventKey: first.eventKey,
      totalFen: ledgerEntries.reduce((sum, entry) => sum + entry.amountFen, 0),
      ledgerEntries,
      reversedAt: first.occurredAt,
    };
  }

  async createReversal(
    input: CommissionReversalWrite,
  ): Promise<CommissionReversalResult> {
    if (input.ledgerEntries.length === 0) {
      throw new Error("提成冲销账本不能为空");
    }
    const inserted = await this.executor
      .insert(commissionLedger)
      .values(
        input.ledgerEntries.map((entry) => ({
          orderId: entry.orderId,
          returnId: entry.returnId,
          snapshotId: entry.snapshotId,
          ruleId: entry.ruleId,
          beneficiaryId: entry.beneficiaryId,
          storeId: entry.storeId,
          entryType: entry.entryType,
          eventKey: entry.eventKey,
          amountFen: entry.amountFen,
          occurredAt: entry.occurredAt,
        })),
      )
      .returning();
    const first = inserted[0];
    if (!first) throw new Error("提成冲销账本创建失败");
    return { id: first.id, ...input };
  }
}
