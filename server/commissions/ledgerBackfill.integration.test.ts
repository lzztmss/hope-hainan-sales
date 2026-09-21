import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  commissionLedger,
  commissionPolicyVersions,
  commissionRules,
  customers,
  orderAttributions,
  orderCommissionSnapshots,
  orderLines,
  orders,
  quotes,
  stores,
  users,
} from "../db/schema.js";
import { DrizzleCommissionLedgerRepository } from "./ledgerRepository.js";
import { createCommissionLedgerService } from "./ledgerService.js";
import { createCommissionRuleService } from "./ruleService.js";
import { DrizzleCommissionRuleRepository } from "./ruleRepository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

const setupDatabase = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "app.sqlite");
  await migrateDatabase(databasePath);
  return createDatabaseClient(databasePath);
};

const seedBase = async (client: ReturnType<typeof createDatabaseClient>) => {
  const storeId = "00000000-0000-4000-8000-000000000501";
  const sellerId = "00000000-0000-4000-8000-000000000502";
  const adminId = "00000000-0000-4000-8000-000000000503";
  const customerId = "00000000-0000-4000-8000-000000000504";
  await client.db.insert(stores).values({ id: storeId, code: "BFILL01", name: "补提测试营业厅" });
  await client.db.insert(users).values([
    { id: sellerId, workNo: "BFILL-SALES", displayName: "补提测试销售员", passwordHash: "not-used", role: "sales", personnelType: "unicom", storeId, active: true, mustChangePassword: false },
    { id: adminId, workNo: "BFILL-ADMIN", displayName: "补提测试管理员", passwordHash: "not-used", role: "admin", personnelType: "admin", active: true, mustChangePassword: false },
  ]);
  await client.db.insert(customers).values({
    id: customerId,
    storeId,
    ownerUserId: sellerId,
    nameEncrypted: "test",
    phoneEncrypted: "test",
    phoneLookupHash: "backfill-test-phone",
    phoneTail: "0000",
    elderCount: 1,
    createdBy: sellerId,
  });
  return { storeId, sellerId, adminId, customerId };
};

type SeedOrderInput = {
  suffix: string;
  status: "accepted" | "activated" | "signed" | "reconciled" | "paid" | "returned";
  activatedAt: Date | null;
  withAttribution: boolean;
  withSnapshot?: boolean;
};

const seedOrder = async (
  client: ReturnType<typeof createDatabaseClient>,
  base: Awaited<ReturnType<typeof seedBase>>,
  input: SeedOrderInput,
) => {
  const quoteId = `00000000-0000-4000-8000-0000000006${input.suffix}`;
  const orderId = `00000000-0000-4000-8000-0000000007${input.suffix}`;
  const createdAt = new Date("2026-01-05T01:00:00.000Z");
  await client.db.insert(quotes).values({
    id: quoteId,
    quoteNo: `XLX-BFILL-${input.suffix}`,
    idempotencyKey: `quote-backfill-${input.suffix}`,
    customerId: base.customerId,
    storeId: base.storeId,
    sellerId: base.sellerId,
    status: "converted",
    paymentMode: "one_time",
    fttrKind: "none",
    fttrMonthlyFen: 0,
    heartMonthlyFen: 0,
    oneTimeFen: 10_000,
    monthlyTotalFen: 0,
    contract36Fen: 0,
    catalogVersion: "test",
    customerSnapshot: {},
    quoteSnapshot: {},
    confirmedAt: createdAt,
    createdAt,
  });
  await client.db.insert(orders).values({
    id: orderId,
    orderNo: `XLXDD-BFILL-${input.suffix}`,
    quoteId,
    customerId: base.customerId,
    idempotencyKey: `order-backfill-${input.suffix}`,
    storeId: base.storeId,
    sellerId: base.sellerId,
    status: input.status,
    salesChannel: "offline",
    paymentMode: "one_time",
    fttrKind: "none",
    fttrMonthlyFen: 0,
    heartMonthlyFen: 0,
    oneTimeFen: 10_000,
    monthlyTotalFen: 0,
    contract36Fen: 0,
    catalogVersion: "test",
    catalogSnapshot: {},
    customerSnapshot: {},
    quoteSnapshot: {},
    storeSnapshot: {},
    sellerSnapshot: {},
    createdBy: base.sellerId,
    acceptedAt: createdAt,
    activatedAt: input.activatedAt,
    createdAt,
  });
  await client.db.insert(orderLines).values({
    orderId,
    lineType: "charge",
    sku: "WATCH",
    label: "AI 健康智能手表",
    unit: "块",
    quantity: 1,
    oneTimeUnitFen: 10_000,
    oneTimeSubtotalFen: 10_000,
    monthlyUnitFen: 0,
    monthlySubtotalFen: 0,
    locations: [],
  });
  if (input.withAttribution) {
    await client.db.insert(orderAttributions).values({
      orderId,
      beneficiaryId: base.sellerId,
      attributionRole: "primary",
      basisPoints: 10_000,
      beneficiarySnapshot: { displayName: "补提测试销售员" },
    });
  }
  if (input.withSnapshot) {
    await client.db.insert(orderCommissionSnapshots).values({
      orderId,
      policyVersionId: "00000000-0000-4000-8000-000000000599",
      eventKey: `activation:${orderId}`,
      totalFen: 0,
      calculationSnapshot: { seeded: true },
      createdAt,
    });
  }
  return orderId;
};

