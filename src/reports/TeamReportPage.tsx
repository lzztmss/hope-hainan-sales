import { useEffect, useMemo, useState } from "react";

import type { SalesReportFilters, SalesReportResponse } from "../../shared/reports/types";
import { PageLayout } from "../components/layout";
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
  const defaults = useMemo(() => defaultShanghaiReportFilters(), []);
  const initialFilters: SalesReportFilters = useMemo(() => ({
    from: report?.period.from ?? defaults.from,
    to: report?.period.to ?? defaults.to,
    groupBy: report?.rows[0]?.sellerId ? "seller" : "store",
  }), [defaults.from, defaults.to, report?.period.from, report?.period.to, report?.rows]);
  const load = async (filters: SalesReportFilters) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await onLoad(filters));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "团队报表加载失败");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!initialReport) void load(initialFilters);
    if (providedStores || providedSellers) return;
    void fetch("/api/order-filter-options", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("筛选项加载失败");
        return response.json() as Promise<typeof options>;
      })
      .then(setOptions)
      .catch(() => setOptions({ stores: [], sellers: [] }));
  }, []);

  return (
    <PageLayout
      eyebrow="团队管理"
      title="团队销售报表"
      description="主管仅查看本营业厅，管理员可查看全公司；导出沿用当前筛选范围。"
    >
      <ReportFilters
        allowTeamFilters
        busy={busy}
        initialValue={initialFilters}
        onApply={(filters) => void load(filters)}
        onExport={(filters) => void onExport(filters)}
        sellers={options.sellers}
        stores={options.stores}
      />
      {error ? <div className="report-error" role="alert">{error}</div> : null}
      {report ? (
        <>
          <ReportSummary metrics={report.totals} />
          <section className="team-report-rows" aria-label="团队明细">
            {report.rows.map((row) => (
              <article aria-label={`${row.label}销售数据`} key={row.key}>
                <header><h2>{row.label}</h2><span>{row.storeName}</span></header>
                <dl>
                  <div><dt>报价 / 订单</dt><dd>{row.quoteCount} / {row.orderCount}</dd></div>
                  <div><dt>成交率</dt><dd>{formatReportRate(row.conversionRateBps)}</dd></div>
                  <div><dt>一次性原额</dt><dd>{formatReportFen(row.oneTimeOriginalFen)}</dd></div>
                  <div><dt>退单额</dt><dd>{formatReportFen(row.returnedFen)}</dd></div>
                  <div><dt>净额</dt><dd>{formatReportFen(row.oneTimeNetFen)}</dd></div>
                  <div><dt>FTTR / 心连心月费</dt><dd>{formatReportFen(row.fttrMonthlyFen)} / {formatReportFen(row.heartMonthlyFen)}</dd></div>
                  <div><dt>36 月名义额</dt><dd>{formatReportFen(row.contract36Fen)}</dd></div>
                  <div><dt>提成净额</dt><dd>{formatReportFen(row.commissionNetFen)}</dd></div>
                </dl>
              </article>
            ))}
            {report.rows.length === 0 ? <div className="report-empty">当前筛选范围暂无团队明细</div> : null}
          </section>
        </>
      ) : <div className="report-empty">请选择日期并查询报表</div>}
    </PageLayout>
  );
};
