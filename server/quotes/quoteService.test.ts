import { describe, expect, it } from "vitest";

import type { QuoteInput } from "../../shared/pricing/types.js";
import type { AuthenticatedUser, UserScope } from "../auth/authorization.js";
import {
  createQuoteService,
  type ConfirmedQuote,
  type CustomerWriteRecord,
  type QuoteListFilters,
  type QuoteRepository,
  type QuoteWriteRecord,
} from "./quoteService.js";

const seller: AuthenticatedUser = {
  id: "seller-1",
  displayName: "测试销售员",
  role: "sales",
  storeId: "store-1",
  mustChangePassword: false,
};

const nonSalesUsers: AuthenticatedUser[] = [
  {
    id: "manager-1",
    displayName: "测试厅经理",
    role: "store_manager",
    storeId: "store-1",
    mustChangePassword: false,
  },
  {
    id: "admin-1",
    displayName: "测试管理员",
    role: "admin",
    storeId: null,
    mustChangePassword: false,
  },
];

const pricing = (watch: number): QuoteInput => ({
  mode: "contract_36",
  fttrPlan: 159,
  selection: { watch },
});

class MemoryQuoteRepository implements QuoteRepository {
  quotes = new Map<string, ConfirmedQuote>();
  customers = new Map<string, CustomerWriteRecord>();
  audits: Array<Record<string, unknown>> = [];

