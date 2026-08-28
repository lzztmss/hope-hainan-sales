import { basename, resolve } from "node:path";

import { createDatabaseClient } from "../server/db/client.js";

const sqlitePath = process.env.SQLITE_PATH?.trim();
if (!sqlitePath) throw new Error("请先配置 SQLITE_PATH，例如 ./data/acceptance.sqlite");

const absolutePath = resolve(sqlitePath.replace(/^file:/, ""));
if (!/^(?:acceptance|order-v2)(?:[.-]|$)/i.test(basename(absolutePath))) {
  throw new Error(`为避免误删正式数据，此脚本只允许操作 acceptance.sqlite 或 order-v2.sqlite：${absolutePath}`);
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const [command, orderNo, dateValue] = args;
if (!command || !orderNo || (command === "set-signed" && !dateValue)) {
  console.error(`用法：
  pnpm db:acceptance:order -- delete <订单号>
  pnpm db:acceptance:order -- set-signed <订单号> <ISO时间>

示例：
  pnpm db:acceptance:order -- delete XLXDD-20260826-62F702
  pnpm db:acceptance:order -- set-signed XLXDD-20260827-ABC123 2026-08-01T10:00:00+08:00`);
  process.exit(1);
}

const client = createDatabaseClient(absolutePath);
try {
  const order = client.raw
    .prepare("SELECT id, order_no, status FROM orders WHERE order_no = ? LIMIT 1")
    .get(orderNo) as { id: string; order_no: string; status: string } | undefined;
  if (!order) throw new Error(`找不到订单：${orderNo}`);

  if (command === "delete") {
    client.raw.exec("BEGIN IMMEDIATE");
    try {
      // 先移除引用提成流水的结算明细，再移除流水、售后、快照和订单。
      client.raw
        .prepare(`DELETE FROM settlement_items WHERE ledger_entry_id IN (
          SELECT id FROM commission_ledger
          WHERE order_id = ? OR return_id IN (SELECT id FROM returns WHERE order_id = ?)
        )`)
        .run(order.id, order.id);
      client.raw
        .prepare(`DELETE FROM commission_ledger
          WHERE order_id = ? OR return_id IN (SELECT id FROM returns WHERE order_id = ?)`)
        .run(order.id, order.id);
      client.raw.prepare("DELETE FROM returns WHERE order_id = ?").run(order.id);
      client.raw.prepare("DELETE FROM order_commission_snapshots WHERE order_id = ?").run(order.id);
      client.raw.prepare("DELETE FROM orders WHERE id = ?").run(order.id);
      client.raw.exec("COMMIT");
    } catch (error) {
      client.raw.exec("ROLLBACK");
      throw error;
    }
    console.log(`已从验收库删除订单：${order.order_no}`);
  } else if (command === "set-signed") {
    const signedAt = new Date(dateValue!);
    if (Number.isNaN(signedAt.getTime())) throw new Error(`时间格式无效：${dateValue}`);
    const result = client.raw
      .prepare(`UPDATE orders
        SET status = 'signed', signed_at = ?, signed_by = COALESCE(signed_by, seller_id), updated_at = ?, version = version + 1
        WHERE id = ?`)
      .run(signedAt.getTime(), Date.now(), order.id);
    if (result.changes !== 1) throw new Error("订单签收时间更新失败");
    console.log(`已将 ${order.order_no} 的签收时间改为：${signedAt.toISOString()}`);
    console.log("注意：该命令只修改测试时间，不会生成提成快照；请先按正常流程激活订单。");
  } else {
    throw new Error(`未知命令：${command}`);
  }
} finally {
  await client.close();
}
