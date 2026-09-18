import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SalesReportFilters, SalesReportResponse } from "../../shared/reports/types";
import { APP_BASE_PATH } from "../appBasePath";
import { PageLayout } from "../components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { LIST_PAGE_SIZE, Pagination } from "../components/Pagination";
import { usePageAutoRefresh } from "../hooks/usePageAutoRefresh";
import { ReportFilters } from "./ReportFilters";
import { formatReportFen, formatReportRate, ReportSummary } from "./ReportSummary";
import { reportsApi } from "./reportApi";
import { defaultShanghaiReportFilters } from "./reportDates";
import "./reports.css";

export interface TeamReportPageProps {
  initialReport?: SalesReportResponse;
  onLoad?: (filters: SalesReportFilters) => Promise<SalesReportResponse>;
  onExport?: (filters: SalesReportFilters) => Promise<void> | void;
  sellers?: readonly { id: string; label: string; storeId?: string }[];
  stores?: readonly { id: string; label: string }[];
}

export const TeamReportPage = ({
  initialReport,
  onLoad = reportsApi.getSalesReport,
  onExport = reportsApi.exportSalesReport,
  sellers: providedSellers,
  stores: providedStores,
}: TeamReportPageProps) => {
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState({
    stores: providedStores ?? [],
    sellers: providedSellers ?? [],
  });
  const [page, setPage] = useState(1);
  const defaults = useMemo(() => defaultShanghaiReportFilters(), []);
  const initialFilters: SalesReportFilters = useMemo(() => ({
    from: report?.period.from ?? defaults.from,
    to: report?.period.to ?? defaults.to,
    groupBy: report?.rows[0]?.sellerId ? "seller" : "store",
  }), [defaults.from, defaults.to, report?.period.from, report?.period.to, report?.rows]);
  const appliedFilters = useRef(initialFilters);
  const initialLoadStarted = useRef(false);
  const load = useCallback(async (filters: SalesReportFilters, requestedPage = 1, background = false) => {
    if (!background) {
      setBusy(true);
      setError(null);
    }
    try {
      const next = await onLoad({ ...filters, page: requestedPage, pageSize: LIST_PAGE_SIZE });
      setReport(next);
      setPage(next.page ?? requestedPage);
      setError(null);
    } catch (reason) {
      if (!background) setError(reason instanceof Error ? reason.message : "团队报表加载失败");
    } finally {
      if (!background) setBusy(false);
    }
  }, [onLoad]);

  useEffect(() => {
    if (!initialReport && !initialLoadStarted.current) {
      initialLoadStarted.current = true;
      void load(appliedFilters.current);
    }
    if (providedStores || providedSellers) return;
    void fetch(`${APP_BASE_PATH}/api/order-filter-options`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("筛选项加载失败");
        return response.json() as Promise<typeof options>;
      })
      .then(setOptions)
      .catch(() => setOptions({ stores: [], sellers: [] }));
  }, [initialReport, load, providedSellers, providedStores]);

  usePageAutoRefresh({
    enabled: Boolean(report) && !busy,
    intervalMs: 60_000,
    onRefresh: () => load(appliedFilters.current, page, true),
  });

  return (
    <PageLayout
      eyebrow="团队管理"
      title="团队销售报表"
      description="营业厅经理查看本厅，大区经理查看所管营业厅，人力资源、财务和管理员查看全公司；导出沿用当前筛选范围。"
    >
      <ReportFilters
        allowTeamFilters
        busy={busy}
        initialValue={initialFilters}
        onApply={(filters) => {
          appliedFilters.current = filters;
          void load(filters, 1);
        }}
        onExport={(filters) => void onExport(filters)}
        sellers={options.sellers}
        stores={options.stores}
      />
      {error ? <div className="report-error" role="alert">{error}</div> : null}
      {report ? (
        <>
          <ReportSummary metrics={report.totals} />
          <section className="ops-list" aria-label="团队明细">
            <header className="ops-list__heading"><h2>团队明细</h2><span>{report.total ?? report.rows.length} 项</span></header>
            <Table aria-label="团队销售明细">
            <TableHeader><TableRow><TableHead>归属</TableHead><TableHead>报价 / 订单</TableHead><TableHead>成交率</TableHead><TableHead>一次性原额</TableHead><TableHead>退单额</TableHead><TableHead>设备净额</TableHead><TableHead>月付套餐月费</TableHead><TableHead>36 个月合计</TableHead><TableHead>期间提成净额</TableHead></TableRow></TableHeader>
            <TableBody>
            {report.rows.map((row) => (
              <TableRow aria-label={`${row.label}销售数据`} key={row.key}>
                <TableCell><strong>{row.label}</strong><small>{row.storeName}</small></TableCell>
                <TableCell>{row.quoteCount} / {row.orderCount}</TableCell>
                <TableCell>{formatReportRate(row.conversionRateBps)}</TableCell>
                <TableCell>{formatReportFen(row.oneTimeOriginalFen)}</TableCell>
                <TableCell>{formatReportFen(row.returnedFen)}</TableCell>
                <TableCell>{formatReportFen(row.oneTimeNetFen)}</TableCell>
                <TableCell>{formatReportFen(row.monthlyFen)}</TableCell>
                <TableCell>{formatReportFen(row.contract36Fen)}</TableCell>
                <TableCell>{formatReportFen(row.commissionNetFen)}</TableCell>
              </TableRow>
            ))}
            </TableBody></Table>
            {report.rows.length === 0 ? <div className="report-empty">当前筛选范围暂无团队明细</div> : null}
          </section>
          <Pagination
            onPageChange={(nextPage) => void load(appliedFilters.current, nextPage)}
            page={page}
            totalItems={report.total ?? report.rows.length}
          />
        </>
      ) : <div className="report-empty">请选择日期并查询报表</div>}
    </PageLayout>
  );
};