  async runConfirmationTransaction<T>(work: (repository: QuoteRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async findByIdempotencyKey(key: string) {
    return [...this.quotes.values()].find((quote) => quote.idempotencyKey === key) ?? null;
  }

  async upsertCustomer(input: CustomerWriteRecord) {
    const id = `customer-${this.customers.size + 1}`;
    this.customers.set(id, input);
    return { id };
  }

  async createQuote(input: QuoteWriteRecord) {
    const at = new Date("2026-08-12T08:00:00.000Z");
    const quote: ConfirmedQuote = {
      ...input,
      id: "quote-1",
      deletedAt: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    this.quotes.set(quote.id, quote);
    return quote;
  }

  async findById(id: string) {
    return this.quotes.get(id) ?? null;
  }

  async list(_scope: UserScope, filters: QuoteListFilters) {
    const items = [...this.quotes.values()];
    if (filters.query) return { items, total: items.length };
    const start = (filters.page - 1) * filters.pageSize;
    return { items: items.slice(start, start + filters.pageSize), total: items.length };
  }

  async updateQuote(id: string, expectedVersion: number, input: QuoteWriteRecord) {
    const current = this.quotes.get(id);
    if (!current || current.version !== expectedVersion || current.status !== "confirmed") return null;
    const updated: ConfirmedQuote = {
      ...current,
      ...input,
      id,
      version: current.version + 1,
      updatedAt: new Date("2026-08-12T09:00:00.000Z"),
    };
    this.quotes.set(id, updated);
    return updated;
  }

  async setDeletedAt(id: string, deletedAt: Date | null) {
    const current = this.quotes.get(id);
    if (!current) return null;
    const updated = { ...current, deletedAt, version: current.version + 1 };
    this.quotes.set(id, updated);
    return updated;
  }

  async writeAudit(input: Parameters<QuoteRepository["writeAudit"]>[0]) {
    this.audits.push(input);
  }

  async recordPrint() {}
}

const draft = (watch: number) => ({
  customer: {
    name: "张先生",
    phone: "13800138000",
    roomType: "one_bedroom" as const,
    elderCount: 1,
  },
  pricing: pricing(watch),
});

const setup = () => {
  const repository = new MemoryQuoteRepository();
  const service = createQuoteService({
    repository,
    pii: {
      encryptPii: (value) => `enc:${value}`,
      decryptPii: (value) => value.replace(/^enc:/, ""),
      phoneLookupHash: (value) => `hash:${value}`,
    },
    now: () => new Date("2026-08-12T08:00:00.000Z"),
    randomSuffix: () => "ABC123",
  });
  return { repository, service };
};

describe("报价保存后编辑主链路", () => {
  it.each(nonSalesUsers)("拒绝 $role 直接调用后端创建报价", async (user) => {
    const { repository, service } = setup();

    await expect(
      service.confirmQuote(user, draft(1), `quote-key-${user.role}-123456`),
    ).rejects.toThrow("仅销售员可以创建报价单");
    expect(repository.quotes.size).toBe(0);
  });

  it.each(nonSalesUsers)("拒绝 $role 修改销售员报价", async (user) => {
    const { service } = setup();
    const created = await service.confirmQuote(seller, draft(1), "quote-key-123456");

    await expect(service.updateQuote(user, created.id, draft(2), 1)).rejects.toThrow(
      "仅销售员可以修改报价单",
    );
  });

  it("重新核价、保留报价单号并递增版本", async () => {
    const { repository, service } = setup();
    const created = await service.confirmQuote(seller, draft(1), "quote-key-123456");
    const updated = await service.updateQuote(seller, created.id, draft(2), 1);

    expect(updated.quoteNo).toBe(created.quoteNo);
    expect(updated.version).toBe(2);
    expect(updated.calculation.heartMonthlyFen).toBe(4_000);
    expect(updated.calculation.monthlyTotalFen).toBe(19_900);
    expect(repository.audits).toHaveLength(1);
  });

  it("拒绝使用过期版本覆盖较新的报价", async () => {
    const { service } = setup();
    const created = await service.confirmQuote(seller, draft(1), "quote-key-123456");
    await service.updateQuote(seller, created.id, draft(2), 1);

    await expect(service.updateQuote(seller, created.id, draft(3), 1)).rejects.toThrow(
      "报价已被其他人修改",
    );
  });

  it("报价转订单后不能继续编辑", async () => {
    const { repository, service } = setup();
    const created = await service.confirmQuote(seller, draft(1), "quote-key-123456");
    repository.quotes.set(created.id, { ...created, status: "converted" });

    await expect(service.updateQuote(seller, created.id, draft(2), 1)).rejects.toThrow(
      "当前报价已锁定",
    );
  });

  it("列表可按客户姓名和手机号查询", async () => {
    const { service } = setup();
    await service.confirmQuote(seller, draft(1), "quote-key-123456");

    const byName = await service.listQuotes(seller, { query: "张先生", page: 1, pageSize: 20 });
    const byPhone = await service.listQuotes(seller, { query: "8000", page: 1, pageSize: 20 });
    expect(byName.items).toHaveLength(1);
    expect(byPhone.items).toHaveLength(1);
  });

  it("服务端按每页 20 条返回并保留真实总数", async () => {
    const { repository, service } = setup();
    const created = await service.confirmQuote(seller, draft(1), "quote-key-123456");
    for (let index = 2; index <= 45; index += 1) {
      repository.quotes.set(`quote-${index}`, {
        ...created,
        id: `quote-${index}`,
        quoteNo: `XLX-PAGE-${String(index).padStart(3, "0")}`,
        idempotencyKey: `quote-page-key-${String(index).padStart(6, "0")}`,
      });
    }

    const secondPage = await service.listQuotes(seller, { page: 2, pageSize: 20 });
    const thirdPage = await service.listQuotes(seller, { page: 3, pageSize: 20 });
    const searchedThirdPage = await service.listQuotes(seller, {
      query: "张先生",
      page: 3,
      pageSize: 20,
    });

    expect(secondPage).toMatchObject({ total: 45, page: 2, pageSize: 20 });
    expect(secondPage.items).toHaveLength(20);
    expect(thirdPage.items).toHaveLength(5);
    expect(searchedThirdPage).toMatchObject({ total: 45, page: 3, pageSize: 20 });
    expect(searchedThirdPage.items).toHaveLength(5);
  });
});
