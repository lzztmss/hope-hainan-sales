import { hash } from "@node-rs/argon2";

import type {
  AuthenticatedUser,
  UserRole,
} from "../auth/authorization.js";
import {
  maskPhone,
  normalizeMainlandPhone,
  type PiiProtector,
} from "../security/pii.js";

export type PersonnelType = "unicom" | "auxiliary" | "admin";

export interface AdminStoreRecord {
  id: string;
  code: string;
  name: string;
  active: boolean;
  activeUserCount: number;
  managerUserId: string | null;
  managerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminStoreView {
  id: string;
  code: string;
  name: string;
  active: boolean;
  activeUserCount: number;
  managerUserId: string | null;
  managerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserRecord {
  id: string;
  workNo: string;
  displayName: string;
  passwordHash: string;
  phoneEncrypted: string | null;
  phoneLookupHash: string | null;
  role: UserRole;
  personnelType: PersonnelType;
  storeId: string | null;
  storeName: string | null;
  active: boolean;
  isPrimaryStoreManager: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUserView {
  id: string;
  workNo: string;
  displayName: string;
  phoneMasked: string | null;
  role: UserRole;
  personnelType: PersonnelType;
  storeId: string | null;
  storeName: string | null;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserFilters {
  storeId?: string;
  role?: UserRole;
  active?: boolean;
  isPrimaryStoreManager?: boolean;
  query?: string;
}

export interface AdminStoreWrite {
  code: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminStorePatch {
  name?: string;
  active?: boolean;
  updatedAt: Date;
}

export interface AdminUserWrite {
  workNo: string;
  displayName: string;
  passwordHash: string;
  phoneEncrypted: string | null;
  phoneLookupHash: string | null;
  role: UserRole;
  personnelType: PersonnelType;
  storeId: string | null;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUserPatch {
  workNo?: string;
  displayName?: string;
  passwordHash?: string;
  phoneEncrypted?: string | null;
  phoneLookupHash?: string | null;
  role?: UserRole;
  personnelType?: PersonnelType;
  storeId?: string | null;
  active?: boolean;
  isPrimaryStoreManager?: boolean;
  mustChangePassword?: boolean;
  updatedAt: Date;
}

export interface AdminAuditInput {
  actorUserId: string;
  storeId: string | null;
  entityType: "store" | "user";
  entityId: string;
  action:
    | "create_store"
    | "update_store"
    | "create_user"
    | "update_user"
    | "reset_user_password";
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown>;
  reason: string;
  createdAt: Date;
}

export interface AdminRepository {
  runTransaction<T>(work: (repository: AdminRepository) => Promise<T>): Promise<T>;
  lockAdministration(): Promise<void>;
  listStores(): Promise<readonly AdminStoreRecord[]>;
  findStoreForUpdate(id: string): Promise<AdminStoreRecord | null>;
  createStore(input: AdminStoreWrite): Promise<AdminStoreRecord>;
  updateStore(id: string, patch: AdminStorePatch): Promise<AdminStoreRecord | null>;
  assignStoreManager(storeId: string, userId: string | null): Promise<void>;
  listActiveUsersInStoreForUpdate(storeId: string): Promise<readonly string[]>;
  listUsers(filters: AdminUserFilters): Promise<readonly AdminUserRecord[]>;
  findUserForUpdate(id: string): Promise<AdminUserRecord | null>;
  createUser(input: AdminUserWrite): Promise<AdminUserRecord>;
  updateUser(id: string, patch: AdminUserPatch): Promise<AdminUserRecord | null>;
  listActiveAdminsForUpdate(): Promise<readonly string[]>;
  deleteSessionsForUser(userId: string): Promise<void>;
  writeAudit(input: AdminAuditInput): Promise<void>;
}

export interface CreateStoreInput {
  code: string;
  name: string;
  reason: string;
}

export interface UpdateStoreInput {
  name?: string;
  active?: boolean;
  managerUserId?: string | null;
  reason: string;
}

export interface CreateAdminUserInput {
  workNo: string;
  displayName: string;
  phone?: string | null;
  role: UserRole;
  personnelType: PersonnelType;
  storeId: string | null;
  active?: boolean;
  initialPassword: string;
  reason: string;
}

export interface UpdateAdminUserInput {
  workNo?: string;
  displayName?: string;
  phone?: string | null;
  role?: UserRole;
  personnelType?: PersonnelType;
  storeId?: string | null;
  active?: boolean;
  reason: string;
}

export interface ResetUserPasswordInput {
  initialPassword: string;
  reason: string;
}

export class AdminServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AdminServiceError";
  }
}

export interface AdminServiceOptions {
  repository: AdminRepository;
  pii: Pick<PiiProtector, "encryptPii" | "decryptPii" | "phoneLookupHash">;
  hashPassword?: (password: string) => Promise<string>;
  now?: () => Date;
}

const requireAdmin = (actor: AuthenticatedUser): void => {
  if (actor.role !== "admin") {
    throw new AdminServiceError("仅管理员可管理营业厅与账号", 403);
  }
};

const normalizeReason = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 500) {
    throw new AdminServiceError("操作原因长度必须为2至500字", 400);
  }
  return normalized;
};

const normalizeCode = (value: string, label: string): string => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(normalized)) {
    throw new AdminServiceError(`${label}须为2至64位大写字母、数字、横线或下划线`, 400);
  }
  return normalized;
};

