import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/authService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import type { ReturnService } from "../returns/returnService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";
import { sendValidationError } from "./validationError.js";

const returnFieldLabels = {
  serviceType: "售后方式",
  type: "退单类型",
  kind: "申请类型",
  reasonCategory: "原因类型",
  reason: "退单原因",
  requestedRefundFen: "申请退款金额",
  items: "退货商品",
  decision: "审批结果",
  note: "审批意见",
  refundFen: "退款金额",
} as const;

export interface RegisterReturnRoutesOptions {
  authService: AuthService;
  returnService: ReturnService;
  appOrigin: string;
}

const requestSchema = z.object({
  serviceType: z.literal("refund"),
  type: z.enum(["full", "partial"]),
  kind: z.enum(["normal", "special"]),
  reasonCategory: z.enum(["no_reason", "quality", "order_mismatch", "service_issue", "other"]),
  reason: z.string().trim().min(2).max(1_000),
  requestedRefundFen: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  items: z
    .array(
      z.object({
        orderLineId: z.string().min(1).max(128),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .max(50),
});
const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(1).max(1_000),
});
const completionSchema = z.object({
  refundFen: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
const listSchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z.enum(["requested", "approved", "rejected", "completed"]).optional(),
  serviceType: z.literal("refund").optional(),
  returnKind: z.enum(["normal", "special"]).optional(),
  storeId: z.string().uuid().optional(),
  sellerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const trustedOrigin = (
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

const currentUser = async (
  request: FastifyRequest,
  reply: FastifyReply,
  service: AuthService,
): Promise<AuthenticatedUser | null> => {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
  const user = token ? await service.getSessionUser(token) : null;
  if (!user) void reply.status(401).send({ error: "请先登录" });
  return user;
};

const idempotencyKey = (request: FastifyRequest): string | null => {
  const value = request.headers["idempotency-key"];
  return (Array.isArray(value) ? value[0] : value) ?? null;
};

const serviceError = (reply: FastifyReply, error: unknown) => {
  const message = error instanceof Error ? error.message : "操作失败";
  const status = message.includes("不存在") ? 404 : message.startsWith("无权") ? 403 : 400;
  return reply.status(status).send({ error: message });
};

export const registerReturnRoutes = async (
  app: FastifyInstance,
  options: RegisterReturnRoutesOptions,
): Promise<void> => {
  app.get("/api/returns", async (request, reply) => {
    const user = await currentUser(request, reply, options.authService);
    if (!user) return;
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "退单查询条件不正确" });
    }
    try {
      return await options.returnService.listReturns(user, parsed.data);
    } catch (error) {
      return serviceError(reply, error);
    }
  });

  app.get<{ Params: { orderId: string } }>(
    "/api/orders/:orderId/returns",
    async (request, reply) => {
      const user = await currentUser(request, reply, options.authService);
      if (!user) return;
      try {
        return {
          items: await options.returnService.listOrderReturns(
            user,
            request.params.orderId,
          ),
        };
      } catch (error) {
        return serviceError(reply, error);
      }
    },
  );

  app.post<{ Params: { orderId: string } }>(
    "/api/orders/:orderId/returns",
    async (request, reply) => {
      if (!trustedOrigin(request, reply, options.appOrigin)) return;
      const user = await currentUser(request, reply, options.authService);
      if (!user) return;
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, parsed.error, returnFieldLabels, "请检查退单申请信息");
      }
      const key = idempotencyKey(request);
      if (!key) return reply.status(400).send({ error: "缺少幂等键" });
      try {
        const result = await options.returnService.requestReturn(
          user,
          request.params.orderId,
          parsed.data,
          key,
        );
        return reply.status(201).send(result);
      } catch (error) {
        return serviceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/returns/:id/decision",
    async (request, reply) => {
      if (!trustedOrigin(request, reply, options.appOrigin)) return;
      const user = await currentUser(request, reply, options.authService);
      if (!user) return;
      const parsed = decisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, parsed.error, returnFieldLabels, "请填写审批结果和意见");
      }
      try {
        return await options.returnService.decideReturn(
          user,
          request.params.id,
          parsed.data.decision,
          parsed.data.note,
        );
      } catch (error) {
        return serviceError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/returns/:id/complete",
    async (request, reply) => {
      if (!trustedOrigin(request, reply, options.appOrigin)) return;
      const user = await currentUser(request, reply, options.authService);
      if (!user) return;
      const parsed = completionSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, parsed.error, returnFieldLabels, "请检查退款金额");
      }
      const key = idempotencyKey(request);
      if (!key) return reply.status(400).send({ error: "缺少幂等键" });
      try {
        return await options.returnService.completeReturn(
          user,
          request.params.id,
          parsed.data.refundFen,
          key,
        );
      } catch (error) {
        return serviceError(reply, error);
      }
    },
  );
};
