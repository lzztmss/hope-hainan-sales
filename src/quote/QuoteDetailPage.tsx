import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { ApiClient, OrderMutationDto, QuoteDetailDto } from "../api/client";
import { PageLayout } from "../components/layout";
import { QuotePrintDocument } from "./QuotePrintDocument";
import { OrderCompositionDialog } from "./OrderCompositionDialog";
import "./quoteManagement.css";

const orderKey = () => `order-create-${crypto.randomUUID()}`;
export const QuoteDetailPage = ({ client, quoteId }: { client: ApiClient; quoteId: string }) => {
  const [quote, setQuote] = useState<QuoteDetailDto | null>(null);
  const [order, setOrder] = useState<OrderMutationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [orderCompositionOpen, setOrderCompositionOpen] = useState(false);
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
      setOrderCompositionOpen(false);
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
        <QuotePrintDocument
          calculation={quote.calculation}
          confirmedAt={quote.confirmedAt}
          customFttrNote={quote.pricing.customFttrNote}
          customerName={quote.customer.name}
          elderCount={quote.customer.elderCount}
          phoneMasked={quote.customer.phoneMasked}
          quoteNo={quote.quoteNo}
          roomType={quote.customer.roomType}
          version={quote.version}
          actions={<>
            {quote.status === "confirmed" ? (
              <button type="button" onClick={() => navigate(`/quotes/${quote.id}/edit`)}>修改报价</button>
            ) : null}
            <button type="button" onClick={() => setPreviewOpen(true)}>预览报价单</button>
            <button type="button" onClick={() => void print()} disabled={busy}>打印报价</button>
            {quote.status === "confirmed" ? (
              <button className="is-primary" type="button" onClick={() => setOrderCompositionOpen(true)} disabled={busy}>转为订单</button>
            ) : null}
            {order ? <Link to={`/orders/${order.id}`}>查看订单 {order.orderNo}</Link> : null}
          </>}
        />
      ) : null}
      {quote && previewOpen ? (
        <div className="quote-preview-backdrop" role="presentation">
          <section aria-label="报价单预览" aria-modal="true" className="quote-preview-dialog" role="dialog">
            <QuotePrintDocument {...{
              calculation: quote.calculation, confirmedAt: quote.confirmedAt,
              customFttrNote: quote.pricing.customFttrNote, customerName: quote.customer.name,
              elderCount: quote.customer.elderCount, phoneMasked: quote.customer.phoneMasked,
              quoteNo: quote.quoteNo, roomType: quote.customer.roomType, version: quote.version,
            }} preview actions={<><button type="button" onClick={() => setPreviewOpen(false)}>关闭预览</button><button className="is-primary" type="button" onClick={() => void print()}>打印报价</button></>} />
          </section>
        </div>
      ) : null}
      {quote && orderCompositionOpen ? (
        <OrderCompositionDialog
          busy={busy}
          lines={quote.calculation.chargeLines}
          onClose={() => setOrderCompositionOpen(false)}
          onConfirm={() => void convert()}
        />
      ) : null}
    </PageLayout>
  );
};
