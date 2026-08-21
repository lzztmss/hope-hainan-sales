import { Pagination } from "../components/Pagination";
import { formatFen } from "../../shared/money";
import "./myCommission.css";

export interface MyCommissionSummary {
  estimatedFen: number;
  accruedNetFen: number;
  pendingSettlementFen: number;
  pendingPaymentFen: number;
  paidThisMonthFen: number;
  paidLifetimeFen: number;
  reversedLifetimeFen: number;
  netLifetimeFen: number;
}

export interface MyCommissionOrderLine {
  sku: string;
  label: string;
  quantity: number;
  unitCommissionFen: number;
  subtotalFen: number;
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
}

const displayMoney = (value: number, reversal = false): string => {
  const absolute = Math.abs(value);
  const prefix = value < 0 || reversal ? "−" : "";
  return `${prefix}¥${formatFen(absolute)}`;
};

const summaryDefinitions: ReadonlyArray<{
  key: keyof MyCommissionSummary;
  label: string;
  tone: "primary" | "normal" | "warning" | "success";
}> = [
  { key: "estimatedFen", label: "预计提成", tone: "normal" },
  { key: "accruedNetFen", label: "已计提净额", tone: "primary" },
  { key: "pendingSettlementFen", label: "待结算", tone: "warning" },
  { key: "pendingPaymentFen", label: "待发放", tone: "warning" },
  { key: "paidThisMonthFen", label: "本月已发放", tone: "success" },
  { key: "paidLifetimeFen", label: "累计已发放", tone: "success" },
  { key: "reversedLifetimeFen", label: "累计退单扣回", tone: "normal" },
  { key: "netLifetimeFen", label: "累计净提成", tone: "primary" },
];

export const MyCommissionPage = ({ dashboard, onPageChange }: MyCommissionPageProps) => {
  return (
    <section className="my-commission-page" aria-labelledby="my-commission-title">
    <header className="my-commission-page__header">
      <div>
        <p>销售激励</p>
        <h1 id="my-commission-title">我的提成</h1>
        <span>{dashboard.periodLabel}·数据以订单生效和结算状态为准</span>
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
        </article>
      ))}
    </section>
    <p className="commission-summary-note">
      已计提净额为本月已计提提成减本月退单扣回；累计净提成为历史全部已计提提成减全部退单扣回。客户实际退款与提成扣回分别核算。
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
          <p>每笔提成都保留商品、数量、适用规则和退单冲回。</p>
        </div>
      </div>

      <div className="commission-order-list">
        {dashboard.orders.length === 0 ? (
          <p className="commission-order-empty">本期暂无提成订单</p>
        ) : dashboard.orders.map((order) => (
          <article
            className={`commission-order-card is-${order.status}`}
            data-testid={`commission-order-${order.orderId}`}
            key={order.orderId}
          >
            <header>
              <div>
                <span>{order.orderNo}</span>
                <h3>{order.customerMasked}</h3>
                <time>{order.activatedAt}</time>
              </div>
              <div className="commission-order-card__amount">
                <span>{order.statusLabel}</span>
                <strong>{displayMoney(order.amountFen)}</strong>
              </div>
            </header>
            <div className="commission-order-card__lines">
              {order.status === "exception" ? (
                <p className="commission-order-card__exception">
                  该订单未生成提成快照，当前不计入提成金额，请联系管理员核对激活时的规则版本。
                </p>
              ) : order.lines.map((line) => (
                <div key={`${order.orderId}-${line.sku}`}>
                  <span>
                    {line.label} ×{line.quantity}
                  </span>
                  <span>
                    {displayMoney(line.unitCommissionFen)} × {line.quantity}
                  </span>
                  <strong>{displayMoney(line.subtotalFen)}</strong>
                </div>
              ))}
            </div>
          </article>
        ))}
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
