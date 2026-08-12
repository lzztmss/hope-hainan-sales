import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AUTHENTICATION_FAILED_MESSAGE,
  type AuthService,
} from "../auth/authService.js";

export const SESSION_COOKIE_NAME = "hainan_fttr_session";

export interface RegisterAuthRoutesOptions {
  authService: AuthService;
  appOrigin: string;
  secureCookies: boolean;
  maxLoginAttempts?: number;
  loginWindowMs?: number;
}

const loginBodySchema = z.object({
  identifier: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128),
});

const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

class LoginAttemptLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
  ) {}

  isLimited(key: string, now: number): boolean {
    const active = (this.attempts.get(key) ?? []).filter(
      (timestamp) => now - timestamp < this.windowMs,
    );
    this.attempts.set(key, active);
    return active.length >= this.maxAttempts;
  }

  recordFailure(key: string, now: number): void {
    const current = this.attempts.get(key) ?? [];
    current.push(now);
    this.attempts.set(key, current);
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}

const getToken = (request: FastifyRequest): string | null =>
  request.cookies[SESSION_COOKIE_NAME] ?? null;

const enforceTrustedOrigin = (
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

export const registerAuthRoutes = async (
  app: FastifyInstance,
  options: RegisterAuthRoutesOptions,
): Promise<void> => {
  await app.register(cookie);
  const limiter = new LoginAttemptLimiter(
    options.maxLoginAttempts ?? 5,
    options.loginWindowMs ?? 15 * 60 * 1000,
  );
  const cookieOptions = {
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: "lax" as const,
    path: "/",
  };

  app.post("/api/auth/login", async (request, reply) => {
    if (!enforceTrustedOrigin(request, reply, options.appOrigin)) return;
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "请输入工号/手机号和密码" });
    }

    const limiterKey = `${request.ip}:${parsed.data.identifier.trim().toUpperCase()}`;
    const attemptAt = Date.now();
    if (limiter.isLimited(limiterKey, attemptAt)) {
      return reply
        .status(429)
        .send({ error: "尝试次数过多，请稍后再试" });
    }

    try {
      const result = await options.authService.login(
        parsed.data.identifier,
        parsed.data.password,
        {
          ip: request.ip,
          userAgent: request.headers["user-agent"],
        },
      );
      limiter.clear(limiterKey);
      reply.setCookie(SESSION_COOKIE_NAME, result.token, {
        ...cookieOptions,
        expires: result.expiresAt,
      });
      return { user: result.user };
    } catch {
      limiter.recordFailure(limiterKey, attemptAt);
      return reply.status(401).send({ error: AUTHENTICATION_FAILED_MESSAGE });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    const token = getToken(request);
    const user = token
      ? await options.authService.getSessionUser(token)
      : null;
    if (!user) return reply.status(401).send({ error: "请先登录" });
    return { user };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (!enforceTrustedOrigin(request, reply, options.appOrigin)) return;
    const token = getToken(request);
    if (token) await options.authService.logout(token);
    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    return { success: true };
  });

  app.post("/api/auth/change-password", async (request, reply) => {
    if (!enforceTrustedOrigin(request, reply, options.appOrigin)) return;
    const token = getToken(request);
    if (!token || !(await options.authService.getSessionUser(token))) {
      return reply.status(401).send({ error: "请先登录" });
    }

    const parsed = changePasswordBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "新密码长度必须为12至128位" });
    }
    try {
      const user = await options.authService.changePassword(
        token,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      return { user };
    } catch (error) {
      const message = error instanceof Error ? error.message : "密码修改失败";
      return reply.status(400).send({ error: message });
    }
  });
};
