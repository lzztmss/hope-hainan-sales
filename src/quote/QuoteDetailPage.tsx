import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { ApiClient, OrderMutationDto, QuoteDetailDto } from "../api/client";
import { PageLayout } from "../components/layout";
import "./quoteManagement.css";

const orderKey = () => `order-create-${crypto.randomUUID()}`;
const money = (fen: number) => `¥${(fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;

export const QuoteDetailPage = ({ client, quoteId }: { client: ApiClient; quoteId: string }) => {
  const [quote, setQuote] = useState<QuoteDetailDto | null>(null);
  const [order, setOrder] = useState<OrderMutationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    setError(null);
    void client.getQuote(quoteId).then(setQuote).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "报价读取失败");
    });
  }, [client, quoteId]);

  const print = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      await client.recordQuotePrint(quote.id);
      window.print();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "打印准备失败");
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      key.current ??= orderKey();
      setOrder(await client.createOrderFromQuote(quote.id, key.current));
      setQuote({ ...quote, status: "converted" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "转订单失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageLayout
      eyebrow="报价管理"
      title={quote?.quoteNo ?? "报价详情"}
      description="查看已保存版本；未转订单的报价可以继续修改、打印或转为订单。"
      actions={<Link className="quote-management__secondary-link" to="/quotes">返回报价列表</Link>}
    >
      {error ? <p className="quote-management__error" role="alert">{error}</p> : null}
      {!quote && !error ? <p role="status">正在读取报价…</p> : null}
      {quote ? (
        <article className="quote-management__detail">
          <section>
            <h2>客户与报价</h2>
            <dl>
              <div><dt>客户</dt><dd>{quote.customer.name}</dd></div>
              <div><dt>手机</dt><dd>{quote.customer.phoneMasked}</dd></div>
              <div><dt>长者人数</dt><dd>{quote.customer.elderCount} 位</dd></div>
              <div><dt>报价版本</dt><dd>第 {quote.version} 版</dd></div>
              <div><dt>每月合计</dt><dd>{money(quote.calculation.monthlyTotalFen)}</dd></div>
              <div><dt>36个月月费</dt><dd>{money(quote.calculation.contract36Fen)}</dd></div>
              <div><dt>一次性费用</dt><dd>{money(quote.calculation.oneTimeFen)}</dd></div>
            </dl>
          </section>
          <section>
            <h2>计价商品</h2>
            <ul>{quote.calculation.chargeLines.map((line) => (
              <li key={line.sku}><strong>{line.label} × {line.quantity} {line.unit}</strong><span>{line.monthlySubtotalFen ? `${money(line.monthlySubtotalFen)}/月` : money(line.oneTimeSubtotalFen)}</span></li>
            ))}</ul>
          </section>
          <section>
            <h2>最终实际设备</h2>
            <ul>{quote.calculation.componentLines.map((line) => (
              <li key={line.componentId}><strong>{line.label} × {line.quantity} {line.unit}</strong><span>{line.locations.join("、")}</span></li>
            ))}</ul>
          </section>
          <footer className="quote-management__actions">
            {quote.status === "confirmed" ? (
              <button type="button" onClick={() => navigate(`/quotes/${quote.id}/edit`)}>修改报价</button>
            ) : null}
            <button type="button" onClick={() => void print()} disabled={busy}>打印报价</button>
            {quote.status === "confirmed" ? (
              <button className="is-primary" type="button" onClick={() => void convert()} disabled={busy}>转为订单</button>
            ) : null}
            {order ? <Link to={`/orders/${order.id}`}>查看订单 {order.orderNo}</Link> : null}
          </footer>
        </article>
      ) : null}
    </PageLayout>
  );
};