describe("提成补提", () => {
  it("按规则覆盖窗口为已生效但无快照的订单补计提，并跳过整单退完与脏数据订单", async () => {
    const client = await setupDatabase("hfttr-ledger-backfill-");
    const base = await seedBase(client);
    // 政策从 1 月 1 日起生效，保证窗口内（1~3 月）激活的订单在计提时点能解析到规则。
    const policyStart = new Date("2026-01-01T00:00:00.000Z");
    await client.db.insert(commissionPolicyVersions).values({
      id: "00000000-0000-4000-8000-000000000591",
      policyCode: "HAINAN_DEVICE_COMMISSION",
      versionNo: 1,
      name: "补提前的现行规则",
      status: "published",
      effectiveFrom: policyStart,
      createdBy: base.adminId,
      publishedBy: base.adminId,
      publishedAt: policyStart,
      changeNote: "补提前的现行规则",
    });
    await client.db.insert(commissionRules).values({
      id: "00000000-0000-4000-8000-000000000592",
      policyVersionId: "00000000-0000-4000-8000-000000000591",
      ruleCode: "BFILL-WATCH",
      ruleName: "补提测试手表提成",
      businessDomain: "heartlink",
      targetType: "product",
      targetSku: "WATCH",
      paymentModeScope: "all",
      calculationBasis: "per_unit",
      packageMode: "additive",
      amountFen: 1_000,
      effectiveFrom: policyStart,
      createdBy: base.adminId,
    });

    const inWindowSigned = await seedOrder(client, base, { suffix: "11", status: "signed", activatedAt: new Date("2026-02-10T02:00:00.000Z"), withAttribution: true });
    const inWindowPaid = await seedOrder(client, base, { suffix: "12", status: "paid", activatedAt: new Date("2026-02-12T02:00:00.000Z"), withAttribution: true });
    const missingAttribution = await seedOrder(client, base, { suffix: "13", status: "reconciled", activatedAt: new Date("2026-02-14T02:00:00.000Z"), withAttribution: false });
    const outsideWindow = await seedOrder(client, base, { suffix: "14", status: "activated", activatedAt: new Date("2026-04-01T02:00:00.000Z"), withAttribution: true });
    const stillAccepted = await seedOrder(client, base, { suffix: "15", status: "accepted", activatedAt: null, withAttribution: true });
    const fullyReturned = await seedOrder(client, base, { suffix: "16", status: "returned", activatedAt: new Date("2026-02-20T02:00:00.000Z"), withAttribution: true });

    const ledgerService = createCommissionLedgerService({
      repository: new DrizzleCommissionLedgerRepository(client),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });
    const report = await ledgerService.backfillForPolicyWindow({
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-03-01T00:00:00.000Z",
    });
    expect(report.accrued).toBe(2);
    expect(report.skipped).toEqual([
      { orderId: missingAttribution, reason: "订单缺少销售归属" },
    ]);

    for (const orderId of [inWindowSigned, inWindowPaid]) {
      const [snapshot] = await client.db.select().from(orderCommissionSnapshots).where(eq(orderCommissionSnapshots.orderId, orderId));
      expect(snapshot).toMatchObject({
        policyVersionId: "00000000-0000-4000-8000-000000000591",
        totalFen: 1_000,
      });
      const entries = await client.db.select().from(commissionLedger).where(eq(commissionLedger.orderId, orderId));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ amountFen: 1_000, entryType: "accrual", beneficiaryId: base.sellerId });
    }
    for (const orderId of [outsideWindow, stillAccepted, fullyReturned, missingAttribution]) {
      const snapshots = await client.db.select().from(orderCommissionSnapshots).where(eq(orderCommissionSnapshots.orderId, orderId));
      expect(snapshots).toHaveLength(0);
    }

    const rerun = await ledgerService.backfillForPolicyWindow({
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-03-01T00:00:00.000Z",
    });
    expect(rerun.accrued).toBe(0);
    await client.close();
  });

  it("发布回填历史空窗的规则版本时自动补提", async () => {
    const client = await setupDatabase("hfttr-publish-backfill-");
    const base = await seedBase(client);
    const legacySigned = await seedOrder(client, base, { suffix: "21", status: "signed", activatedAt: new Date("2026-02-10T02:00:00.000Z"), withAttribution: true });
    const afterGap = await seedOrder(client, base, { suffix: "22", status: "activated", activatedAt: new Date("2026-04-01T02:00:00.000Z"), withAttribution: true });

    const ledgerService = createCommissionLedgerService({
      repository: new DrizzleCommissionLedgerRepository(client),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
    });
    const ruleService = createCommissionRuleService({
      repository: new DrizzleCommissionRuleRepository(client),
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      onPublished: (version) =>
        ledgerService.backfillForPolicyWindow({
          effectiveFrom: version.effectiveFrom,
          effectiveTo: version.effectiveTo,
        }),
    });
    const admin: AuthenticatedUser = { id: base.adminId, displayName: "补提测试管理员", role: "admin", storeId: null, mustChangePassword: false };

    const draft = await ruleService.createDraft(admin, {
      name: "回填空窗规则",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-03-01",
      rules: [
        { sku: "WATCH", amountFen: 800, paymentMode: "all", scope: { kind: "global" }, enabled: true },
      ],
      reason: "为规则空窗期订单补建提成规则",
    });
    const published = await ruleService.publish(admin, draft.id, "发布回填规则");
    expect(published.effectiveFrom).toBe(new Date("2026-01-01T00:00:00+08:00").toISOString());

    const [legacySnapshot] = await client.db.select().from(orderCommissionSnapshots).where(eq(orderCommissionSnapshots.orderId, legacySigned));
    expect(legacySnapshot).toMatchObject({ totalFen: 800 });
    const entries = await client.db.select().from(commissionLedger).where(eq(commissionLedger.orderId, legacySigned));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amountFen: 800, entryType: "accrual" });

    const afterGapSnapshots = await client.db.select().from(orderCommissionSnapshots).where(eq(orderCommissionSnapshots.orderId, afterGap));
    expect(afterGapSnapshots).toHaveLength(0);
    await client.close();
  });
});
