import { describe, expect, it } from "vitest";

import type { AuthenticatedUser, UserScope } from "../auth/authorization.js";
import { createCustomerService, type CustomerRepository } from "./customerService.js";

class RecordingRepository implements CustomerRepository {
  scope: UserScope | null = null;
  filters: { storeId?: string; ownerUserId?: string } | null = null;

  async list(scope: UserScope, filters: { storeId?: string; ownerUserId?: string }) {
    this.scope = scope;
    this.filters = filters;
    return [
      {
        id: "customer-1",
        storeId: "store-1",
        storeName: "海口营业厅",
        ownerUserId: "seller-1",
        ownerName: "王销售",
        nameEncrypted: "陈女士",
        phoneEncrypted: "13800138000",
        roomType: "two_bedroom",
        elderCount: 2,
        quoteCount: 2,
        orderCount: 1,
        lastQuoteAt: new Date("2026-08-13T01:00:00.000Z"),
        updatedAt: new Date("2026-08-13T02:00:00.000Z"),
      },
    ];
  }
}

const user = (role: AuthenticatedUser["role"]): AuthenticatedUser => ({
  id: role === "sales" ? "seller-1" : `${role}-1`,
  displayName: "测试用户",
  role,
  storeId: role === "admin" ? null : "store-1",
  storeName: role === "admin" ? null : "海口营业厅",
  mustChangePassword: false,
});

describe("客户列表权限与查询", () => {
  it.each([
    ["sales", { kind: "seller", storeId: "store-1", sellerId: "seller-1" }],
    ["store_manager", { kind: "store", storeId: "store-1" }],
    ["admin", { kind: "global" }],
  ] as const)("%s 使用正确数据范围", async (role, expectedScope) => {
    const repository = new RecordingRepository();
    const service = createCustomerService({ repository, decryptPii: (value) => value });
    const result = await service.listCustomers(user(role));
    expect(repository.scope).toEqual(expectedScope);
    expect(result.items[0]).toMatchObject({
      name: "陈女士",
      phoneMasked: "138****8000",
      quoteCount: 2,
      orderCount: 1,
    });
  });

  it("支持按手机后四位查询", async () => {
    const repository = new RecordingRepository();
    const service = createCustomerService({ repository, decryptPii: (value) => value });
    expect((await service.listCustomers(user("sales"), { query: "8000" })).items).toHaveLength(1);
    expect((await service.listCustomers(user("sales"), { query: "9999" })).items).toHaveLength(0);
  });

  it("把管理员选择的营业厅和销售员交给数据层筛选", async () => {
    const repository = new RecordingRepository();
    const service = createCustomerService({ repository, decryptPii: (value) => value });
    await service.listCustomers(user("admin"), { storeId: "store-1", sellerId: "seller-1" });
    expect(repository.filters).toEqual({ storeId: "store-1", ownerUserId: "seller-1" });
  });
});
