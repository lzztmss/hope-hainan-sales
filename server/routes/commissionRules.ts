import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/authService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import type { CommissionRuleService } from "../commissions/ruleService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";

export interface RegisterCommissionRuleRoutesOptions {
  authService: AuthService;
  ruleService: CommissionRuleService;
  appOrigin: string;
}

const reasonSchema = z.string().trim().min(1).max(500);
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({
    kind: z.literal("personnel_type"),
    value: z.enum(["unicom", "auxiliary", "admin"]),
  }),
  z.object({ kind: z.literal("store"), value: z.string().trim().min(1).max(100) }),
  z.object({
    kind: z.literal("salesperson"),
    value: z.string().trim().min(1).max(100),
  }),
]);

const ruleSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  amountFen: z.number().int().min(0).max(100_000_000),
  paymentMode: z.enum(["all", "one_time", "contract_36"]),
  scope: scopeSchema,
  enabled: z.boolean(),
});

const createDraftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  effectiveFrom: localDateSchema,
  effectiveTo: localDateSchema.nullable().optional(),
  rules: z.array(ruleSchema).min(1).max(500),
  reason: reasonSchema,
});

const updateRuleSchema = z.object({
  amountFen: z.number().int().min(0).max(100_000_000),
  enabled: z.boolean(),
  expectedRevision: z.number().int().min(1),
  reason: reasonSchema,
});

const lifecycleSchema = z.object({ reason: reasonSchema });

const copySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  effectiveFrom: localDateSchema.optional(),
  effectiveTo: localDateSchema.nullable().optional(),
  rules: z.array(ruleSchema).min(1).max(500).optional(),
  reason: reasonSchema,
});

const simulationSchema = z.object({
  versionId: z.string().trim().min(1).max(100).optional(),
  at: z
    .string()
    .trim()
    .refine((value) => Number.isFinite(Date.parse(value)), "模拟时间不合法")
    .optional(),
  orderLines: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(64),
        label: z.string().trim().min(1).max(160),
        quantity: z.number().int().min(1).max(10_000),
        lineType: z.enum(["charge", "component"]),
      }),
    )
    .min(1)
    .max(1_000),
  sellerContext: z.object({
    salespersonId: z.string().trim().min(1).max(100),
    storeId: z.string().trim().min(1).max(100),
    personnelType: z.enum(["unicom", "auxiliary", "admin"]),
    paymentMode: z.enum(["one_time", "contract_36"]),
  }),
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
  if (user.role !== "admin") {
    void reply.status(403).send({ error: "仅管理员可管理提成规则" });
    return null;
  }
  return user;
};

const sendServiceError = (reply: FastifyReply, error: unknown) => {
  const message = error instanceof Error ? error.message : "提成规则操作失败";
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : message.includes("不存在")
        ? 404
        : message.includes("重叠") || message.includes("其他操作更新")
          ? 409
          : 400;
  return reply.status(statusCode).send({ error: message });
};

const invalidPayload = (reply: FastifyReply) =>
  reply.status(400).send({ error: "提成规则参数不完整或格式不正确" });

export const registerCommissionRuleRoutes = async (
  app: FastifyInstance,
  options: RegisterCommissionRuleRoutesOptions,
): Promise<void> => {
  app.get("/api/admin/commission-policy-versions", async (request, reply) => {
    const actor = await resolveAdmin(request, reply, options.authService);
    if (!actor) return;
    try {
      return { versions: await options.ruleService.listVersions(actor) };
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/api/admin/commission-policy-versions", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const actor = await resolveAdmin(request, reply, options.authService);
    if (!actor) return;
    const parsed = createDraftSchema.safeParse(request.body);
    if (!parsed.success) return invalidPayload(reply);
    try {
      const version = await options.ruleService.createDraft(actor, parsed.data);
      return reply.status(201).send({ version });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.patch<{
    Params: { versionId: string; ruleId: string };
  }>(
    "/api/admin/commission-policy-versions/:versionId/rules/:ruleId",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const actor = await resolveAdmin(request, reply, options.authService);
      if (!actor) return;
      const parsed = updateRuleSchema.safeParse(request.body);
      if (!parsed.success) return invalidPayload(reply);
      try {
        const version = await options.ruleService.updateRule(
          actor,
          request.params.versionId,
          request.params.ruleId,
          parsed.data,
        );
        return { version };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.post("/api/admin/commission-simulate", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const actor = await resolveAdmin(request, reply, options.authService);
    if (!actor) return;
    const parsed = simulationSchema.safeParse(request.body);
    if (!parsed.success) return invalidPayload(reply);
    try {
      return await options.ruleService.simulate(actor, {
        ...parsed.data,
        at: parsed.data.at ? new Date(parsed.data.at) : undefined,
      });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/admin/commission-policy-versions/:id/publish",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const actor = await resolveAdmin(request, reply, options.authService);
      if (!actor) return;
      const parsed = lifecycleSchema.safeParse(request.body);
      if (!parsed.success) return invalidPayload(reply);
      try {
        return {
          version: await options.ruleService.publish(
            actor,
            request.params.id,
            parsed.data.reason,
          ),
        };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/commission-policy-versions/:id/stop",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const actor = await resolveAdmin(request, reply, options.authService);
      if (!actor) return;
      const parsed = lifecycleSchema.safeParse(request.body);
      if (!parsed.success) return invalidPayload(reply);
      try {
        return {
          version: await options.ruleService.stop(
            actor,
            request.params.id,
            parsed.data.reason,
          ),
        };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/admin/commission-policy-versions/:id/copy",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const actor = await resolveAdmin(request, reply, options.authService);
      if (!actor) return;
      const parsed = copySchema.safeParse(request.body);
      if (!parsed.success) return invalidPayload(reply);
      try {
        const version = await options.ruleService.copyVersion(
          actor,
          request.params.id,
          parsed.data,
        );
        return reply.status(201).send({ version });
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );
};
