import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";

import type { ApiClient, QuoteDetailDto } from "../api/client";
import { QuotePrintDocument } from "./QuotePrintDocument";
import { renderQuoteToA4Images, waitForPrintImages } from "./quotePrintRaster";
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
  const [printPages, setPrintPages] = useState<string[]>([]);
  const autoPrintStarted = useRef(false);
  const documentRef = useRef<HTMLDivElement>(null);

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
      const printableDocument = documentRef.current?.querySelector<HTMLElement>(
        ".quote-management__print-document",
      );
      if (!printableDocument) throw new Error("报价单尚未生成完成");
      const pages = await renderQuoteToA4Images(printableDocument);
      flushSync(() => setPrintPages(pages));
      await waitForPrintImages();
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
  }, [busy, client, quote]);

  useEffect(() => {
    if (!autoPrint || !quote || autoPrintStarted.current) return;
    autoPrintStarted.current = true;
    void print();
  }, [autoPrint, print, quote]);

  return (
    <main className={`standalone-quote-print-page${printPages.length ? " standalone-quote-print-page--raster-ready" : ""}`}>
      <nav aria-label="报价单打印操作" className="standalone-quote-print-actions">
        <Link to={`/quotes/${quoteId}`}>返回报价详情</Link>
        <button disabled={!quote || busy} onClick={() => void print()} type="button">
          {busy ? "正在准备打印…" : "打印报价单"}
        </button>
      </nav>
      {error ? <p className="standalone-quote-print-error" role="alert">{error}</p> : null}
      {!quote && !error ? <p role="status">正在生成报价单…</p> : null}
      {quote ? (
        <div className="standalone-quote-print-source" ref={documentRef}>
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
        </div>
      ) : null}
      <section aria-hidden="true" className="standalone-quote-print-raster">
        {printPages.map((page, index) => (
          <img alt="" className="standalone-quote-print-raster-page" key={index} src={page} />
        ))}
      </section>
    </main>
  );
};
