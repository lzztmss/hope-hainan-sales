import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";

import {
  completionReward,
  milestoneReward,
  revenueAccelerationReward,
  tieredOrderReward,
  topUpReward,
} from "../../shared/regionalCommission/calculator.js";
import {
  DEFAULT_REGIONAL_COMMISSION_RULES,
  type RegionalCommissionRules,
  type RegionalProductSku,
} from "../../shared/regionalCommission/types.js";
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
  users,
} from "../db/schema.js";

const DAY_MS = 86_400_000;
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: string, days: number) =>
  dateOnly(new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS));
const addMonths = (value: string, months: number) => {
  const [year, month, day] = value.split("-").map(Number);
  const target = (year! * 12) + month! - 1 + months;
  const targetYear = Math.floor(target / 12);
  const targetMonth = target % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return dateOnly(new Date(Date.UTC(targetYear, targetMonth, Math.min(day!, lastDay))));
};
const monthEnd = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, value!, 1) - 1);
};
const assertManagerAccess = (actor: AuthenticatedUser, managerId: string) => {
  if (["admin", "hr", "finance"].includes(actor.role)) return;
  if (actor.role !== "regional_manager" || actor.id !== managerId) throw new AuthorizationError();
};
const asRules = (value: Record<string, unknown>): RegionalCommissionRules =>
  value as unknown as RegionalCommissionRules;

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

  async listTemplates(actor: AuthenticatedUser) {
    requireRole(actor, "admin");
    return this.client.db.select().from(regionalCommissionTemplateVersions)
      .orderBy(asc(regionalCommissionTemplateVersions.templateCode), asc(regionalCommissionTemplateVersions.versionNo));
  }

  async createTemplate(actor: AuthenticatedUser, input: { name: string; effectiveFrom: string; reason: string; rules?: RegionalCommissionRules }) {
    requireRole(actor, "admin");
    const [row] = await this.client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: `REGIONAL-${Date.now()}`,
      versionNo: 1,
      name: input.name,
      effectiveFrom: input.effectiveFrom,
      rulesSnapshot: (input.rules ?? DEFAULT_REGIONAL_COMMISSION_RULES) as unknown as Record<string, unknown>,
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
    const [row] = await this.client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: source.templateCode,
      versionNo: (latest?.versionNo ?? source.versionNo) + 1,
      name: input.name ?? source.name,
      effectiveFrom: input.effectiveFrom,
      sourceVersionId: source.id,
      rulesSnapshot: source.rulesSnapshot,
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
      await tx.update(regionalCommissionTemplateVersions).set({ effectiveTo: addDays(draft.effectiveFrom, -1), updatedAt: new Date() }).where(and(eq(regionalCommissionTemplateVersions.templateCode, draft.templateCode), eq(regionalCommissionTemplateVersions.status, "published"), isNull(regionalCommissionTemplateVersions.effectiveTo)));
      const [row] = await tx.update(regionalCommissionTemplateVersions).set({ status: "published", publishedBy: actor.id, publishedAt: new Date(), changeReason: reason, version: draft.version + 1, updatedAt: new Date() }).where(eq(regionalCommissionTemplateVersions.id, id)).returning();
      return row!;
    });
  }

  async updateTemplate(actor: AuthenticatedUser, id: string, rules: RegionalCommissionRules, reason: string) {
    requireRole(actor, "admin");
    const [row] = await this.client.db.update(regionalCommissionTemplateVersions).set({ rulesSnapshot: rules as unknown as Record<string, unknown>, changeReason: reason, updatedAt: new Date() }).where(and(eq(regionalCommissionTemplateVersions.id, id), eq(regionalCommissionTemplateVersions.status, "draft"))).returning();
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
    const template = (await this.client.db.select().from(regionalCommissionTemplateVersions).where(eq(regionalCommissionTemplateVersions.id, input.templateVersionId)))[0];
    if (!template || template.status !== "published") throw new Error("只能分配已发布模板");
    await this.client.withTransaction(async (tx) => {
      await tx.update(regionalCommissionTemplateAssignments).set({ effectiveTo: addDays(input.effectiveFrom, -1), updatedAt: new Date() })
        .where(and(eq(regionalCommissionTemplateAssignments.regionalManagerId, input.managerId), isNull(regionalCommissionTemplateAssignments.effectiveTo), lte(regionalCommissionTemplateAssignments.effectiveFrom, input.effectiveFrom)));
      await tx.insert(regionalCommissionTemplateAssignments).values({ regionalManagerId: input.managerId, templateVersionId: input.templateVersionId, effectiveFrom: input.effectiveFrom, reason: input.reason, assignedBy: actor.id });
    });
  }

  async createTargetPlan(actor: AuthenticatedUser, input: { managerId: string; planType: "quarter" | "half_year" | "year"; startsOn: string; targets: readonly number[]; reason: string }) {
    requireRole(actor, "hr", "admin");
    const expected = input.planType === "quarter" ? 3 : input.planType === "half_year" ? 6 : 12;
    if (input.targets.length !== expected || input.targets.some((target) => !Number.isInteger(target) || target <= 0)) throw new Error("目标数量与计划类型不匹配");
    const endsOn = addDays(addMonths(input.startsOn, expected), -1);
    const existing = await this.client.db.select().from(regionalCommissionTargetPlans).where(eq(regionalCommissionTargetPlans.regionalManagerId, input.managerId));
    if (existing.some((plan) => input.startsOn <= plan.endsOn && endsOn >= plan.startsOn)) throw new Error("目标计划日期不能与已有计划重叠");
    return this.client.withTransaction(async (tx) => {
      const [plan] = await tx.insert(regionalCommissionTargetPlans).values({ regionalManagerId: input.managerId, planType: input.planType, periodCount: expected, startsOn: input.startsOn, endsOn, status: "active", setBy: actor.id, changeReason: input.reason }).returning();
      let cumulative = 0;
      await tx.insert(regionalCommissionTargetPeriods).values(input.targets.map((target, index) => { cumulative += target; return { planId: plan!.id, sequence: index + 1, startsOn: addMonths(input.startsOn, index), endsOn: addDays(addMonths(input.startsOn, index + 1), -1), targetOrderCount: target, cumulativeTargetOrderCount: cumulative }; }));
      return plan!;
    });
  }

  async updateTargetPlan(actor: AuthenticatedUser, planId: string, input: { managerId: string; planType: "quarter" | "half_year" | "year"; startsOn: string; targets: readonly number[]; reason: string }) {
    requireRole(actor, "hr", "admin");
    const expected = input.planType === "quarter" ? 3 : input.planType === "half_year" ? 6 : 12;
    if (input.targets.length !== expected || input.targets.some((target) => !Number.isInteger(target) || target <= 0)) throw new Error("目标数量与计划类型不匹配");
    const endsOn = addDays(addMonths(input.startsOn, expected), -1);
    const existing = await this.client.db.select().from(regionalCommissionTargetPlans).where(eq(regionalCommissionTargetPlans.regionalManagerId, input.managerId));
    if (!existing.some((plan) => plan.id === planId)) throw new Error("目标计划不存在");
    if (existing.some((plan) => plan.id !== planId && input.startsOn <= plan.endsOn && endsOn >= plan.startsOn)) throw new Error("目标计划日期不能与已有计划重叠");
    return this.client.withTransaction(async (tx) => {
      const [plan] = await tx.update(regionalCommissionTargetPlans).set({ planType: input.planType, periodCount: expected, startsOn: input.startsOn, endsOn, setBy: actor.id, changeReason: input.reason, updatedAt: new Date() }).where(eq(regionalCommissionTargetPlans.id, planId)).returning();
      await tx.delete(regionalCommissionTargetPeriods).where(eq(regionalCommissionTargetPeriods.planId, planId));
      let cumulative = 0;
      await tx.insert(regionalCommissionTargetPeriods).values(input.targets.map((target, index) => { cumulative += target; return { planId, sequence: index + 1, startsOn: addMonths(input.startsOn, index), endsOn: addDays(addMonths(input.startsOn, index + 1), -1), targetOrderCount: target, cumulativeTargetOrderCount: cumulative }; }));
      return plan!;
    });
  }

  private async resolveRules(managerId: string, onDate: string) {
    const [assignment] = await this.client.db.select({
      assignmentId: regionalCommissionTemplateAssignments.id,
      templateVersionId: regionalCommissionTemplateVersions.id,
      rules: regionalCommissionTemplateVersions.rulesSnapshot,
    }).from(regionalCommissionTemplateAssignments)
      .innerJoin(regionalCommissionTemplateVersions, eq(regionalCommissionTemplateVersions.id, regionalCommissionTemplateAssignments.templateVersionId))
      .where(and(
        eq(regionalCommissionTemplateAssignments.regionalManagerId, managerId),
        lte(regionalCommissionTemplateAssignments.effectiveFrom, onDate),
        or(isNull(regionalCommissionTemplateAssignments.effectiveTo), gte(regionalCommissionTemplateAssignments.effectiveTo, onDate)),
      )).orderBy(desc(regionalCommissionTemplateAssignments.effectiveFrom)).limit(1);
    return assignment ? { ...assignment, rules: asRules(assignment.rules) } : { assignmentId: null, templateVersionId: null, rules: DEFAULT_REGIONAL_COMMISSION_RULES };
  }

  async summary(actor: AuthenticatedUser, managerId: string, month = new Date().toISOString().slice(0, 7)) {
    assertManagerAccess(actor, managerId);
    const asOf = monthEnd(month);
    const asOfDate = dateOnly(asOf);
    const manager = (await this.client.db.select({ employmentStartDate: users.employmentStartDate, employmentEndDate: users.employmentEndDate }).from(users).where(and(eq(users.id, managerId), eq(users.role, "regional_manager"))))[0];
    if (!manager) throw new Error("大区经理不存在");
    const history = await this.client.db.select().from(regionalManagerStoreHistory)
      .where(eq(regionalManagerStoreHistory.regionalManagerId, managerId));
    const storeIds = [...new Set(history.map((row) => row.storeId))];
    const candidateOrders = storeIds.length === 0 ? [] : await this.client.db.select({
      id: orders.id, orderNo: orders.orderNo, storeId: orders.storeId, signedAt: orders.signedAt, status: orders.status, reconciledAt: orders.reconciledAt, cancelledAt: orders.cancelledAt, deletedAt: orders.deletedAt,
    }).from(orders).where(and(inArray(orders.storeId, storeIds), lte(orders.signedAt, new Date(asOf.getTime() - 7 * DAY_MS))));
    const managedOrders = candidateOrders.flatMap((order) => {
      if (!order.signedAt) return [];
      const effectiveAt = new Date(order.signedAt.getTime() + 7 * DAY_MS);
      if ((order.cancelledAt && order.cancelledAt < effectiveAt) || (order.deletedAt && order.deletedAt < effectiveAt)) return [];
      if (manager.employmentStartDate && dateOnly(effectiveAt) < manager.employmentStartDate) return [];
      if (manager.employmentEndDate && dateOnly(effectiveAt) > manager.employmentEndDate) return [];
      const assigned = history.some((row) => row.storeId === order.storeId && row.effectiveFrom <= effectiveAt && (!row.effectiveTo || row.effectiveTo > effectiveAt));
      return assigned ? [{ ...order, effectiveOn: dateOnly(effectiveAt) }] : [];
    });
    const personal = await this.client.db.select().from(regionalPersonalChannelOrders).where(and(
      eq(regionalPersonalChannelOrders.regionalManagerId, managerId),
      inArray(regionalPersonalChannelOrders.status, ["active", "returned"]),
      lte(regionalPersonalChannelOrders.effectiveOn, asOfDate),
    ));
    const orderCount = managedOrders.length + personal.reduce((sum, row) => sum + row.orderCount, 0);
    const plan = (await this.client.db.select().from(regionalCommissionTargetPlans)
      .where(and(eq(regionalCommissionTargetPlans.regionalManagerId, managerId), lte(regionalCommissionTargetPlans.startsOn, asOfDate)))
      .orderBy(asc(regionalCommissionTargetPlans.startsOn)).limit(1))[0];
    const periods = plan ? await this.client.db.select().from(regionalCommissionTargetPeriods)
      .where(eq(regionalCommissionTargetPeriods.planId, plan.id)).orderBy(asc(regionalCommissionTargetPeriods.sequence)) : [];
    const resolved = await this.resolveRules(managerId, asOfDate);
    const periodStats = periods.map((period) => {
      const managedCount = managedOrders.filter((order) => order.effectiveOn >= period.startsOn && order.effectiveOn <= period.endsOn).length;
      const personalCount = personal.filter((order) => order.effectiveOn >= period.startsOn && order.effectiveOn <= period.endsOn).reduce((sum, order) => sum + order.orderCount, 0);
      const currentCount = managedCount + personalCount;
      return { ...period, orderCount: currentCount, rewardFen: period.endsOn <= asOfDate ? completionReward(currentCount, period.targetOrderCount, resolved.rules) : 0 };
    });
    const receipt = (await this.client.db.select().from(regionalNetReceipts).where(and(
      eq(regionalNetReceipts.regionalManagerId, managerId), eq(regionalNetReceipts.month, month),
    )))[0] ?? null;
    const productLines = personal.length ? await this.client.db.select().from(regionalPersonalChannelOrderLines)
      .where(inArray(regionalPersonalChannelOrderLines.orderId, personal.map((row) => row.id))) : [];
    const productFen = productLines.reduce((sum, row) => sum + (row.quantity - row.returnedQuantity) * row.unitCommissionFen, 0);
    const completionFen = periodStats.reduce((sum, row) => sum + row.rewardFen, 0);
    const tieredOrderFen = tieredOrderReward(orderCount, resolved.rules);
    const fullReturns = managedOrders.length ? await this.client.db.select({ orderId: orderReturns.orderId, completedAt: orderReturns.completedAt })
      .from(orderReturns).where(and(inArray(orderReturns.orderId, managedOrders.map((order) => order.id)), eq(orderReturns.returnType, "full"), eq(orderReturns.status, "completed"), lte(orderReturns.completedAt, asOf))) : [];
    const systemReturnIds = new Set(fullReturns.map((row) => row.orderId));
    const units = [
      ...managedOrders.map((order) => ({ effectiveOn: order.effectiveOn, key: order.id, returned: systemReturnIds.has(order.id) })),
      ...personal.flatMap((order) => Array.from({ length: order.orderCount }, (_, index) => ({ effectiveOn: order.effectiveOn, key: `${order.id}:${index}`, returned: order.status === "returned" && Boolean(order.returnedOn && order.returnedOn <= asOfDate) }))),
    ].sort((left, right) => left.effectiveOn.localeCompare(right.effectiveOn) || left.key.localeCompare(right.key));
    const directReturnFen = units.reduce((sum, unit, index) => unit.returned ? sum + tieredOrderReward(index + 1, resolved.rules) - tieredOrderReward(index, resolved.rules) : sum, 0);
    const milestoneFen = milestoneReward(orderCount, resolved.rules);
    const verifiedOrderCount = managedOrders.filter((order) => Boolean(order.reconciledAt)).length + personal.reduce((sum, row) => sum + row.orderCount, 0);
    const topUpFen = topUpReward(completionFen, orderCount, verifiedOrderCount >= resolved.rules.topUp.orderCount, resolved.rules);
    const revenueAccelerationFen = receipt?.verificationStatus === "verified"
      ? revenueAccelerationReward(receipt.netReceiptFen, orderCount >= resolved.rules.revenueAcceleration.unlockOrderCount, resolved.rules)
      : 0;
    const cooperation = await this.client.db.select().from(regionalCooperationStages)
      .where(eq(regionalCooperationStages.regionalManagerId, managerId));
    const cooperationFen = cooperation.filter((row) => row.status === "confirmed").reduce((sum, row) => sum + row.amountFen, 0);
    return {
      managerId, month, templateVersionId: resolved.templateVersionId, planId: plan?.id ?? null,
      orderCount, managedOrderCount: managedOrders.length, personalOrderCount: personal.reduce((sum, row) => sum + row.orderCount, 0),
      completionFen, tieredOrderFen, milestoneFen, topUpFen, revenueAccelerationFen, personalProductFen: productFen,
      cooperationFen, directReturnFen,
      totalFen: completionFen + tieredOrderFen + milestoneFen + topUpFen + revenueAccelerationFen + productFen + cooperationFen - directReturnFen,
      periods: periodStats, personalOrders: personal, receipt, cooperation,
    };
  }

  async listPersonalOrders(actor: AuthenticatedUser, managerId: string) {
    assertManagerAccess(actor, managerId);
    const rows = await this.client.db.select().from(regionalPersonalChannelOrders)
      .where(eq(regionalPersonalChannelOrders.regionalManagerId, managerId)).orderBy(asc(regionalPersonalChannelOrders.businessDate));
    return Promise.all(rows.map(async (order) => ({ ...order, lines: await this.client.db.select().from(regionalPersonalChannelOrderLines).where(eq(regionalPersonalChannelOrderLines.orderId, order.id)) })));
  }

  async createPersonalOrder(actor: AuthenticatedUser, input: PersonalOrderInput) {
    requireRole(actor, "hr", "admin");
    const effectiveOn = addDays(input.signedOn, 7);
    const resolved = await this.resolveRules(input.managerId, effectiveOn);
    if (!resolved.templateVersionId) throw new Error("请先为大区经理分配已发布的提成模板");
    const lines = input.lines.map((line) => ({ ...line, unitCommissionFen: resolved.rules.productCommissionFen[line.sku], subtotalFen: resolved.rules.productCommissionFen[line.sku] * line.quantity }));
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

  async upsertReceipt(actor: AuthenticatedUser, input: { managerId: string; month: string; netReceiptFen: number; evidenceNo: string; note?: string }) {
    requireRole(actor, "hr", "finance", "admin");
    const existing = (await this.client.db.select({ id: regionalNetReceipts.id }).from(regionalNetReceipts).where(and(eq(regionalNetReceipts.regionalManagerId, input.managerId), eq(regionalNetReceipts.month, input.month))))[0];
    if (existing) {
      await this.client.db.update(regionalNetReceipts).set({ netReceiptFen: input.netReceiptFen, evidenceNo: input.evidenceNo, note: input.note, verificationStatus: "pending", verifiedBy: null, verifiedAt: null, updatedAt: new Date() }).where(eq(regionalNetReceipts.id, existing.id));
      return existing.id;
    }
    const [row] = await this.client.db.insert(regionalNetReceipts).values({ regionalManagerId: input.managerId, month: input.month, netReceiptFen: input.netReceiptFen, evidenceNo: input.evidenceNo, note: input.note, enteredBy: actor.id }).returning({ id: regionalNetReceipts.id });
    return row!.id;
  }

  async verifyReceipt(actor: AuthenticatedUser, id: string, approved: boolean, reason?: string) {
    requireRole(actor, "finance", "admin");
    await this.client.db.update(regionalNetReceipts).set({ verificationStatus: approved ? "verified" : "rejected", verifiedBy: actor.id, verifiedAt: new Date(), verificationReason: reason, updatedAt: new Date() }).where(eq(regionalNetReceipts.id, id));
  }

  async listCooperation(actor: AuthenticatedUser, managerId: string) {
    assertManagerAccess(actor, managerId);
    return this.client.db.select().from(regionalCooperationStages).where(eq(regionalCooperationStages.regionalManagerId, managerId));
  }

  async submitCooperation(actor: AuthenticatedUser, input: { managerId: string; stageCode: string; achievedOn: string; evidenceNo: string; note?: string }) {
    requireRole(actor, "hr", "admin");
    const resolved = await this.resolveRules(input.managerId, input.achievedOn);
    if (!resolved.templateVersionId) throw new Error("请先为大区经理分配已发布的提成模板");
    const rule = resolved.rules.cooperationStages.find((stage) => stage.code === input.stageCode);
    if (!rule) throw new Error("合作奖阶段不存在");
    const [row] = await this.client.db.insert(regionalCooperationStages).values({ regionalManagerId: input.managerId, stageCode: input.stageCode, stageLabel: rule.label, amountFen: rule.amountFen, achievedOn: input.achievedOn, evidenceNo: input.evidenceNo, note: input.note, submittedBy: actor.id }).returning();
    return row!;
  }

  async transitionCooperation(actor: AuthenticatedUser, id: string, action: "verify" | "confirm" | "revoke", reason?: string) {
    const now = new Date();
    if (action === "verify") {
      requireRole(actor, "finance", "admin");
      await this.client.db.update(regionalCooperationStages).set({ status: "finance_verified", financeVerifiedBy: actor.id, financeVerifiedAt: now, updatedAt: now }).where(and(eq(regionalCooperationStages.id, id), eq(regionalCooperationStages.status, "submitted")));
    } else if (action === "confirm") {
      requireRole(actor, "admin");
      const stage = (await this.client.db.select().from(regionalCooperationStages).where(eq(regionalCooperationStages.id, id)))[0];
      if (!stage) throw new Error("合作奖阶段不存在");
      const needsFinance = stage.stageCode === "PILOT" || stage.stageCode === "SCALE";
      if ((needsFinance && stage.status !== "finance_verified") || (!needsFinance && stage.status !== "submitted" && stage.status !== "finance_verified")) throw new Error("合作奖尚未完成所需核验");
      await this.client.db.update(regionalCooperationStages).set({ status: "confirmed", confirmedBy: actor.id, confirmedAt: now, updatedAt: now }).where(eq(regionalCooperationStages.id, id));
    } else {
      requireRole(actor, "admin");
      if (!reason) throw new Error("撤销合作奖必须填写原因");
      await this.client.db.update(regionalCooperationStages).set({ status: "revoked", revokedBy: actor.id, revokedAt: now, revokeReason: reason, updatedAt: now }).where(eq(regionalCooperationStages.id, id));
    }
  }

  async calculateStatement(actor: AuthenticatedUser, managerId: string, month: string) {
    requireRole(actor, "hr", "admin");
    const summary = await this.summary(actor, managerId, month);
    if (!summary.templateVersionId) throw new Error("请先为大区经理分配已发布的提成模板");
    const existing = (await this.client.db.select().from(regionalCommissionStatements).where(and(eq(regionalCommissionStatements.regionalManagerId, managerId), eq(regionalCommissionStatements.settlementMonth, month))))[0];
    if (existing && existing.status !== "draft") throw new Error("已确认的提成单不能重算");
    const categories = [
      ["completion", summary.completionFen], ["tiered_order", summary.tieredOrderFen], ["milestone", summary.milestoneFen],
      ["top_up", summary.topUpFen], ["personal_product", summary.personalProductFen], ["cooperation", summary.cooperationFen],
      ["tiered_return", -summary.directReturnFen],
    ] as const;
    const prior = (await this.client.db.select().from(regionalCommissionLedger).where(eq(regionalCommissionLedger.regionalManagerId, managerId))).filter((row) => row.statementId !== existing?.id);
    const entries: Array<{ category: string; amountFen: number }> = categories.map(([category, desired]) => ({ category, amountFen: desired - prior.filter((row) => row.category === category).reduce((sum, row) => sum + row.amountFen, 0) })).filter((entry) => entry.amountFen !== 0);
    if (summary.revenueAccelerationFen) entries.push({ category: "revenue_acceleration", amountFen: summary.revenueAccelerationFen });
    return this.client.withTransaction(async (tx) => {
      if (existing) {
        await tx.delete(regionalCommissionLedger).where(eq(regionalCommissionLedger.statementId, existing.id));
        await tx.delete(regionalCommissionStatements).where(eq(regionalCommissionStatements.id, existing.id));
      }
      const [statement] = await tx.insert(regionalCommissionStatements).values({ regionalManagerId: managerId, settlementMonth: month, templateVersionId: summary.templateVersionId!, targetPlanId: summary.planId, totalFen: entries.reduce((sum, entry) => sum + entry.amountFen, 0), calculationSnapshot: summary as unknown as Record<string, unknown>, calculatedBy: actor.id }).returning();
      if (entries.length) await tx.insert(regionalCommissionLedger).values(entries.map((entry) => ({ regionalManagerId: managerId, statementId: statement!.id, eventKey: `statement:${managerId}:${month}:${entry.category}`, category: entry.category, sourceType: "statement", sourceId: statement!.id, amountFen: entry.amountFen, occurredOn: dateOnly(monthEnd(month)), settlementMonth: month, detailSnapshot: summary as unknown as Record<string, unknown>, createdBy: actor.id })));
      return statement!;
    });
  }

  async transitionStatement(actor: AuthenticatedUser, id: string, action: "confirm" | "pay") {
    const now = new Date();
    if (action === "confirm") {
      requireRole(actor, "admin");
      await this.client.db.update(regionalCommissionStatements).set({ status: "confirmed", confirmedBy: actor.id, confirmedAt: now, updatedAt: now }).where(and(eq(regionalCommissionStatements.id, id), eq(regionalCommissionStatements.status, "draft")));
    } else {
      requireRole(actor, "finance", "admin");
      await this.client.withTransaction(async (tx) => {
        await tx.update(regionalCommissionStatements).set({ status: "paid", paidBy: actor.id, paidAt: now, updatedAt: now }).where(and(eq(regionalCommissionStatements.id, id), eq(regionalCommissionStatements.status, "confirmed")));
        await tx.update(regionalCommissionLedger).set({ paidAt: now }).where(eq(regionalCommissionLedger.statementId, id));
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
