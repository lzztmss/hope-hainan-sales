import { useState } from "react";

import { Pagination } from "../components/Pagination";
import { formatFen } from "../../shared/money";
import "./myCommission.css";

export interface MyCommissionSummary {
  estimatedFen: number;
  accruedNetFen: number;
  pendingSettlementFen: number;
  pendingPaymentFen: number;
  pendingDeductionFen: number;
  paidThisMonthFen: number;
  paidLifetimeFen: number;
  reversedLifetimeFen: number;
  netLifetimeFen: number;
}

export interface MyCommissionOrderLine {
  id?: string;
  sku: string;
  label: string;
  quantity: number;
  unitCommissionFen: number;
  subtotalFen: number;
  entryType?: "estimated" | "accrual" | "return_reversal" | "manual_positive" | "manual_negative";
  settlementStatus?: "unsettled" | "paid";
}

export interface MyCommissionOrder {
  orderId: string;
  orderNo: string;
  customerMasked: string;
  activatedAt: string;
  status: "estimated" | "accrued" | "settled" | "paid" | "reversed" | "exception";
  statusLabel: string;
  amountFen: number;
  lines: MyCommissionOrderLine[];
  payoutStatus?: "ineligible" | "pending" | "paid" | "deduction";
  ledgerEntries?: Array<{ beneficiaryId: string; beneficiaryName: string }>;
}

