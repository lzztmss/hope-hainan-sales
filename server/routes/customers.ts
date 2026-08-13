import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/authService.js";
import type { CustomerService } from "../customers/customerService.js";
import { SESSION_COOKIE_NAME } from "./auth.js";

const querySchema = z.object({
  query: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

const resolveUser = async (
  request: FastifyRequest,
  reply: FastifyReply,
  authService: AuthService,
) => {
  const token = request.cookies?.[SESSION_COOKIE_NAME];
  const user = token ? await authService.getSessionUser(token) : null;
  if (!user) void reply.status(401).send({ error: "请先登录" });
  return user;
};

export const registerCustomerRoutes = async (
  app: FastifyInstance,
  options: { authService: AuthService; customerService: CustomerService },
) => {
  app.get("/api/customers", async (request, reply) => {
    const user = await resolveUser(request, reply, options.authService);
    if (!user) return;
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: "客户查询条件不正确" });
    return options.customerService.listCustomers(
      user,
      parsed.data.query,
      parsed.data.limit,
    );
  });
};
