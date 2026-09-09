import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_REGIONAL_COMMISSION_RULES } from "../../shared/regionalCommission/types.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  regionalCommissionTemplateAssignments,
  regionalCommissionTemplateVersions,
  regionalCommissionLedger,
  users,
} from "../db/schema.js";
import { RegionalCommissionService } from "./regionalCommissionService.js";

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("大区经理个人渠道提成", () => {
  it("按第七天计入并按退回小件生成扣减", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-commission-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "hr", workNo: "HR", displayName: "人力", passwordHash: "x", role: "hr", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-01", mustChangePassword: false },
    ]);
    const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({ templateCode: "TEST", versionNo: 1, name: "测试模板", status: "published", effectiveFrom: "2026-01-01", rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>, createdBy: "admin", publishedBy: "admin", publishedAt: new Date(), changeReason: "测试" }).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values({ regionalManagerId: "regional", templateVersionId: template!.id, effectiveFrom: "2026-01-01", assignedBy: "admin", reason: "测试" });
    const service = new RegionalCommissionService(client);
    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    const admin: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    const targetPlan = await service.createSuggestedTargetPlan(hr, "regional", "按入职日生成验收计划");
    await service.activateTargetPlan(hr, targetPlan.id, "确认启用验收计划");
    const followUpPlan = await service.saveTargetPlanDraft(hr, {
      managerId: "regional",
      planType: "half_year",
      startsOn: "2026-07-01",
      periodTargets: [1_000, 4_000, 8_000, 10_000, 13_000, 14_000],
      reason: "HR手动创建第二份计划",
    });
    await service.activateTargetPlan(hr, followUpPlan.id, "HR手动确认第二份计划");
    const created = await service.createPersonalOrder(hr, { managerId: "regional", orderNo: "P-001", channel: "电信", orderCount: 1, businessDate: "2026-01-01", signedOn: "2026-01-01", evidenceNo: "E-001", lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }, { sku: "MOTION", label: "人体传感器", quantity: 1 }] });
    const listed = await service.listPersonalOrders(hr, "regional");
    expect(listed[0]?.effectiveOn).toBe("2026-01-08");
    const january = await service.summary(hr, "regional", "2026-01");
    expect(january.personalProductFen).toBe(1_500);
    expect(january.periods).toHaveLength(6);
    expect(january.periods[0]).toMatchObject({
      sequence: 1,
      startsOn: "2026-01-01",
      endsOn: "2026-01-31",
      targetOrderCount: 1_000,
    });
    expect(january.settlementPreviewFen).toBe(january.totalFen);
    const januaryStatement = await service.calculateStatement(hr, "regional", "2026-01");
    expect(januaryStatement.totalFen).toBe(january.settlementPreviewFen);
    await service.transitionStatement(admin, januaryStatement.id, "confirm");
    await service.returnPersonalOrder(hr, created.id, { completedOn: "2026-02-02", reason: "退回网关", lines: [{ lineId: listed[0]!.lines[0]!.id, returnedQuantity: 1 }] });
    expect((await service.summary(hr, "regional", "2026-02")).personalProductFen).toBe(900);
    const refreshed = await service.listPersonalOrders(hr, "regional");
    await service.returnPersonalOrder(hr, created.id, { completedOn: "2026-02-03", reason: "全部退回", lines: refreshed[0]!.lines.map((line) => ({ lineId: line.id, returnedQuantity: line.quantity })) });
    const returned = await service.summary(hr, "regional", "2026-02");
    expect(returned.orderCount).toBe(1);
    expect(returned.personalProductFen).toBe(0);
    expect(returned.directReturnFen).toBe(100);

    const receiptId = await service.upsertReceipt(hr, { managerId: "regional", month: "2026-02", netReceiptFen: 100_000, evidenceNo: "BANK-001", note: "银行流水" });
    await service.verifyReceipt(admin, receiptId, true);
    expect((await service.summary(hr, "regional", "2026-02")).receipt?.verificationStatus).toBe("verified");
    await expect(service.upsertReceipt(hr, { managerId: "regional", month: "2026-02", netReceiptFen: 90_000, evidenceNo: "BANK-002" })).rejects.toThrow("请先退回更正");
    await expect(service.verifyReceipt(admin, receiptId, false)).rejects.toThrow("必须填写原因");
    await service.verifyReceipt(admin, receiptId, false, "金额需更正");
    await service.upsertReceipt(hr, { managerId: "regional", month: "2026-02", netReceiptFen: 90_000, evidenceNo: "BANK-002" });
    expect((await service.summary(hr, "regional", "2026-02")).receipt).toMatchObject({
      netReceiptFen: 90_000,
      verificationStatus: "pending",
      verificationReason: null,
    });

    const cooperation = await service.submitCooperation(hr, { managerId: "regional", stageCode: "PROJECT", achievedOn: "2026-02-01", evidenceNo: "PROJECT-001", note: "立项批复" });
    await service.transitionCooperation(admin, cooperation.id, "confirm");
    expect((await service.summary(hr, "regional", "2026-02")).cooperationFen).toBeGreaterThan(0);
    const duplicateWhileConfirmed = await service.submitCooperation(hr, { managerId: "regional", stageCode: "PROJECT", achievedOn: "2026-02-02", evidenceNo: "PROJECT-001-B", note: "同阶段补充资料" });
    await expect(service.transitionCooperation(admin, duplicateWhileConfirmed.id, "confirm")).rejects.toThrow("不能重复确认");
    await expect(service.transitionCooperation(admin, cooperation.id, "revoke")).rejects.toThrow("必须填写原因");
    await service.transitionCooperation(admin, cooperation.id, "revoke", "项目取消");
    expect((await service.summary(hr, "regional", "2026-02")).cooperationFen).toBe(0);

    const repeatedStage = await service.submitCooperation(hr, { managerId: "regional", stageCode: "PROJECT", achievedOn: "2026-02-10", evidenceNo: "PROJECT-002", note: "第二次立项" });
    const anotherRepeatedStage = await service.submitCooperation(hr, { managerId: "regional", stageCode: "PROJECT", achievedOn: "2026-02-11", evidenceNo: "PROJECT-003", note: "第三次立项" });
    expect(repeatedStage.id).not.toBe(anotherRepeatedStage.id);
    expect((await service.listCooperation(hr, "regional")).filter((stage) => stage.stageCode === "PROJECT")).toMatchObject([
      { id: anotherRepeatedStage.id, evidenceNo: "PROJECT-003", status: "submitted" },
      { id: repeatedStage.id, evidenceNo: "PROJECT-002", status: "submitted" },
      { id: duplicateWhileConfirmed.id, evidenceNo: "PROJECT-001-B", status: "submitted" },
      { id: cooperation.id, evidenceNo: "PROJECT-001", status: "revoked" },
    ]);
    const februaryPreview = await service.summary(hr, "regional", "2026-02");
    expect(februaryPreview.settlementEntries.find((entry) => entry.category === "personal_product")).toMatchObject({
      accruedFen: 0,
      previouslySettledFen: 1_500,
      payableFen: -1_500,
    });
    expect(februaryPreview.settlementEntries.find((entry) => entry.category === "tiered_return")?.payableFen).toBe(-100);
    await client.close();
  });

  it("目标周期结束后停止周期目标奖，但不误伤仍在适用期的其他规则", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-ended-plan-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "hr", workNo: "HR", displayName: "人力", passwordHash: "x", role: "hr", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-15", mustChangePassword: false },
    ]);
    const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: "ENDED-PLAN",
      versionNo: 1,
      name: "计划边界测试模板",
      status: "published",
      effectiveFrom: "2026-01-15",
      rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>,
      createdBy: "admin",
      publishedBy: "admin",
      publishedAt: new Date(),
      changeReason: "测试",
    }).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values({
      regionalManagerId: "regional",
      templateVersionId: template!.id,
      effectiveFrom: "2026-01-15",
      assignedBy: "admin",
      reason: "测试",
    });
    const service = new RegionalCommissionService(client);
    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    const targetPlan = await service.createSuggestedTargetPlan(hr, "regional", "按入职日生成半年计划");
    await service.activateTargetPlan(hr, targetPlan.id, "确认启用半年计划");

    await service.createPersonalOrder(hr, {
      managerId: "regional",
      orderNo: "AFTER-PLAN-001",
      channel: "电信",
      orderCount: 1,
      businessDate: "2026-08-01",
      signedOn: "2026-08-01",
      evidenceNo: "AFTER-PLAN-EVIDENCE",
      lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }],
    });
    const cooperation = await service.submitCooperation(hr, {
      managerId: "regional",
      stageCode: "PROJECT",
      achievedOn: "2026-09-10",
      evidenceNo: "PROJECT-SEP",
      note: "9 月立项",
    });
    expect(cooperation).toMatchObject({ stageCode: "PROJECT", achievedOn: "2026-09-10" });

    const september = await service.summary(hr, "regional", "2026-09");
    expect(september).toMatchObject({
      targetPlanId: targetPlan.id,
      targetPlanStartsOn: "2026-01-15",
      targetPlanEndsOn: "2026-07-14",
      statisticsStartsOn: "2026-01-15",
      statisticsEndsOn: "2026-09-30",
      orderCount: 1,
      managedOrderCount: 0,
      personalOrderCount: 1,
      completionFen: 0,
      tieredOrderFen: 100,
      milestoneFen: 0,
      topUpFen: 0,
      personalProductFen: 600,
      cooperationFen: 0,
      totalFen: 700,
    });
    await expect(service.summary(hr, "regional", "2025-12")).rejects.toThrow("不能早于大区经理入职月份");

    const firstDraft = await service.calculateStatement(hr, "regional", "2026-09");
    expect(firstDraft).toMatchObject({ targetPlanId: targetPlan.id, totalFen: 700 });
    const secondDraft = await service.calculateStatement(hr, "regional", "2026-09");
    expect(secondDraft).toMatchObject({ targetPlanId: targetPlan.id, totalFen: 700 });
    const ledger = await client.db.select().from(regionalCommissionLedger);
    expect(ledger).toHaveLength(2);
    await client.close();
  });

  it("模板适用日可以早于 M1，周期统计同时返回本期与累计订单", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-independent-m1-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "hr", workNo: "HR", displayName: "人力", passwordHash: "x", role: "hr", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-15", mustChangePassword: false },
    ]);
    const rules = {
      ...DEFAULT_REGIONAL_COMMISSION_RULES,
      targetCycle: { startsOn: "2026-02-01", planType: "quarter" as const, periodTargets: [1, 2, 3] },
    };
    const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: "INDEPENDENT-M1",
      versionNo: 1,
      name: "独立 M1 模板",
      status: "published",
      effectiveFrom: "2026-01-15",
      rulesSnapshot: rules as unknown as Record<string, unknown>,
      createdBy: "admin",
      publishedBy: "admin",
      publishedAt: new Date(),
      changeReason: "测试",
    }).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values({
      regionalManagerId: "regional",
      templateVersionId: template!.id,
      effectiveFrom: "2026-01-15",
      assignedBy: "admin",
      reason: "测试",
    });
    const service = new RegionalCommissionService(client);
    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    await service.createPersonalOrder(hr, { managerId: "regional", orderNo: "PRE-M1", channel: "电信", orderCount: 2, businessDate: "2026-01-20", signedOn: "2026-01-20", evidenceNo: "PRE", lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }] });
    await service.createPersonalOrder(hr, { managerId: "regional", orderNo: "M1", channel: "电信", orderCount: 3, businessDate: "2026-02-01", signedOn: "2026-02-01", evidenceNo: "M1", lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }] });

    const february = await service.summary(hr, "regional", "2026-02");
    expect(february).toMatchObject({
      targetPlanStartsOn: "2026-02-01",
      targetPlanEndsOn: "2026-04-30",
      statisticsStartsOn: "2026-02-01",
      orderCount: 3,
    });
    expect(february.periods[0]).toMatchObject({
      startsOn: "2026-02-01",
      orderCount: 3,
      cumulativeOrderCount: 3,
    });
    expect(february.periods[1]).toMatchObject({ orderCount: 0, cumulativeOrderCount: 3 });
    await client.close();
  });

  it("同日改派模板时安全替换，重复或倒填日期时返回业务提示", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-assignment-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-01", mustChangePassword: false },
    ]);
    const [first, second] = await client.db.insert(regionalCommissionTemplateVersions).values([
      { id: "template-first", templateCode: "FIRST", versionNo: 1, name: "原模板", status: "published", effectiveFrom: "2026-01-15", rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>, createdBy: "admin", publishedBy: "admin", publishedAt: new Date(), changeReason: "测试" },
      { id: "template-second", templateCode: "SECOND", versionNo: 1, name: "替换模板", status: "published", effectiveFrom: "2026-01-15", rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>, createdBy: "admin", publishedBy: "admin", publishedAt: new Date(), changeReason: "测试" },
    ]).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values({
      regionalManagerId: "regional",
      templateVersionId: first!.id,
      effectiveFrom: "2026-01-15",
      assignedBy: "admin",
      reason: "首次分配",
    });
    const service = new RegionalCommissionService(client);
    const admin: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };

    await service.assignTemplate(admin, {
      managerId: "regional",
      templateVersionId: second!.id,
      effectiveFrom: "2026-01-15",
      reason: "同日纠正模板",
    });
    const assignments = await client.db.select().from(regionalCommissionTemplateAssignments);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      templateVersionId: second!.id,
      effectiveFrom: "2026-01-15",
      effectiveTo: null,
      reason: "同日纠正模板",
    });
    await expect(service.assignTemplate(admin, {
      managerId: "regional",
      templateVersionId: second!.id,
      effectiveFrom: "2026-01-15",
      reason: "重复分配",
    })).rejects.toThrow("无需重复分配");
    await expect(service.assignTemplate(admin, {
      managerId: "regional",
      templateVersionId: first!.id,
      effectiveFrom: "2026-01-14",
      reason: "倒填日期",
    })).rejects.toThrow("不能早于模板生效日期");
    await client.close();
  });

  it("倒填纠正生效日期时清除未来错误分配并写入新区间", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-assignment-backdate-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-15", mustChangePassword: false },
    ]);
    const [first, second] = await client.db.insert(regionalCommissionTemplateVersions).values([
      { id: "template-first", templateCode: "FIRST", versionNo: 1, name: "原模板", status: "published", effectiveFrom: "2026-01-15", rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>, createdBy: "admin", publishedBy: "admin", publishedAt: new Date(), changeReason: "测试" },
      { id: "template-second", templateCode: "SECOND", versionNo: 1, name: "新模板", status: "published", effectiveFrom: "2026-01-01", rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>, createdBy: "admin", publishedBy: "admin", publishedAt: new Date(), changeReason: "测试" },
    ]).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values([
      { id: "closed-old", regionalManagerId: "regional", templateVersionId: first!.id, effectiveFrom: "2026-01-15", effectiveTo: "2026-09-07", assignedBy: "admin", reason: "历史区间" },
      { id: "active-wrong", regionalManagerId: "regional", templateVersionId: first!.id, effectiveFrom: "2026-09-08", effectiveTo: null, assignedBy: "admin", reason: "错误默认日期" },
    ]);
    const service = new RegionalCommissionService(client);
    const admin: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };

    await service.assignTemplate(admin, {
      managerId: "regional",
      templateVersionId: second!.id,
      effectiveFrom: "2026-01-15",
      reason: "纠正为入职日生效",
    });

    const assignments = await client.db.select().from(regionalCommissionTemplateAssignments).orderBy(
      regionalCommissionTemplateAssignments.effectiveFrom,
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      templateVersionId: second!.id,
      effectiveFrom: "2026-01-15",
      effectiveTo: null,
      reason: "纠正为入职日生效",
    });
    await client.close();
  });
});
