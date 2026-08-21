import { scopeForUser, type AuthenticatedUser, type UserScope } from "../auth/authorization.js";

export interface CustomerListRecord {
  id: string;
  storeId: string;
  storeName: string;
  ownerUserId: string;
  ownerName: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  roomType: string | null;
  elderCount: number;
  quoteCount: number;
  orderCount: number;
  lastQuoteAt: Date | null;
  updatedAt: Date;
}

export interface CustomerRepository {
  list(
    scope: UserScope,
    filters: { storeId?: string; ownerUserId?: string },
    paging: { page: number; pageSize: number; unpaged?: boolean },
  ): Promise<{ items: readonly CustomerListRecord[]; total: number }>;
}

export interface CustomerListFilters {
  query?: string;
  storeId?: string;
  sellerId?: string;
  page?: number;
  pageSize?: number;
}

export const createCustomerService = (options: {
  repository: CustomerRepository;
  decryptPii(value: string): string;
}) => ({
  async listCustomers(user: AuthenticatedUser, filters: CustomerListFilters = {}) {
    const normalized = filters.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const result = await options.repository.list(
      scopeForUser(user),
      { storeId: filters.storeId, ownerUserId: filters.sellerId },
      { page, pageSize, unpaged: Boolean(normalized) },
    );
    const filtered = result.items
      .map((row) => {
        const name = options.decryptPii(row.nameEncrypted);
        const phone = options.decryptPii(row.phoneEncrypted);
        return {
          id: row.id,
          storeId: row.storeId,
          storeName: row.storeName,
          ownerUserId: row.ownerUserId,
          ownerName: row.ownerName,
          name,
          phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
          roomType: row.roomType,
          elderCount: row.elderCount,
          quoteCount: row.quoteCount,
          orderCount: row.orderCount,
          lastQuoteAt: row.lastQuoteAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        };
      })
      .filter((row) =>
        !normalized ||
        row.name.toLocaleLowerCase("zh-CN").includes(normalized) ||
        row.phoneMasked.replace("****", "").includes(normalized) ||
        row.phoneMasked.endsWith(normalized) ||
        row.ownerName.toLocaleLowerCase("zh-CN").includes(normalized) ||
        row.storeName.toLocaleLowerCase("zh-CN").includes(normalized),
      );
    const start = normalized ? (page - 1) * pageSize : 0;
    return {
      items: normalized ? filtered.slice(start, start + pageSize) : filtered,
      total: normalized ? filtered.length : result.total,
      page,
      pageSize,
    };
  },
});

export type CustomerService = ReturnType<typeof createCustomerService>;
