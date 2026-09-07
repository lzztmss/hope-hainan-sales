import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_REGIONAL_COMMISSION_RULES } from "../../shared/regionalCommission/types.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  regionalCommissionTargetPeriods,
  regionalCommissionTargetPlans,
  regionalCommissionTemplateAssignments,
  regionalCommissionTemplateVersions,
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
    const [plan] = await client.db.insert(regionalCommissionTargetPlans).values({ regionalManagerId: "regional", planType: "quarter", periodCount: 3, startsOn: "2026-01-01", endsOn: "2026-03-31", setBy: "admin", changeReason: "测试" }).returning();
    await client.db.insert(regionalCommissionTargetPeriods).values([
      { planId: plan!.id, sequence: 1, startsOn: "2026-01-01", endsOn: "2026-01-31", targetOrderCount: 1, cumulativeTargetOrderCount: 1 },
      { planId: plan!.id, sequence: 2, startsOn: "2026-02-01", endsOn: "2026-02-28", targetOrderCount: 1, cumulativeTargetOrderCount: 2 },
      { planId: plan!.id, sequence: 3, startsOn: "2026-03-01", endsOn: "2026-03-31", targetOrderCount: 1, cumulativeTargetOrderCount: 3 },
    ]);
    const service = new RegionalCommissionService(client);
    const hr: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    const created = await service.createPersonalOrder(hr, { managerId: "regional", orderNo: "P-001", channel: "电信", orderCount: 1, businessDate: "2026-01-01", signedOn: "2026-01-01", evidenceNo: "E-001", lines: [{ sku: "GATEWAY", label: "迷你网关", quantity: 1 }, { sku: "MOTION", label: "人体传感器", quantity: 1 }] });
    const listed = await service.listPersonalOrders(hr, "regional");
    expect(listed[0]?.effectiveOn).toBe("2026-01-08");
    expect((await service.summary(hr, "regional", "2026-01")).personalProductFen).toBe(1_500);
    await service.returnPersonalOrder(hr, created.id, { completedOn: "2026-02-02", reason: "退回网关", lines: [{ lineId: listed[0]!.lines[0]!.id, returnedQuantity: 1 }] });
    expect((await service.summary(hr, "regional", "2026-02")).personalProductFen).toBe(900);
    const refreshed = await service.listPersonalOrders(hr, "regional");
    await service.returnPersonalOrder(hr, created.id, { completedOn: "2026-02-03", reason: "全部退回", lines: refreshed[0]!.lines.map((line) => ({ lineId: line.id, returnedQuantity: line.quantity })) });
    const returned = await service.summary(hr, "regional", "2026-02");
    expect(returned.orderCount).toBe(1);
    expect(returned.personalProductFen).toBe(0);
    expect(returned.directReturnFen).toBe(100);
    await client.close();
  });
});
