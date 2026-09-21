import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";

import {
  completionReward,
  milestoneReward,
  revenueAccelerationReward,
  tieredOrderReward,
  topUpReward,
} from "../../shared/regionalCommission/calculator.js";
import {
  DEFAULT_REGIONAL_COMMISSION_RULES,
  normalizeRegionalCommissionRules,
  type RegionalCommissionRules,
  type RegionalProductSku,
} from "../../shared/regionalCommission/types.js";
import {
  buildTargetPlan,
  buildPresetHalfYearPlan,
  type RegionalTargetPlanType,
} from "../admin/regionalCommissionTargetPlan.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { AuthorizationError, requireRole } from "../auth/authorization.js";
import type { DbClient, DbTransaction } from "../db/client.js";
import {
  auditLogs,
  orders,
  returns as orderReturns,
  regionalCommissionLedger,
  regionalCommissionStatements,
  regionalCommissionTargetPeriods,
  regionalCommissionTargetPlans,
  regionalCommissionTemplateAssignments,
  regionalCommissionTemplateVersions,
  regionalCooperationStages,
  regionalManagerStoreHistory,
  regionalNetReceipts,
  regionalPersonalChannelOrderLines,
  regionalPersonalChannelOrders,
  settlementBatches,
  stores,
  users,
} from "../db/schema.js";

const DAY_MS = 86_400_000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const currentShanghaiMonth = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
}).format(new Date());
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: string, days: number) =>
  dateOnly(new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS));
const monthEnd = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, value!, 1) - 1);
};
const assertManagerAccess = (actor: AuthenticatedUser, managerId: string) => {
  if (["admin", "hr", "finance"].includes(actor.role)) return;
  if (actor.role !== "regional_manager" || actor.id !== managerId) throw new AuthorizationError();
};
const asRules = (value: Record<string, unknown>): RegionalCommissionRules =>
  normalizeRegionalCommissionRules(value);

const rulesForTemplate = (value: Record<string, unknown> | RegionalCommissionRules) =>
  normalizeRegionalCommissionRules(value);

type RuleAssignment = {
  assignmentId: string;
  assignmentEffectiveFrom: string;
  assignmentEffectiveTo: string | null;
  templateVersionId: string;
  templateName: string;
  templateVersionNo: number;
  templateEffectiveTo: string | null;
  rules: RegionalCommissionRules;
};

const fallbackRules = () => ({
  assignmentId: null,
  assignmentEffectiveFrom: null,
  assignmentEffectiveTo: null,
  templateVersionId: null,
  templateName: null,
  templateVersionNo: null,
  templateEffectiveTo: null,
  rules: DEFAULT_REGIONAL_COMMISSION_RULES,
});

const assignmentTargetCycle = (assignment: RuleAssignment, fallbackStartsOn: string | null = null) => {
  const startsOn = assignment.rules.targetCycle.startsOn ?? fallbackStartsOn;
  return startsOn
    ? buildTargetPlan(startsOn, assignment.rules.targetCycle.planType, assignment.rules.targetCycle.periodTargets)
    : null;
};

const earliestDate = (...values: Array<string | null | undefined>): string | null => {
  const dates = values.filter((value): value is string => Boolean(value));
  return dates.length ? dates.sort()[0]! : null;
};

const assignmentCalculationEndsOn = (assignment: RuleAssignment, fallbackStartsOn: string | null = null) =>
  earliestDate(
    assignment.assignmentEffectiveTo,
    assignment.templateEffectiveTo,
    assignmentTargetCycle(assignment, fallbackStartsOn)?.endsOn,
  );

const rulesOn = (assignments: readonly RuleAssignment[], onDate: string, fallbackStartsOn: string | null = null) =>
  assignments.find((assignment) => {
    const calculationEndsOn = assignmentCalculationEndsOn(assignment, fallbackStartsOn);
    return assignment.assignmentEffectiveFrom <= onDate
      && (!calculationEndsOn || calculationEndsOn >= onDate);
  }) ?? fallbackRules();

const receiptAuditSnapshot = (value: unknown) => {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    month: row.month ?? null,
    netReceiptFen: row.netReceiptFen ?? null,
    evidenceNo: row.evidenceNo ?? null,
    note: row.note ?? null,
    verificationStatus: row.verificationStatus ?? null,
    verifiedBy: row.verifiedBy ?? null,
    verifiedAt: row.verifiedAt ?? null,
    verificationReason: row.verificationReason ?? null,
  };
};

export interface PersonalOrderInput {
  managerId: string;
  orderNo: string;
  channel: string;
  orderCount: number;
  businessDate: string;
  signedOn: string;
  evidenceNo: string;
  note?: string;
  lines: readonly { sku: RegionalProductSku; label: string; quantity: number }[];
}

export class RegionalCommissionService {
  constructor(private readonly client: DbClient) {}

  async listManagers(actor: AuthenticatedUser) {
    requireRole(actor, "regional_manager", "hr", "finance", "admin");
    const condition = actor.role === "regional_manager"
      ? eq(users.id, actor.id)
      : eq(users.role, "regional_manager");
    return this.client.db.select({
      id: users.id,
      displayName: users.displayName,
      workNo: users.workNo,
      active: users.active,
      employmentStartDate: users.employmentStartDate,
      employmentEndDate: users.employmentEndDate,
    }).from(users).where(condition).orderBy(asc(users.displayName));
  }

  async listTargetPlans(actor: AuthenticatedUser, managerId: string) {
    assertManagerAccess(actor, managerId);
    const plans = await this.client.db.select().from(regionalCommissionTargetPlans)
      .where(eq(regionalCommissionTargetPlans.regionalManagerId, managerId))
      .orderBy(desc(regionalCommissionTargetPlans.startsOn), desc(regionalCommissionTargetPlans.createdAt));
    return Promise.all(plans.map(async (plan) => ({
      ...plan,
      periods: await this.client.db.select().from(regionalCommissionTargetPeriods)
        .where(eq(regionalCommissionTargetPeriods.planId, plan.id))
        .orderBy(asc(regionalCommissionTargetPeriods.sequence)),
    })));
  }

  async createSuggestedTargetPlan(actor: AuthenticatedUser, managerId: string, reason: string) {
    requireRole(actor, "hr", "admin");
    const manager = (await this.client.db.select({
      employmentStartDate: users.employmentStartDate,
    }).from(users).where(and(eq(users.id, managerId), eq(users.role, "regional_manager"))))[0];
    if (!manager?.employmentStartDate) throw new Error("大区经理未配置入职日期");
    const existing = await this.client.db.select({ id: regionalCommissionTargetPlans.id })
      .from(regionalCommissionTargetPlans)
      .where(eq(regionalCommissionTargetPlans.regionalManagerId, managerId)).limit(1);
    if (existing.length > 0) throw new Error("该大区经理已经存在目标计划");
    const plan = buildPresetHalfYearPlan(manager.employmentStartDate);
    return this.client.withTransaction(async (tx) => {
      const [created] = await tx.insert(regionalCommissionTargetPlans).values({
        regionalManagerId: managerId,
        planType: plan.planType,
        periodCount: plan.periodCount,
        startsOn: plan.startsOn,
        endsOn: plan.endsOn,
        isPreset: true,
        status: "draft",
        setBy: actor.id,
        changeReason: reason.trim(),
      }).returning();
      await tx.insert(regionalCommissionTargetPeriods).values(
        plan.periods.map((period) => ({ ...period, planId: created!.id })),
      );
      await this.audit(tx, actor.id, "regional_target_plan", created!.id, "create_suggested_draft", reason);
      return { ...created!, periods: plan.periods };
    });
  }

  async saveTargetPlanDraft(actor: AuthenticatedUser, input: {
    id?: string;
    managerId: string;
    planType: RegionalTargetPlanType;
    startsOn: string;
    periodTargets: readonly number[];
    reason: string;
  }) {
    requireRole(actor, "hr", "admin");
    if (!input.reason.trim()) throw new Error("请填写目标计划设置原因");
    const manager = (await this.client.db.select({ employmentStartDate: users.employmentStartDate })
      .from(users).where(and(eq(users.id, input.managerId), eq(users.role, "regional_manager"))))[0];
    if (!manager?.employmentStartDate) throw new Error("大区经理未配置入职日期");
    const plan = buildTargetPlan(input.startsOn, input.planType, input.periodTargets);
    return this.client.withTransaction(async (tx) => {
      let planId = input.id;
      if (planId) {
        const current = (await tx.select().from(regionalCommissionTargetPlans)
          .where(and(eq(regionalCommissionTargetPlans.id, planId), eq(regionalCommissionTargetPlans.regionalManagerId, input.managerId))))[0];
        if (!current || current.status !== "draft") throw new Error("只有草稿目标计划可以修改");
        await tx.update(regionalCommissionTargetPlans).set({
          planType: plan.planType,
          periodCount: plan.periodCount,
          startsOn: plan.startsOn,
          endsOn: plan.endsOn,
          setBy: actor.id,
          changeReason: input.reason.trim(),
          updatedAt: new Date(),
        }).where(eq(regionalCommissionTargetPlans.id, planId));
        await tx.delete(regionalCommissionTargetPeriods).where(eq(regionalCommissionTargetPeriods.planId, planId));
      } else {
        const [created] = await tx.insert(regionalCommissionTargetPlans).values({
          regionalManagerId: input.managerId,
          planType: plan.planType,
          periodCount: plan.periodCount,
          startsOn: plan.startsOn,
          endsOn: plan.endsOn,
          isPreset: false,
          status: "draft",
          setBy: actor.id,
          changeReason: input.reason.trim(),
        }).returning({ id: regionalCommissionTargetPlans.id });
        planId = created!.id;
      }
      await tx.insert(regionalCommissionTargetPeriods).values(
        plan.periods.map((period) => ({ ...period, planId: planId! })),
      );
      await this.audit(tx, actor.id, "regional_target_plan", planId!, input.id ? "update_draft" : "create_draft", input.reason);
      return (await tx.select().from(regionalCommissionTargetPlans).where(eq(regionalCommissionTargetPlans.id, planId!)))[0]!;
    });
  }

