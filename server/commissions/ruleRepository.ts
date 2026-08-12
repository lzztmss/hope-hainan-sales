import { and, desc, eq, inArray, max, sql } from "drizzle-orm";

import type { CommissionRule, CommissionScope } from "../../shared/commission/types.js";
import type { AppDatabase, DbClient, DbTransaction } from "../db/client.js";
import {
  auditLogs,
  commissionPolicyVersions,
  commissionRules,
  orderCommissionSnapshots,
} from "../db/schema.js";
import type {
  CommissionPolicyVersion,
  CommissionPolicyReplacementWrite,
  CommissionRuleAuditContext,
  CommissionRuleRepository,
} from "./ruleService.js";

type QueryExecutor = AppDatabase | DbTransaction;
type PolicyRow = typeof commissionPolicyVersions.$inferSelect;
type RuleRow = typeof commissionRules.$inferSelect;

const POLICY_CODE = "HAINAN_FTTR_HEARTLINK";
const PACKAGE_SKUS = new Set([
  "FULL_FAMILY",
  "WATCH_MATTRESS",
  "WATCH_STANDARD",
  "MATTRESS_STANDARD",
  "STANDARD_BUNDLE",
  "ONE_KEY",
  "HOME_DUAL",
]);

const toIso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

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

const mapVersion = (
  row: PolicyRow,
  rules: readonly RuleRow[],
): CommissionPolicyVersion => ({
  id: row.id,
  version: row.versionNo,
  name: row.name,
  status: row.status,
  effectiveFrom: row.effectiveFrom.toISOString(),
  effectiveTo: toIso(row.effectiveTo),
  rules: rules.map(mapRule),
  sourceVersionId: null,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  publishedBy: row.publishedBy,
  publishedAt: toIso(row.publishedAt),
  stoppedBy: row.stoppedBy,
  stoppedAt: toIso(row.stoppedAt),
  changeNote: row.changeNote,
  revision: row.version,
});

const targetFields = (sku: string) => {
  if (sku === "FTTR_CUSTOM") {
    return {
      businessDomain: "fttr" as const,
      targetType: "fttr_plan" as const,
      targetSku: "CUSTOM",
      fttrPlan: null,
    };
  }
  const fttrMatch = /^FTTR_(\d{1,4})$/.exec(sku);
  if (fttrMatch) {
    return {
      businessDomain: "fttr" as const,
      targetType: "fttr_plan" as const,
      targetSku: null,
      fttrPlan: Number(fttrMatch[1]),
    };
  }
  return {
    businessDomain: "heartlink" as const,
    targetType: PACKAGE_SKUS.has(sku) ? ("package" as const) : ("product" as const),
    targetSku: sku,
    fttrPlan: null,
  };
};

const scopeFields = (scope: CommissionScope) => ({
  storeId: scope.kind === "store" ? scope.value : null,
  personnelType: scope.kind === "personnel_type" ? scope.value : null,
  salespersonId: scope.kind === "salesperson" ? scope.value : null,
});

const ruleInsertValues = (
  version: CommissionPolicyVersion,
  rule: CommissionRule,
): typeof commissionRules.$inferInsert => {
  const target = targetFields(rule.sku);
  return {
    id: rule.id,
    policyVersionId: version.id,
    ruleCode: rule.id,
    ruleName: rule.sku,
    status: rule.enabled ? "active" : "inactive",
    ...target,
    paymentModeScope: rule.paymentMode,
    calculationBasis: "per_unit",
    packageMode: target.targetType === "package" ? "fixed_override" : "additive",
    amountFen: rule.amountFen,
    ...scopeFields(rule.scope),
    attributionScope: "all",
    effectiveFrom: new Date(version.effectiveFrom),
    effectiveTo: version.effectiveTo ? new Date(version.effectiveTo) : null,
    stackable: false,
    allowsCrossDomain: false,
    changeNote: version.changeNote,
    createdBy: version.createdBy,
  };
};

const policyInsertValues = (
  version: CommissionPolicyVersion,
): typeof commissionPolicyVersions.$inferInsert => ({
  id: version.id,
  policyCode: POLICY_CODE,
  versionNo: version.version,
  name: version.name,
  status: version.status,
  effectiveFrom: new Date(version.effectiveFrom),
  effectiveTo: version.effectiveTo ? new Date(version.effectiveTo) : null,
  createdBy: version.createdBy,
  publishedBy: version.publishedBy,
  publishedAt: version.publishedAt ? new Date(version.publishedAt) : null,
  stoppedBy: version.stoppedBy,
  stoppedAt: version.stoppedAt ? new Date(version.stoppedAt) : null,
  changeNote: version.changeNote,
  version: version.revision,
  createdAt: new Date(version.createdAt),
  updatedAt: new Date(version.createdAt),
});

