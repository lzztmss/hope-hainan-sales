import Fastify, {
  type FastifyError,
  type FastifyInstance,
} from "fastify";

import type { AuthService } from "./auth/authService.js";
import type { AdminService } from "./admin/adminService.js";
import type { CommissionRuleService } from "./commissions/ruleService.js";
import type { CommissionDashboardService } from "./commissions/dashboardService.js";
import type { OrderService } from "./orders/orderService.js";
import type { QuoteService } from "./quotes/quoteService.js";
import type { ReturnService } from "./returns/returnService.js";
import type { SalesReportService } from "./reports/salesReportService.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCommissionRuleRoutes } from "./routes/commissionRules.js";
import { registerCommissionDashboardRoutes } from "./routes/commissionDashboard.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerQuoteRoutes } from "./routes/quotes.js";
import { registerReturnRoutes } from "./routes/returns.js";
import { registerReportRoutes } from "./routes/reports.js";

export interface AppDependencies {
  authService?: AuthService;
  quoteService?: QuoteService;
  commissionRuleService?: CommissionRuleService;
  commissionDashboardService?: CommissionDashboardService;
  orderService?: OrderService;
  returnService?: ReturnService;
  adminService?: AdminService;
  salesReportService?: SalesReportService;
  appOrigin?: string;
  secureCookies?: boolean;
  onClose?: () => Promise<void>;
}

export const buildApp = (
  _dependencies: AppDependencies = {},
): FastifyInstance => {
  const app = Fastify({
    logger: false,
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.headers({
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    return payload;
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "hainan-fttr-sales",
  }));

  if (_dependencies.authService) {
    app.register(async (securedApp) => {
      await registerAuthRoutes(securedApp, {
        authService: _dependencies.authService!,
        appOrigin: _dependencies.appOrigin ?? "http://127.0.0.1:5173",
        secureCookies: _dependencies.secureCookies ?? false,
      });
      if (_dependencies.quoteService) {
        await registerQuoteRoutes(securedApp, {
          authService: _dependencies.authService!,
          quoteService: _dependencies.quoteService,
          appOrigin: _dependencies.appOrigin ?? "http://127.0.0.1:5173",
        });
      }
      if (_dependencies.commissionRuleService) {
        await registerCommissionRuleRoutes(securedApp, {
          authService: _dependencies.authService!,
          ruleService: _dependencies.commissionRuleService,
          appOrigin: _dependencies.appOrigin ?? "http://127.0.0.1:5173",
        });
      }
      if (_dependencies.commissionDashboardService) {
        await registerCommissionDashboardRoutes(securedApp, {
          authService: _dependencies.authService!,
          commissionDashboardService: _dependencies.commissionDashboardService,
        });
      }
      if (_dependencies.orderService) {
        await registerOrderRoutes(securedApp, {
          authService: _dependencies.authService!,
          orderService: _dependencies.orderService,
          appOrigin: _dependencies.appOrigin ?? "http://127.0.0.1:5173",
        });
      }
      if (_dependencies.returnService) {
        await registerReturnRoutes(securedApp, {
          authService: _dependencies.authService!,
          returnService: _dependencies.returnService,
          appOrigin: _dependencies.appOrigin ?? "http://127.0.0.1:5173",
        });
      }
      if (_dependencies.adminService) {
        await registerAdminRoutes(securedApp, {
          authService: _dependencies.authService!,
          adminService: _dependencies.adminService,
          appOrigin: _dependencies.appOrigin ?? "http://127.0.0.1:5173",
        });
      }
      if (_dependencies.salesReportService) {
        await registerReportRoutes(securedApp, {
          authService: _dependencies.authService!,
          salesReportService: _dependencies.salesReportService,
          appOrigin: _dependencies.appOrigin ?? "http://127.0.0.1:5173",
        });
      }
    });
  }

  if (_dependencies.onClose) {
    app.addHook("onClose", async () => _dependencies.onClose?.());
  }

  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    void reply.status(statusCode).send({
      error: statusCode >= 500 ? "服务暂时不可用" : error.message,
    });
  });

  return app;
};
