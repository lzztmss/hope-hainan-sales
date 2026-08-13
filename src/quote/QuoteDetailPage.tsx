import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { ApiClient, OrderMutationDto, QuoteDetailDto } from "../api/client";
import { PageLayout } from "../components/layout";
import "./quoteManagement.css";

const orderKey = () => `order-create-${crypto.randomUUID()}`;
const money = (fen: number) => `¥${(fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;
const roomLabel = {
  one_bedroom: "一室一厅",
  two_bedroom: "两室一厅",
  three_bedroom: "三室一厅",
} as const;

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
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
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
        <article className="quote-management__detail quote-management__print-document">
          <header className="quote-management__print-header">
            <img src="/haipo-logo.jpg" alt="海魄科技标识" />
            <div><strong>海南联通 FTTR 心连心融合套餐</strong><h2>客户报价单</h2></div>
          </header>
          <section>
            <h2>客户与报价</h2>
            <dl>
              <div><dt>报价单号</dt><dd>{quote.quoteNo}</dd></div>
              <div><dt>报价日期</dt><dd>{new Date(quote.confirmedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd></div>
              <div><dt>客户</dt><dd>{quote.customer.name}</dd></div>
              <div><dt>手机</dt><dd>{quote.customer.phoneMasked}</dd></div>
              <div><dt>客户户型</dt><dd>{quote.customer.roomType ? roomLabel[quote.customer.roomType] : "未填写"}</dd></div>
              <div><dt>长者人数</dt><dd>{quote.customer.elderCount} 位</dd></div>
              <div><dt>支付方式</dt><dd>{quote.calculation.mode === "contract_36" ? "36 个月合约月付" : "设备一次性购买"}</dd></div>
              <div><dt>FTTR 方案</dt><dd>{quote.calculation.fttrKind === "none" ? "不新增 FTTR" : quote.calculation.fttrKind === "custom" ? `自定义：${quote.pricing.customFttrNote ?? "以业务受理为准"}` : `${quote.calculation.fttrPlan} 元/月`}</dd></div>
              <div><dt>报价版本</dt><dd>第 {quote.version} 版</dd></div>
              <div><dt>价格版本</dt><dd>{quote.calculation.catalogVersion}</dd></div>
              <div><dt>每月合计</dt><dd>{money(quote.calculation.monthlyTotalFen)}</dd></div>
              <div><dt>36个月月费</dt><dd>{money(quote.calculation.contract36Fen)}</dd></div>
              <div><dt>一次性费用</dt><dd>{money(quote.calculation.oneTimeFen)}</dd></div>
              <div><dt>预计总支出</dt><dd>{money(quote.calculation.contract36Fen + quote.calculation.oneTimeFen)}</dd></div>
            </dl>
          </section>
          <section>
            <h2>计价商品</h2>
            <ul>{quote.calculation.chargeLines.map((line) => (
              <li key={line.sku}><strong>{line.label} × {line.quantity} {line.unit}</strong><span>{line.monthlySubtotalFen ? `${money(line.monthlySubtotalFen)}/月` : money(line.oneTimeSubtotalFen)}</span></li>
            ))}</ul>
          </section>
          <section className="quote-management__print-note">
            <h2>报价说明</h2>
            <p>本报价内容取自系统已保存的第 {quote.version} 版数据。最终资费、业务受理、网络覆盖与安装点位，以海南联通现场确认及双方签署的订单为准。</p>
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
