import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { ApiClient, AuthenticatedUser, CustomerListItemDto, OrderFilterOptionsApiResponse } from "../api/client";
import { LIST_PAGE_SIZE, Pagination } from "../components/Pagination";
import { PageLayout } from "../components/layout";
import "./customers.css";

const ROOM_LABELS: Record<string, string> = {
  one_bedroom: "一室户型",
  two_bedroom: "二室户型",
  three_bedroom: "三室户型",
};

const globalDataRole = (role: AuthenticatedUser["role"]): boolean =>
  role === "admin" || role === "hr" || role === "finance";

export const CustomerListPage = ({ client, viewer }: { client: ApiClient; viewer: AuthenticatedUser }) => {
  const [items, setItems] = useState<readonly CustomerListItemDto[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [storeId, setStoreId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [options, setOptions] = useState<OrderFilterOptionsApiResponse>({ stores: [], sellers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appliedFilters = useRef({ query: "", storeId: "", sellerId: "" });

  const load = useCallback(async (nextQuery = "", nextStoreId = "", nextSellerId = "", requestedPage = 1) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listCustomers({ query: nextQuery, storeId: nextStoreId || undefined, sellerId: nextSellerId || undefined, page: requestedPage, pageSize: LIST_PAGE_SIZE });
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "客户读取失败");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (viewer.role === "sales") return;
    void client.listOrderFilterOptions().then(setOptions).catch(() => setOptions({ stores: [], sellers: [] }));
  }, [client, viewer.role]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    appliedFilters.current = { query, storeId, sellerId };
    void load(query, storeId, sellerId);
  };

  const reset = () => {
    setQuery("");
    setStoreId("");
    setSellerId("");
    appliedFilters.current = { query: "", storeId: "", sellerId: "" };
    void load();
  };

  return (
    <PageLayout
      eyebrow="客户档案"
      title="客户管理"
      description={globalDataRole(viewer.role) ? "查看全公司客户，可按营业厅和销售员筛选。" : viewer.role === "regional_manager" ? "只读查看所管营业厅客户，可按营业厅和销售员筛选。" : viewer.role === "store_manager" ? "仅展示本营业厅客户，可按本厅销售员筛选。" : "客户由正式报价自动建档，可查看归属、报价和订单情况。"}
    >
      <form className="customer-list__filters" onSubmit={submit}>
        <div className="customer-list__filter-row is-primary">
          <label>
            <span>搜索客户</span>
            <input
              type="search"
              placeholder="客户姓名、手机后四位、营业厅或销售员"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="customer-list__filter-row is-secondary">
          {globalDataRole(viewer.role) || viewer.role === "regional_manager" ? <label><span>营业厅</span><select value={storeId} onChange={(event) => { setStoreId(event.currentTarget.value); setSellerId(""); }}><option value="">全部营业厅</option>{options.stores.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
          {viewer.role !== "sales" ? <label><span>销售员</span><select value={sellerId} onChange={(event) => setSellerId(event.currentTarget.value)}><option value="">全部可见销售员</option>{options.sellers.filter((option) => !storeId || option.storeId === storeId).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label> : null}
          <div className="customer-list__filter-actions">
            <button className="is-secondary" disabled={loading} onClick={reset} type="button">重置</button>
            <button disabled={loading} type="submit">查询</button>
          </div>
        </div>
      </form>

      {error ? <p className="customer-list__error" role="alert">{error}</p> : null}
      {loading ? <p role="status">正在读取客户…</p> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="customer-list__empty">没有找到符合条件的客户。</div>
      ) : null}
      <div className="customer-list__grid">
        {items.map((customer) => (
          <article key={customer.id}>
            <header>
              <div>
                <h2>{customer.name}</h2>
                <span>{customer.phoneMasked}</span>
              </div>
              <span>{customer.storeName}</span>
            </header>
            <dl>
              <div><dt>客户情况</dt><dd>{ROOM_LABELS[customer.roomType ?? ""] ?? "户型未录入"} · {customer.elderCount} 位长者</dd></div>
              <div><dt>负责销售</dt><dd>{customer.ownerName}</dd></div>
              <div><dt>报价 / 订单</dt><dd>{customer.quoteCount} / {customer.orderCount}</dd></div>
              <div><dt>最近报价</dt><dd>{customer.lastQuoteAt ? new Date(customer.lastQuoteAt).toLocaleString("zh-CN") : "暂无"}</dd></div>
            </dl>
            <Link to={`/quotes?query=${encodeURIComponent(customer.name)}`}>查看相关报价</Link>
          </article>
        ))}
      </div>
      <Pagination
        onPageChange={(nextPage) => {
          const filters = appliedFilters.current;
          void load(filters.query, filters.storeId, filters.sellerId, nextPage);
        }}
        page={page}
        totalItems={total}
      />
    </PageLayout>
  );
};
