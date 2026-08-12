import { useState } from "react";

import type { FttrResult, QuoteTotals } from "../domain/types";

type QuoteSummaryProps = {
  fttr: FttrResult;
  totals: QuoteTotals;
};

const formatMoney = (amount: number): string =>
  amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });

const SUMMARY_DETAILS_ID = "quote-summary-details";

export const QuoteSummary = ({ fttr, totals }: QuoteSummaryProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside
      aria-labelledby="quote-summary-title"
      className="quote-summary"
      data-expanded={isExpanded}
    >
      <h2 id="quote-summary-title">报价汇总</h2>
      <button
        type="button"
        className="summary-toggle"
        aria-expanded={isExpanded}
        aria-controls={SUMMARY_DETAILS_ID}
        onClick={() => setIsExpanded((current) => !current)}
      >
        {isExpanded ? "收起完整汇总" : "展开完整汇总"}
      </button>
      <dl
        id={SUMMARY_DETAILS_ID}
        data-testid="quote-summary-details"
        data-expanded={isExpanded}
      >
        <div>
          <dt>设备合计</dt>
          <dd data-testid="device-total">¥{formatMoney(totals.deviceTotal)}</dd>
        </div>
        <div>
          <dt>联通 FTTR</dt>
          <dd data-testid="fttr-total">
            {fttr.error
              ? "未计入"
              : fttr.raw.trim() === ""
                ? "待填写"
                : `¥${formatMoney(totals.fttrTotal)}`}
          </dd>
        </div>
        <div>
          <dt>最终合计</dt>
          <dd data-testid="final-total">¥{formatMoney(totals.finalTotal)}</dd>
        </div>
      </dl>
    </aside>
  );
};
