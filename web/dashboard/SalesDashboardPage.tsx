import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  Banknote,
  ClipboardCheck,
  Contact,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  PackageCheck,
  Search,
  Settings2,
  ShieldCheck,
  Undo2,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { SalesReportFilters, SalesReportResponse } from "../../shared/reports/types";
import type { ApiClient, ApiUserRole, AuthenticatedUser, OrderDto, QuoteDetailDto, QuoteStatus } from "../api/client";
import { PageLayout } from "../components/layout";
import { Badge } from "../components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "../components/ui/table";
import { usePageAutoRefresh } from "../hooks/usePageAutoRefresh";
import { ReportFilters } from "../reports/ReportFilters";
import { formatReportFen, formatReportRate, ReportSummary } from "../reports/ReportSummary";
import { reportsApi } from "../reports/reportApi";
import { defaultShanghaiReportFilters } from "../reports/reportDates";
import "../reports/reports.css";
import "./salesDashboard.css";

const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  confirmed: "已确认",
  converted: "已转订单",
  expired: "已过期",
  lost: "未成交",
  voided: "已作废",
};

const QUOTE_STATUS_VARIANTS: Record<QuoteStatus, "secondary" | "outline" | "destructive"> = {
  confirmed: "secondary",
  converted: "outline",
  expired: "destructive",
  lost: "destructive",
  voided: "outline",
};

const PENDING_ORDER_COPY: Partial<Record<OrderDto["status"], { label: string; icon: LucideIcon }>> = {
  pending: { label: "等待受理", icon: ClipboardCheck },
  accepted: { label: "等待业务生效", icon: PackageCheck },
  activated: { label: "等待确认签收", icon: ClipboardCheck },
  signed: { label: "等待财务对账", icon: FileSpreadsheet },
  reconciled: { label: "等待确认收款", icon: WalletCards },
  return_pending: { label: "售后申请待处理", icon: Undo2 },
};

interface QuickAction {
  href: string;
  icon: LucideIcon;
  label: string;
}

const QUICK_ACTIONS: Record<ApiUserRole, readonly QuickAction[]> = {
  sales: [
    { href: "/quotes/new", icon: FilePlus2, label: "新建客户报价" },
    { href: "/customers", icon: Search, label: "查找客户档案" },
    { href: "/orders", icon: PackageCheck, label: "查看订单进度" },
    { href: "/commissions/my", icon: BadgeDollarSign, label: "查看我的提成" },
  ],
  store_manager: [
    { href: "/quotes", icon: FileText, label: "管理本厅报价" },
    { href: "/orders", icon: PackageCheck, label: "处理本厅订单" },
    { href: "/returns", icon: Undo2, label: "处理售后申请" },
    { href: "/reports/team", icon: FileSpreadsheet, label: "查看团队报表" },
  ],
  regional_manager: [
    { href: "/reports/team", icon: FileSpreadsheet, label: "查看大区报表" },
    { href: "/commissions/regional", icon: BadgeDollarSign, label: "查看大区经理提成" },
    { href: "/regional/users", icon: Users, label: "查看销售名单" },
    { href: "/returns", icon: Undo2, label: "处理售后申请" },
  ],
  hr: [
    { href: "/reports", icon: FileSpreadsheet, label: "查看全公司报表" },
    { href: "/commissions/regional", icon: BadgeDollarSign, label: "管理大区经理提成" },
    { href: "/commissions/sales", icon: Contact, label: "查看销售提成明细" },
    { href: "/commissions/regional/personal-orders", icon: FilePlus2, label: "录入个人渠道订单" },
  ],
  finance: [
    { href: "/reports", icon: FileSpreadsheet, label: "查看全公司报表" },
    { href: "/orders", icon: WalletCards, label: "处理对账与收款" },
    { href: "/returns", icon: Undo2, label: "处理退款事项" },
    { href: "/commissions/regional", icon: BadgeDollarSign, label: "查看大区提成" },
  ],
  admin: [
    { href: "/admin/users", icon: Users, label: "管理营业厅与账号" },
    { href: "/admin/commissions", icon: Settings2, label: "维护提成规则" },
    { href: "/admin/settlements", icon: WalletCards, label: "管理结算批次" },
    { href: "/admin/audit", icon: ShieldCheck, label: "查看审计记录" },
  ],
};

