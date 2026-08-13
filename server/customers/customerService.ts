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
    limit: number,
  ): Promise<readonly CustomerListRecord[]>;
}

export interface CustomerListFilters {
  query?: string;
  storeId?: string;
  sellerId?: string;
  limit?: number;
}

export const createCustomerService = (options: {
  repository: CustomerRepository;
  decryptPii(value: string): string;
}) => ({
  async listCustomers(user: AuthenticatedUser, filters: CustomerListFilters = {}) {
    const normalized = filters.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
    const limit = filters.limit ?? 100;
    const rows = await options.repository.list(
      scopeForUser(user),
      { storeId: filters.storeId, ownerUserId: filters.sellerId },
      normalized ? 500 : limit,
    );
    return {
      items: rows
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
        )
        .slice(0, limit),
    };
  },
});

export type CustomerService = ReturnType<typeof createCustomerService>;
