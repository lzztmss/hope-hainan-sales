import { resolve } from "node:path";
import { createDatabaseClient } from "../server/db/client.js";
import { calculateQuote } from "../shared/pricing/quoteEngine.js";
import type { QuoteInput } from "../shared/pricing/types.js";

/**
 * 为大区经理验收准备大批量、跨 M1~M6 的营业厅订单。
 * 只允许写入当前本地测试服务使用的 .local/acceptance.sqlite。
 * 默认 50,000 笔，每批 500 笔提交。
 */
const sqlitePath = process.env.SQLITE_PATH?.trim()
  || process.env.ACCEPTANCE_SQLITE_PATH?.trim()
  || "./.local/acceptance.sqlite";
const databasePath = resolve(sqlitePath.replace(/^file:/, ""));
const expectedDatabasePath = resolve(process.cwd(), ".local/acceptance.sqlite");
if (databasePath !== expectedDatabasePath) {
  throw new Error(`为避免误写其他数据，此脚本只允许操作当前测试库：${expectedDatabasePath}\n实际收到：${databasePath}`);
}

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=", 2);
  return [key, value ?? "true"] as const;
}));
const total = Math.min(Math.max(Number(args.get("count") ?? 50_000), 1), 50_000);
const batchSize = Math.min(Math.max(Number(args.get("batch") ?? 500), 50), 2_000);
const managerWorkNo = args.get("manager") ?? "REGIONAL";
const storeCode = args.get("store") ?? "ACCEPT001";
const sellerWorkNo = args.get("seller") ?? "SALE";
if (!Number.isInteger(total) || !Number.isInteger(batchSize)) throw new Error("count/batch 必须是整数");

const client = createDatabaseClient(databasePath);
const DAY = 86_400_000;
const addMonths = (source: string, months: number) => {
  const [year, month, day] = source.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
};
const uuid = (kind: number, index: number, line = 0) =>
  `${kind.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(8, "0")}${line.toString(16).padStart(4, "0")}`;
const json = (value: unknown) => JSON.stringify(value);