const normalizeName = (value: string, label: string, max: number): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new AdminServiceError(`${label}长度必须为1至${max}字`, 400);
  }
  return normalized;
};

const validateInitialPassword = (value: string): void => {
  if (value.length < 12 || value.length > 128) {
    throw new AdminServiceError("初始密码长度必须为12至128位", 400);
  }
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "23505" || String(error.code).startsWith("SQLITE_CONSTRAINT"));

const mapPersistenceError = (error: unknown): never => {
  if (error instanceof AdminServiceError) throw error;
  if (isUniqueViolation(error)) {
    const constraint =
      typeof error === "object" && error !== null && "constraint_name" in error
        ? String(error.constraint_name)
        : "";
    if (constraint.includes("phone")) {
      throw new AdminServiceError("该手机号已绑定其他账号", 409);
    }
    if (constraint.includes("stores_code")) {
      throw new AdminServiceError("营业厅编码已存在", 409);
    }
    throw new AdminServiceError("工号已存在", 409);
  }
  throw error;
};

const storeView = (store: AdminStoreRecord): AdminStoreView => ({
  id: store.id,
  code: store.code,
  name: store.name,
  active: store.active,
  activeUserCount: store.activeUserCount,
  managerUserId: store.managerUserId,
  managerName: store.managerName,
  createdAt: store.createdAt.toISOString(),
  updatedAt: store.updatedAt.toISOString(),
});

const storeAuditSnapshot = (store: AdminStoreRecord): Record<string, unknown> => ({
  id: store.id,
  code: store.code,
  name: store.name,
  active: store.active,
  activeUserCount: store.activeUserCount,
  managerUserId: store.managerUserId,
  managerName: store.managerName,
});

const safeDecryptPhone = (
  encrypted: string | null,
  pii: AdminServiceOptions["pii"],
): string | null => {
  if (!encrypted) return null;
  try {
    return maskPhone(pii.decryptPii(encrypted));
  } catch {
    throw new AdminServiceError("账号手机号资料校验失败", 500);
  }
};

