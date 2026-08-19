import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthService } from "../auth/authService.js";
import { registerAuthRoutes } from "./auth.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("登录尝试限制", () => {
  it("超过失败次数后仍允许正确密码登录", async () => {
    const login = vi.fn(async (_identifier: string, password: string) => {
      if (password !== "CorrectPass88") throw new Error("账号或密码错误");
      return {
        token: "a".repeat(64),
        expiresAt: new Date("2026-08-19T10:00:00.000Z"),
        user: {
          id: "user-1",
          displayName: "销售员",
          role: "sales" as const,
          storeId: "store-1",
          storeName: "海口营业厅",
          mustChangePassword: false,
        },
      };
    });
    const authService = {
      login,
      getSessionUser: vi.fn(),
      logout: vi.fn(),
      changePassword: vi.fn(),
    } as unknown as AuthService;
    const app = Fastify();
    apps.push(app);
    await registerAuthRoutes(app, {
      authService,
      appOrigin: "http://127.0.0.1:5173",
      secureCookies: false,
      maxLoginAttempts: 2,
      loginWindowMs: 15 * 60 * 1000,
    });

    const attempt = (password: string) => app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { identifier: "SALES001", password },
    });

    expect((await attempt("wrong-one")).statusCode).toBe(401);
    expect((await attempt("wrong-two")).statusCode).toBe(401);
    const limitedFailure = await attempt("wrong-three");
    expect(limitedFailure.statusCode).toBe(429);
    expect(limitedFailure.json()).toEqual({
      error: "尝试次数过多，请稍后再试；正确密码仍可正常登录",
    });

    const successful = await attempt("CorrectPass88");
    expect(successful.statusCode).toBe(200);
    expect(successful.json().user.id).toBe("user-1");
    expect(login).toHaveBeenCalledTimes(4);
  });
});
