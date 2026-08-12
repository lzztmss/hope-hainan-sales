import { useState } from "react";

import type { SalesReportFilters, SalesReportResponse } from "../../shared/reports/types";
import { PageLayout } from "../components/layout";
import { ReportFilters } from "../reports/ReportFilters";
import { ReportSummary } from "../reports/ReportSummary";
import { reportsApi } from "../reports/reportApi";
import { defaultShanghaiReportFilters } from "../reports/reportDates";
import "../reports/reports.css";

export interface SalesDashboardPageProps {
  initialReport?: SalesReportResponse;
  onLoad?: (filters: SalesReportFilters) => Promise<SalesReportResponse>;
  onExport?: (filters: SalesReportFilters) => Promise<void> | void;
}

export const SalesDashboardPage = ({
  initialReport,
  onLoad = reportsApi.getSalesReport,
  onExport = reportsApi.exportSalesReport,
}: SalesDashboardPageProps) => {
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaults = defaultShanghaiReportFilters();
  const initialFilters: SalesReportFilters = {
    from: report?.period.from ?? defaults.from,
    to: report?.period.to ?? defaults.to,
    groupBy: "none",
  };
  const load = async (filters: SalesReportFilters) => {
    setBusy(true);
    setError(null);
    try {
      setReport(await onLoad({ ...filters, groupBy: "none" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "销售报表加载失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageLayout
      eyebrow="销售数据"
      title="我的销售工作台"
      description="按上海时间统计本人报价、订单、销售净额与提成，金额口径互不混算。"
    >
      <ReportFilters
        busy={busy}
        initialValue={initialFilters}
        onApply={(filters) => void load(filters)}
        onExport={(filters) => void onExport({ ...filters, groupBy: "none" })}
      />
      {error ? <div className="report-error" role="alert">{error}</div> : null}
      {report ? <ReportSummary metrics={report.totals} /> : <div className="report-empty">请选择日期并查询报表</div>}
    </PageLayout>
  );
};