  async activateTargetPlan(actor: AuthenticatedUser, id: string, reason: string) {
    requireRole(actor, "hr", "admin");
    if (!reason.trim()) throw new Error("请填写启用目标计划的原因");
    return this.client.withTransaction(async (tx) => {
      const plan = (await tx.select().from(regionalCommissionTargetPlans).where(eq(regionalCommissionTargetPlans.id, id)))[0];
      if (!plan || plan.status !== "draft") throw new Error("只有草稿目标计划可以启用");
      const manager = (await tx.select({ employmentStartDate: users.employmentStartDate })
        .from(users).where(eq(users.id, plan.regionalManagerId)))[0];
      if (!manager?.employmentStartDate) throw new Error("大区经理未配置入职日期");
      const usedPlans = await tx.select().from(regionalCommissionTargetPlans)
        .where(and(
          eq(regionalCommissionTargetPlans.regionalManagerId, plan.regionalManagerId),
          eq(regionalCommissionTargetPlans.status, "active"),
        ))
        .orderBy(asc(regionalCommissionTargetPlans.startsOn));
      if (usedPlans.length === 0) {
        if (plan.startsOn !== manager.employmentStartDate) {
          throw new Error(`首份目标计划必须从入职日期 ${manager.employmentStartDate} 开始`);
        }
      } else {
        const latest = usedPlans[usedPlans.length - 1]!;
        const expectedStart = addDays(latest.endsOn, 1);
        if (plan.startsOn !== expectedStart) {
          throw new Error(`后续目标计划必须手动创建，并从上一计划结束次日 ${expectedStart} 开始`);
        }
      }
      const [activated] = await tx.update(regionalCommissionTargetPlans).set({
        status: "active",
        replacedByPlanId: null,
        setBy: actor.id,
        changeReason: reason.trim(),
        updatedAt: new Date(),
      }).where(eq(regionalCommissionTargetPlans.id, id)).returning();
      await this.audit(tx, actor.id, "regional_target_plan", id, "activate", reason);
      return activated!;
    });
  }

  private async resolveTargetPlan(managerId: string, onDate: string) {
    const [plan] = await this.client.db.select().from(regionalCommissionTargetPlans)
      .where(and(
        eq(regionalCommissionTargetPlans.regionalManagerId, managerId),
        eq(regionalCommissionTargetPlans.status, "active"),
        lte(regionalCommissionTargetPlans.startsOn, onDate),
      ))
      .orderBy(desc(regionalCommissionTargetPlans.startsOn)).limit(1);
    if (!plan) return null;
    const periods = await this.client.db.select().from(regionalCommissionTargetPeriods)
      .where(eq(regionalCommissionTargetPeriods.planId, plan.id))
      .orderBy(asc(regionalCommissionTargetPeriods.sequence));
    return { ...plan, periods };
  }

  async listTemplates(actor: AuthenticatedUser) {
    requireRole(actor, "admin");
    const rows = await this.client.db.select().from(regionalCommissionTemplateVersions)
      .orderBy(asc(regionalCommissionTemplateVersions.templateCode), asc(regionalCommissionTemplateVersions.versionNo));
    return rows.map((row) => {
      const rulesSnapshot = normalizeRegionalCommissionRules(row.rulesSnapshot);
      const cycle = buildTargetPlan(
        rulesSnapshot.targetCycle.startsOn ?? row.effectiveFrom,
        rulesSnapshot.targetCycle.planType,
        rulesSnapshot.targetCycle.periodTargets,
      );
      return {
        ...row,
        effectiveTo: earliestDate(row.effectiveTo, cycle.endsOn),
        rulesSnapshot,
      };
    });
  }

