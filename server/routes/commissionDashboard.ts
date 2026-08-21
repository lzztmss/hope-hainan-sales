import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/authService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import {
  CommissionDashboardError,
  type CommissionDashboardFilters,
  type CommissionDashboardService,
} from "../commissions/dashboardService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";

export interface RegisterCommissionDashboardRoutesOptions {
  authService: AuthService;
  commissionDashboardService: CommissionDashboardService;
}

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional();

const pagingSchema = {
  month: monthSchema,
  cursor: z.string().trim().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

const meQuerySchema = z.object(pagingSchema);

const dashboardQuerySchema = z.object({
  ...pagingSchema,
  storeId: z.string().uuid().optional(),
  beneficiaryId: z.string().uuid().optional(),
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

const sendServiceError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof CommissionDashboardError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 400;
  const message = error instanceof Error ? error.message : "提成查询失败";
  return reply.status(statusCode).send({ error: message });
};

const invalidQuery = (reply: FastifyReply) =>
  reply.status(400).send({ error: "提成查询条件不正确" });

export const registerCommissionDashboardRoutes = async (
  app: FastifyInstance,
  options: RegisterCommissionDashboardRoutesOptions,
): Promise<void> => {
  app.get("/api/commissions/me", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = meQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply);
    const filters: CommissionDashboardFilters = {
      month: parsed.data.month,
      beneficiaryId: user.id,
      storeId: user.storeId ?? undefined,
      cursor: parsed.data.cursor,
      page: parsed.data.page,
      limit: parsed.data.limit,
    };
    try {
      return await options.commissionDashboardService.getDashboard(user, filters);
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.get("/api/commissions/dashboard", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = dashboardQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidQuery(reply);
    const filters: CommissionDashboardFilters = {
      month: parsed.data.month,
      storeId: parsed.data.storeId,
      beneficiaryId: parsed.data.beneficiaryId,
      cursor: parsed.data.cursor,
      page: parsed.data.page,
      limit: parsed.data.limit,
    };
    try {
      return await options.commissionDashboardService.getDashboard(user, filters);
    } catch (error) {
      return sendServiceError(reply, error);
    }
  });

  app.get<{ Params: { orderId: string } }>(
    "/api/commissions/orders/:orderId",
    async (request, reply) => {
      const user = await resolveUser(request, reply, options.authService);
      if (!user) return;
      if (!z.string().uuid().safeParse(request.params.orderId).success) {
        return invalidQuery(reply);
      }
      try {
        return await options.commissionDashboardService.getOrderDetail(
          user,
          request.params.orderId,
        );
      } catch (error) {
        return sendServiceError(reply, error);
      }
    },
  );
};
