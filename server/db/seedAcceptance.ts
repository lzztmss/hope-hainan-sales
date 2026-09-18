import { hash } from "@node-rs/argon2";
import { eq, inArray } from "drizzle-orm";

import { calculateQuote } from "../../shared/pricing/quoteEngine.js";
import type { QuoteInput, SubscriptionPlanDefinition } from "../../shared/pricing/types.js";
import { DEFAULT_REGIONAL_COMMISSION_RULES } from "../../shared/regionalCommission/types.js";
import { createPiiProtector, maskPhone } from "../security/pii.js";
import { migrateDatabase } from "./migrate.js";
import { createDatabaseClient } from "./client.js";
import {
  auditLogs,
  customers,
  orderAttributions,
  orderLines,
  orders,
  quoteLines,
  quotes,
  regionalCommissionTemplateAssignments,
  regionalCommissionTemplateVersions,
  regionalManagerStoreHistory,
  regionalManagerStores,
  stores,
  subscriptionPlanItems,
  subscriptionPlans,
  users,
} from "./schema.js";
import { seedBootstrapAdmin } from "./seed.js";

const sqlitePath = process.env.ACCEPTANCE_SQLITE_PATH?.trim();
const password = process.env.ACCEPTANCE_PASSWORD ?? "11223344";

if (!sqlitePath) {
  throw new Error("ACCEPTANCE_SQLITE_PATH 未配置");
}
if (!/(^|[/\\])acceptance(?:[.-]|$)/i.test(sqlitePath)) {
  throw new Error("验收库文件名必须以 acceptance 开头，避免误写日常数据库");
}
if (password.length < 8 || password.length > 128) {
  throw new Error("ACCEPTANCE_PASSWORD 长度必须为 8 至 128 个字符");
}

const decodeKey = (name: string): Buffer => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new Error(`${name} 必须解码为 32 字节`);
  return key;
};

const pii = createPiiProtector({
  encryptionKey: decodeKey("PII_ENCRYPTION_KEY_BASE64"),
  lookupKey: decodeKey("PII_LOOKUP_HMAC_KEY_BASE64"),
});

await migrateDatabase(sqlitePath);
await seedBootstrapAdmin({
  sqlitePath,
  username: "admin",
  password: "AcceptanceBootstrap123",
});

