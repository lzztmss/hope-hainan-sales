import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

import { type ApiClient, type ApiUserRole, apiClient } from "./api/client";
import { CommissionRulesRoute } from "./admin/CommissionRulesRoute";
import { UserStoreManagementRoute } from "./admin/UserStoreManagementRoute";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { ChangePasswordPage } from "./auth/ChangePasswordPage";
import { LoginPage } from "./auth/LoginPage";
import {
  AppShell,
  PageLayout,
  type AppRole,
  type NavigationLinkRenderProps,
} from "./components/layout";
import { MyCommissionRoute } from "./commissions/MyCommissionRoute";
import { SalesDashboardPage } from "./dashboard/SalesDashboardPage";
import { OrderManagementRoute } from "./orders/OrderManagementRoute";
import { QuoteWorkflowPage } from "./quote/QuoteWorkflowPage";
import { QuoteListPage } from "./quote/QuoteListPage";
import { QuoteDetailPage } from "./quote/QuoteDetailPage";
import { TeamReportPage } from "./reports/TeamReportPage";
import { ReturnManagementRoute } from "./returns/ReturnManagementRoute";
import { CustomerListPage } from "./customers/CustomerListPage";
import "./salesSystem.css";

export type SalesSystemRoutesProps = {
  client: ApiClient;
};

export type SalesSystemAppProps = {
  client?: ApiClient;
};

const roleForShell = (role: ApiUserRole): AppRole =>
  role === "store_manager" ? "manager" : role;

const SessionStatePage = ({
  error,
  onRetry,
}: {
  error?: string | null;
  onRetry?: () => void;
}) => (
  <main className="system-state-page">
    <section className="system-state-card" aria-live="polite">
      {error ? (
        <>
          <h1>暂时无法连接系统</h1>
          <p role="alert">{error}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              重新加载
            </button>
          ) : null}
        </>
      ) : (
        <>
          <h1>正在验证登录状态</h1>
          <p>请稍候…</p>
        </>
      )}
    </section>
  </main>
);

const LoginRoute = () => {
  const { refresh, status, user } = useAuth();

  if (status === "loading") return <SessionStatePage />;
  if (status === "error") {
    return <SessionStatePage error="登录状态获取失败，请重试" onRetry={() => void refresh()} />;
  }
  if (status === "authenticated" && user) {
    return <Navigate replace to={user.mustChangePassword ? "/change-password" : "/"} />;
  }
  return <LoginPage />;
};

const RequireAuthentication = () => {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "loading") return <SessionStatePage />;
  if (auth.status === "error") {
    return (
      <SessionStatePage
        error={auth.error ?? "登录状态获取失败，请重试"}
        onRetry={() => void auth.refresh()}
      />
    );
  }
  if (auth.status === "anonymous" || !auth.user) {
    return (
      <Navigate
        replace
        state={{ from: `${location.pathname}${location.search}` }}
        to="/login"
      />
    );
  }
  return <Outlet />;
};

const RequirePasswordReady = () => {
  const { user } = useAuth();
  return user?.mustChangePassword ? (
    <Navigate replace to="/change-password" />
  ) : (
    <Outlet />
  );
};

const RouterLink = ({ isCurrent, item }: NavigationLinkRenderProps) => (
  <Link aria-current={isCurrent ? "page" : undefined} to={item.href}>
    {item.label}
  </Link>
);

const AuthenticatedShell = () => {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  if (!auth.user) return null;

  const logout = async () => {
    await auth.logout();
    navigate("/login", { replace: true });
  };

  return (
    <AppShell
      currentPath={location.pathname}
      onLogout={() => void logout()}
      renderLink={RouterLink}
      user={{
        displayName: auth.user.displayName,
        role: roleForShell(auth.user.role),
        storeName: auth.user.storeName ?? undefined,
      }}
    >
      <Outlet />
    </AppShell>
  );
};

const RequireRole = ({ allowed }: { allowed: readonly ApiUserRole[] }) => {
  const { user } = useAuth();
  return user && allowed.includes(user.role) ? <Outlet /> : <AccessDeniedPage />;
};

const AccessDeniedPage = () => (
  <PageLayout
    description="当前账号没有访问此功能的权限。如需处理跨营业厅或管理配置，请联系系统管理员。"
    eyebrow="权限限制"
    title="无权访问此页面"
  >
    <div className="system-notice" role="status">
      您可以通过导航返回当前角色可用的功能。
    </div>
  </PageLayout>
);

const AdminCommissionRoute = ({ client }: { client: ApiClient }) => {
  const { user } = useAuth();
  return user ? <CommissionRulesRoute actor={user} client={client} /> : null;
};

