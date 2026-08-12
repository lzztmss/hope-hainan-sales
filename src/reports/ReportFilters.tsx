import { useState } from "react";

import type { SalesReportFilters } from "../../shared/reports/types";
import "./reports.css";

export interface ReportFiltersProps {
  allowTeamFilters?: boolean;
  busy?: boolean;
  initialValue: SalesReportFilters;
  onApply(filters: SalesReportFilters): void;
  onExport(filters: SalesReportFilters): void;
  sellers?: readonly { id: string; label: string }[];
  stores?: readonly { id: string; label: string }[];
}

export const ReportFilters = ({
  allowTeamFilters = false,
  busy = false,
  initialValue,
  onApply,
  onExport,
  sellers = [],
  stores = [],
}: ReportFiltersProps) => {
  const [value, setValue] = useState<SalesReportFilters>(initialValue);
  const update = (field: keyof SalesReportFilters, next: string) =>
    setValue((current) => ({ ...current, [field]: next || undefined }));

  return (
    <form
      className="report-filters"
      aria-label="报表筛选"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(value);
      }}
    >
      <label>
        <span>开始日期</span>
        <input
          aria-label="开始日期"
          required
          type="date"
          value={value.from ?? ""}
          onChange={(event) => update("from", event.currentTarget.value)}
        />
      </label>
      <label>
        <span>结束日期</span>
        <input
          aria-label="结束日期"
          required
          type="date"
          value={value.to ?? ""}
          onChange={(event) => update("to", event.currentTarget.value)}
        />
      </label>
      {allowTeamFilters ? (
        <>
          {stores.length > 0 ? (
            <label>
              <span>营业厅</span>
              <select
                aria-label="营业厅"
                value={value.storeId ?? ""}
                onChange={(event) => update("storeId", event.currentTarget.value)}
              >
                <option value="">全部可见营业厅</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}
              </select>
            </label>
          ) : null}
          {sellers.length > 0 ? (
            <label>
              <span>销售员</span>
              <select
                aria-label="销售员"
                value={value.sellerId ?? ""}
                onChange={(event) => update("sellerId", event.currentTarget.value)}
              >
                <option value="">全部可见销售员</option>
                {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.label}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            <span>分组方式</span>
            <select
              aria-label="分组方式"
              value={value.groupBy ?? "seller"}
              onChange={(event) => update("groupBy", event.currentTarget.value)}
            >
              <option value="seller">按销售员</option>
              <option value="store">按营业厅</option>
              <option value="none">仅看合计</option>
            </select>
          </label>
        </>
      ) : null}
      <div className="report-filters__actions">
        <button disabled={busy} type="submit">查询报表</button>
        <button disabled={busy} type="button" onClick={() => onExport(value)}>
          导出 CSV
        </button>
      </div>
    </form>
  );
};