const ROLE_COPY: Record<ApiUserRole, { eyebrow: string; description: string; scope: string }> = {
  sales: {
    eyebrow: "个人工作台",
    description: "查看本人最新报价、订单进度、销售数据与提成状态。",
    scope: "个人销售数据",
  },
  store_manager: {
    eyebrow: "营业厅工作台",
    description: "集中掌握本厅报价、订单、售后与团队经营情况。",
    scope: "本营业厅经营数据",
  },
  regional_manager: {
    eyebrow: "大区工作台",
    description: "掌握所管营业厅的销售进度、业务待办与提成完成情况。",
    scope: "所管营业厅经营数据",
  },
  hr: {
    eyebrow: "人力工作台",
    description: "查看全公司销售与提成数据，处理大区经理目标及相关业务资料。",
    scope: "全公司经营数据",
  },
  finance: {
    eyebrow: "财务工作台",
    description: "查看全公司订单、收款、退款和提成结算相关数据。",
    scope: "全公司财务数据",
  },
  admin: {
    eyebrow: "系统工作台",
    description: "查看全局业务运行情况，并进入账号、规则、结算与审计管理。",
    scope: "全局经营数据",
  },
};

const money = (fen: number) => formatReportFen(fen).replace(".00", "");

const formatDateTime = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(value));