export interface MyCommissionDashboard {
  periodLabel: string;
  summary: MyCommissionSummary;
  orders: MyCommissionOrder[];
  unconfiguredOrders: number;
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface MyCommissionPageProps {
  dashboard: MyCommissionDashboard;
  onPageChange?(page: number): void;
  onPayout?(orderIds: readonly string[]): Promise<void>;
  title?: string;
  eyebrow?: string;
  description?: string;
}

const displayMoney = (value: number, reversal = false): string => {
  const absolute = Math.abs(value);
  const prefix = value < 0 || reversal ? "−" : "";
  return `${prefix}¥${formatFen(absolute)}`;
};

const isDeductionLine = (line: MyCommissionOrderLine): boolean =>
  line.entryType === "return_reversal" ||
  line.entryType === "manual_negative" ||
  line.subtotalFen < 0;

const lineStatusLabel = (line: MyCommissionOrderLine): string => {
  if (!isDeductionLine(line)) return line.entryType === "estimated" ? "预计提成" : "计入提成";
  return line.settlementStatus === "paid" ? "已扣除" : "待扣除";
};

const CommissionLineGroup = ({
  lines,
  title,
  tone,
}: {
  lines: readonly MyCommissionOrderLine[];
  title: string;
  tone: "earning" | "deduction";
}) => (
  <section className={`commission-order-line-group is-${tone}`}>
    <h4>{title}</h4>
    {lines.map((line) => (
      <div className="commission-order-line" key={line.id ?? `${line.sku}-${line.label}-${line.subtotalFen}`}>
        <span>
          <strong>{line.label}</strong>
          <small>{lineStatusLabel(line)}</small>
        </span>
        <span>{displayMoney(line.unitCommissionFen)} × {line.quantity}</span>
        <strong>{displayMoney(line.subtotalFen)}</strong>
      </div>
    ))}
  </section>
);

const summaryDefinitions: ReadonlyArray<{
  key: keyof MyCommissionSummary;
  label: string;
  tone: "primary" | "normal" | "warning" | "success";
}> = [
  { key: "estimatedFen", label: "预计提成", tone: "normal" },
  { key: "accruedNetFen", label: "本月提成净额", tone: "primary" },
  { key: "pendingSettlementFen", label: "待结算", tone: "warning" },
  { key: "pendingPaymentFen", label: "待发放", tone: "warning" },
  { key: "paidThisMonthFen", label: "本月已发放", tone: "success" },
  { key: "paidLifetimeFen", label: "累计已发放", tone: "success" },
  { key: "reversedLifetimeFen", label: "历史累计扣回", tone: "normal" },
  { key: "netLifetimeFen", label: "历史提成净额", tone: "primary" },
];

export const MyCommissionPage = ({
  dashboard,
  description = "数据按订单签收、公司收款和实际发放状态统计",
  eyebrow = "销售激励",
  onPageChange,
  onPayout,
  title = "我的提成",
}: MyCommissionPageProps) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const runPayout = async () => {
    if (!onPayout || selected.size === 0) return;
    setPayoutBusy(true);
    setPayoutError(null);
    try {
      await onPayout([...selected]);
      setSelected(new Set());
    } catch (error) {
      setPayoutError(error instanceof Error ? error.message : "提成发放失败，请重试");
    } finally {
      setPayoutBusy(false);
    }
  };
  return (
    <section className="my-commission-page" aria-labelledby="my-commission-title">
    <header className="my-commission-page__header">
      <div>
        <p>{eyebrow}</p>
        <h1 id="my-commission-title">{title}</h1>
        <span>{dashboard.periodLabel} · {description}</span>
      </div>
    </header>

    <section className="commission-summary-grid" aria-label="提成汇总">
      {summaryDefinitions.map((definition) => (
        <article
          className={`commission-summary-card is-${definition.tone}`}
          data-testid={`commission-summary-${definition.label}`}
          key={definition.key}
        >
          <span>{definition.label}</span>
          <strong>
            {displayMoney(dashboard.summary[definition.key], false)}
          </strong>
          {definition.key === "pendingPaymentFen" && dashboard.summary.pendingDeductionFen > 0 ? (
            <em className="commission-summary-card__deduction">
              待扣回 {displayMoney(dashboard.summary.pendingDeductionFen)}
            </em>
          ) : null}
        </article>
      ))}
    </section>
    <p className="commission-summary-note">
      待结算是订单已签收或已对账、仍在等待联通向公司付款的提成；待发放是公司已经收款、尚未向提成人员实际发放的提成。历史累计扣回是一共扣回过的提成，不是当前尚待扣回余额；客户退款与提成扣回分别核算。
    </p>

    {dashboard.unconfiguredOrders > 0 ? (
      <div className="commission-unconfigured" role="status">
        <strong>需管理员配置</strong>
        <span>
          {dashboard.unconfiguredOrders} 笔订单含未配置提成的商品，
          暂不计入预计和累计金额。
        </span>
      </div>
    ) : null}

    <section className="commission-order-section" aria-labelledby="commission-orders-title">
      <div className="commission-order-section__heading">
        <div>
          <h2 id="commission-orders-title">按订单查看</h2>
          <p>每笔提成都保留商品、数量、适用规则和退单扣回。</p>
        </div>
        {onPayout ? (
          <button disabled={payoutBusy || selected.size === 0} onClick={() => void runPayout()} type="button">
            {payoutBusy ? "正在发放…" : `发放所选提成（${selected.size}）`}
          </button>
        ) : null}
      </div>
      {payoutError ? <p className="commission-unconfigured" role="alert">{payoutError}</p> : null}

      <div className="commission-order-list">
        {dashboard.orders.length === 0 ? (
          <p className="commission-order-empty">本期暂无提成订单</p>
        ) : dashboard.orders.map((order) => {
          const earningLines = order.lines.filter((line) => !isDeductionLine(line));
          const deductionLines = order.lines.filter(isDeductionLine);
          const originalFen = earningLines.reduce((sum, line) => sum + line.subtotalFen, 0);
          const deductionFen = Math.abs(deductionLines.reduce((sum, line) => sum + line.subtotalFen, 0));
          return (
          <article
            className={`commission-order-card is-${order.status}`}
            data-testid={`commission-order-${order.orderId}`}
            key={order.orderId}
          >
            <header>
              <div>
                {onPayout ? (
                  <input
                    aria-label={`选择订单 ${order.orderNo}`}
                    checked={selected.has(order.orderId)}
                    disabled={payoutBusy || order.payoutStatus !== "pending"}
                    onChange={(event) => { const checked = event.currentTarget.checked; setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(order.orderId); else next.delete(order.orderId);
                      return next;
                    }); }}
                    title={order.payoutStatus === "deduction" ? "该订单为待扣回提成" : order.payoutStatus === "paid" ? "提成已发放" : order.payoutStatus !== "pending" ? "尚未到发放条件" : "选择发放"}
                    type="checkbox"
                  />
                ) : null}
                <span>{order.orderNo}</span>
                <h3>{order.customerMasked}</h3>
                <time>{order.activatedAt}</time>
                {order.ledgerEntries?.length ? (
                  <small>{[...new Set(order.ledgerEntries.map((entry) => entry.beneficiaryName))].join("、")}</small>
                ) : null}
              </div>
              <div className="commission-order-card__amount">
                <span>{order.statusLabel}</span>
                <strong>{displayMoney(order.amountFen)}</strong>
              </div>
            </header>
            {order.status !== "exception" ? (
              <dl className="commission-order-card__breakdown" aria-label="本单提成汇总">
                <div><dt>原提成</dt><dd>{displayMoney(originalFen)}</dd></div>
                <div className={deductionFen > 0 ? "has-deduction" : ""}><dt>应扣提成</dt><dd>{displayMoney(-deductionFen)}</dd></div>
                <div><dt>当前净额</dt><dd>{displayMoney(order.amountFen)}</dd></div>
              </dl>
            ) : null}
            <div className="commission-order-card__lines">
              {order.status === "exception" ? (
                <p className="commission-order-card__exception">
                  该订单未生成提成快照，当前不计入提成金额，请联系管理员核对激活时的规则版本。
                </p>
              ) : (
                <>
                  {earningLines.length > 0 ? <CommissionLineGroup lines={earningLines} title="本单提成商品" tone="earning" /> : null}
                  {deductionLines.length > 0 ? <CommissionLineGroup lines={deductionLines} title="应扣提成" tone="deduction" /> : null}
                </>
              )}
            </div>
          </article>
          );
        })}
      </div>
      <Pagination
        onPageChange={(nextPage) => onPageChange?.(nextPage)}
        page={dashboard.page ?? 1}
        totalItems={dashboard.total ?? dashboard.orders.length}
      />
    </section>
    </section>
  );
};