const jsonSnapshot = (value: CommissionPolicyVersion | null) =>
  value === null
    ? null
    : (JSON.parse(JSON.stringify(value)) as Record<string, unknown>);

const insertAudit = async (
  executor: QueryExecutor,
  version: CommissionPolicyVersion,
  audit: CommissionRuleAuditContext,
): Promise<void> => {
  await executor.insert(auditLogs).values({
    actorUserId: audit.actorId,
    entityType: "commission_policy_version",
    entityId: version.id,
    action: audit.action,
    beforeSnapshot: jsonSnapshot(audit.before),
    afterSnapshot: jsonSnapshot(version),
    reason: audit.reason,
    createdAt: new Date(audit.at),
  });
};

const loadRules = async (
  executor: QueryExecutor,
  policyIds: readonly string[],
): Promise<readonly RuleRow[]> => {
  if (policyIds.length === 0) return [];
  return executor
    .select()
    .from(commissionRules)
    .where(inArray(commissionRules.policyVersionId, [...policyIds]));
};

const replaceStoredVersion = async (
  tx: DbTransaction,
  version: CommissionPolicyVersion,
  expectedRevision: number,
  audit: CommissionRuleAuditContext,
): Promise<boolean> => {
  const [updated] = await tx
    .update(commissionPolicyVersions)
    .set({
      name: version.name,
      status: version.status,
      effectiveFrom: new Date(version.effectiveFrom),
      effectiveTo: version.effectiveTo ? new Date(version.effectiveTo) : null,
      publishedBy: version.publishedBy,
      publishedAt: version.publishedAt ? new Date(version.publishedAt) : null,
      stoppedBy: version.stoppedBy,
      stoppedAt: version.stoppedAt ? new Date(version.stoppedAt) : null,
      changeNote: version.changeNote,
      version: version.revision,
      updatedAt: new Date(audit.at),
    })
    .where(
      and(
        eq(commissionPolicyVersions.id, version.id),
        eq(commissionPolicyVersions.version, expectedRevision),
      ),
    )
    .returning({ id: commissionPolicyVersions.id });
  if (!updated) return false;

  if (audit.action === "update_draft") {
    for (const rule of version.rules) {
      const [changed] = await tx
        .update(commissionRules)
        .set({
          amountFen: rule.amountFen,
          status: rule.enabled ? "active" : "inactive",
          changeNote: audit.reason,
          version: version.revision,
          updatedAt: new Date(audit.at),
        })
        .where(
          and(
            eq(commissionRules.id, rule.id),
            eq(commissionRules.policyVersionId, version.id),
          ),
        )
        .returning({ id: commissionRules.id });
      if (!changed) throw new Error("提成规则不存在");
    }
  } else if (audit.action === "publish" || audit.action === "stop") {
    await tx
      .update(commissionRules)
      .set({
        effectiveFrom: new Date(version.effectiveFrom),
        effectiveTo: version.effectiveTo ? new Date(version.effectiveTo) : null,
        changeNote: audit.reason,
        version: version.revision,
        updatedAt: new Date(audit.at),
      })
      .where(eq(commissionRules.policyVersionId, version.id));
  }

  await insertAudit(tx, version, audit);
  return true;
};

class CommissionPolicyRevisionConflict extends Error {}

interface StoredPolicyInterval {
  id: string;
  status: CommissionPolicyVersion["status"];
  effectiveFrom: Date;
  effectiveTo: Date | null;
  revision: number;
}

const storedIntervalsOverlap = (
  left: StoredPolicyInterval,
  right: StoredPolicyInterval,
): boolean => {
  const leftStart = left.effectiveFrom.getTime();
  const rightStart = right.effectiveFrom.getTime();
  const leftEnd = left.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftEnd <= leftStart || rightEnd <= rightStart) return false;
  return leftStart < rightEnd && rightStart < leftEnd;
};

const assertPublishSchedule = (
  rows: readonly StoredPolicyInterval[],
  published: CommissionPolicyReplacementWrite,
  predecessor?: CommissionPolicyReplacementWrite,
): void => {
  const current = rows.find((row) => row.id === published.version.id);
  const currentPredecessor = predecessor
    ? rows.find((row) => row.id === predecessor.version.id)
    : null;
  if (
    !current ||
    current.revision !== published.expectedRevision ||
    (predecessor &&
      (!currentPredecessor ||
        currentPredecessor.revision !== predecessor.expectedRevision))
  ) {
    throw new CommissionPolicyRevisionConflict();
  }

  const proposed = rows
    .map((row): StoredPolicyInterval => {
      const replacement =
        row.id === published.version.id
          ? published.version
          : predecessor && row.id === predecessor.version.id
            ? predecessor.version
            : null;
      return replacement
        ? {
            id: replacement.id,
            status: replacement.status,
            effectiveFrom: new Date(replacement.effectiveFrom),
            effectiveTo: replacement.effectiveTo
              ? new Date(replacement.effectiveTo)
              : null,
            revision: replacement.revision,
          }
        : row;
    })
    .filter((row) => row.status !== "draft");
  for (let leftIndex = 0; leftIndex < proposed.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < proposed.length;
      rightIndex += 1
    ) {
      if (storedIntervalsOverlap(proposed[leftIndex]!, proposed[rightIndex]!)) {
        throw new Error("提成规则版本生效时间重叠");
      }
    }
  }
};

