import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AdminService } from "../admin/adminService.js";
import { AdminServiceError } from "../admin/adminService.js";
import type { AuthService } from "../auth/authService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { SESSION_COOKIE_NAME } from "./auth.js";
import { sendValidationError } from "./validationError.js";

export interface RegisterAdminRoutesOptions {
  authService: AuthService;
  adminService: AdminService;
  appOrigin: string;
}

const reasonSchema = z.string().trim().min(2).max(500);
const roleSchema = z.enum(["sales", "store_manager", "regional_manager", "hr", "finance", "admin"]);
const personnelTypeSchema = z.enum(["unicom", "auxiliary", "admin"]);
const storeIdSchema = z.string().uuid();

const createStoreSchema = z.object({
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(1).max(160),
  reason: reasonSchema,
});

const updateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    active: z.boolean().optional(),
    managerUserId: storeIdSchema.nullable().optional(),
    reason: reasonSchema,
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.active !== undefined ||
      value.managerUserId !== undefined,
  );

const createUserSchema = z.object({
  workNo: z.string().trim().min(2).max(64),
  displayName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).nullable().optional(),
  role: roleSchema,
  personnelType: personnelTypeSchema,
  storeId: storeIdSchema.nullable(),
  managedStoreIds: z.array(storeIdSchema).max(100).optional(),
  active: z.boolean().optional(),
  initialPassword: z.string().min(8).max(128),
  reason: reasonSchema,
});

const updateUserSchema = z
  .object({
    workNo: z.string().trim().min(2).max(64).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    role: roleSchema.optional(),
    personnelType: personnelTypeSchema.optional(),
    storeId: storeIdSchema.nullable().optional(),
    managedStoreIds: z.array(storeIdSchema).max(100).optional(),
    active: z.boolean().optional(),
    reason: reasonSchema,
  })
  .refine((value) =>
    Object.entries(value).some(
      ([key, fieldValue]) => key !== "reason" && fieldValue !== undefined,
    ),
  );

const resetPasswordSchema = z.object({
  initialPassword: z.string().min(8).max(128),
  reason: reasonSchema,
});

const listUsersQuerySchema = z.object({
  storeId: storeIdSchema.optional(),
  role: roleSchema.optional(),
  active: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  query: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const ensureTrustedOrigin = (
  request: FastifyRequest,
  reply: FastifyReply,
  appOrigin: string,
): boolean => {
  const origin = request.headers.origin;
  if (origin && origin !== appOrigin) {
    void reply.status(403).send({ error: "请求来源不可信" });
    return false;
  }
  return true;
};

const resolveAdmin = async (
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
): Promise<AuthenticatedUser | null> => {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
  const user = token ? await authService.getSessionUser(token) : null;
  if (!user) {
    void reply.status(401).send({ error: "请先登录" });
    return null;
  }
  if (user.role !== "admin" && user.role !== "regional_manager") {
    void reply.status(403).send({ error: "仅管理员可管理营业厅与账号" });
    return null;
  }
  return user;
};

const sendServiceError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof AdminServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 400;
  const message = error instanceof Error ? error.message : "管理员操作失败";
  return reply.status(statusCode).send({ error: message });
};

const adminFieldLabels = {
  code: "营业厅编码",
  name: "营业厅名称",
  managerUserId: "营业厅主经理",
  workNo: "工号",
  displayName: "账号姓名",
  phone: "手机号",
  role: "账号角色",
  personnelType: "人员类型",
  storeId: "所属营业厅",
  initialPassword: "初始密码",
  reason: "操作原因",
} as const;

const invalidPayload = (reply: FastifyReply) =>
  reply.status(400).send({ error: "请检查营业厅或账号信息" });

const validId = (value: string): boolean => z.string().uuid().safeParse(value).success;

export const registerAdminRoutes = async (
  app: FastifyInstance,
  options: RegisterAdminRoutesOptions,
): Promise<void> => {
  app.get("/api/admin/stores", async (request, reply) => {
    const actor = await resolveAdmin(request, reply, options.authService);
    if (!actor) return;
    try {
      return { stores: await options.adminService.listStores(actor) };
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/api/admin/stores", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const actor = await resolveAdmin(request, reply, options.authService);
    if (!actor) return;
    const parsed = createStoreSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error, adminFieldLabels, "请检查新增营业厅信息");
    try {
      const store = await options.adminService.createStore(actor, parsed.data);
      return reply.status(201).send({ store });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/stores/:id",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const actor = await resolveAdmin(request, reply, options.authService);
      if (!actor) return;
      if (!validId(request.params.id)) return invalidPayload(reply);
      const parsed = updateStoreSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error, adminFieldLabels, "请检查营业厅变更信息");
      try {
        return {
          store: await options.adminService.updateStore(
            actor,
            request.params.id,
            parsed.data,
          ),
        };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.get("/api/admin/users", async (request, reply) => {
    const actor = await resolveAdmin(request, reply, options.authService);
    if (!actor) return;
    const parsed = listUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidPayload(reply);
    try {
      return await options.adminService.listUsers(actor, parsed.data);
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/api/admin/users", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const actor = await resolveAdmin(request, reply, options.authService);
    if (!actor) return;
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error, adminFieldLabels, "请检查新增账号信息");
    try {
      const user = await options.adminService.createUser(actor, parsed.data);
      return reply.status(201).send({ user });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/api/admin/users/:id",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const actor = await resolveAdmin(request, reply, options.authService);
      if (!actor) return;
      if (!validId(request.params.id)) return invalidPayload(reply);
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error, adminFieldLabels, "请检查账号修改信息");
      try {
        return {
          user: await options.adminService.updateUser(
            actor,
            request.params.id,
            parsed.data,
          ),
        };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/users/:id/reset-password",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const actor = await resolveAdmin(request, reply, options.authService);
      if (!actor) return;
      if (!validId(request.params.id)) return invalidPayload(reply);
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error, adminFieldLabels, "请检查密码重置信息");
      try {
        return {
          user: await options.adminService.resetUserPassword(
            actor,
            request.params.id,
            parsed.data,
          ),
        };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );
};
