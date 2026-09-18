import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createPiiProtector } from "../server/security/pii.js";

const databasePath = resolve(process.env.SQLITE_PATH?.trim() || "./.local/acceptance.sqlite");
const expectedPath = resolve(process.cwd(), ".local/acceptance.sqlite");
if (databasePath !== expectedPath) {
  throw new Error(`此修复脚本只允许操作当前验收库：${expectedPath}`);
}

const keyLines = readFileSync(resolve(process.cwd(), ".local/test-keys"), "utf8")
  .trim()
  .split(/\r?\n/);
const decode = (value: string | undefined, label: string) => {
  if (!value) throw new Error(`缺少 ${label}`);
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) throw new Error(`${label} 必须解码为32字节`);
  return key;
};
const pii = createPiiProtector({
  encryptionKey: decode(keyLines[0], "PII 加密密钥"),
  lookupKey: decode(keyLines[1], "PII 查询密钥"),
});

// better-sqlite3 是项目数据库客户端的底层驱动，脚本只在验收库上运行。
const { default: Database } = await import("better-sqlite3");
const db = new Database(databasePath);
const customers = db.prepare(`SELECT id, name_encrypted AS name, phone_encrypted AS phone
  FROM customers WHERE name_encrypted NOT LIKE 'v1.%' OR phone_encrypted NOT LIKE 'v1.%'`).all() as Array<{
  id: string;
  name: string;
  phone: string;
}>;
const updateCustomer = db.prepare(`UPDATE customers SET name_encrypted = ?, phone_encrypted = ?,
  phone_lookup_hash = ?, phone_tail = ?, updated_at = updated_at WHERE id = ?`);
const updateSnapshot = db.prepare(`UPDATE quotes SET customer_snapshot = ? WHERE customer_id = ?`);
const updateOrderSnapshot = db.prepare(`UPDATE orders SET customer_snapshot = ? WHERE customer_id = ?`);

const repair = db.transaction(() => {
  for (const customer of customers) {
    if (!/^1[3-9]\d{9}$/.test(customer.phone)) {
      throw new Error(`客户 ${customer.id} 的历史手机号格式不正确，未执行任何修复：${customer.phone}`);
    }
    const nameEncrypted = pii.encryptPii(customer.name);
    const phoneEncrypted = pii.encryptPii(customer.phone);
    updateCustomer.run(nameEncrypted, phoneEncrypted, pii.phoneLookupHash(customer.phone), customer.phone.slice(-4), customer.id);
    const customerSnapshotRows = db.prepare(`SELECT id, customer_snapshot FROM quotes WHERE customer_id = ?`).all(customer.id) as Array<{ id: string; customer_snapshot: Record<string, unknown> }>;
    for (const row of customerSnapshotRows) {
      const snapshot = typeof row.customer_snapshot === "string" ? JSON.parse(row.customer_snapshot) : row.customer_snapshot;
      updateSnapshot.run(JSON.stringify({ ...snapshot, nameEncrypted, phoneEncrypted, phoneMasked: `${customer.phone.slice(0, 3)}****${customer.phone.slice(-4)}` }), customer.id);
    }
    const orderSnapshotRows = db.prepare(`SELECT id, customer_snapshot FROM orders WHERE customer_id = ?`).all(customer.id) as Array<{ id: string; customer_snapshot: Record<string, unknown> }>;
    for (const row of orderSnapshotRows) {
      const snapshot = typeof row.customer_snapshot === "string" ? JSON.parse(row.customer_snapshot) : row.customer_snapshot;
      updateOrderSnapshot.run(JSON.stringify({ ...snapshot, nameEncrypted, phoneEncrypted, phoneMasked: `${customer.phone.slice(0, 3)}****${customer.phone.slice(-4)}` }), customer.id);
    }
  }
  return customers.length;
});

const repaired = repair();
db.close();
console.log(`已修复 ${repaired} 条验收客户的加密字段及报价/订单客户快照。`);
