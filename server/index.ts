import "dotenv/config";
import { buildApp } from "./app.js";
import { createAuthService } from "./auth/authService.js";
import { DrizzleAuthRepository } from "./auth/authRepository.js";
import { createAdminService } from "./admin/adminService.js";
import { DrizzleAdminRepository } from "./admin/adminRepository.js";
import { DrizzleCommissionRuleRepository } from "./commissions/ruleRepository.js";
import { createCommissionRuleService } from "./commissions/ruleService.js";
import { DrizzleCommissionLedgerRepository } from "./commissions/ledgerRepository.js";
import { createCommissionLedgerService } from "./commissions/ledgerService.js";
import { DrizzleCommissionDashboardRepository } from "./commissions/dashboardRepository.js";
import { createCommissionDashboardService } from "./commissions/dashboardService.js";
import { createDatabaseClient } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";
import { DrizzleOrderRepository } from "./orders/orderRepository.js";
import { createOrderService } from "./orders/orderService.js";
import { createOrderExportService } from "./orders/orderExportService.js";
import { DrizzleQuoteRepository } from "./quotes/quoteRepository.js";
import { createQuoteService } from "./quotes/quoteService.js";
import { DrizzleReturnRepository } from "./returns/returnRepository.js";
import { createReturnService } from "./returns/returnService.js";
import { DrizzleSalesReportRepository } from "./reports/salesReportRepository.js";
import { createSalesReportService } from "./reports/salesReportService.js";
import { createPiiProtector } from "./security/pii.js";
import { DrizzleCustomerRepository } from "./customers/customerRepository.js";
import { createCustomerService } from "./customers/customerService.js";
import { ACTIVE_CATALOG } from "../shared/pricing/catalog.js";
import { RegionalCommissionService } from "./regionalCommissions/regionalCommissionService.js";
import { DrizzleSubscriptionPlanRepository } from "./plans/planRepository.js";
import { createSubscriptionPlanService } from "./plans/planService.js";

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少必需环境变量：${name}`);
  return value;
};

const decodeKey = (name: string): Buffer => {
  const key = Buffer.from(requiredEnvironment(name), "base64");
  if (key.byteLength !== 32) throw new Error(`${name}必须解码为32字节`);
  return key;
};

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const sqlitePath = requiredEnvironment("SQLITE_PATH");
if (process.env.NODE_ENV !== "production") {
  await migrateDatabase(sqlitePath);
}
const databaseClient = createDatabaseClient(sqlitePath);
const pii = createPiiProtector({
  encryptionKey: decodeKey("PII_ENCRYPTION_KEY_BASE64"),
  lookupKey: decodeKey("PII_LOOKUP_HMAC_KEY_BASE64"),
});
const authService = createAuthService({
  repository: new DrizzleAuthRepository(databaseClient.db),
  phoneLookupHash: pii.phoneLookupHash,
});
const planService = createSubscriptionPlanService({
  repository: new DrizzleSubscriptionPlanRepository(databaseClient),
});
const quoteService = createQuoteService({
  repository: new DrizzleQuoteRepository(databaseClient),
  pii,
  plans: planService,
});
const commissionLedgerService = createCommissionLedgerService({
  repository: new DrizzleCommissionLedgerRepository(databaseClient),
});
const commissionRuleService = createCommissionRuleService({
  repository: new DrizzleCommissionRuleRepository(databaseClient),
  // 规则发布（含生效日回填到历史空窗）后自动为覆盖区间内已生效但无提成
  // 快照的订单补计提。
  onPublished: (version) =>
    commissionLedgerService.backfillForPolicyWindow({
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
    }),
});
const commissionDashboardService = createCommissionDashboardService({
  repository: new DrizzleCommissionDashboardRepository(databaseClient),
  decryptPii: pii.decryptPii,
});
const orderRepository = new DrizzleOrderRepository(databaseClient);
const returnRepository = new DrizzleReturnRepository(databaseClient);
const orderService = createOrderService({
  repository: orderRepository,
  activeCatalogVersion: ACTIVE_CATALOG.version,
  decryptPii: pii.decryptPii,
  commissionAccrual: commissionLedgerService,
});
const returnService = createReturnService({
  repository: returnRepository,
  commissionReversal: commissionLedgerService,
});
const orderExportService = createOrderExportService({
  orderService,
  returnRepository,
});
const adminService = createAdminService({
  repository: new DrizzleAdminRepository(databaseClient),
  pii,
});
const salesReportService = createSalesReportService({
  repository: new DrizzleSalesReportRepository(databaseClient),
});
const customerService = createCustomerService({
  repository: new DrizzleCustomerRepository(databaseClient),
  decryptPii: pii.decryptPii,
});
const app = buildApp({
  authService,
  quoteService,
  commissionRuleService,
  commissionDashboardService,
  orderService,
  orderExportService,
  returnService,
  adminService,
  salesReportService,
  customerService,
  regionalCommissionService: new RegionalCommissionService(databaseClient),
  planService,
  appOrigin: requiredEnvironment("APP_ORIGIN"),
  secureCookies: process.env.NODE_ENV === "production",
  onClose: () => databaseClient.close(),
});

const shutdown = async (): Promise<void> => {
  await app.close();
};

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
