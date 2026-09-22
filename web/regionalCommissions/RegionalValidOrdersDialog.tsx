import { useEffect, useMemo, useState } from "react";

import type { ApiClient, RegionalCommissionSummary, RegionalValidOrdersReport } from "../api/client";

const statusLabel: Record<RegionalValidOrdersReport["items"][number]["status"], string> = {
  valid: "有效",
  returned: "整单退回",
};

// 「当前版本累计有效订单」的逐单核查明细：与汇总共用同一套口径，
// 合计与提成页显示的计数一致。
export const RegionalValidOrdersDialog = ({
  client,
  managerId,
  month,
  summary,
  onClose,
}: {
  client: ApiClient;
  managerId: string;
  month: string;
  summary: RegionalCommissionSummary;
  onClose: () => void;
}) => {
  const [report, setReport] = useState<RegionalValidOrdersReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReport(null);
    client.listRegionalValidOrders({ managerId, month })
      .then((loaded) => {
        if (!cancelled) setReport(loaded);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "有效订单明细加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [client, managerId, month]);

  const filteredItems = useMemo(() => {
    if (!report) return [];
    const normalizedKeyword = keyword.trim().toLowerCase();
    return report.items.filter((item) => {
      if (periodFilter === "outside" && item.periodSequence !== null) return false;
      if (periodFilter.startsWith("M") && item.periodSequence !== Number(periodFilter.slice(1))) return false;
      if (normalizedKeyword && !`${item.orderNo} ${item.place}`.toLowerCase().includes(normalizedKeyword)) return false;
      return true;
    });
  }, [keyword, periodFilter, report]);

  const filteredOrderCount = filteredItems.reduce((sum, item) => sum + item.orderCount, 0);

  return <div className="regional-action-dialog-backdrop" role="presentation">
    <section aria-labelledby="regional-valid-orders-title" aria-modal="true" className="regional-valid-orders-dialog" role="dialog">
      <div className="regional-valid-orders-dialog__heading">
        <div>
          <h2 id="regional-valid-orders-title">当前版本累计有效订单明细</h2>
          <p>
            统计范围 {summary.statisticsStartsOn ?? "—"} 至 {summary.statisticsEndsOn}；
            {summary.managedOrderCount} 笔营业厅订单 + {summary.personalOrderCount} 笔个人渠道订单 = {summary.orderCount} 笔。
            营业厅订单按签收满 7 天当日的历史归属计入。
          </p>
        </div>
        <button autoFocus className="regional-primary-action" type="button" onClick={onClose}>关闭</button>
      </div>
      {error ? <div className="system-notice" role="alert">{error}</div> : null}
      {report ? <>
        <div className="regional-valid-orders-dialog__filters">
          <label>
            <span>目标周期</span>
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.currentTarget.value)}>
              <option value="all">全部周期（{report.orderCount} 笔）</option>
              {report.periods.map((period) => <option key={period.sequence} value={`M${period.sequence}`}>M{period.sequence}（{period.startsOn} 至 {period.endsOn}）</option>)}
              <option value="outside">模板范围外（不计奖）</option>
            </select>
          </label>
          <label>
            <span>搜索订单号 / 营业厅</span>
            <input type="search" value={keyword} onChange={(event) => setKeyword(event.currentTarget.value)} />
          </label>
          <small>筛选结果 {filteredItems.length} 条 / {filteredOrderCount} 笔</small>
        </div>
        <div className="regional-table-wrap regional-valid-orders-table">
          <table>
            <thead><tr><th>序号</th><th>来源</th><th>订单号</th><th>营业厅 / 渠道</th><th>签收日</th><th>生效日（满7天）</th><th>归属周期</th><th>状态</th></tr></thead>
            <tbody>
              {filteredItems.map((item, index) => <tr key={`${item.source}:${item.id}`}>
                <td>{index + 1}</td>
                <td>{item.source === "store" ? "营业厅订单" : item.orderCount > 1 ? `个人渠道（${item.orderCount} 笔）` : "个人渠道"}</td>
                <td>{item.orderNo}</td>
                <td>{item.place}</td>
                <td>{item.signedOn ?? "—"}</td>
                <td>{item.effectiveOn}</td>
                <td>{item.periodSequence ? `M${item.periodSequence}` : "范围外"}</td>
                <td>{statusLabel[item.status]}</td>
              </tr>)}
              {filteredItems.length === 0 ? <tr><td colSpan={8}>没有符合筛选条件的有效订单。</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="regional-inline-help">
          明细合计 {report.managedOrderCount} 笔营业厅 + {report.personalOrderCount} 笔个人渠道 = {report.orderCount} 笔，与汇总「当前版本累计有效订单」一致；
          个人渠道为手工录入，一条记录可代表多笔（在来源列标注）；已整单退回的订单保留计数，其分段订单奖在退单中扣回。
        </p>
      </> : !error ? <p className="regional-empty">正在加载有效订单明细…</p> : null}
    </section>
  </div>;
};
