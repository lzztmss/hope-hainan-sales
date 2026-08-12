import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { SalesReportFilters } from "../../shared/reports/types.js";
import type { AuthService } from "../auth/authService.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { SalesReportError, type SalesReportService } from "../reports/salesReportService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";

export interface RegisterReportRoutesOptions {
  authService: AuthService;
  salesReportService: SalesReportService;
  appOrigin: string;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const filtersSchema = z.object({
  from: date,
  to: date,
  storeId: z.string().uuid().optional(),
  sellerId: z.string().uuid().optional(),
  groupBy: z.enum(["none", "store", "seller"]).optional(),
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

const sendError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof SalesReportError || (error instanceof Error && "statusCode" in error)) {
    const statusCode =
      "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 400;
    return reply.status(statusCode).send({ error: error.message });
  }
  return reply.status(500).send({ error: "销售报表生成失败" });
};

const parseFilters = (value: unknown): SalesReportFilters | null => {
  const parsed = filtersSchema.safeParse(value);
  return parsed.success
    ? {
        from: parsed.data.from,
        to: parsed.data.to,
        storeId: parsed.data.storeId,
        sellerId: parsed.data.sellerId,
        groupBy: parsed.data.groupBy,
      }
    : null;
};

export const registerReportRoutes = async (
  app: FastifyInstance,
  options: RegisterReportRoutesOptions,
): Promise<void> => {
  app.get("/api/reports/sales", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const filters = parseFilters(request.query);
    if (!filters) return reply.status(400).send({ error: "报表查询条件不正确" });
    try {
      return await options.salesReportService.getReport(user, filters);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/reports/sales/export.csv", async (request, reply) => {
    if (!ensureTrustedOrigin(request, reply, options.appOrigin)) return;
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const filters = parseFilters(request.body);
    if (!filters) return reply.status(400).send({ error: "报表导出条件不正确" });
    try {
      const exported = await options.salesReportService.exportCsv(user, filters, request.ip);
      const encoded = encodeURIComponent(exported.fileName);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="sales-report.csv"; filename*=UTF-8''${encoded}`,
        )
        .send(exported.csv);
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
