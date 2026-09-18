import { isTrustedOrigin } from "../security/origin.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/authService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import type { SubscriptionPlanService } from "../plans/planService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";

const itemSchema = z.object({
  sku: z.enum(["WATCH", "MATTRESS", "GATEWAY", "MOTION", "DOOR", "PORTABLE_BUTTON", "WALL_BUTTON"]),
  quantity: z.number().int().min(1).max(20),
});
const draftSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  monthlyFen: z.number().int().positive(),
  active: z.boolean().optional(),
  items: z.array(itemSchema).min(1).max(20),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().min(1).optional(),
});
const deleteSchema = z.object({
  expectedVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500),
});

const resolveUser = async (
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
): Promise<AuthenticatedUser | null> => {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
  const user = token ? await authService.getSessionUser(token) : null;
  if (!user) void reply.status(401).send({ error: "请先登录" });
  return user;
};

export const registerSubscriptionPlanRoutes = async (
  app: FastifyInstance,
  options: {
    authService: AuthService;
    planService: SubscriptionPlanService;
    appOrigin: string;
  },
) => {
  app.get("/api/subscription-plans", async (request, reply) => {
    const actor = await resolveUser(request, reply, options.authService);
    if (!actor) return;
    const includeInactive =
      actor.role === "admin" &&
      (request.query as { includeInactive?: string }).includeInactive === "true";
    return { plans: await options.planService.list(actor, includeInactive) };
  });

  app.post("/api/subscription-plans", async (request, reply) => {
    const actor = await resolveUser(request, reply, options.authService);
    if (!actor) return;
    if (request.headers.origin && !isTrustedOrigin(request.headers.origin, options.appOrigin)) {
      return reply.status(403).send({ error: "请求来源不可信" });
    }
    const parsed = draftSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "请检查套餐信息" });
    try {
      return reply.status(201).send({ plan: await options.planService.create(actor, parsed.data) });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "套餐创建失败" });
    }
  });

  app.put<{ Params: { id: string } }>("/api/subscription-plans/:id", async (request, reply) => {
    const actor = await resolveUser(request, reply, options.authService);
    if (!actor) return;
    if (request.headers.origin && !isTrustedOrigin(request.headers.origin, options.appOrigin)) {
      return reply.status(403).send({ error: "请求来源不可信" });
    }
    const parsed = draftSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.expectedVersion === undefined) {
      return reply.status(400).send({ error: "请检查套餐信息" });
    }
    try {
      return { plan: await options.planService.update(actor, request.params.id, parsed.data) };
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "套餐更新失败" });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/subscription-plans/:id", async (request, reply) => {
    const actor = await resolveUser(request, reply, options.authService);
    if (!actor) return;
    if (request.headers.origin && !isTrustedOrigin(request.headers.origin, options.appOrigin)) {
      return reply.status(403).send({ error: "请求来源不可信" });
    }
    const parsed = deleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "请检查删除信息" });
    try {
      await options.planService.delete(actor, request.params.id, parsed.data);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "套餐删除失败";
      const status = message.includes("已有报价或订单使用") ? 409 : 400;
      return reply.status(status).send({ error: message });
    }
  });
};