try {
  const store = client.raw.prepare("SELECT id, code, name FROM stores WHERE code = ? LIMIT 1").get(storeCode) as { id: string; code: string; name: string } | undefined;
  const seller = client.raw.prepare("SELECT id, work_no, display_name FROM users WHERE work_no = ? AND role = 'sales' LIMIT 1").get(sellerWorkNo) as { id: string; work_no: string; display_name: string } | undefined;
  const manager = client.raw.prepare("SELECT id, employment_start_date FROM users WHERE work_no = ? AND role = 'regional_manager' LIMIT 1").get(managerWorkNo) as { id: string; employment_start_date: string | null } | undefined;
  if (!store) throw new Error(`测试营业厅不存在：${storeCode}`);
  if (!seller || !manager?.employment_start_date) throw new Error(`测试账号或大区经理入职日不存在：seller=${sellerWorkNo}, manager=${managerWorkNo}`);
  const managesStore = client.raw.prepare(`SELECT 1 FROM regional_manager_store_history
    WHERE regional_manager_id = ? AND store_id = ? LIMIT 1`).get(manager.id, store.id);
  if (!managesStore) throw new Error(`${managerWorkNo} 没有 ${storeCode} 的历史管理关系，导入后不会计入该经理`);

  const patterns: QuoteInput[] = [
    { mode: "one_time", fttrPlan: null, selection: { watch: 1 } },
    { mode: "one_time", fttrPlan: null, selection: { mattress: 1 } },
    { mode: "one_time", fttrPlan: null, selection: { gateway: 1, motion: 2 } },
    { mode: "one_time", fttrPlan: null, selection: { door: 1, wallButton: 1 } },
    { mode: "contract_36", fttrPlan: 159, selection: { homeDual: 1 } },
  ];
  const hireDate = manager.employment_start_date;
  const now = Date.now();
  const insertCustomer = client.raw.prepare(`INSERT OR IGNORE INTO customers
    (id, store_id, owner_user_id, name_encrypted, phone_encrypted, phone_lookup_hash, phone_tail, room_type, elder_count, source, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'two_bedroom', 2, '大区经理50K验收压测', ?, ?, ?)`);
  const insertQuote = client.raw.prepare(`INSERT OR IGNORE INTO quotes
    (id, quote_no, idempotency_key, customer_id, store_id, seller_id, status, payment_mode, fttr_kind, fttr_plan, custom_fttr_note, fttr_monthly_fen, heart_monthly_fen, one_time_fen, monthly_total_fen, contract_36_fen, catalog_version, customer_snapshot, quote_snapshot, confirmed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'converted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertQuoteLine = client.raw.prepare(`INSERT OR IGNORE INTO quote_lines
    (id, quote_id, line_type, sku, label, unit, quantity, one_time_unit_fen, monthly_unit_fen, one_time_subtotal_fen, monthly_subtotal_fen, locations, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertOrder = client.raw.prepare(`INSERT OR IGNORE INTO orders
    (id, order_no, idempotency_key, quote_id, customer_id, store_id, seller_id, status, sales_channel, payment_mode, fttr_kind, fttr_plan, custom_fttr_note, fttr_monthly_fen, heart_monthly_fen, one_time_fen, monthly_total_fen, contract_36_fen, catalog_version, catalog_snapshot, customer_snapshot, quote_snapshot, store_snapshot, seller_snapshot, created_by, accepted_at, activated_at, signed_at, signed_by, reconciled_at, reconciled_by, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'reconciled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 5, ?, ?)`);
  const insertOrderLine = client.raw.prepare(`INSERT OR IGNORE INTO order_lines
    (id, order_id, line_type, sku, label, unit, quantity, one_time_unit_fen, monthly_unit_fen, one_time_subtotal_fen, monthly_subtotal_fen, locations, reason, line_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertAttribution = client.raw.prepare(`INSERT OR IGNORE INTO order_attributions
    (id, order_id, beneficiary_id, attribution_role, basis_points, beneficiary_snapshot, created_at)
    VALUES (?, ?, ?, 'primary', 10000, ?, ?)`);

  let done = 0;
  for (let batchStart = 0; batchStart < total; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, total);
    client.raw.exec("BEGIN IMMEDIATE");
    try {
      for (let index = batchStart; index < batchEnd; index += 1) {
        const oneBased = index + 1;
        const pattern = patterns[index % patterns.length];
        const calculation = calculateQuote(pattern);
        const period = index % 6;
        const periodStart = new Date(`${addMonths(hireDate, period)}T00:00:00+08:00`);
        const periodEnd = new Date(new Date(`${addMonths(hireDate, period + 1)}T00:00:00+08:00`).getTime() - DAY);
        const daysInPeriod = Math.floor((periodEnd.getTime() - periodStart.getTime()) / DAY) + 1;
        const offsetDays = Math.floor(index / 6) % daysInPeriod;
        const effectiveAt = new Date(periodStart.getTime() + offsetDays * DAY + 10 * 60 * 60 * 1000);
        const signedAt = new Date(effectiveAt.getTime() - 7 * DAY);
        const createdAt = new Date(signedAt.getTime() - 2 * DAY);
        const reconciledAt = new Date(signedAt.getTime() + 8 * DAY);
        const customerId = uuid(0x10000000, oneBased);
        const quoteId = uuid(0x20000000, oneBased);
        const orderId = uuid(0x30000000, oneBased);
        const customerName = `大区验收客户${oneBased}`;
        const phone = `139${String(10000000 + oneBased).padStart(8, "0")}`;
        const snapshot = { nameEncrypted: customerName, phoneEncrypted: phone, phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`, roomType: "two_bedroom", elderCount: 2, source: "大区经理50K验收压测" };
        const quoteSnapshot = { catalogVersion: calculation.catalogVersion, pricingInput: pattern, calculation };
        insertCustomer.run(customerId, store.id, seller.id, customerName, phone, `test-phone-${oneBased}`, phone.slice(-4), seller.id, createdAt.getTime(), createdAt.getTime());
        insertQuote.run(quoteId, `XLX-ACCEPT-50K-${String(oneBased).padStart(5, "0")}`, `acceptance-regional-50k-${oneBased}`, customerId, store.id, seller.id, calculation.mode, calculation.fttrKind, calculation.fttrPlan, calculation.customFttrNote, calculation.fttrMonthlyFen, calculation.heartMonthlyFen, calculation.oneTimeFen, calculation.monthlyTotalFen, calculation.contract36Fen, calculation.catalogVersion, json(snapshot), json(quoteSnapshot), createdAt.getTime(), createdAt.getTime(), createdAt.getTime());
        const lines = [...calculation.chargeLines.map((line) => ({ ...line, lineType: "charge" as const, sku: line.sku, locations: [] as string[] })), ...calculation.componentLines.map((line) => ({ ...line, lineType: "component" as const, sku: line.componentId }))];
        lines.forEach((line, lineIndex) => {
          const lineId = uuid(0x40000000 + lineIndex, oneBased);
          insertQuoteLine.run(lineId, quoteId, line.lineType, line.sku, line.label, line.unit, line.quantity, line.oneTimeUnitFen, line.monthlyUnitFen, line.oneTimeSubtotalFen, line.monthlySubtotalFen, json(line.locations ?? []), line.reason ?? null, createdAt.getTime());
        });
        insertOrder.run(orderId, `XLXDD-ACCEPT-50K-${String(oneBased).padStart(5, "0")}`, `acceptance-regional-order-50k-${oneBased}`, quoteId, customerId, store.id, seller.id, index % 5 === 4 ? "online" : "offline", calculation.mode, calculation.fttrKind, calculation.fttrPlan, calculation.customFttrNote, calculation.fttrMonthlyFen, calculation.heartMonthlyFen, calculation.oneTimeFen, calculation.monthlyTotalFen, calculation.contract36Fen, calculation.catalogVersion, json(quoteSnapshot), json(snapshot), json(quoteSnapshot), json({ id: store.id, code: store.code, name: store.name }), json({ id: seller.id, workNo: seller.work_no, displayName: seller.display_name }), seller.id, createdAt.getTime(), new Date(signedAt.getTime() - DAY).getTime(), signedAt.getTime(), seller.id, reconciledAt.getTime(), seller.id, createdAt.getTime(), reconciledAt.getTime());
        lines.forEach((line, lineIndex) => {
          insertOrderLine.run(uuid(0x50000000 + lineIndex, oneBased), orderId, line.lineType, line.sku, line.label, line.unit, line.quantity, line.oneTimeUnitFen, line.monthlyUnitFen, line.oneTimeSubtotalFen, line.monthlySubtotalFen, json(line.locations ?? []), line.reason ?? null, json(line), createdAt.getTime());
        });
        insertAttribution.run(uuid(0x60000000, oneBased), orderId, seller.id, json({ id: seller.id, workNo: seller.work_no, displayName: seller.display_name }), createdAt.getTime());
      }
      client.raw.exec("COMMIT");
      done = batchEnd;
      console.log(`已导入 ${done}/${total} 笔（最近提交 ${batchEnd - batchStart} 笔）`);
    } catch (error) {
      client.raw.exec("ROLLBACK");
      throw error;
    }
  }
  console.log(`完成：${done} 笔。日期按 ${managerWorkNo} 入职日 ${hireDate} 分布到 M1~M6。耗时约 ${(Date.now() - now) / 1000}s`);
} finally {
  await client.close();
}