const client = createDatabaseClient(sqlitePath);
try {
  const passwordHash = await hash(password);
  const now = new Date();
  const [headquarters] = await client.db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.code, "HQ"))
    .limit(1);
  if (!headquarters) throw new Error("公司总部初始化失败");

  const [acceptanceStore] = await client.db
    .insert(stores)
    .values({ code: "ACCEPT001", name: "海口验收营业厅" })
    .onConflictDoUpdate({
      target: stores.code,
      set: { name: "海口验收营业厅", active: true, updatedAt: now },
    })
    .returning({ id: stores.id });
  if (!acceptanceStore) throw new Error("验收营业厅初始化失败");

  await client.db
    .update(users)
    .set({ active: false, isPrimaryStoreManager: false, updatedAt: now })
    .where(inArray(users.workNo, ["ADMIN001", "MANAGER001", "SALES001"]));

  await client.db
    .insert(users)
    .values({
      workNo: "ADMIN",
      displayName: "验收管理员",
      passwordHash,
      role: "admin",
      personnelType: "admin",
      storeId: headquarters.id,
      active: true,
      mustChangePassword: false,
    })
    .onConflictDoUpdate({
      target: users.workNo,
      set: {
        displayName: "验收管理员",
        passwordHash,
        role: "admin",
        personnelType: "admin",
        storeId: headquarters.id,
        active: true,
        mustChangePassword: false,
        isPrimaryStoreManager: false,
        updatedAt: now,
      },
    });

  await client.db
    .update(users)
    .set({ isPrimaryStoreManager: false, updatedAt: now })
    .where(eq(users.storeId, acceptanceStore.id));

  await client.db
    .insert(users)
    .values({
      workNo: "MANAGE",
      displayName: "验收营业厅经理",
      passwordHash,
      role: "store_manager",
      personnelType: "unicom",
      storeId: acceptanceStore.id,
      active: true,
      mustChangePassword: false,
      isPrimaryStoreManager: true,
    })
    .onConflictDoUpdate({
      target: users.workNo,
      set: {
        displayName: "验收营业厅经理",
        passwordHash,
        role: "store_manager",
        personnelType: "unicom",
        storeId: acceptanceStore.id,
        active: true,
        mustChangePassword: false,
        isPrimaryStoreManager: true,
        updatedAt: now,
      },
    });

  await client.db
    .insert(users)
    .values({
      workNo: "SALE",
      displayName: "验收营业员",
      passwordHash,
      role: "sales",
      personnelType: "unicom",
      storeId: acceptanceStore.id,
      active: true,
      mustChangePassword: false,
    })
    .onConflictDoUpdate({
      target: users.workNo,
      set: {
        displayName: "验收营业员",
        passwordHash,
        role: "sales",
        personnelType: "unicom",
        storeId: acceptanceStore.id,
        active: true,
        mustChangePassword: false,
        isPrimaryStoreManager: false,
        updatedAt: now,
      },
    });

  for (const account of [
    { workNo: "HR", displayName: "验收人力资源", role: "hr" as const },
    {
      workNo: "FINANCE",
      displayName: "验收财务",
      role: "finance" as const,
    },
  ]) {
    await client.db
      .insert(users)
      .values({
        ...account,
        passwordHash,
        personnelType: "admin",
        storeId: null,
        active: true,
        mustChangePassword: false,
      })
      .onConflictDoUpdate({
        target: users.workNo,
        set: {
          displayName: account.displayName,
          passwordHash,
          role: account.role,
          personnelType: "admin",
          storeId: null,
          active: true,
          mustChangePassword: false,
          isPrimaryStoreManager: false,
          updatedAt: now,
        },
      });
  }

  const [admin] = await client.db.select({ id: users.id }).from(users).where(eq(users.workNo, "ADMIN")).limit(1);
  const [regional] = await client.db.insert(users).values({
    workNo: "REGIONAL", displayName: "验收大区经理", passwordHash,
    role: "regional_manager", personnelType: "admin", storeId: null,
    employmentStartDate: "2026-01-15", active: true, mustChangePassword: false,
  }).onConflictDoUpdate({ target: users.workNo, set: { passwordHash, active: true, mustChangePassword: false, updatedAt: now } }).returning({ id: users.id });
  if (!admin || !regional) throw new Error("验收大区账号初始化失败");
  await client.db.insert(regionalManagerStores).values({ regionalManagerId: regional.id, storeId: acceptanceStore.id }).onConflictDoNothing();
  await client.db.insert(regionalManagerStoreHistory).values({ regionalManagerId: regional.id, storeId: acceptanceStore.id, effectiveFrom: new Date("2026-01-15T00:00:00+08:00") }).onConflictDoNothing();
  const acceptanceRules = {
    ...DEFAULT_REGIONAL_COMMISSION_RULES,
    targetCycle: { ...DEFAULT_REGIONAL_COMMISSION_RULES.targetCycle, startsOn: "2026-01-15" },
  };
  const [template] = await client.db.insert(regionalCommissionTemplateVersions).values({ templateCode: "REGIONAL_DEFAULT", versionNo: 1, name: "海南大区经理默认提成", status: "published", effectiveFrom: "2026-01-15", rulesSnapshot: acceptanceRules as unknown as Record<string, unknown>, createdBy: admin.id, publishedBy: admin.id, publishedAt: now, changeReason: "验收预置" }).onConflictDoNothing().returning({ id: regionalCommissionTemplateVersions.id });
  if (template) await client.db.insert(regionalCommissionTemplateAssignments).values({ regionalManagerId: regional.id, templateVersionId: template.id, effectiveFrom: "2026-01-15", assignedBy: admin.id, reason: "验收预置" });

  const [seller] = await client.db.select({
    id: users.id,
    displayName: users.displayName,
    workNo: users.workNo,
  }).from(users).where(eq(users.workNo, "SALE")).limit(1);
  if (!seller) throw new Error("验收营业员初始化失败");

  const acceptancePlanId = "40000000-0000-4000-8000-000000000001";
  const [acceptancePlanRow] = await client.db.insert(subscriptionPlans).values({
    id: acceptancePlanId,
    code: "ACCEPT_A",
    name: "验收月付套餐A",
    monthlyFen: 15_900,
    contractMonths: 36,
    active: true,
    createdBy: admin.id,
  }).onConflictDoUpdate({
    target: subscriptionPlans.code,
    set: { name: "验收月付套餐A", monthlyFen: 15_900, active: true, updatedAt: now },
  }).returning();
  if (!acceptancePlanRow) throw new Error("验收月付套餐初始化失败");
  await client.db.delete(subscriptionPlanItems).where(eq(subscriptionPlanItems.planId, acceptancePlanRow.id));
  await client.db.insert(subscriptionPlanItems).values([
    { planId: acceptancePlanRow.id, productSku: "GATEWAY", quantity: 1 },
    { planId: acceptancePlanRow.id, productSku: "MOTION", quantity: 1 },
    { planId: acceptancePlanRow.id, productSku: "WALL_BUTTON", quantity: 1 },
  ]);
  const acceptancePlan: SubscriptionPlanDefinition = {
    id: acceptancePlanRow.id,
    code: acceptancePlanRow.code,
    name: acceptancePlanRow.name,
    description: acceptancePlanRow.description,
    monthlyFen: acceptancePlanRow.monthlyFen,
    contractMonths: 36,
    active: true,
    version: acceptancePlanRow.version,
    items: [
      { sku: "GATEWAY", quantity: 1 },
      { sku: "MOTION", quantity: 1 },
      { sku: "WALL_BUTTON", quantity: 1 },
    ],
  };

  const orderFixtures: readonly {
    suffix: string;
    customerName: string;
    phone: string;
    signedOn: string;
    pricing: QuoteInput;
  }[] = [
    { suffix: "01", customerName: "测试客户甲", phone: "13800001001", signedOn: "2026-07-18", pricing: { mode: "one_time", subscriptionPlanId: null, selection: { watch: 1 } } },
    { suffix: "02", customerName: "测试客户乙", phone: "13800001002", signedOn: "2026-08-02", pricing: { mode: "one_time", subscriptionPlanId: null, selection: { mattress: 1 } } },
    { suffix: "03", customerName: "测试客户丙", phone: "13800001003", signedOn: "2026-08-12", pricing: { mode: "one_time", subscriptionPlanId: null, selection: { oneKey: 1 } } },
    { suffix: "04", customerName: "测试客户丁", phone: "13800001004", signedOn: "2026-08-20", pricing: { mode: "contract_36", subscriptionPlanId: acceptancePlan.id, selection: {} } },
    { suffix: "05", customerName: "测试客户戊", phone: "13800001005", signedOn: "2026-08-30", pricing: { mode: "one_time", subscriptionPlanId: null, selection: { gateway: 1, motion: 2 } } },
    { suffix: "06", customerName: "测试客户己", phone: "13800001006", signedOn: "2026-09-01", pricing: { mode: "one_time", subscriptionPlanId: null, selection: { door: 1, wallButton: 1 } } },
  ];

  let importedOrders = 0;
  await client.withTransaction(async (tx) => {
    for (const fixture of orderFixtures) {
      const numericSuffix = fixture.suffix.padStart(12, "0");
      const customerId = `10000000-0000-4000-8000-${numericSuffix}`;
      const quoteId = `20000000-0000-4000-8000-${numericSuffix}`;
      const orderId = `30000000-0000-4000-8000-${numericSuffix}`;
      const phoneEncrypted = pii.encryptPii(fixture.phone);
      const nameEncrypted = pii.encryptPii(fixture.customerName);
      const customerSnapshot = {
        nameEncrypted,
        phoneEncrypted,
        phoneMasked: maskPhone(fixture.phone),
        districtEncrypted: null,
        addressEncrypted: null,
        roomType: "two_bedroom",
        elderCount: 2,
        source: "大区提成验收数据",
        notesEncrypted: null,
      };
      const calculation = calculateQuote(
        fixture.pricing,
        undefined,
        fixture.pricing.mode === "contract_36" ? acceptancePlan : null,
      );
      const quoteSnapshot = {
        catalogVersion: calculation.catalogVersion,
        pricingInput: fixture.pricing,
        calculation,
      };
      const signedAt = new Date(`${fixture.signedOn}T10:00:00+08:00`);
      const createdAt = new Date(signedAt.getTime() - 2 * 86_400_000);
      const activatedAt = new Date(signedAt.getTime() - 86_400_000);
      const reconciledAt = fixture.suffix === "06"
        ? null
        : new Date(signedAt.getTime() + 8 * 86_400_000);

      await tx.insert(customers).values({
        id: customerId,
        storeId: acceptanceStore.id,
        ownerUserId: seller.id,
        nameEncrypted,
        phoneEncrypted,
        phoneLookupHash: pii.phoneLookupHash(fixture.phone),
        phoneTail: fixture.phone.slice(-4),
        roomType: "two_bedroom",
        elderCount: 2,
        source: "大区提成验收数据",
        createdBy: seller.id,
        createdAt,
        updatedAt: createdAt,
      }).onConflictDoNothing();
      const [createdQuote] = await tx.insert(quotes).values({
        id: quoteId,
        quoteNo: `XLX-ACCEPT-REGIONAL-${fixture.suffix}`,
        idempotencyKey: `acceptance-regional-quote-${fixture.suffix}`,
        customerId,
        storeId: acceptanceStore.id,
        sellerId: seller.id,
        status: "converted",
        paymentMode: calculation.mode,
        subscriptionPlanId: calculation.subscriptionPlan?.id ?? null,
        oneTimeFen: calculation.oneTimeFen,
        monthlyTotalFen: calculation.monthlyTotalFen,
        contract36Fen: calculation.contract36Fen,
        catalogVersion: calculation.catalogVersion,
        customerSnapshot,
        quoteSnapshot,
        confirmedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      }).onConflictDoNothing().returning({ id: quotes.id });
      if (createdQuote) {
        await tx.insert(quoteLines).values([
          ...calculation.chargeLines.map((line) => ({
            quoteId,
            lineType: "charge" as const,
            sku: line.sku,
            label: line.label,
            unit: line.unit,
            quantity: line.quantity,
            oneTimeUnitFen: line.oneTimeUnitFen,
            monthlyUnitFen: line.monthlyUnitFen,
            oneTimeSubtotalFen: line.oneTimeSubtotalFen,
            monthlySubtotalFen: line.monthlySubtotalFen,
            locations: [],
          })),
          ...calculation.componentLines.map((line) => ({
            quoteId,
            lineType: "component" as const,
            sku: line.componentId,
            label: line.label,
            unit: line.unit,
            quantity: line.quantity,
            oneTimeUnitFen: 0,
            monthlyUnitFen: 0,
            oneTimeSubtotalFen: 0,
            monthlySubtotalFen: 0,
            locations: line.locations,
            reason: line.reason,
          })),
        ]);
      }
      const [createdOrder] = await tx.insert(orders).values({
        id: orderId,
        orderNo: `XLXDD-ACCEPT-REGIONAL-${fixture.suffix}`,
        idempotencyKey: `acceptance-regional-order-${fixture.suffix}`,
        quoteId,
        customerId,
        storeId: acceptanceStore.id,
        sellerId: seller.id,
        status: reconciledAt ? "reconciled" : "signed",
        salesChannel: fixture.suffix === "04" ? "online" : "offline",
        paymentMode: calculation.mode,
        subscriptionPlanId: calculation.subscriptionPlan?.id ?? null,
        oneTimeFen: calculation.oneTimeFen,
        monthlyTotalFen: calculation.monthlyTotalFen,
        contract36Fen: calculation.contract36Fen,
        catalogVersion: calculation.catalogVersion,
        catalogSnapshot: quoteSnapshot,
        customerSnapshot,
        quoteSnapshot,
        storeSnapshot: { id: acceptanceStore.id, code: "ACCEPT001", name: "海口验收营业厅" },
        sellerSnapshot: { id: seller.id, workNo: seller.workNo, displayName: seller.displayName },
        createdBy: seller.id,
        acceptedAt: createdAt,
        activatedAt,
        signedAt,
        signedBy: seller.id,
        reconciledAt,
        reconciledBy: reconciledAt ? admin.id : null,
        version: reconciledAt ? 5 : 4,
        createdAt,
        updatedAt: reconciledAt ?? signedAt,
      }).onConflictDoNothing().returning({ id: orders.id });
      if (!createdOrder) continue;
      importedOrders += 1;
      await tx.insert(orderLines).values([
        ...calculation.chargeLines.map((line) => ({
          orderId,
          lineType: "charge" as const,
          sku: line.sku,
          label: line.label,
          unit: line.unit,
          quantity: line.quantity,
          oneTimeUnitFen: line.oneTimeUnitFen,
          monthlyUnitFen: line.monthlyUnitFen,
          oneTimeSubtotalFen: line.oneTimeSubtotalFen,
          monthlySubtotalFen: line.monthlySubtotalFen,
          locations: [],
          lineSnapshot: line as unknown as Record<string, unknown>,
        })),
        ...calculation.componentLines.map((line) => ({
          orderId,
          lineType: "component" as const,
          sku: line.componentId,
          label: line.label,
          unit: line.unit,
          quantity: line.quantity,
          oneTimeUnitFen: 0,
          monthlyUnitFen: 0,
          oneTimeSubtotalFen: 0,
          monthlySubtotalFen: 0,
          locations: line.locations,
          reason: line.reason,
          lineSnapshot: line as unknown as Record<string, unknown>,
        })),
      ]);
      await tx.insert(orderAttributions).values({
        orderId,
        beneficiaryId: seller.id,
        attributionRole: "primary",
        basisPoints: 10_000,
        beneficiarySnapshot: { id: seller.id, workNo: seller.workNo, displayName: seller.displayName },
      });
      await tx.insert(auditLogs).values([
        { actorUserId: seller.id, storeId: acceptanceStore.id, entityType: "order", entityId: orderId, action: "order.create", reason: "验收测试订单", createdAt },
        { actorUserId: seller.id, storeId: acceptanceStore.id, entityType: "order", entityId: orderId, action: "order.sign", reason: "验收测试签收", createdAt: signedAt },
        ...(reconciledAt ? [{ actorUserId: admin.id, storeId: acceptanceStore.id, entityType: "order", entityId: orderId, action: "order.reconcile", reason: "验收测试对账", createdAt: reconciledAt }] : []),
      ]);
    }
  });

  console.log(`验收数据已就绪：admin / manage / sale / regional / hr / finance；新增 ${importedOrders} 笔大区提成测试订单`);
} finally {
  await client.close();
}
