import type { SalesReportMetrics } from "../../shared/reports/types";

export const formatReportFen = (value: number): string => {
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  return `${sign}¥${Math.floor(absolute / 100).toLocaleString("zh-CN")}.${String(absolute % 100).padStart(2, "0")}`;
};

export const formatReportRate = (basisPoints: number): string =>
  `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}%`;

const salesMetrics: ReadonlyArray<{
  key: keyof SalesReportMetrics;
  label: string;
  kind: "count" | "rate" | "money";
  tone?: string;
}> = [
  { key: "quoteCount", label: "报价数", kind: "count" },
  { key: "orderCount", label: "订单数", kind: "count" },
  { key: "conversionRateBps", label: "成交率", kind: "rate", tone: "primary" },
  { key: "oneTimeOriginalFen", label: "一次性设备原额", kind: "money" },
  { key: "returnedFen", label: "退单额", kind: "money", tone: "danger" },
  { key: "oneTimeNetFen", label: "一次性设备净额", kind: "money", tone: "primary" },
  { key: "fttrMonthlyFen", label: "FTTR 月费", kind: "money" },
  { key: "heartMonthlyFen", label: "心连心月增费", kind: "money" },
  { key: "contract36Fen", label: "36 月名义额", kind: "money" },
];

const commissionMetrics: ReadonlyArray<{ key: keyof SalesReportMetrics; label: string }> = [
  { key: "commissionEstimatedFen", label: "预计提成" },
  { key: "commissionPendingSettlementFen", label: "待结算" },
  { key: "commissionPaidFen", label: "已发提成" },
  { key: "commissionReversedFen", label: "退单冲销" },
  { key: "commissionNetFen", label: "净提成" },
];

export const ReportSummary = ({ metrics }: { metrics: SalesReportMetrics }) => (
  <div className="report-summary">
    <section className="report-metric-grid" aria-label="销售汇总">
      {salesMetrics.map((item) => (
        <article className={`report-metric-card ${item.tone ? `is-${item.tone}` : ""}`} key={item.key}>
          <span>{item.label}</span>
          <strong>
            {item.kind === "money"
              ? formatReportFen(metrics[item.key])
              : item.kind === "rate"
                ? formatReportRate(metrics[item.key])
                : metrics[item.key].toLocaleString("zh-CN")}
          </strong>
        </article>
      ))}
    </section>
    <section className="report-commission-panel" aria-label="提成汇总">
      <header><h2>提成激励</h2><p>预计、结算、发放和冲销分别列示</p></header>
      <div>
        {commissionMetrics.map((item) => (
          <article key={item.key}>
            <span>{item.label}</span>
            <strong>{formatReportFen(metrics[item.key])}</strong>
          </article>
        ))}
      </div>
    </section>
  </div>
);
