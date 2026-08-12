import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { ApiClient, QuoteDetailDto, QuoteStatus } from "../api/client";
import { PageLayout } from "../components/layout";
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

export const QuoteListPage = ({ client }: { client: ApiClient }) => {
  const [items, setItems] = useState<readonly QuoteDetailDto[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<QuoteStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextQuery = query, nextStatus = status) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.listQuotes({
        query: nextQuery.trim() || undefined,
        status: nextStatus || undefined,
      });
      setItems(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "报价读取失败");
    } finally {
      setLoading(false);
    }
  }, [client, query, status]);

  useEffect(() => { void load("", ""); }, [load]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  return (
    <PageLayout
      eyebrow="销售报价"
      title="我的报价"
      description="查询已保存报价，未转订单的报价可以继续修改、打印或转为订单。"
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
        <label>
          <span>报价状态</span>
          <select value={status} onChange={(event) => setStatus(event.currentTarget.value as QuoteStatus | "")}>
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
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