const OrdersRoute = ({ client }: { client: ApiClient }) => {
  const { user } = useAuth();
  const { orderId } = useParams();
  return user ? (
    <OrderManagementRoute
      client={client}
      initialOrderId={orderId}
      viewer={user}
    />
  ) : null;
};

const QuoteDetailRoute = ({ client }: { client: ApiClient }) => {
  const { quoteId } = useParams();
  return quoteId ? <QuoteDetailPage client={client} quoteId={quoteId} /> : null;
};

const QuoteEditRoute = ({ client }: { client: ApiClient }) => {
  const { quoteId } = useParams();
  const [quote, setQuote] = useState<Awaited<ReturnType<ApiClient["getQuote"]>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!quoteId) return;
    setQuote(null);
    setError(null);
    void client.getQuote(quoteId).then((loaded) => {
      if (loaded.status !== "confirmed" || loaded.deletedAt) {
        throw new Error("当前报价已锁定，不能修改");
      }
      setQuote(loaded);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "报价读取失败"));
  }, [client, quoteId]);
  if (error) return <PageLayout title="无法修改报价"><div className="system-notice" role="alert">{error}</div></PageLayout>;
  return quote ? <QuoteWorkflowPage client={client} initialQuote={quote} /> : <PageLayout title="修改报价"><div className="system-notice" role="status">正在读取报价…</div></PageLayout>;
};

const ReturnsRoute = () => {
  const { user } = useAuth();
  return user ? <ReturnManagementRoute actor={user} /> : null;
};

const HomeRoute = () => {
  const { user } = useAuth();
  if (user?.role === "sales") return <SalesDashboardPage />;
  if (user?.role === "store_manager") {
    return <Navigate replace to="/reports/team" />;
  }
  return <Navigate replace to="/reports" />;
};

const PlaceholderPage = ({
  description = "该功能正在接入业务数据，当前没有可展示的内容。",
  title,
}: {
  description?: string;
  title: string;
}) => (
  <PageLayout description={description} title={title}>
    <div className="system-notice" role="status">
      暂无数据
    </div>
  </PageLayout>
);

export const SalesSystemRoutes = ({ client }: SalesSystemRoutesProps) => (
  <Routes>
    <Route path="/login" element={<LoginRoute />} />
    <Route element={<RequireAuthentication />}>
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route element={<RequirePasswordReady />}>
        <Route element={<AuthenticatedShell />}>
          <Route path="/" element={<HomeRoute />} />

          <Route element={<RequireRole allowed={["sales"]} />}>
            <Route path="/quotes/new" element={<QuoteWorkflowPage client={client} />} />
            <Route path="/commissions/my" element={<MyCommissionRoute client={client} />} />
          </Route>

          <Route element={<RequireRole allowed={["sales", "store_manager", "admin"]} />}>
            <Route path="/quotes" element={<QuoteListPage client={client} />} />
            <Route path="/quotes/:quoteId/edit" element={<QuoteEditRoute client={client} />} />
            <Route path="/quotes/:quoteId" element={<QuoteDetailRoute client={client} />} />
            <Route path="/customers" element={<CustomerListPage client={client} />} />
            <Route path="/orders" element={<OrdersRoute client={client} />} />
            <Route path="/orders/:orderId" element={<OrdersRoute client={client} />} />
            <Route path="/profile" element={<PlaceholderPage title="个人中心" />} />
          </Route>

          <Route element={<RequireRole allowed={["store_manager", "admin"]} />}>
            <Route path="/returns" element={<ReturnsRoute />} />
            <Route path="/reports/team" element={<TeamReportPage />} />
          </Route>

          <Route element={<RequireRole allowed={["store_manager"]} />}>
            <Route path="/commissions" element={<PlaceholderPage title="提成汇总" />} />
          </Route>

          <Route element={<RequireRole allowed={["admin"]} />}>
            <Route path="/reports" element={<TeamReportPage />} />
            <Route path="/admin/users" element={<UserStoreManagementRoute />} />
            <Route path="/admin/pricing" element={<PlaceholderPage title="价格版本" />} />
            <Route path="/admin/commissions" element={<AdminCommissionRoute client={client} />} />
            <Route path="/admin/settlements" element={<PlaceholderPage title="结算批次" />} />
            <Route path="/admin/audit" element={<PlaceholderPage title="审计与回收站" />} />
          </Route>

          <Route path="*" element={<PlaceholderPage title="页面不存在" />} />
        </Route>
      </Route>
    </Route>
  </Routes>
);

export const SalesSystemApp = ({ client = apiClient }: SalesSystemAppProps) => (
  <AuthProvider client={client}>
    <BrowserRouter>
      <SalesSystemRoutes client={client} />
    </BrowserRouter>
  </AuthProvider>
);