export class DrizzleCommissionRuleRepository
  implements CommissionRuleRepository
{
  constructor(private readonly client: DbClient) {}

  async allocateVersionNumber(): Promise<number> {
    const [row] = await this.client.db
      .select({ value: max(commissionPolicyVersions.versionNo) })
      .from(commissionPolicyVersions)
      .where(eq(commissionPolicyVersions.policyCode, POLICY_CODE));
    return (row?.value ?? 0) + 1;
  }

  async insertVersion(
    version: CommissionPolicyVersion,
    audit: CommissionRuleAuditContext,
  ): Promise<void> {
    await this.client.withTransaction(async (tx) => {
      await tx.insert(commissionPolicyVersions).values(policyInsertValues(version));
      await tx
        .insert(commissionRules)
        .values(version.rules.map((rule) => ruleInsertValues(version, rule)));
      await insertAudit(tx, version, audit);
    });
  }

  async findVersionById(id: string): Promise<CommissionPolicyVersion | null> {
    const [row] = await this.client.db
      .select()
      .from(commissionPolicyVersions)
      .where(eq(commissionPolicyVersions.id, id))
      .limit(1);
    if (!row) return null;
    const rules = await loadRules(this.client.db, [row.id]);
    return mapVersion(row, rules);
  }

  async listVersions(): Promise<readonly CommissionPolicyVersion[]> {
    const rows = await this.client.db
      .select()
      .from(commissionPolicyVersions)
      .where(eq(commissionPolicyVersions.policyCode, POLICY_CODE))
      .orderBy(desc(commissionPolicyVersions.versionNo));
    const rules = await loadRules(
      this.client.db,
      rows.map((row) => row.id),
    );
    const byPolicy = new Map<string, RuleRow[]>();
    for (const rule of rules) {
      const entries = byPolicy.get(rule.policyVersionId) ?? [];
      entries.push(rule);
      byPolicy.set(rule.policyVersionId, entries);
    }
    return rows.map((row) => mapVersion(row, byPolicy.get(row.id) ?? []));
  }

  async replaceVersion(
    version: CommissionPolicyVersion,
    expectedRevision: number,
    audit: CommissionRuleAuditContext,
  ): Promise<boolean> {
    return this.client.withTransaction((tx) =>
      replaceStoredVersion(tx, version, expectedRevision, audit),
    );
  }

  async publishVersion(
    published: CommissionPolicyReplacementWrite,
    predecessor?: CommissionPolicyReplacementWrite,
  ): Promise<boolean> {
    try {
      return await this.client.withTransaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${POLICY_CODE}))`,
        );
        const rows = await tx
          .select({
            id: commissionPolicyVersions.id,
            status: commissionPolicyVersions.status,
            effectiveFrom: commissionPolicyVersions.effectiveFrom,
            effectiveTo: commissionPolicyVersions.effectiveTo,
            revision: commissionPolicyVersions.version,
          })
          .from(commissionPolicyVersions)
          .where(eq(commissionPolicyVersions.policyCode, POLICY_CODE));
        assertPublishSchedule(rows, published, predecessor);
        if (predecessor) {
          const stopped = await replaceStoredVersion(
            tx,
            predecessor.version,
            predecessor.expectedRevision,
            predecessor.audit,
          );
          if (!stopped) throw new CommissionPolicyRevisionConflict();
        }
        const inserted = await replaceStoredVersion(
          tx,
          published.version,
          published.expectedRevision,
          published.audit,
        );
        if (!inserted) throw new CommissionPolicyRevisionConflict();
        return true;
      });
    } catch (error) {
      if (error instanceof CommissionPolicyRevisionConflict) return false;
      throw error;
    }
  }

  async isVersionUsed(id: string): Promise<boolean> {
    const [row] = await this.client.db
      .select({ id: orderCommissionSnapshots.id })
      .from(orderCommissionSnapshots)
      .where(eq(orderCommissionSnapshots.policyVersionId, id))
      .limit(1);
    return Boolean(row);
  }
}