const shanghaiDateKey = (value: Date | string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(typeof value === "string" ? new Date(value) : value);

const sellerNameFromSnapshot = (order: OrderDto) => {
  const snapshot = order.sellerSnapshot;
  if (!snapshot) return "销售员";
  const value = snapshot.displayName ?? snapshot.name;
  return typeof value === "string" && value.trim() ? value : "销售员";
};

export interface SalesDashboardPageProps {
  client: ApiClient;
  viewer: AuthenticatedUser;
  initialReport?: SalesReportResponse;
  onLoad?: (filters: SalesReportFilters) => Promise<SalesReportResponse>;
  onExport?: (filters: SalesReportFilters) => Promise<void> | void;
}

export const SalesDashboardPage = ({
  client,
  viewer,
  initialReport,
  onLoad = reportsApi.getSalesReport,
  onExport = reportsApi.exportSalesReport,
}: SalesDashboardPageProps) => {
  const [report, setReport] = useState(initialReport);
  const [quotes, setQuotes] = useState<readonly QuoteDetailDto[]>([]);
  const [orders, setOrders] = useState<readonly OrderDto[]>([]);
  const [quoteTotal, setQuoteTotal] = useState(0);
  const [storeNames, setStoreNames] = useState<Record<string, string>>({});
  const [sellerNames, setSellerNames] = useState<Record<string, string>>({});
  const [quoteQuery, setQuoteQuery] = useState("");
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [operationalBusy, setOperationalBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationalError, setOperationalError] = useState<string | null>(null);
  const defaults = useMemo(() => defaultShanghaiReportFilters(), []);
  const initialFilters: SalesReportFilters = useMemo(() => ({
    from: report?.period.from ?? defaults.from,
    to: report?.period.to ?? defaults.to,
    groupBy: "none",
  }), [defaults.from, defaults.to, report?.period.from, report?.period.to]);
  const appliedFilters = useRef(initialFilters);
  const initialLoadStarted = useRef(false);
  const operationalLoadStarted = useRef(false);
  const copy = ROLE_COPY[viewer.role];

  const loadReport = useCallback(async (filters: SalesReportFilters, background = false) => {
    if (!background) {
      setBusy(true);
      setError(null);
    }
    try {
      setReport(await onLoad({ ...filters, groupBy: "none" }));
      setError(null);
    } catch (reason) {
      if (!background) setError(reason instanceof Error ? reason.message : "销售报表加载失败");
    } finally {
      if (!background) setBusy(false);
    }
  }, [onLoad]);

  const loadOperationalData = useCallback(async (background = false) => {
    if (!background) {
      setOperationalBusy(true);
      setOperationalError(null);
    }
    const [quoteResult, orderResult, optionResult] = await Promise.allSettled([
      client.listQuotes({ page: 1, pageSize: 8 }),
      client.listOrders({ page: 1, limit: 12 }),
      client.listOrderFilterOptions(),
    ]);

    if (quoteResult.status === "fulfilled") {
      setQuotes(quoteResult.value.items);
      setQuoteTotal(quoteResult.value.total);
    }
    if (orderResult.status === "fulfilled") setOrders(orderResult.value.items);
    if (optionResult.status === "fulfilled") {
      setStoreNames(Object.fromEntries(optionResult.value.stores.map((item) => [item.id, item.label])));
      setSellerNames(Object.fromEntries(optionResult.value.sellers.map((item) => [item.id, item.label])));
    }
    if (quoteResult.status === "rejected" || orderResult.status === "rejected") {
      setOperationalError("部分实时业务数据暂时无法加载，请进入对应列表查看。");
    } else {
      setOperationalError(null);
    }
    if (!background) setOperationalBusy(false);
  }, [client]);

  useEffect(() => {
    if (!initialReport && !initialLoadStarted.current) {
      initialLoadStarted.current = true;
      void loadReport(appliedFilters.current);
    }
    if (!operationalLoadStarted.current) {
      operationalLoadStarted.current = true;
      void loadOperationalData();
    }
  }, [initialReport, loadOperationalData, loadReport]);

  usePageAutoRefresh({
    enabled: Boolean(report) && !busy && !operationalBusy,
    intervalMs: 60_000,
    onRefresh: async () => {
      await Promise.all([
        loadReport(appliedFilters.current, true),
        loadOperationalData(true),
      ]);
    },
  });

  const visibleQuotes = useMemo(() => {
    const normalizedQuery = quoteQuery.trim().toLowerCase();
    return quotes.filter((quote) => {
      const matchesQuery = !normalizedQuery || [
        quote.quoteNo,
        quote.customer.name,
        quote.customer.phoneMasked,
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesQuery && (!quoteStatus || quote.status === quoteStatus);
    }).slice(0, 5);
  }, [quoteQuery, quoteStatus, quotes]);

  const pendingOrders = useMemo(() => orders
    .filter((order) => PENDING_ORDER_COPY[order.status])
    .slice(0, 4), [orders]);

  const trendDays = useMemo(() => {
    const end = report?.period.to
      ? new Date(`${report.period.to}T00:00:00+08:00`)
      : new Date();
    const quoteByDay = new Map<string, number>();
    const orderByDay = new Map<string, number>();
    quotes.forEach((quote) => {
      const key = shanghaiDateKey(quote.updatedAt);
      quoteByDay.set(key, (quoteByDay.get(key) ?? 0) + 1);
    });
    orders.forEach((order) => {
      const key = shanghaiDateKey(order.updatedAt);
      orderByDay.set(key, (orderByDay.get(key) ?? 0) + 1);
    });
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(end);
      day.setUTCDate(end.getUTCDate() - (6 - index));
      const key = shanghaiDateKey(day);
      return {
        label: key.slice(5).replace("-", "/"),
        key,
        quotes: quoteByDay.get(key) ?? 0,
        orders: orderByDay.get(key) ?? 0,
      };
    });
  }, [orders, quotes, report?.period.to]);

  const trendMax = Math.max(1, ...trendDays.map((day) => day.orders));
  const trendOrderTotal = trendDays.reduce((total, day) => total + day.orders, 0);

  const metrics = report?.totals;
  const primaryAction = QUICK_ACTIONS[viewer.role][0];

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={`您好，${viewer.displayName}`}
      description={copy.description}
      actions={primaryAction ? (
        <Link className="operations-primary-action" to={primaryAction.href}>
          <primaryAction.icon aria-hidden="true" />
          {primaryAction.label}
        </Link>
      ) : undefined}
    >
      <div className="operations-dashboard" aria-label={`${copy.scope}工作台`}>
        <p className="operations-dashboard__scope">{copy.scope}{viewer.storeName ? ` · ${viewer.storeName}` : ""}</p>

        <section className="operations-metrics" aria-label="关键指标">
          <Card className="operations-metric" size="sm">
            <CardContent><span>本期报价</span><FileText aria-hidden="true" /><strong>{metrics?.quoteCount.toLocaleString("zh-CN") ?? "--"}</strong><small>按当前报表周期统计</small></CardContent>
          </Card>
          <Card className="operations-metric" size="sm">
            <CardContent><span>成交订单</span><PackageCheck aria-hidden="true" /><strong>{metrics?.orderCount.toLocaleString("zh-CN") ?? "--"}</strong><small>成交率 {metrics ? formatReportRate(metrics.conversionRateBps) : "--"}</small></CardContent>
          </Card>
          <Card className="operations-metric" size="sm">
            <CardContent><span>设备净额</span><Banknote aria-hidden="true" /><strong>{metrics ? money(metrics.oneTimeNetFen) : "--"}</strong><small>{metrics ? `已扣除退单 ${money(metrics.returnedFen)}` : "按当前报表周期统计"}</small></CardContent>
          </Card>
          <Card className="operations-metric" size="sm">
            <CardContent><span>预计提成</span><BadgeDollarSign aria-hidden="true" /><strong>{metrics ? money(metrics.commissionEstimatedFen) : "--"}</strong><small>{metrics ? `待结算 ${money(metrics.commissionPendingSettlementFen)}` : "按当前报表周期统计"}</small></CardContent>
          </Card>
        </section>

        {operationalError ? <p className="operations-dashboard__notice" role="status">{operationalError}</p> : null}

        <div className="operations-workspace">
          <div className="operations-stack operations-stack--main">
            <Card className="operations-panel operations-recent-quotes">
              <CardHeader className="operations-panel__header">
                <CardTitle><h2>最近报价</h2></CardTitle>
                <CardDescription>{operationalBusy ? "正在读取…" : `当前范围共 ${quoteTotal} 笔`}</CardDescription>
                <CardAction><Link className="operations-text-action" to="/quotes">查看全部 <ArrowRight aria-hidden="true" /></Link></CardAction>
              </CardHeader>
              <div className="operations-filterbar">
                <label className="operations-search"><Search aria-hidden="true" /><span className="sr-only">搜索最近报价</span><Input placeholder="报价单号、客户姓名或手机号" type="search" value={quoteQuery} onChange={(event) => setQuoteQuery(event.currentTarget.value)} /></label>
                <label><span className="sr-only">报价状态</span><select value={quoteStatus} onChange={(event) => setQuoteStatus(event.currentTarget.value as QuoteStatus | "")}><option value="">全部状态</option>{Object.entries(QUOTE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <button type="button" onClick={() => { setQuoteQuery(""); setQuoteStatus(""); }}>重置</button>
              </div>
              <CardContent className="operations-table-content">
                <Table aria-label="最近报价列表">
                  <TableHeader><TableRow><TableHead>报价单号 / 客户</TableHead><TableHead>归属</TableHead><TableHead>金额</TableHead><TableHead>状态</TableHead><TableHead>更新时间</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {visibleQuotes.map((quote) => (
                      <TableRow key={quote.id}>
                        <TableCell><strong>{quote.quoteNo}</strong><small>{quote.customer.name} · {quote.customer.phoneMasked}</small></TableCell>
                        <TableCell><strong>{storeNames[quote.storeId] ?? viewer.storeName ?? "营业厅"}</strong><small>{sellerNames[quote.sellerId] ?? (quote.sellerId === viewer.id ? viewer.displayName : "销售员")}</small></TableCell>
                        <TableCell><strong>{money(quote.calculation.oneTimeFen)}</strong><small>月费 {money(quote.calculation.monthlyTotalFen)}</small></TableCell>
                        <TableCell><Badge variant={QUOTE_STATUS_VARIANTS[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</Badge></TableCell>
                        <TableCell>{formatDateTime(quote.updatedAt)}</TableCell>
                        <TableCell><Link className="operations-row-action" to={`/quotes/${quote.id}`}>查看</Link></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!operationalBusy && visibleQuotes.length === 0 ? <p className="operations-empty">没有符合条件的最近报价</p> : null}
              </CardContent>
            </Card>

            <Card className="operations-panel">
              <CardHeader className="operations-panel__header">
                <CardTitle><h2>订单待办</h2></CardTitle>
                <CardDescription>当前角色可见范围内的近期事项</CardDescription>
                <CardAction><Link className="operations-text-action" to="/orders">订单列表 <ArrowRight aria-hidden="true" /></Link></CardAction>
              </CardHeader>
              <CardContent className="operations-task-list">
                {pendingOrders.map((order) => {
                  const task = PENDING_ORDER_COPY[order.status]!;
                  const Icon = task.icon;
                  return <Link className="operations-task" key={order.id} to={`/orders/${order.id}`}>
                    <span className="operations-task__icon"><Icon aria-hidden="true" /></span>
                    <span><strong>订单 {order.orderNo} {task.label}</strong><small>{order.customer.name ?? "客户"} · {sellerNames[order.sellerId] ?? sellerNameFromSnapshot(order)}</small></span>
                    <time dateTime={order.updatedAt}>{formatDateTime(order.updatedAt)}</time>
                  </Link>;
                })}
                {!operationalBusy && pendingOrders.length === 0 ? <p className="operations-empty">近期没有待处理订单</p> : null}
              </CardContent>
            </Card>
          </div>

          <aside className="operations-stack" aria-label="业务辅助信息">
            <Card className="operations-panel">
              <CardHeader className="operations-panel__header"><CardTitle><h2>成交趋势</h2></CardTitle><CardDescription>近 7 天 · 上海时间</CardDescription></CardHeader>
              <CardContent className="operations-trend">
                <div className="operations-trend__meta"><div><strong>{trendOrderTotal}</strong><span>近 7 天成交订单</span></div><Badge variant="secondary">报价 {quotes.length}</Badge></div>
                <div className="operations-trend__bars" aria-label="近七日成交订单柱状图">
                  {trendDays.map((day) => <div className="operations-trend__bar" key={day.key}><span style={{ height: `${Math.max(day.orders ? 12 : 0, (day.orders / trendMax) * 100)}%` }} title={`${day.label}：${day.orders} 笔订单，${day.quotes} 笔报价`} /><small>{day.label}</small></div>)}
                </div>
              </CardContent>
            </Card>

            <Card className="operations-panel">
              <CardHeader className="operations-panel__header"><CardTitle><h2>提成状态</h2></CardTitle><CardDescription>当前报表周期</CardDescription>{viewer.role === "sales" ? <CardAction><Link className="operations-text-action" to="/commissions/my">查看明细 <ArrowRight aria-hidden="true" /></Link></CardAction> : null}</CardHeader>
              <CardContent className="operations-commission-grid">
                <div><span>预计提成</span><strong>{metrics ? money(metrics.commissionEstimatedFen) : "--"}</strong></div>
                <div><span>已发放</span><strong>{metrics ? money(metrics.commissionPaidFen) : "--"}</strong></div>
                <div><span>待结算</span><strong>{metrics ? money(metrics.commissionPendingSettlementFen) : "--"}</strong></div>
                <div className="is-danger"><span>退单扣回</span><strong>{metrics ? money(metrics.commissionReversedFen) : "--"}</strong></div>
              </CardContent>
            </Card>

            <Card className="operations-panel">
              <CardHeader className="operations-panel__header"><CardTitle><h2>快捷操作</h2></CardTitle><CardDescription>按当前账号权限展示</CardDescription></CardHeader>
              <CardContent className="operations-quick-actions">
                {QUICK_ACTIONS[viewer.role].map((action) => <Link key={action.href} to={action.href}><action.icon aria-hidden="true" /><span>{action.label}</span><ArrowRight aria-hidden="true" /></Link>)}
              </CardContent>
            </Card>
          </aside>
        </div>

        <Card className="operations-panel operations-full-report">
          <CardHeader className="operations-panel__header"><CardTitle><h2>完整经营数据</h2></CardTitle><CardDescription>保留原有日期筛选、导出、销售指标与提成汇总</CardDescription></CardHeader>
          <CardContent>
            <ReportFilters
              busy={busy}
              initialValue={initialFilters}
              onApply={(filters) => {
                appliedFilters.current = filters;
                void loadReport(filters);
              }}
              onExport={(filters) => void onExport({ ...filters, groupBy: "none" })}
            />
            {error ? <div className="report-error" role="alert">{error}</div> : null}
            {report ? <ReportSummary metrics={report.totals} /> : <div className="report-empty">请选择日期并查询报表</div>}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
};
