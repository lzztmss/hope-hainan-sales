import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_REGIONAL_COMMISSION_RULES } from "../../shared/regionalCommission/types.js";
import { DrizzleAdminRepository } from "../admin/adminRepository.js";
import { createAdminService } from "../admin/adminService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  customers,
  orders,
  quotes,
  regionalCommissionTemplateAssignments,
  regionalCommissionTemplateVersions,
  regionalCommissionLedger,
  regionalManagerStoreHistory,
  regionalPersonalChannelOrders,
  returns as orderReturns,
  stores,
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

  it("模板计算周期结束后不再纳入新订单或新奖励", async () => {
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
    await expect(service.submitCooperation(hr, {
      managerId: "regional",
      stageCode: "PROJECT",
      achievedOn: "2026-09-10",
      evidenceNo: "PROJECT-SEP",
      note: "9 月立项",
    })).rejects.toThrow("达成日期不在已分配模板的计算范围内");

    const september = await service.summary(hr, "regional", "2026-09");
    expect(september).toMatchObject({
      targetPlanId: targetPlan.id,
      targetPlanStartsOn: "2026-01-15",
      targetPlanEndsOn: "2026-07-14",
      statisticsStartsOn: "2026-01-15",
      statisticsEndsOn: "2026-07-14",
      orderCount: 0,
      managedOrderCount: 0,
      personalOrderCount: 0,
      completionFen: 0,
      tieredOrderFen: 0,
      milestoneFen: 0,
      topUpFen: 0,
      personalProductFen: 0,
      cooperationFen: 0,
      totalFen: 0,
    });
    await expect(service.summary(hr, "regional", "2025-12")).rejects.toThrow("不能早于大区经理入职月份");
    await expect(service.summary(hr, "regional", "2026-10")).rejects.toThrow("不能晚于当前月份");

    const firstDraft = await service.calculateStatement(hr, "regional", "2026-09");
    expect(firstDraft).toMatchObject({ targetPlanId: targetPlan.id, totalFen: 0 });
    const secondDraft = await service.calculateStatement(hr, "regional", "2026-09");
    expect(secondDraft).toMatchObject({ targetPlanId: targetPlan.id, totalFen: 0 });
    const ledger = await client.db.select().from(regionalCommissionLedger);
    expect(ledger).toHaveLength(0);
    await client.close();
  });

  it("后创建的模板会自动纳入计算范围内尚未结算的原始订单", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-template-after-order-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "hr", workNo: "HR", displayName: "人力", passwordHash: "x", role: "hr", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-15", mustChangePassword: false },
    ]);
    const service = new RegionalCommissionService(client);
    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    const admin: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };

    await service.createPersonalOrder(hr, {
      managerId: "regional",
      orderNo: "BEFORE-TEMPLATE",
      channel: "电信",
      orderCount: 1,
      businessDate: "2026-01-15",
      signedOn: "2026-01-15",
      evidenceNo: "BEFORE-TEMPLATE",
      lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }],
    });
    const draft = await service.createTemplate(admin, {
      name: "后创建模板",
      effectiveFrom: "2026-01-15",
      reason: "订单成立后补建规则",
      rules: {
        ...DEFAULT_REGIONAL_COMMISSION_RULES,
        targetCycle: {
          startsOn: "2026-01-15",
          planType: "half_year",
          periodTargets: [1_000, 4_000, 8_000, 10_000, 13_000, 14_000],
        },
      },
    });
    const published = await service.publishTemplate(admin, draft.id, "确认发布");
    expect(published.effectiveTo).toBe("2026-07-14");
    await service.assignTemplate(admin, {
      managerId: "regional",
      templateVersionId: published.id,
      effectiveFrom: "2026-01-15",
      reason: "补入尚未结算的周期订单",
    });

    const january = await service.summary(hr, "regional", "2026-01");
    expect(january).toMatchObject({
      statisticsStartsOn: "2026-01-15",
      statisticsEndsOn: "2026-01-31",
      templateEffectiveTo: "2026-07-14",
      orderCount: 1,
      personalOrderCount: 1,
      personalProductFen: 600,
    });
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

  it("相同统计起点切换模板版本后，不会重复计入已锁定的历史金额", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-cross-version-settlement-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "hr", workNo: "HR", displayName: "人力", passwordHash: "x", role: "hr", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-01", mustChangePassword: false },
    ]);
    const rules = {
      ...DEFAULT_REGIONAL_COMMISSION_RULES,
      targetCycle: { startsOn: "2026-01-01", planType: "quarter" as const, periodTargets: [1_000, 1_000, 1_000] },
    };
    const [first, second] = await client.db.insert(regionalCommissionTemplateVersions).values([
      { id: "template-a", templateCode: "A", versionNo: 1, name: "A 版", status: "published", effectiveFrom: "2026-01-01", rulesSnapshot: rules as unknown as Record<string, unknown>, createdBy: "admin", publishedBy: "admin", publishedAt: new Date(), changeReason: "测试" },
      { id: "template-b", templateCode: "B", versionNo: 1, name: "B 版", status: "published", effectiveFrom: "2026-02-01", rulesSnapshot: rules as unknown as Record<string, unknown>, createdBy: "admin", publishedBy: "admin", publishedAt: new Date(), changeReason: "测试" },
    ]).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values({ regionalManagerId: "regional", templateVersionId: first!.id, effectiveFrom: "2026-01-01", assignedBy: "admin", reason: "首版" });
    const service = new RegionalCommissionService(client);
    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    const admin: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    await service.createPersonalOrder(hr, { managerId: "regional", orderNo: "JAN-001", channel: "电信", orderCount: 1, businessDate: "2026-01-01", signedOn: "2026-01-01", evidenceNo: "JAN", lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }] });
    const januaryStatement = await service.calculateStatement(hr, "regional", "2026-01");
    await service.transitionStatement(admin, januaryStatement.id, "confirm");
    await service.assignTemplate(admin, { managerId: "regional", templateVersionId: second!.id, effectiveFrom: "2026-02-01", reason: "2 月切换新版本" });

    const february = await service.summary(hr, "regional", "2026-02");
    expect(february.templateVersionId).toBe(second!.id);
    expect(february.statisticsStartsOn).toBe("2026-01-01");
    expect(february.settlementPreviewFen).toBe(0);
    expect(february.settlementEntries.find((entry) => entry.category === "tiered_order")).toMatchObject({
      accruedFen: 100,
      previouslySettledFen: 100,
      payableFen: 0,
    });
    await client.close();
  });

  it("后续月份已累计结算时，禁止倒序重复生成前月结算单", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-backdated-settlement-"));
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
      targetCycle: { startsOn: "2026-01-15", planType: "half_year" as const, periodTargets: [1_000, 4_000, 8_000, 10_000, 13_000, 14_000] },
      revenueAcceleration: {
        ...DEFAULT_REGIONAL_COMMISSION_RULES.revenueAcceleration,
        unlockOrderCount: 1,
      },
    };
    const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: "BACKDATED",
      versionNo: 1,
      name: "倒序结算测试",
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
    const admin: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    await service.createPersonalOrder(hr, {
      managerId: "regional",
      orderNo: "JAN-COVERED",
      channel: "电信",
      orderCount: 1,
      businessDate: "2026-01-15",
      signedOn: "2026-01-15",
      evidenceNo: "JAN-COVERED",
      lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }],
    });

    const augustStatement = await service.calculateStatement(hr, "regional", "2026-08");
    await service.transitionStatement(admin, augustStatement.id, "confirm");
    await service.transitionStatement(admin, augustStatement.id, "pay");

    const septemberStatement = await service.calculateStatement(hr, "regional", "2026-09");
    await service.transitionStatement(admin, septemberStatement.id, "confirm");
    await service.transitionStatement(admin, septemberStatement.id, "pay");

    const lateJulyReceiptId = await service.upsertReceipt(hr, {
      managerId: "regional",
      month: "2026-07",
      netReceiptFen: 30_000_000,
      evidenceNo: "LATE-JULY-RECEIPT",
      note: "8、9 月发放后补录",
    });
    await service.verifyReceipt(admin, lateJulyReceiptId, true);
    const septemberAfterLateReceipt = await service.summary(hr, "regional", "2026-09");
    expect(septemberAfterLateReceipt).toMatchObject({
      currentMonthRevenueAccelerationFen: 0,
      revenueAccelerationFen: 15_000,
      settlementPreviewFen: 15_000,
    });
    expect(septemberAfterLateReceipt.settlementEntries.find((entry) => entry.category === "revenue_acceleration"))
      .toMatchObject({ accruedFen: 15_000, previouslySettledFen: 0, payableFen: 15_000 });

    const june = await service.summary(hr, "regional", "2026-06");
    expect(june.settlementCoveredBy).toMatchObject({
      id: augustStatement.id,
      settlementMonth: "2026-08",
      status: "paid",
    });
    expect(june.settlementPreviewFen).toBe(0);
    expect(june.settlementEntries.every((entry) => entry.payableFen === 0)).toBe(true);
    await expect(service.calculateStatement(hr, "regional", "2026-06"))
      .rejects.toThrow("2026-06 已包含在 2026-08 已发放的累计结算中");
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
      reason: "倒填日期未确认",
    })).rejects.toThrow("需要确认：分配生效日期早于模板生效日期");
    await service.assignTemplate(admin, {
      managerId: "regional",
      templateVersionId: first!.id,
      effectiveFrom: "2026-01-14",
      reason: "确认倒填到模板生效日之前",
      confirmBackdated: true,
    });
    const backdated = await client.db.select().from(regionalCommissionTemplateAssignments);
    expect(backdated).toHaveLength(1);
    expect(backdated[0]).toMatchObject({
      templateVersionId: first!.id,
      effectiveFrom: "2026-01-14",
      effectiveTo: null,
      reason: "确认倒填到模板生效日之前",
    });
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

  it("补建账号回填入职日期时，营业厅订单从入职日起计入有效订单", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-hire-affiliation-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "hr", workNo: "HR", displayName: "人力", passwordHash: "x", role: "hr", personnelType: "admin", mustChangePassword: false },
    ]);
    const storeId = "00000000-0000-4000-8000-000000000401";
    await client.db.insert(stores).values({ id: storeId, code: "RGHIRE01", name: "入职起算营业厅" });
    // 2026-01-10 入职，2026-01-20 才补建账号并绑定营业厅。
    const adminService = createAdminService({
      repository: new DrizzleAdminRepository(client),
      pii: {
        encryptPii: (value) => value,
        decryptPii: (value) => value,
        phoneLookupHash: (value) => value,
      },
      hashPassword: async () => "hashed-for-test",
      now: () => new Date("2026-01-20T10:00:00+08:00"),
    });
    const admin: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    const manager = await adminService.createUser(admin, {
      workNo: "REGIONAL-HIRE-BACKFILL",
      displayName: "回填入职日大区经理",
      role: "regional_manager",
      personnelType: "unicom",
      storeId: null,
      managedStoreIds: [storeId],
      employmentStartDate: "2026-01-10",
      initialPassword: "password-for-test",
      reason: "补建账号并回填入职日期",
    });

    const [affiliation] = await client.db.select().from(regionalManagerStoreHistory);
    expect(affiliation).toMatchObject({
      storeId,
      effectiveFrom: new Date("2026-01-10T00:00:00+08:00"),
      effectiveTo: null,
    });

    const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: "HIRE-BACKFILL",
      versionNo: 1,
      name: "入职起算测试模板",
      status: "published",
      effectiveFrom: "2026-01-10",
      rulesSnapshot: DEFAULT_REGIONAL_COMMISSION_RULES as unknown as Record<string, unknown>,
      createdBy: "admin",
      publishedBy: "admin",
      publishedAt: new Date(),
      changeReason: "测试",
    }).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values({
      regionalManagerId: manager.id,
      templateVersionId: template!.id,
      effectiveFrom: "2026-01-10",
      assignedBy: "admin",
      reason: "测试",
    });

    const customerId = "00000000-0000-4000-8000-000000000402";
    await client.db.insert(customers).values({
      id: customerId,
      storeId,
      ownerUserId: "admin",
      nameEncrypted: "test",
      phoneEncrypted: "test",
      phoneLookupHash: "hire-backfill-phone",
      phoneTail: "0000",
      elderCount: 1,
      createdBy: "admin",
    });
    const orderRows = [
      // 生效日（签收满 7 天）2026-01-15：入职之后、建号之前，应计入。
      { orderNo: "HIRE-AFTER-001", idempotencyKey: "hire-after-001", quoteId: "quote-after-001", signedAt: new Date("2026-01-08T12:00:00+08:00") },
      // 生效日 2026-01-09：入职之前，不计入。
      { orderNo: "HIRE-BEFORE-001", idempotencyKey: "hire-before-001", quoteId: "quote-before-001", signedAt: new Date("2026-01-02T12:00:00+08:00") },
    ];
    await client.db.insert(quotes).values(orderRows.map((row) => ({
      id: row.quoteId,
      quoteNo: `XLX-${row.orderNo}`,
      idempotencyKey: `quote-${row.idempotencyKey}`,
      customerId,
      storeId,
      sellerId: "admin",
      status: "converted",
      paymentMode: "contract_36",
      fttrKind: "standard",
      fttrPlan: 159,
      fttrMonthlyFen: 15900,
      heartMonthlyFen: 2000,
      oneTimeFen: 0,
      monthlyTotalFen: 17900,
      contract36Fen: 644400,
      catalogVersion: "test",
      customerSnapshot: {},
      quoteSnapshot: {},
      confirmedAt: new Date("2026-01-02T09:00:00+08:00"),
    })));
    await client.db.insert(orders).values(orderRows.map((row) => ({
      orderNo: row.orderNo,
      idempotencyKey: row.idempotencyKey,
      quoteId: row.quoteId,
      customerId,
      storeId,
      sellerId: "admin",
      status: "accepted",
      paymentMode: "contract_36",
      fttrKind: "standard",
      fttrPlan: 159,
      fttrMonthlyFen: 15900,
      heartMonthlyFen: 2000,
      oneTimeFen: 0,
      monthlyTotalFen: 17900,
      contract36Fen: 644400,
      catalogVersion: "test",
      catalogSnapshot: {},
      customerSnapshot: {},
      quoteSnapshot: {},
      storeSnapshot: {},
      sellerSnapshot: {},
      createdBy: "admin",
      acceptedAt: new Date("2026-01-02T09:00:00+08:00"),
      signedAt: row.signedAt,
    })));

    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    const summary = await new RegionalCommissionService(client).summary(hr, manager.id, "2026-01");
    expect(summary.statisticsStartsOn).toBe("2026-01-10");
    expect(summary.managedOrderCount).toBe(1);
    expect(summary.orderCount).toBe(1);
    await client.close();
  });

  it("有效订单明细列表与汇总计数一致，并标注来源、状态和归属周期", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hope-regional-valid-orders-"));
    directories.push(directory);
    const path = join(directory, "app.sqlite");
    await migrateDatabase(path);
    const client = createDatabaseClient(path);
    await client.db.insert(users).values([
      { id: "admin", workNo: "ADMIN", displayName: "管理员", passwordHash: "x", role: "admin", personnelType: "admin", mustChangePassword: false },
      { id: "hr", workNo: "HR", displayName: "人力", passwordHash: "x", role: "hr", personnelType: "admin", mustChangePassword: false },
      { id: "regional", workNo: "REGIONAL", displayName: "大区经理", passwordHash: "x", role: "regional_manager", personnelType: "admin", employmentStartDate: "2026-01-01", mustChangePassword: false },
    ]);
    const storeId = "00000000-0000-4000-8000-000000000801";
    await client.db.insert(stores).values({ id: storeId, code: "RGVO01", name: "明细核查营业厅" });
    await client.db.insert(regionalManagerStoreHistory).values({
      regionalManagerId: "regional",
      storeId,
      effectiveFrom: new Date("2026-01-01T00:00:00+08:00"),
    });
    const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({
      templateCode: "VALID-ORDERS",
      versionNo: 1,
      name: "明细核查模板",
      status: "published",
      effectiveFrom: "2026-01-01",
      rulesSnapshot: {
        ...DEFAULT_REGIONAL_COMMISSION_RULES,
        targetCycle: { ...DEFAULT_REGIONAL_COMMISSION_RULES.targetCycle, startsOn: "2026-01-01" },
      } as unknown as Record<string, unknown>,
      createdBy: "admin",
      publishedBy: "admin",
      publishedAt: new Date(),
      changeReason: "测试",
    }).returning();
    await client.db.insert(regionalCommissionTemplateAssignments).values({
      regionalManagerId: "regional",
      templateVersionId: template!.id,
      effectiveFrom: "2026-01-01",
      assignedBy: "admin",
      reason: "测试",
    });

    const orderRows = [
      // 生效日 2026-01-15：M1 内，应计入。
      { suffix: "A", signedAt: new Date("2026-01-08T12:00:00+08:00"), cancelledAt: null },
      // 生效日 2026-01-27：M1 内，计入且已有已完成整单退货。
      { suffix: "B", signedAt: new Date("2026-01-20T12:00:00+08:00"), cancelledAt: null },
      // 生效日 2025-12-27：统计起点之前，不计入。
      { suffix: "C", signedAt: new Date("2025-12-20T12:00:00+08:00"), cancelledAt: null },
      // 签收未满 7 天，不计入。
      { suffix: "D", signedAt: new Date("2026-02-25T12:00:00+08:00"), cancelledAt: null },
      // 生效日 2026-01-12，但生效前已取消，不计入。
      { suffix: "E", signedAt: new Date("2026-01-05T12:00:00+08:00"), cancelledAt: new Date("2026-01-10T00:00:00+08:00") },
    ];
    await client.db.insert(customers).values({
      id: "00000000-0000-4000-8000-000000000909",
      storeId,
      ownerUserId: "admin",
      nameEncrypted: "test",
      phoneEncrypted: "test",
      phoneLookupHash: "valid-orders-phone",
      phoneTail: "0000",
      elderCount: 1,
      createdBy: "admin",
    });
    await client.db.insert(quotes).values(orderRows.map((row) => ({
      id: `00000000-0000-4000-8000-00000000090${row.suffix}`,
      quoteNo: `XLX-VO-${row.suffix}`,
      idempotencyKey: `quote-vo-${row.suffix}`,
      customerId: "00000000-0000-4000-8000-000000000909",
      storeId,
      sellerId: "admin",
      status: "converted",
      paymentMode: "contract_36",
      fttrKind: "standard",
      fttrPlan: 159,
      fttrMonthlyFen: 15900,
      heartMonthlyFen: 2000,
      oneTimeFen: 0,
      monthlyTotalFen: 17900,
      contract36Fen: 644400,
      catalogVersion: "test",
      customerSnapshot: {},
      quoteSnapshot: {},
      confirmedAt: new Date("2026-01-02T09:00:00+08:00"),
    })));
    const insertedOrders = await client.db.insert(orders).values(orderRows.map((row) => ({
      id: `00000000-0000-4000-8000-00000000091${row.suffix}`,
      orderNo: `XLXDD-VO-${row.suffix}`,
      idempotencyKey: `order-vo-${row.suffix}`,
      quoteId: `00000000-0000-4000-8000-00000000090${row.suffix}`,
      customerId: "00000000-0000-4000-8000-000000000909",
      storeId,
      sellerId: "admin",
      status: "accepted",
      paymentMode: "contract_36",
      fttrKind: "standard",
      fttrPlan: 159,
      fttrMonthlyFen: 15900,
      heartMonthlyFen: 2000,
      oneTimeFen: 0,
      monthlyTotalFen: 17900,
      contract36Fen: 644400,
      catalogVersion: "test",
      catalogSnapshot: {},
      customerSnapshot: {},
      quoteSnapshot: {},
      storeSnapshot: {},
      sellerSnapshot: {},
      createdBy: "admin",
      acceptedAt: new Date("2026-01-02T09:00:00+08:00"),
      signedAt: row.signedAt,
      cancelledAt: row.cancelledAt,
    }))).returning({ id: orders.id, orderNo: orders.orderNo });
    const orderB = insertedOrders.find((row) => row.orderNo === "XLXDD-VO-B")!;
    await client.db.insert(orderReturns).values({
      returnNo: "TH-VO-B",
      idempotencyKey: "return-vo-b",
      completionIdempotencyKey: "return-vo-b-complete",
      orderId: orderB.id,
      returnType: "full",
      status: "completed",
      reason: "测试整单退货",
      requestedBy: "admin",
      requestedAt: new Date("2026-01-28T00:00:00+08:00"),
      decidedBy: "admin",
      decidedAt: new Date("2026-01-29T00:00:00+08:00"),
      completedBy: "admin",
      completedAt: new Date("2026-02-05T00:00:00+08:00"),
    });

    const service = new RegionalCommissionService(client);
    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    await service.createPersonalOrder(hr, {
      managerId: "regional",
      orderNo: "VO-PERSONAL-1",
      channel: "电信",
      orderCount: 2,
      businessDate: "2026-01-15",
      signedOn: "2026-01-13",
      evidenceNo: "VO-P1",
      lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }],
    });
    await service.createPersonalOrder(hr, {
      managerId: "regional",
      orderNo: "VO-PERSONAL-2",
      channel: "电信",
      orderCount: 1,
      businessDate: "2026-01-20",
      signedOn: "2026-01-18",
      evidenceNo: "VO-P2",
      lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }],
    });
    // 作废时间落在统计月内才会被剔除；这里直接写入 2 月作废的记录。
    await client.db.update(regionalPersonalChannelOrders).set({
      status: "voided",
      voidedBy: "hr",
      voidedAt: new Date("2026-02-10T00:00:00+08:00"),
      voidReason: "录入作废",
    }).where(and(
      eq(regionalPersonalChannelOrders.regionalManagerId, "regional"),
      eq(regionalPersonalChannelOrders.orderNo, "VO-PERSONAL-2"),
    ));

    const summary = await service.summary(hr, "regional", "2026-02");
    const detail = await service.listValidOrders(hr, "regional", "2026-02");
    expect(detail.orderCount).toBe(summary.orderCount);
    expect(detail.managedOrderCount).toBe(summary.managedOrderCount);
    expect(detail.personalOrderCount).toBe(summary.personalOrderCount);
    expect(detail.orderCount).toBe(4);
    expect(detail.items).toHaveLength(3);
    const byOrderNo = new Map(detail.items.map((item) => [item.orderNo, item]));
    expect(byOrderNo.get("XLXDD-VO-A")).toMatchObject({
      source: "store",
      place: "明细核查营业厅",
      effectiveOn: "2026-01-15",
      status: "valid",
      orderCount: 1,
      periodSequence: 1,
    });
    expect(byOrderNo.get("XLXDD-VO-B")).toMatchObject({ source: "store", status: "returned", periodSequence: 1 });
    expect(byOrderNo.get("VO-PERSONAL-1")).toMatchObject({
      source: "personal",
      place: "电信",
      effectiveOn: "2026-01-20",
      status: "valid",
      orderCount: 2,
      periodSequence: 1,
    });
    expect(byOrderNo.get("XLXDD-VO-E")).toBeUndefined();
    expect(byOrderNo.get("XLXDD-VO-C")).toBeUndefined();
    expect(byOrderNo.get("XLXDD-VO-D")).toBeUndefined();
    expect(byOrderNo.get("VO-PERSONAL-2")).toBeUndefined();
    await client.close();
  });
});