const userView = (
  user: AdminUserRecord,
  pii: AdminServiceOptions["pii"],
): AdminUserView => ({
  id: user.id,
  workNo: user.workNo,
  displayName: user.displayName,
  phoneMasked: safeDecryptPhone(user.phoneEncrypted, pii),
  role: user.role,
  personnelType: user.personnelType,
  storeId: user.storeId,
  storeName: user.storeName,
  active: user.active,
  mustChangePassword: user.mustChangePassword,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

const userAuditSnapshot = (
  user: AdminUserRecord,
  pii: AdminServiceOptions["pii"],
): Record<string, unknown> => {
  const view = userView(user, pii);
  return {
    id: view.id,
    workNo: view.workNo,
    displayName: view.displayName,
    phoneMasked: view.phoneMasked,
    role: view.role,
    personnelType: view.personnelType,
    storeId: view.storeId,
    storeName: view.storeName,
    active: view.active,
    mustChangePassword: view.mustChangePassword,
  };
};

const protectedPhone = (
  phone: string | null | undefined,
  pii: AdminServiceOptions["pii"],
): { phoneEncrypted: string | null; phoneLookupHash: string | null } | null => {
  if (phone === undefined) return null;
  if (phone === null || !phone.trim()) {
    return { phoneEncrypted: null, phoneLookupHash: null };
  }
  const normalized = normalizeMainlandPhone(phone);
  return {
    phoneEncrypted: pii.encryptPii(normalized),
    phoneLookupHash: pii.phoneLookupHash(normalized),
  };
};

const audit = async (
  repository: AdminRepository,
  input: Omit<AdminAuditInput, "createdAt">,
  at: Date,
): Promise<void> => {
  await repository.writeAudit({ ...input, createdAt: at });
};

export const createAdminService = (options: AdminServiceOptions) => {
  const now = options.now ?? (() => new Date());
  const hashPassword = options.hashPassword ?? ((password: string) => hash(password));

  const validateAssignment = async (
    repository: AdminRepository,
    role: UserRole,
    personnelType: PersonnelType,
    storeId: string | null,
    active: boolean,
  ): Promise<AdminStoreRecord | null> => {
    if (role === "admin") {
      if (personnelType !== "admin" || storeId !== null) {
        throw new AdminServiceError(
          "管理员账号必须使用管理员人员类型且不绑定营业厅",
          400,
        );
      }
      return null;
    }
    if (personnelType === "admin" || !storeId) {
      throw new AdminServiceError(
        "销售及厅经理必须绑定营业厅和非管理员人员类型",
        400,
      );
    }
    const store = await repository.findStoreForUpdate(storeId);
    if (!store) throw new AdminServiceError("营业厅不存在", 404);
    if (active && !store.active) {
      throw new AdminServiceError("启用账号不能绑定已停用营业厅", 409);
    }
    return store;
  };

  return {
    async listStores(actor: AuthenticatedUser): Promise<AdminStoreView[]> {
      requireAdmin(actor);
      return (await options.repository.listStores()).map(storeView);
    },

    async createStore(
      actor: AuthenticatedUser,
      input: CreateStoreInput,
    ): Promise<AdminStoreView> {
      requireAdmin(actor);
      const reason = normalizeReason(input.reason);
      const at = now();
      try {
        return await options.repository.runTransaction(async (repository) => {
          await repository.lockAdministration();
          const created = await repository.createStore({
            code: normalizeCode(input.code, "营业厅编码"),
            name: normalizeName(input.name, "营业厅名称", 160),
            active: true,
            createdAt: at,
            updatedAt: at,
          });
          await audit(
            repository,
            {
              actorUserId: actor.id,
              storeId: created.id,
              entityType: "store",
              entityId: created.id,
              action: "create_store",
              beforeSnapshot: null,
              afterSnapshot: storeAuditSnapshot(created),
              reason,
            },
            at,
          );
          return storeView(created);
        });
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async updateStore(
      actor: AuthenticatedUser,
      storeId: string,
      input: UpdateStoreInput,
    ): Promise<AdminStoreView> {
      requireAdmin(actor);
      const reason = normalizeReason(input.reason);
      if (
        input.name === undefined &&
        input.active === undefined &&
        input.managerUserId === undefined
      ) {
        throw new AdminServiceError("营业厅没有可更新的字段", 400);
      }
      const at = now();
      return options.repository.runTransaction(async (repository) => {
        await repository.lockAdministration();
        const existing = await repository.findStoreForUpdate(storeId);
        if (!existing) throw new AdminServiceError("营业厅不存在", 404);
        if (input.active === false && existing.active) {
          const activeUsers = await repository.listActiveUsersInStoreForUpdate(storeId);
          if (activeUsers.length > 0) {
            throw new AdminServiceError("营业厅仍有启用账号，请先停用或转移账号", 409);
          }
        }
        if (input.managerUserId) {
          const manager = await repository.findUserForUpdate(input.managerUserId);
          if (
            !manager ||
            manager.storeId !== storeId ||
            manager.role !== "store_manager" ||
            !manager.active
          ) {
            throw new AdminServiceError(
              "主经理必须是该营业厅内启用的厅经理账号",
              400,
            );
          }
        }
        if (input.managerUserId !== undefined) {
          await repository.assignStoreManager(storeId, input.managerUserId);
        }
        const updated = await repository.updateStore(storeId, {
          name:
            input.name === undefined
              ? undefined
              : normalizeName(input.name, "营业厅名称", 160),
          active: input.active,
          updatedAt: at,
        });
        if (!updated) throw new AdminServiceError("营业厅不存在", 404);
        await audit(
          repository,
          {
            actorUserId: actor.id,
            storeId,
            entityType: "store",
            entityId: storeId,
            action: "update_store",
            beforeSnapshot: storeAuditSnapshot(existing),
            afterSnapshot: storeAuditSnapshot(updated),
            reason,
          },
          at,
        );
        return storeView(updated);
      });
    },

    async listUsers(
      actor: AuthenticatedUser,
      filters: AdminUserFilters,
    ): Promise<AdminUserView[]> {
      requireAdmin(actor);
      return (
        await options.repository.listUsers({
          ...filters,
          query: filters.query?.trim() || undefined,
        })
      ).map((user) => userView(user, options.pii));
    },

    async createUser(
      actor: AuthenticatedUser,
      input: CreateAdminUserInput,
    ): Promise<AdminUserView> {
      requireAdmin(actor);
      const reason = normalizeReason(input.reason);
      validateInitialPassword(input.initialPassword);
      const at = now();
      const active = input.active ?? true;
      try {
        return await options.repository.runTransaction(async (repository) => {
          await repository.lockAdministration();
          const store = await validateAssignment(
            repository,
            input.role,
            input.personnelType,
            input.storeId,
            active,
          );
          const phone = protectedPhone(input.phone, options.pii) ?? {
            phoneEncrypted: null,
            phoneLookupHash: null,
          };
          const created = await repository.createUser({
            workNo: normalizeCode(input.workNo, "工号"),
            displayName: normalizeName(input.displayName, "姓名", 120),
            passwordHash: await hashPassword(input.initialPassword),
            ...phone,
            role: input.role,
            personnelType: input.personnelType,
            storeId: store?.id ?? null,
            active,
            mustChangePassword: true,
            createdAt: at,
            updatedAt: at,
          });
          await audit(
            repository,
            {
              actorUserId: actor.id,
              storeId: created.storeId,
              entityType: "user",
              entityId: created.id,
              action: "create_user",
              beforeSnapshot: null,
              afterSnapshot: userAuditSnapshot(created, options.pii),
              reason,
            },
            at,
          );
          return userView(created, options.pii);
        });
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async updateUser(
      actor: AuthenticatedUser,
      userId: string,
      input: UpdateAdminUserInput,
    ): Promise<AdminUserView> {
      requireAdmin(actor);
      const reason = normalizeReason(input.reason);
      const hasMutation = Object.entries(input).some(
        ([key, value]) => key !== "reason" && value !== undefined,
      );
      if (!hasMutation) throw new AdminServiceError("账号没有可更新的字段", 400);
      const at = now();
      try {
        return await options.repository.runTransaction(async (repository) => {
          await repository.lockAdministration();
          const existing = await repository.findUserForUpdate(userId);
          if (!existing) throw new AdminServiceError("账号不存在", 404);
          const next = {
            workNo:
              input.workNo === undefined
                ? existing.workNo
                : normalizeCode(input.workNo, "工号"),
            displayName:
              input.displayName === undefined
                ? existing.displayName
                : normalizeName(input.displayName, "姓名", 120),
            role: input.role ?? existing.role,
            personnelType: input.personnelType ?? existing.personnelType,
            storeId:
              input.storeId === undefined ? existing.storeId : input.storeId,
            active: input.active ?? existing.active,
          };
          const store = await validateAssignment(
            repository,
            next.role,
            next.personnelType,
            next.storeId,
            next.active,
          );
          if (
            existing.role === "admin" &&
            existing.active &&
            (next.role !== "admin" || !next.active)
          ) {
            const activeAdmins = await repository.listActiveAdminsForUpdate();
            if (activeAdmins.length <= 1) {
              throw new AdminServiceError(
                "不能停用或降级最后一个启用的管理员",
                409,
              );
            }
          }
          const phone = protectedPhone(input.phone, options.pii);
          const updated = await repository.updateUser(userId, {
            workNo: input.workNo === undefined ? undefined : next.workNo,
            displayName:
              input.displayName === undefined ? undefined : next.displayName,
            role: input.role,
            personnelType: input.personnelType,
            storeId: input.storeId === undefined ? undefined : store?.id ?? null,
            active: input.active,
            isPrimaryStoreManager:
              existing.isPrimaryStoreManager &&
              (next.role !== "store_manager" ||
                !next.active ||
                next.storeId !== existing.storeId)
                ? false
                : undefined,
            ...(phone ?? {}),
            updatedAt: at,
          });
          if (!updated) throw new AdminServiceError("账号不存在", 404);
          if (existing.active && !updated.active) {
            await repository.deleteSessionsForUser(userId);
          }
          await audit(
            repository,
            {
              actorUserId: actor.id,
              storeId: updated.storeId,
              entityType: "user",
              entityId: updated.id,
              action: "update_user",
              beforeSnapshot: userAuditSnapshot(existing, options.pii),
              afterSnapshot: userAuditSnapshot(updated, options.pii),
              reason,
            },
            at,
          );
          return userView(updated, options.pii);
        });
      } catch (error) {
        return mapPersistenceError(error);
      }
    },

    async resetUserPassword(
      actor: AuthenticatedUser,
      userId: string,
      input: ResetUserPasswordInput,
    ): Promise<AdminUserView> {
      requireAdmin(actor);
      const reason = normalizeReason(input.reason);
      validateInitialPassword(input.initialPassword);
      const at = now();
      return options.repository.runTransaction(async (repository) => {
        await repository.lockAdministration();
        const existing = await repository.findUserForUpdate(userId);
        if (!existing) throw new AdminServiceError("账号不存在", 404);
        const updated = await repository.updateUser(userId, {
          passwordHash: await hashPassword(input.initialPassword),
          mustChangePassword: true,
          updatedAt: at,
        });
        if (!updated) throw new AdminServiceError("账号不存在", 404);
        await repository.deleteSessionsForUser(userId);
        await audit(
          repository,
          {
            actorUserId: actor.id,
            storeId: updated.storeId,
            entityType: "user",
            entityId: updated.id,
            action: "reset_user_password",
            beforeSnapshot: userAuditSnapshot(existing, options.pii),
            afterSnapshot: userAuditSnapshot(updated, options.pii),
            reason,
          },
          at,
        );
        return userView(updated, options.pii);
      });
    },
  };
};

export type AdminService = ReturnType<typeof createAdminService>;
