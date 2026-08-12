import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { QuoteInput } from "../../shared/pricing/types.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { createDatabaseClient } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import { stores, users } from "../db/schema.js";
import { DrizzleOrderRepository } from "../orders/orderRepository.js";
import { createOrderService } from "../orders/orderService.js";
import { createPiiProtector } from "../security/pii.js";
import { ACTIVE_CATALOG } from "../../shared/pricing/catalog.js";
import { DrizzleQuoteRepository } from "./quoteRepository.js";
import { createQuoteService } from "./quoteService.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const pricing = (watch: number): QuoteInput => ({
  mode: "contract_36",
  fttrPlan: 159,
  selection: { watch },
});

describe("SQLite 报价持久化主链路", () => {
  it("迁移后可保存、重启读取并编辑报价", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hfttr-quote-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "app.sqlite");
    await migrateDatabase(databasePath);

    const storeId = "00000000-0000-4000-8000-000000000001";
    const sellerId = "00000000-0000-4000-8000-000000000002";
    const seller: AuthenticatedUser = {
      id: sellerId,
      displayName: "测试销售员",
      role: "sales",
      storeId,
      storeName: "测试营业厅",
      mustChangePassword: false,
    };
    const pii = createPiiProtector({
      encryptionKey: Buffer.alloc(32, 1),
      lookupKey: Buffer.alloc(32, 2),
    });

    let client = createDatabaseClient(databasePath);
    await client.db.insert(stores).values({ id: storeId, code: "TEST001", name: "测试营业厅" });
    await client.db.insert(users).values({
      id: sellerId,
      workNo: "SELLER001",
      displayName: seller.displayName,
      passwordHash: "not-used-by-this-test",
      role: "sales",
      personnelType: "unicom",
      storeId,
      active: true,
      mustChangePassword: false,
    });
    let service = createQuoteService({
      repository: new DrizzleQuoteRepository(client),
      pii,
      now: () => new Date("2026-08-12T08:00:00.000Z"),
      randomSuffix: () => "SQL123",
    });
    const draft = (watch: number) => ({
      customer: {
        name: "王女士",
        phone: "13800138000",
        roomType: "two_bedroom" as const,
        elderCount: 2,
      },
      pricing: pricing(watch),
    });
    const created = await service.confirmQuote(seller, draft(1), "sqlite-quote-key-123456");
    await client.close();

    client = createDatabaseClient(databasePath);
    service = createQuoteService({ repository: new DrizzleQuoteRepository(client), pii });
    const loaded = await service.getQuote(seller, created.id);
    expect(loaded.customer.name).toBe("王女士");
    expect(loaded.version).toBe(1);

    const updated = await service.updateQuote(seller, created.id, draft(2), 1);
    expect(updated.quoteNo).toBe(created.quoteNo);
    expect(updated.version).toBe(2);
    expect(updated.calculation.heartMonthlyFen).toBeGreaterThan(
      loaded.calculation.heartMonthlyFen,
    );
    const list = await service.listQuotes(seller, { query: "王女士", limit: 50 });
    expect(list.items.map((quote) => quote.id)).toContain(created.id);

    const orderService = createOrderService({
      repository: new DrizzleOrderRepository(client),
      activeCatalogVersion: ACTIVE_CATALOG.version,
      commissionAccrual: { accrueForActivatedOrder: async () => undefined },
      now: () => new Date("2026-08-12T10:00:00.000Z"),
      randomSuffix: () => "ORD123",
    });
    const order = await orderService.createOrderFromQuote(
      seller,
      created.id,
      undefined,
      "sqlite-order-key-123456",
    );
    const duplicate = await orderService.createOrderFromQuote(
      seller,
      created.id,
      undefined,
      "sqlite-order-key-another",
    );
    expect(duplicate.id).toBe(order.id);
    const converted = await service.getQuote(seller, created.id);
    expect(converted.status).toBe("converted");
    expect(converted.version).toBe(2);
    await expect(service.updateQuote(seller, created.id, draft(3), 2)).rejects.toThrow(
      "当前报价已锁定",
    );
    await client.close();
  });
});