  async createTemplate(actor: AuthenticatedUser, input: { name: string; effectiveFrom: string; reason: string; rules?: RegionalCommissionRules }) {
    requireRole(actor, "admin");
    const rules = rulesForTemplate(input.rules ?? DEFAULT_REGIONAL_COMMISSION_RULES);
    const [row] = await this.client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: `REGIONAL-${Date.now()}`,
      versionNo: 1,
      name: input.name,
      effectiveFrom: input.effectiveFrom,
      rulesSnapshot: {
        ...rules,
        targetCycle: { ...rules.targetCycle, startsOn: rules.targetCycle.startsOn ?? input.effectiveFrom },
      } as unknown as Record<string, unknown>,
      createdBy: actor.id,
      changeReason: input.reason,
    }).returning();
    return row!;
  }

  async copyTemplate(actor: AuthenticatedUser, id: string, input: { name?: string; effectiveFrom: string; reason: string }) {
    requireRole(actor, "admin");
    const source = (await this.client.db.select().from(regionalCommissionTemplateVersions).where(eq(regionalCommissionTemplateVersions.id, id)))[0];
    if (!source) throw new Error("大区提成模板不存在");
    const [latest] = await this.client.db.select({ versionNo: regionalCommissionTemplateVersions.versionNo })
      .from(regionalCommissionTemplateVersions).where(eq(regionalCommissionTemplateVersions.templateCode, source.templateCode))
      .orderBy(desc(regionalCommissionTemplateVersions.versionNo)).limit(1);
    const sourceRules = rulesForTemplate(source.rulesSnapshot);
    const [row] = await this.client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: source.templateCode,
      versionNo: (latest?.versionNo ?? source.versionNo) + 1,
      name: input.name ?? source.name,
      effectiveFrom: input.effectiveFrom,
      sourceVersionId: source.id,
      rulesSnapshot: {
        ...sourceRules,
        targetCycle: { ...sourceRules.targetCycle, startsOn: input.effectiveFrom },
      } as unknown as Record<string, unknown>,
      createdBy: actor.id,
      changeReason: input.reason,
    }).returning();
    return row!;
  }

  async publishTemplate(actor: AuthenticatedUser, id: string, reason: string) {
    requireRole(actor, "admin");
    return this.client.withTransaction(async (tx) => {
      const draft = (await tx.select().from(regionalCommissionTemplateVersions).where(and(eq(regionalCommissionTemplateVersions.id, id), eq(regionalCommissionTemplateVersions.status, "draft"))))[0];
      if (!draft) throw new Error("仅草稿模板可以发布");
      const normalizedRules = rulesForTemplate(draft.rulesSnapshot);
      const publishedRules = {
        ...normalizedRules,
        targetCycle: {
          ...normalizedRules.targetCycle,
          startsOn: normalizedRules.targetCycle.startsOn ?? draft.effectiveFrom,
        },
      };
      const targetCycle = buildTargetPlan(
        publishedRules.targetCycle.startsOn,
        publishedRules.targetCycle.planType,
        publishedRules.targetCycle.periodTargets,
      );
      if (draft.effectiveFrom > targetCycle.endsOn) {
        throw new Error("版本最早可用日期不能晚于模板计算结束日期");
      }
      await tx.update(regionalCommissionTemplateVersions).set({ effectiveTo: addDays(draft.effectiveFrom, -1), updatedAt: new Date() }).where(and(eq(regionalCommissionTemplateVersions.templateCode, draft.templateCode), eq(regionalCommissionTemplateVersions.status, "published"), isNull(regionalCommissionTemplateVersions.effectiveTo)));
      const [row] = await tx.update(regionalCommissionTemplateVersions).set({ status: "published", effectiveTo: targetCycle.endsOn, rulesSnapshot: publishedRules as unknown as Record<string, unknown>, publishedBy: actor.id, publishedAt: new Date(), changeReason: reason, version: draft.version + 1, updatedAt: new Date() }).where(eq(regionalCommissionTemplateVersions.id, id)).returning();
      return row!;
    });
  }

  async updateTemplate(actor: AuthenticatedUser, id: string, rules: RegionalCommissionRules, reason: string) {
    requireRole(actor, "admin");
    const normalizedRules = rulesForTemplate(rules);
    const [row] = await this.client.db.update(regionalCommissionTemplateVersions).set({ rulesSnapshot: normalizedRules as unknown as Record<string, unknown>, changeReason: reason, updatedAt: new Date() }).where(and(eq(regionalCommissionTemplateVersions.id, id), eq(regionalCommissionTemplateVersions.status, "draft"))).returning();
    if (!row) throw new Error("仅草稿模板可以修改");
    return row;
  }

  async stopTemplate(actor: AuthenticatedUser, id: string, reason: string) {
    requireRole(actor, "admin");
    const [row] = await this.client.db.update(regionalCommissionTemplateVersions).set({ status: "stopped", effectiveTo: dateOnly(new Date()), stoppedBy: actor.id, stoppedAt: new Date(), changeReason: reason, updatedAt: new Date() }).where(eq(regionalCommissionTemplateVersions.id, id)).returning();
    if (!row) throw new Error("模板不存在");
    return row;
  }

  async assignTemplate(actor: AuthenticatedUser, input: { managerId: string; templateVersionId: string; effectiveFrom: string; reason: string }) {
    requireRole(actor, "admin");
    if (!DATE_ONLY_PATTERN.test(input.effectiveFrom)) throw new Error("分配生效日期格式不正确");
    const template = (await this.client.db.select().from(regionalCommissionTemplateVersions).where(eq(regionalCommissionTemplateVersions.id, input.templateVersionId)))[0];
    if (!template || template.status !== "published") throw new Error("只能分配已发布模板");
    if (input.effectiveFrom < template.effectiveFrom) {
      throw new Error(`分配生效日期不能早于模板生效日期 ${template.effectiveFrom}`);
    }
    const templateRules = rulesForTemplate(template.rulesSnapshot);
    const templateCycle = buildTargetPlan(
      templateRules.targetCycle.startsOn ?? template.effectiveFrom,
      templateRules.targetCycle.planType,
      templateRules.targetCycle.periodTargets,
    );
    const templateEndsOn = earliestDate(template.effectiveTo, templateCycle.endsOn);
    if (templateEndsOn && input.effectiveFrom > templateEndsOn) {
      throw new Error(`分配生效日期不能晚于模板计算结束日期 ${templateEndsOn}`);
    }
    await this.client.withTransaction(async (tx) => {
      const [activeAssignment] = await tx.select().from(regionalCommissionTemplateAssignments)
        .where(and(
          eq(regionalCommissionTemplateAssignments.regionalManagerId, input.managerId),
          isNull(regionalCommissionTemplateAssignments.effectiveTo),
        ))
        .orderBy(desc(regionalCommissionTemplateAssignments.effectiveFrom))
        .limit(1);

      if (activeAssignment && input.effectiveFrom === activeAssignment.effectiveFrom) {
        if (activeAssignment.templateVersionId === input.templateVersionId) {
          throw new Error("该模板已从所选日期开始使用，无需重复分配");
        }
        await tx.update(regionalCommissionTemplateAssignments).set({
          templateVersionId: input.templateVersionId,
          assignedBy: actor.id,
          reason: input.reason,
          updatedAt: new Date(),
        }).where(eq(regionalCommissionTemplateAssignments.id, activeAssignment.id));
        await this.audit(tx, actor.id, "regional_template_assignment", activeAssignment.id, "replace_same_day", input.reason);
        return;
      }

      if (activeAssignment && input.effectiveFrom > activeAssignment.effectiveFrom) {
        await tx.update(regionalCommissionTemplateAssignments).set({ effectiveTo: addDays(input.effectiveFrom, -1), updatedAt: new Date() })
          .where(and(
            eq(regionalCommissionTemplateAssignments.regionalManagerId, input.managerId),
            isNull(regionalCommissionTemplateAssignments.effectiveTo),
            lte(regionalCommissionTemplateAssignments.effectiveFrom, input.effectiveFrom),
          ));
        const [assignment] = await tx.insert(regionalCommissionTemplateAssignments).values({ regionalManagerId: input.managerId, templateVersionId: input.templateVersionId, effectiveFrom: input.effectiveFrom, reason: input.reason, assignedBy: actor.id }).returning({ id: regionalCommissionTemplateAssignments.id });
        await this.audit(tx, actor.id, "regional_template_assignment", assignment!.id, "assign", input.reason);
        return;
      }

      // 倒填纠正：新生效日早于当前生效中的分配时，清除当前及未来重叠区间，再写入新区间。
      await tx.delete(regionalCommissionTemplateAssignments)
        .where(and(
          eq(regionalCommissionTemplateAssignments.regionalManagerId, input.managerId),
          or(
            isNull(regionalCommissionTemplateAssignments.effectiveTo),
            gte(regionalCommissionTemplateAssignments.effectiveFrom, input.effectiveFrom),
          ),
        ));
      await tx.update(regionalCommissionTemplateAssignments)
        .set({ effectiveTo: addDays(input.effectiveFrom, -1), updatedAt: new Date() })
        .where(and(
          eq(regionalCommissionTemplateAssignments.regionalManagerId, input.managerId),
          lt(regionalCommissionTemplateAssignments.effectiveFrom, input.effectiveFrom),
          isNotNull(regionalCommissionTemplateAssignments.effectiveTo),
          gte(regionalCommissionTemplateAssignments.effectiveTo, input.effectiveFrom),
        ));
      const [assignment] = await tx.insert(regionalCommissionTemplateAssignments).values({ regionalManagerId: input.managerId, templateVersionId: input.templateVersionId, effectiveFrom: input.effectiveFrom, reason: input.reason, assignedBy: actor.id }).returning({ id: regionalCommissionTemplateAssignments.id });
      await this.audit(tx, actor.id, "regional_template_assignment", assignment!.id, "assign", input.reason);
    });
  }

  private async loadRuleAssignments(managerId: string): Promise<RuleAssignment[]> {
    const assignments = await this.client.db.select({
      assignmentId: regionalCommissionTemplateAssignments.id,
      assignmentEffectiveFrom: regionalCommissionTemplateAssignments.effectiveFrom,
      assignmentEffectiveTo: regionalCommissionTemplateAssignments.effectiveTo,
      templateVersionId: regionalCommissionTemplateVersions.id,
      templateName: regionalCommissionTemplateVersions.name,
      templateVersionNo: regionalCommissionTemplateVersions.versionNo,
      templateEffectiveTo: regionalCommissionTemplateVersions.effectiveTo,
      rules: regionalCommissionTemplateVersions.rulesSnapshot,
    }).from(regionalCommissionTemplateAssignments)
      .innerJoin(regionalCommissionTemplateVersions, eq(regionalCommissionTemplateVersions.id, regionalCommissionTemplateAssignments.templateVersionId))
      .where(eq(regionalCommissionTemplateAssignments.regionalManagerId, managerId))
      .orderBy(
        desc(regionalCommissionTemplateAssignments.effectiveFrom),
        desc(regionalCommissionTemplateAssignments.createdAt),
      );
    return assignments.map((assignment) => ({
      ...assignment,
      rules: asRules(assignment.rules),
    }));
  }

  private async resolveRules(managerId: string, onDate: string) {
    const legacyTargetPlan = await this.resolveTargetPlan(managerId, onDate);
    return rulesOn(await this.loadRuleAssignments(managerId), onDate, legacyTargetPlan?.startsOn ?? null);
  }

  // 提成统计窗口：summary 与「当前版本累计有效订单」明细共用同一套规则解析
  // 与日期窗口，保证计数和逐单核查列表口径一致。
  private async loadStatisticsWindow(managerId: string, asOf: Date) {
    const asOfDate = dateOnly(asOf);
    const manager = (await this.client.db.select({ employmentStartDate: users.employmentStartDate, employmentEndDate: users.employmentEndDate }).from(users).where(and(eq(users.id, managerId), eq(users.role, "regional_manager"))))[0];
    if (!manager) throw new Error("大区经理不存在");
    const formalStartsOn = manager.employmentStartDate ?? null;
    if (formalStartsOn && asOfDate < formalStartsOn) throw new Error("统计截止月份不能早于大区经理入职月份");
    const legacyTargetPlan = await this.resolveTargetPlan(managerId, asOfDate);
    const ruleAssignments = await this.loadRuleAssignments(managerId);
    const cycleFallbackStartsOn = legacyTargetPlan?.startsOn ?? formalStartsOn;
    const resolved = rulesOn(ruleAssignments, asOfDate, cycleFallbackStartsOn);
    const historicalAssignment = ruleAssignments.find((assignment) => assignment.assignmentEffectiveFrom <= asOfDate) ?? null;
    const summaryRules = resolved.templateVersionId ? resolved : historicalAssignment ?? fallbackRules();
    const configuredTargetCycle = summaryRules.templateVersionId && summaryRules.rules.targetCycle.startsOn
      ? assignmentTargetCycle(summaryRules)
      : null;
    const targetPlan = configuredTargetCycle ?? legacyTargetPlan;
    const calculationStartsOn = targetPlan?.startsOn
      ?? summaryRules.rules.targetCycle.startsOn
      ?? summaryRules.assignmentEffectiveFrom
      ?? formalStartsOn;
    const calculationEndsOn = earliestDate(
      targetPlan?.endsOn,
      summaryRules.templateVersionId
        ? assignmentCalculationEndsOn(summaryRules, cycleFallbackStartsOn)
        : null,
    );
    const statisticsEndsOn = earliestDate(asOfDate, calculationEndsOn) ?? asOfDate;
    const history = await this.client.db.select().from(regionalManagerStoreHistory)
      .where(eq(regionalManagerStoreHistory.regionalManagerId, managerId));
    const storeIds = [...new Set(history.map((row) => row.storeId))];
    return {
      manager,
      formalStartsOn,
      legacyTargetPlan,
      ruleAssignments,
      cycleFallbackStartsOn,
      resolved,
      summaryRules,
      configuredTargetCycle,
      targetPlan,
      calculationStartsOn,
      calculationEndsOn,
      statisticsEndsOn,
      history,
      storeIds,
    };
  }

  // 营业厅有效订单的统一过滤条件：汇总聚合与逐单明细共用，等价于
  // 「签收满 7 天生效、未取消/未作废、生效日落在计算窗口内、生效时点
  // 营业厅归属该经理、未过离职日」。
  private managedOrderConditions(input: {
    managerId: string;
    calculationStartsOn: string;
    calculationEndsOn: string | null;
    employmentEndDate: string | null;
  }, asOf: Date): Array<SQL<unknown> | undefined> {
    const effectiveAt = sql<number>`${orders.signedAt} + ${7 * DAY_MS}`;
    const conditions: Array<SQL<unknown> | undefined> = [
      isNotNull(orders.signedAt),
      lte(orders.signedAt, new Date(asOf.getTime() - 7 * DAY_MS)),
      gte(effectiveAt, Date.parse(`${input.calculationStartsOn}T00:00:00.000Z`)),
      or(isNull(orders.cancelledAt), gte(orders.cancelledAt, effectiveAt)),
      or(isNull(orders.deletedAt), gte(orders.deletedAt, effectiveAt)),
      exists(
        this.client.db.select({ id: regionalManagerStoreHistory.id })
          .from(regionalManagerStoreHistory)
          .where(and(
            eq(regionalManagerStoreHistory.regionalManagerId, input.managerId),
            eq(regionalManagerStoreHistory.storeId, orders.storeId),
            lte(regionalManagerStoreHistory.effectiveFrom, effectiveAt),
            or(
              isNull(regionalManagerStoreHistory.effectiveTo),
              gt(regionalManagerStoreHistory.effectiveTo, effectiveAt),
            ),
          )),
      ),
    ];
    if (input.calculationEndsOn) {
      conditions.push(lt(effectiveAt, Date.parse(`${addDays(input.calculationEndsOn, 1)}T00:00:00.000Z`)));
    }
    if (input.employmentEndDate) {
      conditions.push(lt(effectiveAt, Date.parse(`${addDays(input.employmentEndDate, 1)}T00:00:00.000Z`)));
    }
    return conditions;
  }

  private async loadPersonalOrdersInWindow(
    managerId: string,
    manager: { employmentEndDate: string | null },
    calculationStartsOn: string | null,
    calculationEndsOn: string | null,
    asOf: Date,
  ) {
    const asOfDate = dateOnly(asOf);
    const personalRows = await this.client.db.select().from(regionalPersonalChannelOrders).where(and(
      eq(regionalPersonalChannelOrders.regionalManagerId, managerId),
      inArray(regionalPersonalChannelOrders.status, ["active", "returned", "voided"]),
      lte(regionalPersonalChannelOrders.effectiveOn, asOfDate),
    ));
    return calculationStartsOn
      ? personalRows.filter((row) =>
        row.effectiveOn >= calculationStartsOn
        && (!calculationEndsOn || row.effectiveOn <= calculationEndsOn)
        && (!manager.employmentEndDate || row.effectiveOn <= manager.employmentEndDate)
        && !(row.status === "voided" && row.voidedAt && dateOnly(row.voidedAt) <= asOfDate))
      : [];
  }

  // 「当前版本累计有效订单」的逐单核查明细，合计数与 summary().orderCount 一致。
  async listValidOrders(actor: AuthenticatedUser, managerId: string, month = new Date().toISOString().slice(0, 7)) {
    assertManagerAccess(actor, managerId);
    if (!MONTH_PATTERN.test(month)) throw new Error("统计截止月份格式不正确");
    if (month > currentShanghaiMonth()) throw new Error("统计截止月份不能晚于当前月份");
    const asOf = monthEnd(month);
    const asOfDate = dateOnly(asOf);
    const window = await this.loadStatisticsWindow(managerId, asOf);
    const { manager, targetPlan, calculationStartsOn, calculationEndsOn } = window;
    const managedRows = !calculationStartsOn || window.storeIds.length === 0
      ? []
      : await this.client.db.select({
        id: orders.id,
        orderNo: orders.orderNo,
        storeId: orders.storeId,
        signedAt: orders.signedAt,
      }).from(orders).where(and(...this.managedOrderConditions({
        managerId,
        calculationStartsOn,
        calculationEndsOn,
        employmentEndDate: manager.employmentEndDate,
      }, asOf))).orderBy(asc(orders.signedAt), asc(orders.orderNo));
    const fullReturnIds = new Set((await this.client.db.select({ orderId: orderReturns.orderId })
      .from(orderReturns)
      .where(and(
        eq(orderReturns.returnType, "full"),
        eq(orderReturns.status, "completed"),
        lte(orderReturns.completedAt, asOf),
      ))).map((row) => row.orderId));
    const storeNames = new Map(window.storeIds.length === 0
      ? []
      : (await this.client.db.select({ id: stores.id, name: stores.name })
        .from(stores)
        .where(inArray(stores.id, window.storeIds))).map((row) => [row.id, row.name]));
    const personal = await this.loadPersonalOrdersInWindow(managerId, manager, calculationStartsOn, calculationEndsOn, asOf);
    const periods = targetPlan?.periods ?? [];
    const periodOf = (effectiveOn: string) =>
      periods.find((period) => effectiveOn >= period.startsOn && effectiveOn <= period.endsOn)?.sequence ?? null;
    const managedOrderCount = managedRows.length;
    const personalOrderCount = personal.reduce((sum, row) => sum + row.orderCount, 0);
    const items = [
      ...managedRows.map((row) => {
        const effectiveAt = new Date(row.signedAt!.getTime() + 7 * DAY_MS);
        const effectiveOn = dateOnly(effectiveAt);
        return {
          id: row.id,
          source: "store" as const,
          orderNo: row.orderNo,
          place: storeNames.get(row.storeId) ?? "",
          signedOn: dateOnly(row.signedAt!),
          effectiveOn,
          orderCount: 1,
          status: fullReturnIds.has(row.id) ? ("returned" as const) : ("valid" as const),
          periodSequence: periodOf(effectiveOn),
        };
      }),
      ...personal.map((row) => ({
        id: row.id,
        source: "personal" as const,
        orderNo: row.orderNo,
        place: row.channel,
        signedOn: row.signedOn,
        effectiveOn: row.effectiveOn,
        orderCount: row.orderCount,
        status: row.status === "returned" && row.returnedOn !== null && row.returnedOn <= asOfDate
          ? ("returned" as const)
          : ("valid" as const),
        periodSequence: periodOf(row.effectiveOn),
      })),
    ].sort((left, right) => left.effectiveOn.localeCompare(right.effectiveOn)
      || left.orderNo.localeCompare(right.orderNo));
    return {
      month,
      statisticsStartsOn: calculationStartsOn,
      statisticsEndsOn: window.statisticsEndsOn,
      targetPlanStartsOn: targetPlan?.startsOn ?? null,
      targetPlanEndsOn: targetPlan?.endsOn ?? null,
      managedOrderCount,
      personalOrderCount,
      orderCount: managedOrderCount + personalOrderCount,
      periods: periods.map((period) => ({ sequence: period.sequence, startsOn: period.startsOn, endsOn: period.endsOn })),
      items,
    };
  }

  async summary(actor: AuthenticatedUser, managerId: string, month = new Date().toISOString().slice(0, 7)) {
    assertManagerAccess(actor, managerId);
    if (!MONTH_PATTERN.test(month)) throw new Error("统计截止月份格式不正确");
    if (month > currentShanghaiMonth()) throw new Error("统计截止月份不能晚于当前月份");
    const asOf = monthEnd(month);
    const asOfDate = dateOnly(asOf);
    const {
      manager,
      formalStartsOn,
      legacyTargetPlan,
      ruleAssignments,
      cycleFallbackStartsOn,
      resolved,
      summaryRules,
      configuredTargetCycle,
      targetPlan,
      calculationStartsOn,
      calculationEndsOn,
      statisticsEndsOn,
      history,
      storeIds,
    } = await this.loadStatisticsWindow(managerId, asOf);
    type ManagedOrder = { id: string; effectiveOn: string; reconciledAt: Date | null };
    const [completedFullReturn] = await this.client.db.select({ id: orderReturns.id })
      .from(orderReturns)
      .where(and(
        eq(orderReturns.returnType, "full"),
        eq(orderReturns.status, "completed"),
        lte(orderReturns.completedAt, asOf),
      ))
      .limit(1);
    let managedOrdersAsOf: ManagedOrder[];
    if (storeIds.length === 0) {
      managedOrdersAsOf = [];
    } else if (!completedFullReturn && calculationStartsOn) {
      // Most summaries have no completed full returns. Aggregate the large
      // managed-order set by effective day in SQLite, then expand only the
      // tiny shape used by the reward calculator. This avoids transferring
      // tens of thousands of order rows and repeatedly checking assignments
      // in JavaScript while preserving the existing calculation semantics.
      const effectiveAt = sql<number>`${orders.signedAt} + ${7 * DAY_MS}`;
      const effectiveOn = sql<string>`date((${effectiveAt}) / 1000, 'unixepoch')`;
      const conditions = this.managedOrderConditions({
        managerId,
        calculationStartsOn,
        calculationEndsOn,
        employmentEndDate: manager.employmentEndDate,
      }, asOf);
      const dailyRows = await this.client.db.select({
        effectiveOn,
        orderCount: sql<number>`count(*)`,
        verifiedCount: sql<number>`sum(case when ${orders.reconciledAt} is not null and ${orders.reconciledAt} <= ${asOf.getTime()} then 1 else 0 end)`,
      }).from(orders)
        .where(and(...conditions))
        .groupBy(effectiveOn)
        .orderBy(effectiveOn);
      managedOrdersAsOf = dailyRows.flatMap((row) => Array.from(
        { length: Number(row.orderCount) },
        (_, index): ManagedOrder => ({
          id: `${row.effectiveOn}:${String(index).padStart(8, "0")}`,
          effectiveOn: row.effectiveOn,
          reconciledAt: index < Number(row.verifiedCount) ? asOf : null,
        }),
      ));
    } else {
      const candidateOrders = await this.client.db.select({
        id: orders.id,
        storeId: orders.storeId,
        signedAt: orders.signedAt,
        reconciledAt: orders.reconciledAt,
        cancelledAt: orders.cancelledAt,
        deletedAt: orders.deletedAt,
      }).from(orders).where(and(
        inArray(orders.storeId, storeIds),
        lte(orders.signedAt, new Date(asOf.getTime() - 7 * DAY_MS)),
      ));
      managedOrdersAsOf = candidateOrders.flatMap((order) => {
        if (!order.signedAt) return [];
        const effectiveAt = new Date(order.signedAt.getTime() + 7 * DAY_MS);
        if ((order.cancelledAt && order.cancelledAt < effectiveAt) || (order.deletedAt && order.deletedAt < effectiveAt)) return [];
        if (!calculationStartsOn || dateOnly(effectiveAt) < calculationStartsOn) return [];
        if (calculationEndsOn && dateOnly(effectiveAt) > calculationEndsOn) return [];
        if (manager.employmentEndDate && dateOnly(effectiveAt) > manager.employmentEndDate) return [];
        const assigned = history.some((row) => row.storeId === order.storeId && row.effectiveFrom <= effectiveAt && (!row.effectiveTo || row.effectiveTo > effectiveAt));
        return assigned ? [{ id: order.id, effectiveOn: dateOnly(effectiveAt), reconciledAt: order.reconciledAt }] : [];
      });
    }
    const planManagedOrders = targetPlan
      ? managedOrdersAsOf.filter((order) =>
        order.effectiveOn >= targetPlan.startsOn && order.effectiveOn <= targetPlan.endsOn)
      : [];
    const personal = await this.loadPersonalOrdersInWindow(managerId, manager, calculationStartsOn, calculationEndsOn, asOf);
    const planPersonal = targetPlan
      ? personal.filter((row) =>
        row.effectiveOn >= targetPlan.startsOn && row.effectiveOn <= targetPlan.endsOn)
      : [];
    // 原始订单永久保留；当前统计壳从当前模板的 M1/目标周期起点重新累计。
    const orderCount = managedOrdersAsOf.length + personal.reduce((sum, row) => sum + row.orderCount, 0);
    const periods = targetPlan?.periods ?? [];
    let cumulativeOrderCount = 0;
    const periodStats = periods.map((period) => {
      const managedCount = planManagedOrders.filter((order) => order.effectiveOn >= period.startsOn && order.effectiveOn <= period.endsOn).length;
      const personalCount = planPersonal.filter((order) => order.effectiveOn >= period.startsOn && order.effectiveOn <= period.endsOn).reduce((sum, order) => sum + order.orderCount, 0);
      const currentCount = managedCount + personalCount;
      cumulativeOrderCount += currentCount;
      const periodRules = rulesOn(ruleAssignments, period.endsOn, cycleFallbackStartsOn);
      return {
        ...period,
        orderCount: currentCount,
        cumulativeOrderCount,
        rewardFen: period.endsOn <= asOfDate && periodRules.templateVersionId
          ? completionReward(currentCount, period.targetOrderCount, periodRules.rules)
          : 0,
        templateVersionId: periodRules.templateVersionId,
        templateName: periodRules.templateName,
        templateVersionNo: periodRules.templateVersionNo,
      };
    });
    const receipt = (await this.client.db.select().from(regionalNetReceipts).where(and(
      eq(regionalNetReceipts.regionalManagerId, managerId), eq(regionalNetReceipts.month, month),
    )))[0] ?? null;
    const productLines = personal.length ? await this.client.db.select().from(regionalPersonalChannelOrderLines)
      .where(inArray(regionalPersonalChannelOrderLines.orderId, personal.map((row) => row.id))) : [];
    const personalById = new Map(personal.map((row) => [row.id, row]));
    const productFen = productLines.reduce((sum, row) => {
      const order = personalById.get(row.orderId);
      if (!order) return sum;
      const eventRules = rulesOn(ruleAssignments, order.effectiveOn, cycleFallbackStartsOn);
      const unitCommissionFen = eventRules.templateVersionId
        ? eventRules.rules.productCommissionFen[row.sku as RegionalProductSku]
        : 0;
      const returnedQuantity = order?.returnedOn && order.returnedOn <= asOfDate
        ? row.returnedQuantity
        : 0;
      return sum + (row.quantity - returnedQuantity) * unitCommissionFen;
    }, 0);
    const legacyCumulativePlanRows = await this.client.db.select({
      sequence: regionalCommissionTargetPeriods.sequence,
      startsOn: regionalCommissionTargetPeriods.startsOn,
      endsOn: regionalCommissionTargetPeriods.endsOn,
      targetOrderCount: regionalCommissionTargetPeriods.targetOrderCount,
    }).from(regionalCommissionTargetPeriods)
      .innerJoin(regionalCommissionTargetPlans, eq(regionalCommissionTargetPlans.id, regionalCommissionTargetPeriods.planId))
      .where(and(
        eq(regionalCommissionTargetPlans.regionalManagerId, managerId),
        eq(regionalCommissionTargetPlans.status, "active"),
        lte(regionalCommissionTargetPlans.startsOn, asOfDate),
      ));
    const cumulativePlanRows = configuredTargetCycle?.periods ?? legacyCumulativePlanRows;
    const completionFen = cumulativePlanRows.reduce((sum, period) => {
      if (period.endsOn > asOfDate) return sum;
      const managedCount = managedOrdersAsOf.filter((order) => order.effectiveOn >= period.startsOn && order.effectiveOn <= period.endsOn).length;
      const personalCount = personal.filter((order) => order.effectiveOn >= period.startsOn && order.effectiveOn <= period.endsOn)
        .reduce((count, order) => count + order.orderCount, 0);
      const periodRules = rulesOn(ruleAssignments, period.endsOn, cycleFallbackStartsOn);
      return periodRules.templateVersionId
        ? sum + completionReward(managedCount + personalCount, period.targetOrderCount, periodRules.rules)
        : sum;
    }, 0);
    const cumulativeManagedIds = new Set(managedOrdersAsOf.map((order) => order.id));
    // 不构造 50,000 个 SQL 占位符；先按退单状态读取，再以内存集合限定经理订单。
    const fullReturns = completedFullReturn && managedOrdersAsOf.length ? (await this.client.db.select({ orderId: orderReturns.orderId, completedAt: orderReturns.completedAt })
      .from(orderReturns).where(and(eq(orderReturns.returnType, "full"), eq(orderReturns.status, "completed"), lte(orderReturns.completedAt, asOf))))
      .filter((row) => cumulativeManagedIds.has(row.orderId)) : [];
    const systemReturnIds = new Set(fullReturns.map((row) => row.orderId));
    const units = [
      ...managedOrdersAsOf.map((order) => ({ effectiveOn: order.effectiveOn, key: order.id, returned: systemReturnIds.has(order.id) })),
      ...personal.flatMap((order) => Array.from({ length: order.orderCount }, (_, index) => ({ effectiveOn: order.effectiveOn, key: `${order.id}:${index}`, returned: order.status === "returned" && Boolean(order.returnedOn && order.returnedOn <= asOfDate) }))),
    ].sort((left, right) => left.effectiveOn.localeCompare(right.effectiveOn) || left.key.localeCompare(right.key));
    const unitGroups: Array<{
      effectiveOn: string;
      startIndex: number;
      units: typeof units;
    }> = [];
    for (const unit of units) {
      const current = unitGroups[unitGroups.length - 1];
      if (current?.effectiveOn === unit.effectiveOn) {
        current.units.push(unit);
      } else {
        unitGroups.push({
          effectiveOn: unit.effectiveOn,
          startIndex: unitGroups.length === 0
            ? 0
            : unitGroups[unitGroups.length - 1]!.startIndex
              + unitGroups[unitGroups.length - 1]!.units.length,
          units: [unit],
        });
      }
    }
    let tieredOrderFen = 0;
    let directReturnFen = 0;
    let milestoneFen = 0;
    const milestoneEvents: Array<{
      category: "milestone";
      eventKey: string;
      amountFen: number;
      occurredOn: string;
      templateVersionId: string;
      templateName: string;
      templateVersionNo: number;
      orderCount: number;
    }> = [];
    for (const group of unitGroups) {
      const eventRules = rulesOn(ruleAssignments, group.effectiveOn, cycleFallbackStartsOn);
      if (!eventRules.templateVersionId) continue;
      const endIndex = group.startIndex + group.units.length;
      tieredOrderFen += tieredOrderReward(endIndex, eventRules.rules)
        - tieredOrderReward(group.startIndex, eventRules.rules);
      group.units.forEach((unit, offset) => {
        if (!unit.returned) return;
        const index = group.startIndex + offset;
        directReturnFen += tieredOrderReward(index + 1, eventRules.rules)
          - tieredOrderReward(index, eventRules.rules);
      });

      const milestoneBoundaries = new Set<number>([group.startIndex + 1]);
      for (const milestone of eventRules.rules.milestones) {
        if (milestone.orderCount > group.startIndex && milestone.orderCount <= endIndex) {
          milestoneBoundaries.add(milestone.orderCount);
        }
      }
      for (const orderPosition of [...milestoneBoundaries].sort((left, right) => left - right)) {
        const nextCumulativeFen = milestoneReward(orderPosition, eventRules.rules);
        if (nextCumulativeFen <= milestoneFen) continue;
        milestoneEvents.push({
          category: "milestone",
          eventKey: `milestone:${managerId}:${eventRules.templateVersionId}:${orderPosition}:${eventRules.templateVersionId}`,
          amountFen: nextCumulativeFen - milestoneFen,
          occurredOn: group.effectiveOn,
          templateVersionId: eventRules.templateVersionId,
          templateName: eventRules.templateName!,
          templateVersionNo: eventRules.templateVersionNo!,
          orderCount: orderPosition,
        });
        milestoneFen = nextCumulativeFen;
      }
    }
    const verifiedOrderCount = managedOrdersAsOf.filter((order) => Boolean(order.reconciledAt && order.reconciledAt <= asOf)).length
      + personal.reduce((sum, row) => sum + row.orderCount, 0);
    const topUpThreshold = summaryRules.rules.topUp.orderCount;
    const topUpThresholdUnit = units[topUpThreshold - 1];
    const topUpEventRules = topUpThresholdUnit
      ? rulesOn(ruleAssignments, topUpThresholdUnit.effectiveOn, cycleFallbackStartsOn)
      : fallbackRules();
    const topUpFen = topUpEventRules.templateVersionId
      ? topUpReward(completionFen, orderCount, verifiedOrderCount >= topUpThreshold, topUpEventRules.rules)
      : 0;
    const topUpEvents = topUpFen > 0 && topUpThresholdUnit && topUpEventRules.templateVersionId
      ? [{
          category: "top_up" as const,
          eventKey: `top-up:${managerId}:${topUpEventRules.templateVersionId}`,
          amountFen: topUpFen,
          occurredOn: topUpThresholdUnit.effectiveOn,
          templateVersionId: topUpEventRules.templateVersionId!,
          templateName: topUpEventRules.templateName!,
          templateVersionNo: topUpEventRules.templateVersionNo!,
          orderCount: topUpThreshold,
        }]
      : [];
    const receiptRows = await this.client.db.select().from(regionalNetReceipts)
      .where(and(
        eq(regionalNetReceipts.regionalManagerId, managerId),
        lte(regionalNetReceipts.month, month),
      ));
    const revenueAccelerationByMonth = receiptRows
      .filter((row) => row.verificationStatus === "verified")
      .flatMap((row) => {
        const receiptMonthStartsOn = `${row.month}-01`;
        const receiptMonthEndsOn = dateOnly(monthEnd(row.month));
        if (calculationStartsOn && receiptMonthEndsOn < calculationStartsOn) return [];
        if (calculationEndsOn && receiptMonthStartsOn > calculationEndsOn) return [];
        const ruleDate = earliestDate(receiptMonthEndsOn, calculationEndsOn) ?? receiptMonthEndsOn;
        const eventRules = rulesOn(ruleAssignments, ruleDate, cycleFallbackStartsOn);
        if (!eventRules.templateVersionId) return [];
        const effectiveOrderCount = units.filter((unit) => unit.effectiveOn <= ruleDate).length;
        return [{
          month: row.month,
          amountFen: revenueAccelerationReward(
            row.netReceiptFen,
            effectiveOrderCount >= eventRules.rules.revenueAcceleration.unlockOrderCount,
            eventRules.rules,
          ),
        }];
      });
    const revenueAccelerationFen = revenueAccelerationByMonth.reduce((sum, row) => sum + row.amountFen, 0);
    const currentMonthRevenueAccelerationFen = revenueAccelerationByMonth
      .find((row) => row.month === month)?.amountFen ?? 0;
    const cooperation = await this.client.db.select().from(regionalCooperationStages)
      .where(eq(regionalCooperationStages.regionalManagerId, managerId))
      .orderBy(desc(regionalCooperationStages.achievedOn), desc(regionalCooperationStages.createdAt));
    const [currentStatement] = await this.client.db.select({
      id: regionalCommissionStatements.id,
      status: regionalCommissionStatements.status,
    }).from(regionalCommissionStatements).where(and(
      eq(regionalCommissionStatements.regionalManagerId, managerId),
      eq(regionalCommissionStatements.settlementMonth, month),
    )).limit(1);
    const allLedger = await this.client.db.select().from(regionalCommissionLedger)
      .where(eq(regionalCommissionLedger.regionalManagerId, managerId));
    const finalizedStatements = await this.client.db.select({
      id: regionalCommissionStatements.id,
      settlementMonth: regionalCommissionStatements.settlementMonth,
      status: regionalCommissionStatements.status,
      totalFen: regionalCommissionStatements.totalFen,
      calculationSnapshot: regionalCommissionStatements.calculationSnapshot,
    }).from(regionalCommissionStatements).where(and(
        eq(regionalCommissionStatements.regionalManagerId, managerId),
        inArray(regionalCommissionStatements.status, ["confirmed", "paid"]),
      ));
    const finalizedStatementsInCycle = finalizedStatements.filter((row) => {
      const snapshot = row.calculationSnapshot ?? {};
      const priorStartsOn = typeof snapshot.statisticsStartsOn === "string"
        ? snapshot.statisticsStartsOn
        : typeof snapshot.targetPlanStartsOn === "string"
          ? snapshot.targetPlanStartsOn
          : typeof snapshot.templateEffectiveFrom === "string"
            ? snapshot.templateEffectiveFrom
            : formalStartsOn;
      return priorStartsOn === calculationStartsOn;
    });
    const settledStatementIds = new Set(finalizedStatementsInCycle
      .filter((row) => row.settlementMonth <= month)
      .map((row) => row.id));
    const settlementCoveredBy = currentStatement && currentStatement.status !== "draft"
      ? null
      : finalizedStatementsInCycle
          .filter((row) => row.settlementMonth > month)
          .sort((left, right) => left.settlementMonth.localeCompare(right.settlementMonth))[0] ?? null;
    // 新版合作奖直接使用业务账本；旧数据曾把合作奖生成为 statement 账本，
    // 两者都必须纳入累计，以便历史已发金额和后续撤销能完整对上。
    const cooperationLedger = allLedger.filter((row) =>
      row.category === "cooperation" && row.occurredOn <= asOfDate);
    const cooperationFen = cooperationLedger.reduce((sum, row) => sum + row.amountFen, 0);
    const settledLedger = allLedger.filter((row) => row.statementId !== null && settledStatementIds.has(row.statementId));
    const cumulativeCategories = [
      ["completion", completionFen],
      ["tiered_order", tieredOrderFen],
      ["milestone", milestoneFen],
      ["top_up", topUpFen],
      ["personal_product", productFen],
      ["tiered_return", -directReturnFen],
    ] as const;
    const settlementEntries: Array<{
      category: string;
      accruedFen: number;
      previouslySettledFen: number;
      payableFen: number;
    }> = cumulativeCategories.map(([category, accruedFen]) => {
      const previouslySettledFen = settledLedger
        .filter((row) => row.category === category)
        .reduce((sum, row) => sum + row.amountFen, 0);
      return {
        category,
        accruedFen,
        previouslySettledFen,
        payableFen: accruedFen - previouslySettledFen,
      };
    });
    const previouslySettledCooperationFen = cooperationLedger
      .filter((row) => row.statementId !== null && settledStatementIds.has(row.statementId))
      .reduce((sum, row) => sum + row.amountFen, 0);
    const payableCooperationFen = cooperationFen - previouslySettledCooperationFen;
    settlementEntries.push({
      category: "cooperation",
      accruedFen: cooperationFen,
      previouslySettledFen: previouslySettledCooperationFen,
      payableFen: payableCooperationFen,
    });
    const settledRevenueAccelerationFen = settledLedger
      .filter((row) => row.category === "revenue_acceleration")
      .reduce((sum, row) => sum + row.amountFen, 0);
    settlementEntries.push({
      category: "revenue_acceleration",
      accruedFen: revenueAccelerationFen,
      previouslySettledFen: settledRevenueAccelerationFen,
      payableFen: revenueAccelerationFen - settledRevenueAccelerationFen,
    });
    const rawSettlementPreviewFen = settlementEntries.reduce(
      (sum, entry) => sum + entry.payableFen,
      0,
    );
    if (settlementCoveredBy) {
      settlementEntries.forEach((entry) => {
        entry.previouslySettledFen = entry.accruedFen;
        entry.payableFen = 0;
      });
    }
    const settlementPreviewFen = settlementCoveredBy ? 0 : rawSettlementPreviewFen;
    const cooperationWithConditions: Array<(typeof cooperation)[number] & { condition: { label: string; satisfied: boolean } }> = await Promise.all(cooperation.map(async (row) => ({
      ...row,
      condition: await this.cooperationPrerequisites(managerId, row.stageCode, row.achievedOn, orderCount),
    })));
    return {
      managerId, month, templateVersionId: summaryRules.templateVersionId,
      templateName: summaryRules.templateName,
      templateVersionNo: summaryRules.templateVersionNo,
      templateEffectiveFrom: summaryRules.assignmentEffectiveFrom,
      templateEffectiveTo: summaryRules.templateVersionId
        ? assignmentCalculationEndsOn(summaryRules, cycleFallbackStartsOn)
        : null,
      targetPlanId: configuredTargetCycle ? null : legacyTargetPlan?.id ?? null,
      targetPlanType: targetPlan?.planType ?? null,
      targetPlanStartsOn: targetPlan?.startsOn ?? null,
      targetPlanEndsOn: targetPlan?.endsOn ?? null,
      targetPlanStatus: configuredTargetCycle ? "active" as const : legacyTargetPlan?.status ?? null,
      statisticsStartsOn: calculationStartsOn,
      statisticsEndsOn,
      employmentStartDate: manager.employmentStartDate,
      employmentEndDate: manager.employmentEndDate,
      orderCount, managedOrderCount: managedOrdersAsOf.length, personalOrderCount: personal.reduce((sum, row) => sum + row.orderCount, 0),
      completionFen, tieredOrderFen, milestoneFen, topUpFen, revenueAccelerationFen, currentMonthRevenueAccelerationFen, personalProductFen: productFen,
      cooperationFen, directReturnFen,
      totalFen: completionFen + tieredOrderFen + milestoneFen + topUpFen + revenueAccelerationFen + productFen + cooperationFen - directReturnFen,
      settlementPreviewFen,
      settlementCoveredBy: settlementCoveredBy ? {
        id: settlementCoveredBy.id,
        settlementMonth: settlementCoveredBy.settlementMonth,
        status: settlementCoveredBy.status,
        totalFen: settlementCoveredBy.totalFen,
      } : null,
      settlementEntries,
      revenueAcceleration: {
        unlockOrderCount: resolved.rules.revenueAcceleration.unlockOrderCount,
        currentOrderCount: orderCount,
        unlocked: orderCount >= resolved.rules.revenueAcceleration.unlockOrderCount,
        ratePartsPerMillion: resolved.rules.revenueAcceleration.ratePartsPerMillion,
        monthlyCapFen: resolved.rules.revenueAcceleration.monthlyCapFen,
      },
      periods: periodStats, personalOrders: personal, receipt, cooperation: cooperationWithConditions,
    };
  }

  async listPersonalOrders(actor: AuthenticatedUser, managerId: string) {
    assertManagerAccess(actor, managerId);
    const rows = await this.client.db.select().from(regionalPersonalChannelOrders)
      .where(eq(regionalPersonalChannelOrders.regionalManagerId, managerId)).orderBy(asc(regionalPersonalChannelOrders.businessDate));
    return Promise.all(rows.map(async (order) => {
      const resolved = await this.resolveRules(managerId, order.effectiveOn);
      const lines = await this.client.db.select().from(regionalPersonalChannelOrderLines)
        .where(eq(regionalPersonalChannelOrderLines.orderId, order.id));
      return {
        ...order,
        lines: lines.map((line) => {
          const unitCommissionFen = resolved.templateVersionId
            ? resolved.rules.productCommissionFen[line.sku as RegionalProductSku]
            : 0;
          return { ...line, unitCommissionFen, subtotalFen: unitCommissionFen * line.quantity };
        }),
      };
    }));
  }

  async createPersonalOrder(actor: AuthenticatedUser, input: PersonalOrderInput) {
    requireRole(actor, "hr", "admin");
    const effectiveOn = addDays(input.signedOn, 7);
    const resolved = await this.resolveRules(input.managerId, effectiveOn);
    const lines = input.lines.map((line) => {
      const unitCommissionFen = resolved.templateVersionId
        ? resolved.rules.productCommissionFen[line.sku]
        : 0;
      return { ...line, unitCommissionFen, subtotalFen: unitCommissionFen * line.quantity };
    });
    return this.client.withTransaction(async (tx) => {
      const id = randomUUID();
      await tx.insert(regionalPersonalChannelOrders).values({ id, orderNo: input.orderNo, regionalManagerId: input.managerId, channel: input.channel, orderCount: input.orderCount, businessDate: input.businessDate, signedOn: input.signedOn, effectiveOn, evidenceNo: input.evidenceNo, note: input.note, createdBy: actor.id });
      await tx.insert(regionalPersonalChannelOrderLines).values(lines.map((line) => ({ ...line, orderId: id })));
      await this.audit(tx, actor.id, "regional_personal_order", id, "create", input.evidenceNo);
      return { id };
    });
  }

  async voidPersonalOrder(actor: AuthenticatedUser, id: string, reason: string) {
    requireRole(actor, "hr", "admin");
    await this.client.db.update(regionalPersonalChannelOrders).set({ status: "voided", voidedBy: actor.id, voidedAt: new Date(), voidReason: reason, updatedAt: new Date() }).where(eq(regionalPersonalChannelOrders.id, id));
  }

  async returnPersonalOrder(actor: AuthenticatedUser, id: string, input: { completedOn: string; reason: string; lines: readonly { lineId: string; returnedQuantity: number }[] }) {
    requireRole(actor, "hr", "admin");
    await this.client.withTransaction(async (tx) => {
      for (const line of input.lines) {
        const current = (await tx.select().from(regionalPersonalChannelOrderLines).where(and(eq(regionalPersonalChannelOrderLines.id, line.lineId), eq(regionalPersonalChannelOrderLines.orderId, id))))[0];
        if (!current || line.returnedQuantity < 0 || line.returnedQuantity > current.quantity) throw new Error("退货商品数量不合法");
        await tx.update(regionalPersonalChannelOrderLines).set({ returnedQuantity: line.returnedQuantity }).where(eq(regionalPersonalChannelOrderLines.id, line.lineId));
      }
      const all = await tx.select().from(regionalPersonalChannelOrderLines).where(eq(regionalPersonalChannelOrderLines.orderId, id));
      const fullyReturned = all.every((line) => line.returnedQuantity === line.quantity);
      await tx.update(regionalPersonalChannelOrders).set({ status: fullyReturned ? "returned" : "active", returnedOn: input.completedOn, returnReason: input.reason, updatedAt: new Date() }).where(eq(regionalPersonalChannelOrders.id, id));
      await this.audit(tx, actor.id, "regional_personal_order", id, "return", input.reason);
    });
  }

  async upsertReceipt(actor: AuthenticatedUser, input: { managerId: string; month: string; netReceiptFen: number; evidenceNo: string; note?: string; reason?: string }) {
    requireRole(actor, "hr", "finance", "admin");
    if (!Number.isSafeInteger(input.netReceiptFen)) throw new Error("净回款金额不合法");
    if (!input.evidenceNo.trim()) throw new Error("请填写凭据或文件编号");
    const reason = input.reason?.trim();
    return this.client.withTransaction(async (tx) => {
      const existing = (await tx.select().from(regionalNetReceipts).where(and(
        eq(regionalNetReceipts.regionalManagerId, input.managerId),
        eq(regionalNetReceipts.month, input.month),
      )))[0];
      if (existing) {
        if (existing.verificationStatus === "verified") throw new Error("已核验回款不能直接修改，请先退回更正");
        const next = {
          netReceiptFen: input.netReceiptFen,
          evidenceNo: input.evidenceNo.trim(),
          note: input.note?.trim() || null,
          verificationStatus: "pending" as const,
          verifiedBy: null,
          verifiedAt: null,
          verificationReason: null,
          updatedAt: new Date(),
        };
        await tx.update(regionalNetReceipts).set(next).where(eq(regionalNetReceipts.id, existing.id));
        await tx.insert(auditLogs).values({
          actorUserId: actor.id,
          entityType: "regional_net_receipt",
          entityId: existing.id,
          action: "correction",
          beforeSnapshot: receiptAuditSnapshot(existing),
          afterSnapshot: receiptAuditSnapshot({ ...existing, ...next }),
          reason: reason || "金额或凭据更正",
        });
        return existing.id;
      }
      const [row] = await tx.insert(regionalNetReceipts).values({
        regionalManagerId: input.managerId,
        month: input.month,
        netReceiptFen: input.netReceiptFen,
        evidenceNo: input.evidenceNo.trim(),
        note: input.note?.trim() || null,
        enteredBy: actor.id,
      }).returning({ id: regionalNetReceipts.id });
      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        entityType: "regional_net_receipt",
        entityId: row!.id,
        action: "create",
        beforeSnapshot: null,
        afterSnapshot: receiptAuditSnapshot({
          netReceiptFen: input.netReceiptFen,
          evidenceNo: input.evidenceNo.trim(),
          note: input.note?.trim() || null,
        }),
        reason: reason || "首次录入净回款",
      });
      return row!.id;
    });
  }

  async verifyReceipt(actor: AuthenticatedUser, id: string, approved: boolean, reason?: string) {
    requireRole(actor, "finance", "admin");
    return this.client.withTransaction(async (tx) => {
      const current = (await tx.select().from(regionalNetReceipts).where(eq(regionalNetReceipts.id, id)))[0];
      if (!current) throw new Error("净回款记录不存在");
      if (approved && current.verificationStatus !== "pending") throw new Error("只有待核验回款可以核验通过");
      if (!approved && current.verificationStatus !== "pending" && current.verificationStatus !== "verified") throw new Error("该回款记录当前不能退回");
      if (!approved && !reason?.trim()) throw new Error("退回更正必须填写原因");
      const next = {
        verificationStatus: approved ? "verified" as const : "rejected" as const,
        verifiedBy: actor.id,
        verifiedAt: new Date(),
        verificationReason: reason?.trim() || null,
        updatedAt: new Date(),
      };
      await tx.update(regionalNetReceipts).set(next).where(eq(regionalNetReceipts.id, id));
      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        entityType: "regional_net_receipt",
        entityId: id,
        action: approved ? "verify" : "reject",
        beforeSnapshot: receiptAuditSnapshot(current),
        afterSnapshot: receiptAuditSnapshot({ ...current, ...next }),
        reason: reason?.trim() || "财务核验通过",
      });
    });
  }

  async listCooperation(actor: AuthenticatedUser, managerId: string) {
    assertManagerAccess(actor, managerId);
    return this.client.db.select().from(regionalCooperationStages)
      .where(eq(regionalCooperationStages.regionalManagerId, managerId))
      .orderBy(desc(regionalCooperationStages.achievedOn), desc(regionalCooperationStages.createdAt));
  }

  private async cooperationPrerequisites(managerId: string, stageCode: string, achievedOn: string, knownOrderCount?: number): Promise<{ label: string; satisfied: boolean }> {
    if (stageCode === "PROJECT") return { label: "省级项目完成立项", satisfied: true };
    if (stageCode === "CONTRACT") return { label: "完成商务签约和系统准入", satisfied: true };
    const achievedAt = new Date(`${achievedOn}T23:59:59.999Z`);
    const histories = await this.client.db.select().from(regionalManagerStoreHistory)
      .where(eq(regionalManagerStoreHistory.regionalManagerId, managerId));
    const activeStoreCount = new Set(histories
      .filter((row) => row.effectiveFrom <= achievedAt && (!row.effectiveTo || row.effectiveTo > achievedAt))
      .map((row) => row.storeId)).size;
    const verifiedReceipts = await this.client.db.select().from(regionalNetReceipts)
      .where(and(
        eq(regionalNetReceipts.regionalManagerId, managerId),
        eq(regionalNetReceipts.verificationStatus, "verified"),
        lte(regionalNetReceipts.month, achievedOn.slice(0, 7)),
      ));
    const hasVerifiedReceipt = verifiedReceipts.some((row) => row.netReceiptFen > 0);
    if (stageCode === "PILOT") {
      return {
        label: `25 家营业厅上线并产生首笔回款（当前 ${activeStoreCount} 家，${hasVerifiedReceipt ? "已有" : "尚无"}已核验正回款）`,
        satisfied: activeStoreCount >= 25 && hasVerifiedReceipt,
      };
    }
    if (stageCode === "SCALE") {
      const orderCount: number = knownOrderCount ?? (await this.summary(
        { id: managerId, displayName: "大区经理", role: "regional_manager", storeId: null, mustChangePassword: false },
        managerId,
        achievedOn.slice(0, 7),
      )).orderCount;
      return {
        label: `累计达到 1,000 笔并核验回款（当前 ${orderCount} 笔，${hasVerifiedReceipt ? "已有" : "尚无"}已核验正回款）`,
        satisfied: orderCount >= 1_000 && hasVerifiedReceipt,
      };
    }
    return { label: "未识别的阶段条件", satisfied: false };
  }

  async submitCooperation(actor: AuthenticatedUser, input: { managerId: string; stageCode: string; achievedOn: string; evidenceNo: string; note?: string }) {
    requireRole(actor, "hr", "admin");
    const resolved = await this.resolveRules(input.managerId, input.achievedOn);
    if (!resolved.templateVersionId) throw new Error("达成日期不在已分配模板的计算范围内");
    const rule = resolved.rules.cooperationStages.find((stage) => stage.code === input.stageCode);
    if (!rule) throw new Error("合作奖阶段不存在");
    const [row] = await this.client.db.insert(regionalCooperationStages).values({ regionalManagerId: input.managerId, stageCode: input.stageCode, stageLabel: rule.label, amountFen: rule.amountFen, achievedOn: input.achievedOn, evidenceNo: input.evidenceNo, note: input.note, submittedBy: actor.id }).returning();
    return row!;
  }

  async transitionCooperation(actor: AuthenticatedUser, id: string, action: "verify" | "confirm" | "revoke", reason?: string) {
    const now = new Date();
    if (action === "verify") {
      requireRole(actor, "finance", "admin");
      const [row] = await this.client.db.update(regionalCooperationStages).set({ status: "finance_verified", financeVerifiedBy: actor.id, financeVerifiedAt: now, updatedAt: now }).where(and(eq(regionalCooperationStages.id, id), eq(regionalCooperationStages.status, "submitted"))).returning({ id: regionalCooperationStages.id });
      if (!row) throw new Error("只有已提交的合作奖资料可以核验");
    } else if (action === "confirm") {
      requireRole(actor, "admin");
      const stage = (await this.client.db.select().from(regionalCooperationStages).where(eq(regionalCooperationStages.id, id)))[0];
      if (!stage) throw new Error("合作奖阶段不存在");
      const needsFinance = stage.stageCode === "PILOT" || stage.stageCode === "SCALE";
      if ((needsFinance && stage.status !== "finance_verified") || (!needsFinance && stage.status !== "submitted" && stage.status !== "finance_verified")) throw new Error("合作奖尚未完成所需核验");
      const resolved = await this.resolveRules(stage.regionalManagerId, stage.achievedOn);
      if (!resolved.templateVersionId) throw new Error("达成日期不在已分配模板的计算范围内，不能确认奖励");
      const prerequisites = await this.cooperationPrerequisites(stage.regionalManagerId, stage.stageCode, stage.achievedOn);
      if (!prerequisites.satisfied) throw new Error(`合作阶段条件尚未满足：${prerequisites.label}`);
      await this.client.withTransaction(async (tx) => {
        const duplicate = (await tx.select({ id: regionalCooperationStages.id }).from(regionalCooperationStages).where(and(
          eq(regionalCooperationStages.regionalManagerId, stage.regionalManagerId),
          eq(regionalCooperationStages.stageCode, stage.stageCode),
          eq(regionalCooperationStages.status, "confirmed"),
        )).limit(1))[0];
        if (duplicate && duplicate.id !== stage.id) throw new Error("该合作阶段已经确认并计发，不能重复确认");
        const [row] = await tx.update(regionalCooperationStages).set({ status: "confirmed", confirmedBy: actor.id, confirmedAt: now, updatedAt: now }).where(eq(regionalCooperationStages.id, id)).returning({ id: regionalCooperationStages.id });
        if (!row) throw new Error("合作奖阶段不存在");
        await tx.insert(regionalCommissionLedger).values({
          regionalManagerId: stage.regionalManagerId,
          statementId: null,
          eventKey: `cooperation:${stage.id}`,
          category: "cooperation",
          sourceType: "cooperation",
          sourceId: stage.id,
          amountFen: stage.amountFen,
          occurredOn: stage.achievedOn,
          settlementMonth: stage.achievedOn.slice(0, 7),
          detailSnapshot: {
            stageCode: stage.stageCode,
            stageLabel: stage.stageLabel,
            evidenceNo: stage.evidenceNo,
            achievedOn: stage.achievedOn,
            amountFen: stage.amountFen,
          },
          createdBy: actor.id,
        });
        await this.audit(tx, actor.id, "regional_cooperation_stage", id, "confirm", "确认并生成待发账本");
      });
    } else {
      requireRole(actor, "admin");
      if (!reason?.trim()) throw new Error("撤销合作奖必须填写原因");
      await this.client.withTransaction(async (tx) => {
        const current = (await tx.select().from(regionalCooperationStages).where(eq(regionalCooperationStages.id, id)))[0];
        if (!current || !["submitted", "finance_verified", "confirmed"].includes(current.status)) throw new Error("该合作奖不存在或已撤销");
        if (current.status === "confirmed") {
          const originalLedger = (await tx.select().from(regionalCommissionLedger).where(
            eq(regionalCommissionLedger.eventKey, `cooperation:${current.id}`),
          ))[0];
          const reversalOn = originalLedger?.paidAt ? dateOnly(now) : current.achievedOn;
          await tx.insert(regionalCommissionLedger).values({
            regionalManagerId: current.regionalManagerId,
            statementId: null,
            eventKey: `cooperation-revocation:${current.id}`,
            category: "cooperation",
            sourceType: "cooperation",
            sourceId: current.id,
            amountFen: -current.amountFen,
            occurredOn: reversalOn,
            settlementMonth: reversalOn.slice(0, 7),
            detailSnapshot: {
              stageCode: current.stageCode,
              stageLabel: current.stageLabel,
              revokeReason: reason.trim(),
              revokedAt: dateOnly(now),
              reversalMode: originalLedger?.paidAt ? "next_payroll_deduction" : "cancel_unpaid",
            },
            createdBy: actor.id,
          });
        }
        await tx.update(regionalCooperationStages).set({ status: "revoked", revokedBy: actor.id, revokedAt: now, revokeReason: reason.trim(), updatedAt: now }).where(eq(regionalCooperationStages.id, id));
        await this.audit(tx, actor.id, "regional_cooperation_stage", id, "revoke", reason.trim());
      });
    }
  }

  async calculateStatement(actor: AuthenticatedUser, managerId: string, month: string) {
    requireRole(actor, "hr", "admin");
    const summary = await this.summary(actor, managerId, month);
    if (!summary.templateVersionId) throw new Error("请先为大区经理分配已发布的提成模板");
    if (summary.settlementCoveredBy) {
      throw new Error(`${month} 已包含在 ${summary.settlementCoveredBy.settlementMonth} ${summary.settlementCoveredBy.status === "paid" ? "已发放" : "已确认"}的累计结算中，不能重复生成结算单`);
    }
    const existing = (await this.client.db.select().from(regionalCommissionStatements).where(and(eq(regionalCommissionStatements.regionalManagerId, managerId), eq(regionalCommissionStatements.settlementMonth, month))))[0];
    if (existing && existing.status !== "draft") throw new Error("已确认的提成单不能重算");
    const entries = summary.settlementEntries
      .map((entry) => ({ category: entry.category, amountFen: entry.payableFen }))
      .filter((entry) => entry.amountFen !== 0);
    const generatedEntries = entries.filter((entry) => entry.category !== "cooperation");
    return this.client.withTransaction(async (tx) => {
      if (existing) {
        await tx.update(regionalCommissionLedger).set({ statementId: null }).where(and(
          eq(regionalCommissionLedger.statementId, existing.id),
          eq(regionalCommissionLedger.sourceType, "cooperation"),
        ));
        await tx.delete(regionalCommissionLedger).where(eq(regionalCommissionLedger.statementId, existing.id));
        await tx.delete(regionalCommissionStatements).where(eq(regionalCommissionStatements.id, existing.id));
      }
      const [statement] = await tx.insert(regionalCommissionStatements).values({ regionalManagerId: managerId, settlementMonth: month, templateVersionId: summary.templateVersionId!, targetPlanId: summary.targetPlanId, totalFen: entries.reduce((sum, entry) => sum + entry.amountFen, 0), calculationSnapshot: summary as unknown as Record<string, unknown>, calculatedBy: actor.id }).returning();
      if (generatedEntries.length) await tx.insert(regionalCommissionLedger).values(generatedEntries.map((entry) => ({ regionalManagerId: managerId, statementId: statement!.id, eventKey: `statement:${managerId}:${month}:${entry.category}`, category: entry.category, sourceType: "statement", sourceId: statement!.id, amountFen: entry.amountFen, occurredOn: dateOnly(monthEnd(month)), settlementMonth: month, detailSnapshot: summary as unknown as Record<string, unknown>, createdBy: actor.id })));
      await tx.update(regionalCommissionLedger).set({ statementId: statement!.id }).where(and(
        eq(regionalCommissionLedger.regionalManagerId, managerId),
        eq(regionalCommissionLedger.sourceType, "cooperation"),
        isNull(regionalCommissionLedger.statementId),
        isNull(regionalCommissionLedger.paidAt),
        lte(regionalCommissionLedger.occurredOn, dateOnly(monthEnd(month))),
      ));
      return statement!;
    });
  }

  async transitionStatement(actor: AuthenticatedUser, id: string, action: "confirm" | "pay") {
    const now = new Date();
    if (action === "confirm") {
      requireRole(actor, "admin");
      const current = (await this.client.db.select().from(regionalCommissionStatements).where(and(
        eq(regionalCommissionStatements.id, id),
        eq(regionalCommissionStatements.status, "draft"),
      )))[0];
      if (!current) throw new Error("只有草稿提成单可以确认");
      const latest = await this.summary(actor, current.regionalManagerId, current.settlementMonth);
      if (latest.settlementCoveredBy) {
        throw new Error(`${current.settlementMonth} 已包含在 ${latest.settlementCoveredBy.settlementMonth} ${latest.settlementCoveredBy.status === "paid" ? "已发放" : "已确认"}的累计结算中，不能再确认`);
      }
      if (latest.settlementPreviewFen !== current.totalFen) {
        throw new Error("草稿金额已与当前数据不一致，请先更新草稿再确认");
      }
      const [row] = await this.client.db.update(regionalCommissionStatements).set({ status: "confirmed", confirmedBy: actor.id, confirmedAt: now, updatedAt: now }).where(and(eq(regionalCommissionStatements.id, id), eq(regionalCommissionStatements.status, "draft"))).returning();
      if (!row) throw new Error("只有草稿提成单可以确认");
      return row;
    } else {
      requireRole(actor, "finance", "admin");
      return this.client.withTransaction(async (tx) => {
        const [row] = await tx.update(regionalCommissionStatements).set({ status: "paid", paidBy: actor.id, paidAt: now, updatedAt: now }).where(and(eq(regionalCommissionStatements.id, id), eq(regionalCommissionStatements.status, "confirmed"))).returning();
        if (!row) throw new Error("只有已确认提成单可以标记发放");
        const ledgerRows = await tx.select().from(regionalCommissionLedger).where(eq(regionalCommissionLedger.statementId, id));
        await tx.insert(settlementBatches).values({
          batchNo: `REG-${row.settlementMonth.replace("-", "")}-${id.slice(0, 8).toUpperCase()}`,
          idempotencyKey: `regional-statement:${id}`,
          status: "paid",
          periodStart: new Date(`${row.settlementMonth}-01T00:00:00+08:00`),
          periodEnd: new Date(`${dateOnly(monthEnd(row.settlementMonth))}T23:59:59+08:00`),
          beneficiaryId: row.regionalManagerId,
          totalFen: row.totalFen,
          entryCount: ledgerRows.length,
          filtersSnapshot: { scope: "regional_commission", statementId: id, settlementMonth: row.settlementMonth },
          createdBy: actor.id,
          approvedBy: row.confirmedBy ?? actor.id,
          approvedAt: row.confirmedAt ?? now,
          paidBy: actor.id,
          paidAt: now,
        });
        await tx.update(regionalCommissionLedger).set({ paidAt: now }).where(eq(regionalCommissionLedger.statementId, id));
        return row;
      });
    }
  }

  async listStatements(actor: AuthenticatedUser, managerId: string) {
    assertManagerAccess(actor, managerId);
    return this.client.db.select().from(regionalCommissionStatements).where(eq(regionalCommissionStatements.regionalManagerId, managerId)).orderBy(asc(regionalCommissionStatements.settlementMonth));
  }

  private async audit(tx: DbTransaction, actorId: string, entityType: string, entityId: string, action: string, reason: string) {
    await tx.insert(auditLogs).values({ actorUserId: actorId, entityType, entityId, action, reason });
  }
}
