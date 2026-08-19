import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/authService.js";
import {
  AuthorizationError,
  type AuthenticatedUser,
} from "../auth/authorization.js";
import type { QuoteService } from "../quotes/quoteService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";
import { sendValidationError } from "./validationError.js";

const quoteFieldLabels = {
  customer: "客户信息",
  pricing: "报价配置",
  name: "客户姓名",
  phone: "客户手机号",
  elderCount: "长者人数",
  mode: "支付方式",
  fttrPlan: "FTTR 档位",
  selection: "商品数量",
  expectedVersion: "报价版本",
} as const;

export interface RegisterQuoteRoutesOptions {
  authService: AuthService;
  quoteService: QuoteService;
  appOrigin: string;
}

const quantity = z.number().int().min(0).max(20).optional();
const locationsSchema = z
  .object({
    watch: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    mattress: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    gateway: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    motion: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    door: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    portableButton: z
      .array(z.string().trim().min(1).max(100))
      .max(20)
      .optional(),
    wallButton: z
      .array(z.string().trim().min(1).max(100))
      .max(20)
      .optional(),
  })
  .optional();

const pricingSchema = z.object({
  mode: z.enum(["one_time", "contract_36"]),
  fttrPlan: z.number().int().min(1).max(9_999).nullable(),
  customFttrNote: z.string().trim().max(500).optional(),
  selection: z.object({
    watch: quantity,
    mattress: quantity,
    standardBundle: quantity,
    oneKey: quantity,
    homeDual: quantity,
    gateway: quantity,
    motion: quantity,
    door: quantity,
    portableButton: quantity,
    wallButton: quantity,
    locations: locationsSchema,
  }),
});

const customerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(1).max(32),
  district: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  roomType: z
    .enum(["one_bedroom", "two_bedroom", "three_bedroom"])
    .optional(),
  elderCount: z.number().int().min(1).max(20),
  source: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1_000).optional(),
});

const previewSchema = z.object({ pricing: pricingSchema });
const confirmSchema = z.object({ customer: customerSchema, pricing: pricingSchema });
const updateSchema = confirmSchema.extend({
  expectedVersion: z.number().int().min(1),
});
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const listSchema = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(["confirmed", "converted", "expired", "lost", "voided"]).optional(),
  storeId: z.string().uuid().optional(),
  sellerId: z.string().uuid().optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  deletedOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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

const sendServiceError = (reply: FastifyReply, error: unknown) => {
  const message = error instanceof Error ? error.message : "操作失败";
  if (error instanceof AuthorizationError) {
    return reply.status(error.statusCode).send({ error: message });
  }
  const statusCode = message.includes("不存在") ? 404 : 400;
  return reply.status(statusCode).send({ error: message });
};

export const registerQuoteRoutes = async (
  app: FastifyInstance,
  options: RegisterQuoteRoutesOptions,
): Promise<void> => {
  app.get("/api/quotes", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "报价查询条件不正确" });
    const dateFrom = parsed.data.dateFrom
      ? new Date(`${parsed.data.dateFrom}T00:00:00+08:00`)
      : undefined;
    const dateTo = parsed.data.dateTo
      ? new Date(new Date(`${parsed.data.dateTo}T00:00:00+08:00`).getTime() + 86_400_000)
      : undefined;
    try {
      return await options.quoteService.listQuotes(user, {
        query: parsed.data.query,
        status: parsed.data.status,
        storeId: parsed.data.storeId,
        sellerId: parsed.data.sellerId,
        dateFrom,
        dateTo,
        deletedOnly: parsed.data.deletedOnly,
        limit: parsed.data.limit,
      });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/api/quotes/preview", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error, quoteFieldLabels, "请检查报价配置");
    }
    try {
      return options.quoteService.previewQuote(parsed.data);
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.post("/api/quotes", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error, quoteFieldLabels, "请检查客户和报价信息");
    }
    const keyHeader = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!idempotencyKey) {
      return reply.status(400).send({ error: "缺少幂等键" });
    }

    try {
      const quote = await options.quoteService.confirmQuote(
        user,
        parsed.data,
        idempotencyKey,
      );
      const presentation = await options.quoteService.getQuote(user, quote.id);
      return reply.status(201).send({
        id: quote.id,
        quoteNo: quote.quoteNo,
        status: quote.status,
        confirmedAt: quote.confirmedAt,
        oneTimeFen: quote.oneTimeFen,
        monthlyTotalFen: quote.monthlyTotalFen,
        contract36Fen: quote.contract36Fen,
        calculation: presentation.calculation,
      });
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/quotes/:id",
    async (request, reply) => {
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      try {
        return await options.quoteService.getQuote(user, request.params.id);
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.put<{ Params: { id: string } }>(
    "/api/quotes/:id",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error, quoteFieldLabels, "请检查客户和报价信息");
      try {
        return await options.quoteService.updateQuote(
          user,
          request.params.id,
          { customer: parsed.data.customer, pricing: parsed.data.pricing },
          parsed.data.expectedVersion,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "修改报价失败";
        if (message.includes("其他人修改") || message.includes("锁定")) {
          return reply.status(409).send({ error: message });
        }
        return sendServiceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/quotes/:id/print",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      try {
        await options.quoteService.recordPrint(user, request.params.id);
        return { success: true };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/quotes/:id",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      try {
        const quote = await options.quoteService.softDeleteQuote(
          user,
          request.params.id,
        );
        return { id: quote.id, deletedAt: quote.deletedAt };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/quotes/:id/restore",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      try {
        const quote = await options.quoteService.restoreQuote(
          user,
          request.params.id,
        );
        return { id: quote.id, deletedAt: quote.deletedAt };
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );
};
