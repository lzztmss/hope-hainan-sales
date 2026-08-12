export type UserRole = "sales" | "store_manager" | "admin";

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  role: UserRole;
  storeId: string | null;
  storeName?: string | null;
  mustChangePassword: boolean;
}

export type UserScope =
  | { kind: "seller"; sellerId: string; storeId: string }
  | { kind: "store"; storeId: string }
  | { kind: "global" };

export interface OwnedRecord {
  sellerId: string;
  storeId: string;
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor(message = "无权执行此操作") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export const scopeForUser = (user: AuthenticatedUser): UserScope => {
  if (user.role === "admin") return { kind: "global" };
  if (!user.storeId) throw new AuthorizationError("用户未绑定营业厅");
  if (user.role === "store_manager") {
    return { kind: "store", storeId: user.storeId };
  }
  return { kind: "seller", sellerId: user.id, storeId: user.storeId };
};

export const canAccessOwnedRecord = (
  user: AuthenticatedUser,
  record: OwnedRecord,
): boolean => {
  const scope = scopeForUser(user);
  if (scope.kind === "global") return true;
  if (scope.kind === "store") return record.storeId === scope.storeId;
  return (
    record.storeId === scope.storeId && record.sellerId === scope.sellerId
  );
};

export const requireRole = (
  user: AuthenticatedUser,
  ...roles: UserRole[]
): void => {
  if (!roles.includes(user.role)) throw new AuthorizationError();
};
