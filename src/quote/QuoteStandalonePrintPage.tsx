import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { ApiClient, QuoteDetailDto } from "../api/client";
import { QuotePrintDocument } from "./QuotePrintDocument";
import "./quoteStandalonePrint.css";

export const QuoteStandalonePrintPage = ({
  autoPrint,
  client,
  quoteId,
}: {
  autoPrint: boolean;
  client: ApiClient;
  quoteId: string;
}) => {
  const [quote, setQuote] = useState<QuoteDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoPrintStarted = useRef(false);

  useEffect(() => {
    setError(null);
    void client.getQuote(quoteId).then(setQuote).catch((reason) => {
      setError(reason instanceof Error ? reason.message : "报价单读取失败");
    });
  }, [client, quoteId]);

  const print = useCallback(async () => {
    if (!quote || busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.recordQuotePrint(quote.id);
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      window.print();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "打印准备失败");
    } finally {
      setBusy(false);
    }
  }, [busy, client, quote]);

  useEffect(() => {
    if (!autoPrint || !quote || autoPrintStarted.current) return;
    autoPrintStarted.current = true;
    void print();
  }, [autoPrint, print, quote]);

  return (
    <main className="standalone-quote-print-page">
      <nav aria-label="报价单打印操作" className="standalone-quote-print-actions">
        <Link to={`/quotes/${quoteId}`}>返回报价详情</Link>
        <button disabled={!quote || busy} onClick={() => void print()} type="button">
          {busy ? "正在准备打印…" : "打印报价单"}
        </button>
      </nav>
      {error ? <p className="standalone-quote-print-error" role="alert">{error}</p> : null}
      {!quote && !error ? <p role="status">正在生成报价单…</p> : null}
      {quote ? (
        <QuotePrintDocument
          calculation={quote.calculation}
          confirmedAt={quote.confirmedAt}
          customFttrNote={quote.pricing.customFttrNote}
          customerName={quote.customer.name}
          elderCount={quote.customer.elderCount}
          phoneMasked={quote.customer.phoneMasked}
          preview
          quoteNo={quote.quoteNo}
          roomType={quote.customer.roomType}
          version={quote.version}
        />
      ) : null}
    </main>
  );
};
