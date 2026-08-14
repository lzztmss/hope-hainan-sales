import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";

import type { ApiClient, AuthenticatedUser, OrderFilterOptionsApiResponse, QuoteDetailDto, QuoteStatus } from "../api/client";
import { PageLayout } from "../components/layout";
import { usePageAutoRefresh } from "../hooks/usePageAutoRefresh";
import "./quoteManagement.css";

const STATUS_LABELS: Record<QuoteStatus, string> = {
  confirmed: "已确认",
  converted: "已转订单",
  expired: "已过期",
  lost: "未成交",
  voided: "已作废",
};

const money = (fen: number) =>
  `¥${(fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;

interface AppliedQuoteFilters {
  dateFrom: string;
  dateTo: string;
  query: string;
  sellerId: string;
  status: QuoteStatus | "";
  storeId: string;
}

export const QuoteListPage = ({ client, viewer }: { client: ApiClient; viewer: AuthenticatedUser }) => {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("query") ?? "";
  const [items, setItems] = useState<readonly QuoteDetailDto[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<QuoteStatus | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [storeId, setStoreId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [options, setOptions] = useState<OrderFilterOptionsApiResponse>({ stores: [], sellers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appliedFilters = useRef<AppliedQuoteFilters>({
    dateFrom: "",
    dateTo: "",
    query: initialQuery,
    sellerId: "",
    status: "",
    storeId: "",
  });

  const load = useCallback(async (filters: AppliedQuoteFilters, background = false) => {
    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await client.listQuotes({
        query: filters.query.trim() || undefined,
        status: filters.status || undefined,
        storeId: filters.storeId || undefined,
        sellerId: filters.sellerId || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      });
      setItems(result.items);
      setError(null);
    } catch (reason) {
      if (!background) setError(reason instanceof Error ? reason.message : "报价读取失败");
    } finally {
      if (!background) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    appliedFilters.current = { ...appliedFilters.current, query: initialQuery };
    void load(appliedFilters.current);
  }, [initialQuery, load]);
  useEffect(() => {
    if (viewer.role === "sales") return;
    void client.listOrderFilterOptions().then(setOptions).catch(() => setOptions({ stores: [], sellers: [] }));
  }, [client, viewer.role]);

  usePageAutoRefresh({
    enabled: !loading,
    intervalMs: 15_000,
    onRefresh: () => load(appliedFilters.current, true),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    appliedFilters.current = { dateFrom, dateTo, query, sellerId, status, storeId };
    void load(appliedFilters.current);
  };

  return (
    <PageLayout
      eyebrow="销售报价"
      title={viewer.role === "admin" ? "全部报价" : viewer.role === "store_manager" ? "本厅报价" : "我的报价"}
      description={viewer.role === "admin" ? "查询全部营业厅报价，可按营业厅和销售员筛选。" : viewer.role === "store_manager" ? "仅展示本营业厅报价，可按本厅销售员筛选。" : "查询已保存报价，未转订单的报价可以继续修改、打印或转为订单。"}
      actions={<Link className="quote-management__primary-link" to="/quotes/new">新建报价</Link>}
    >
      <form className="quote-management__filters" onSubmit={submit}>
        <label>
          <span>搜索报价</span>
          <input
            type="search"
            placeholder="报价单号、客户姓名或手机号"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        {viewer.role === "admin" ? <label><span>营业厅</span><select value={storeId} onChange={(event) => { setStoreId(event.currentTarget.value); setSellerId(""); }}><option value="">全部营业厅</option>{options.stores.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
        {viewer.role !== "sales" ? <label><span>销售员</span><select value={sellerId} onChange={(event) => setSellerId(event.currentTarget.value)}><option value="">全部可见销售员</option>{options.sellers.filter((option) => !storeId || option.storeId === storeId).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
        <label>
          <span>报价状态</span>
          <select value={status} onChange={(event) => setStatus(event.currentTarget.value as QuoteStatus | "")}>
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>开始日期</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.currentTarget.value)} />
        </label>
        <label>
          <span>结束日期</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.currentTarget.value)} />
        </label>
        <button type="submit" disabled={loading}>查询</button>
      </form>

      {error ? <p className="quote-management__error" role="alert">{error}</p> : null}
      {loading ? <p role="status">正在读取报价…</p> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="quote-management__empty">没有找到符合条件的报价。</div>
      ) : null}
      <div className="quote-management__list">
        {items.map((quote) => (
          <article key={quote.id}>
            <header>
              <div>
                <strong>{quote.quoteNo}</strong>
                <span>{quote.customer.name} · {quote.customer.phoneMasked}</span>
              </div>
              <span className={`quote-management__status is-${quote.status}`}>{STATUS_LABELS[quote.status]}</span>
            </header>
            <dl>
              <div><dt>客户情况</dt><dd>{quote.customer.elderCount} 位长者</dd></div>
              {viewer.role !== "sales" ? <div><dt>销售归属</dt><dd>{options.stores.find((option) => option.id === quote.storeId)?.label ?? viewer.storeName ?? "营业厅"} · {options.sellers.find((option) => option.id === quote.sellerId)?.label ?? "销售员"}</dd></div> : null}
              <div><dt>每月合计</dt><dd>{money(quote.calculation.monthlyTotalFen)}</dd></div>
              <div><dt>一次性费用</dt><dd>{money(quote.calculation.oneTimeFen)}</dd></div>
              <div><dt>更新时间</dt><dd>{new Date(quote.updatedAt).toLocaleString("zh-CN")}</dd></div>
            </dl>
            <Link to={`/quotes/${quote.id}`}>查看报价详情</Link>
          </article>
        ))}
      </div>
    </PageLayout>
  );
};
