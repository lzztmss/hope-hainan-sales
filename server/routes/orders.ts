import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/authService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import {
  OrderServiceError,
  type OrderListFilters,
  type OrderRecord,
  type OrderService,
} from "../orders/orderService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";
import { sendValidationError } from "./validationError.js";

const orderFieldLabels = {
  quoteId: "报价单",
  salesChannel: "销售渠道",
  attributions: "销售归属",
  command: "订单状态操作",
  expectedVersion: "订单版本",
} as const;

export interface RegisterOrderRoutesOptions {
  authService: AuthService;
  orderService: OrderService;
  appOrigin: string;
}

const attributionSchema = z.object({
  beneficiaryId: z.string().uuid(),
  attributionRole: z.enum(["primary", "collaborator"]),
  basisPoints: z.number().int().min(1).max(10_000),
});

const createSchema = z.object({
  quoteId: z.string().uuid(),
  salesChannel: z.enum(["online", "offline"]),
  attributions: z.array(attributionSchema).min(1).max(20).optional(),
});

const transitionSchema = z.object({
  command: z.enum([
    "ACCEPT",
    "ACTIVATE",
    "SIGN",
    "RECONCILE",
    "MARK_PAID",
    "CANCEL",
    "VOID",
    "REQUEST_RETURN",
    "COMPLETE_PARTIAL_RETURN",
    "COMPLETE_FULL_RETURN",
  ]),
  expectedVersion: z.number().int().min(1),
});

const batchTransitionSchema = z.object({
  command: z.enum(["RECONCILE", "MARK_PAID"]),
  items: z.array(z.object({
    orderId: z.string().uuid(),
    expectedVersion: z.number().int().min(1),
  })).min(1).max(100),
});

const batchCommissionPayoutSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(100),
});

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`)));

const listQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  orderNo: z.string().trim().min(1).max(64).optional(),
  customerPhoneTail: z.string().regex(/^\d{4}$/).optional(),
  storeQuery: z.string().trim().min(1).max(160).optional(),
  sellerQuery: z.string().trim().min(1).max(120).optional(),
  status: z
    .enum([
      "pending",
      "accepted",
      "activated",
      "signed",
      "reconciled",
      "paid",
      "cancelled",
      "return_pending",
      "partially_returned",
      "returned",
      "voided",
    ])
    .optional(),
  paymentMode: z.enum(["one_time", "contract_36"]).optional(),
  fttrKind: z.enum(["none", "standard", "custom"]).optional(),
  fttrPlan: z.coerce.number().int().min(1).max(9_999).optional(),
  roomType: z
    .enum(["one_bedroom", "two_bedroom", "three_bedroom"])
    .optional(),
  productSku: z.string().trim().regex(/^[A-Z0-9_]{1,64}$/).optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  signedDateFrom: dateSchema.optional(),
  signedDateTo: dateSchema.optional(),
  commissionPayoutStatus: z.enum(["ineligible", "pending", "paid"]).optional(),
  reconciliationStatus: z.enum(["pending", "reconciled"]).optional(),
  collectionStatus: z.enum(["unpaid", "paid"]).optional(),
  cursor: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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

const sendError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof OrderServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  const message = error instanceof Error ? error.message : "订单操作失败";
  const statusCode = message.includes("不存在") ? 404 : 400;
  return reply.status(statusCode).send({ error: message });
};

const mutationResponse = (order: OrderRecord) => ({
  id: order.id,
  orderNo: order.orderNo,
  quoteId: order.quoteId,
  status: order.status,
  salesChannel: order.salesChannel,
  sellerId: order.sellerId,
  storeId: order.storeId,
  paymentMode: order.paymentMode,
  oneTimeFen: order.oneTimeFen,
  monthlyTotalFen: order.monthlyTotalFen,
  contract36Fen: order.contract36Fen,
  deletedAt: order.deletedAt,
  version: order.version,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

const parseListFilters = (
  query: unknown,
): { success: true; filters: OrderListFilters } | { success: false } => {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) return { success: false };
  const dateFrom = parsed.data.dateFrom
    ? new Date(`${parsed.data.dateFrom}T00:00:00+08:00`)
    : undefined;
  const dateTo = parsed.data.dateTo
    ? new Date(
        new Date(`${parsed.data.dateTo}T00:00:00+08:00`).getTime() +
          24 * 60 * 60 * 1000,
      )
    : undefined;
  const signedDateFrom = parsed.data.signedDateFrom
    ? new Date(`${parsed.data.signedDateFrom}T00:00:00+08:00`)
    : undefined;
  const signedDateTo = parsed.data.signedDateTo
    ? new Date(new Date(`${parsed.data.signedDateTo}T00:00:00+08:00`).getTime() + 86_400_000)
    : undefined;
  if (dateFrom && dateTo && dateFrom >= dateTo) return { success: false };
  if (signedDateFrom && signedDateTo && signedDateFrom >= signedDateTo) return { success: false };
  return {
    success: true,
    filters: {
      query: parsed.data.query,
      orderNo: parsed.data.orderNo,
      customerPhoneTail: parsed.data.customerPhoneTail,
      storeQuery: parsed.data.storeQuery,
      sellerQuery: parsed.data.sellerQuery,
      status: parsed.data.status,
      paymentMode: parsed.data.paymentMode,
      fttrKind: parsed.data.fttrKind,
      fttrPlan: parsed.data.fttrPlan,
      roomType: parsed.data.roomType,
      productSku: parsed.data.productSku,
      dateFrom,
      dateTo,
      signedDateFrom,
      signedDateTo,
      commissionPayoutStatus: parsed.data.commissionPayoutStatus,
      reconciliationStatus: parsed.data.reconciliationStatus,
      collectionStatus: parsed.data.collectionStatus,
      cursor: parsed.data.cursor,
      page: parsed.data.page ?? (parsed.data.cursor ? undefined : 1),
      limit: parsed.data.limit,
    },
  };
};

export const registerOrderRoutes = async (
  app: FastifyInstance,
  options: RegisterOrderRoutesOptions,
): Promise<void> => {
  app.post("/api/orders", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error, orderFieldLabels, "请检查订单信息");
    }
    const keyHeader = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!idempotencyKey) {
      return reply.status(400).send({ error: "缺少幂等键" });
    }
    try {
      const order = await options.orderService.createOrderFromQuote(
        user,
        parsed.data.quoteId,
        parsed.data.salesChannel,
        parsed.data.attributions,
        idempotencyKey,
      );
      return reply.status(201).send(mutationResponse(order));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/orders/recycle-bin", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = parseListFilters(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "查询条件不正确" });
    }
    try {
      return await options.orderService.listRecycleBin(user, parsed.filters);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/orders", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = parseListFilters(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "查询条件不正确" });
    }
    try {
      return await options.orderService.listOrders(user, parsed.filters);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/order-filter-options", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    try {
      return await options.orderService.listFilterOptions(user);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/orders/:id",
    async (request, reply) => {
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      try {
        return await options.orderService.getOrder(user, request.params.id);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/orders/:id/transitions",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      const parsed = transitionSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendValidationError(reply, parsed.error, orderFieldLabels, "请检查订单状态操作");
      }
      try {
        return mutationResponse(
          await options.orderService.transitionOrder(
            user,
            request.params.id,
            parsed.data.command,
            parsed.data.expectedVersion,
          ),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post("/api/orders/batch-transitions", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = batchTransitionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "批量订单参数不正确" });
    try {
      return await options.orderService.batchTransitionOrders(user, parsed.data.items, parsed.data.command);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/orders/batch-commission-payout", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = batchCommissionPayoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "批量发放参数不正确" });
    const keyHeader = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!idempotencyKey) return reply.status(400).send({ error: "缺少幂等键" });
    try {
      return await options.orderService.batchPayCommissions(user, parsed.data.orderIds, idempotencyKey);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>(
    "/api/orders/:id",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      try {
        return mutationResponse(
          await options.orderService.softDeleteOrder(user, request.params.id),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/orders/:id/restore",
    async (request, reply) => {
      if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      try {
        return mutationResponse(
          await options.orderService.restoreOrder(user, request.params.id),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
};
