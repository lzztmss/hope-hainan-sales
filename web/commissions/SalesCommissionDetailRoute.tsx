import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import type { ApiClient, AuthenticatedUser, MyCommissionDashboardResponse, OrderFilterOptionsApiResponse } from "../api/client";
import { PageLayout } from "../components/layout";
import { createClientKey } from "../utils/clientKey";
import { MyCommissionPage } from "./MyCommissionPage";
import "./salesCommissionDetail.css";

const currentShanghaiMonth = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
};

export const SalesCommissionDetailRoute = ({ client, actor }: { client: ApiClient; actor: AuthenticatedUser }) => {
  const initialFilters = { month: currentShanghaiMonth(), storeId: "", beneficiaryId: "" };
  const [dashboard, setDashboard] = useState<MyCommissionDashboardResponse | null>(null);
  const [options, setOptions] = useState<OrderFilterOptionsApiResponse>({ stores: [], sellers: [] });
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [error, setError] = useState<string | null>(null);
  const sellers = useMemo(
    () => options.sellers.filter((seller) => !draft.storeId || seller.storeId === draft.storeId),
    [draft.storeId, options.sellers],
  );
  const load = useCallback(async (page = 1) => {
    try {
      setDashboard(await client.getCommissionDashboard({
        month: filters.month,
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.beneficiaryId ? { beneficiaryId: filters.beneficiaryId } : {}),
        page,
        limit: 20,
      }));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提成数据加载失败，请重试");
    }
  }, [client, filters]);
  useEffect(() => {
    void client.listOrderFilterOptions().then(setOptions).catch(() => undefined);
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draft);
  };
  return (
    <PageLayout title="销售提成详情">
      <form className="sales-commission-filters" onSubmit={submit}>
        <label><span>统计月份</span><input onChange={(event) => setDraft((value) => ({ ...value, month: event.currentTarget.value }))} required type="month" value={draft.month} /></label>
        <label><span>营业厅</span><select onChange={(event) => setDraft((value) => ({ ...value, storeId: event.currentTarget.value, beneficiaryId: "" }))} value={draft.storeId}><option value="">全部营业厅</option>{options.stores.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}</select></label>
        <label><span>销售员</span><select onChange={(event) => setDraft((value) => ({ ...value, beneficiaryId: event.currentTarget.value }))} value={draft.beneficiaryId}><option value="">全部销售员</option>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.label}</option>)}</select></label>
        <button type="submit">查询</button>
      </form>
      {error ? <div className="system-notice" role="alert">{error}</div> : null}
      {!dashboard && !error ? <div className="system-notice" role="status">正在加载提成数据…</div> : null}
      {dashboard ? (
        <MyCommissionPage
          dashboard={dashboard}
          description="逐商品展示原计提、部分退单扣回和当前净额"
          eyebrow="人力资源"
          onPageChange={(page) => void load(page)}
          onPayout={async (orderIds) => {
            await client.batchPayOrderCommissions(orderIds, createClientKey("commission-payout"));
            await load(dashboard.page);
          }}
          title="销售提成明细"
        />
      ) : null}
      <p className="sales-commission-actor">发放操作人：{actor.displayName}</p>
    </PageLayout>
  );
};
