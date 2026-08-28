import { useState } from "react";

import { isNonReturnablePackageSku } from "../../shared/pricing/returnPolicy";
import type { QuoteChargeLine } from "../../shared/pricing/types";

export type OrderSalesChannel = "online" | "offline";

export interface OrderCompositionDialogProps {
  busy: boolean;
  lines: readonly QuoteChargeLine[];
  onClose(): void;
  onConfirm(channel: OrderSalesChannel): void;
}

export const OrderCompositionDialog = ({
  busy,
  lines,
  onClose,
  onConfirm,
}: OrderCompositionDialogProps) => {
  const [channel, setChannel] = useState<OrderSalesChannel | null>(null);

  return <div className="quote-order-confirm-backdrop">
    <section aria-labelledby="order-composition-title" aria-modal="true" className="quote-order-confirm" role="dialog">
      <header>
        <div>
          <span>生成订单前确认</span>
          <h2 id="order-composition-title">本次销售构成</h2>
        </div>
        <button disabled={busy} onClick={onClose} type="button">关闭</button>
      </header>
      <p>订单将按以下计价项目生成。套餐内设备不会作为独立加购商品重复计价。</p>
      <fieldset className="quote-order-channel">
        <legend>选择订单渠道</legend>
        <label>
          <input checked={channel === "online"} name="sales-channel" onChange={() => setChannel("online")} type="radio" />
          <span><strong>线上订单</strong></span>
        </label>
        <label>
          <input checked={channel === "offline"} name="sales-channel" onChange={() => setChannel("offline")} type="radio" />
          <span><strong>线下订单</strong></span>
        </label>
      </fieldset>
      <ul>
        {lines.map((line) => {
          const packageLine = isNonReturnablePackageSku(line.sku);
          return (
            <li data-kind={packageLine ? "package" : "standalone"} key={line.sku}>
              <span>{packageLine ? "套餐" : "独立单品"}</span>
              <strong>{line.label} × {line.quantity} {line.unit}</strong>
            </li>
          );
        })}
      </ul>
      <footer>
        <button disabled={busy} onClick={onClose} type="button">返回检查</button>
        <button className="is-primary" disabled={busy || channel === null} onClick={() => channel && onConfirm(channel)} type="button">
          {busy ? "正在生成订单…" : "确认并生成订单"}
        </button>
      </footer>
    </section>
  </div>;
};
