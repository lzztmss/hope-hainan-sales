import type {
  ProductId,
  QuantityMap,
  QuoteConfig,
  QuoteLine,
  QuoteMode,
} from "../domain/types";

type DeviceListProps = {
  config: QuoteConfig;
  productIds: readonly ProductId[];
  lines: QuoteLine[];
  quantities: QuantityMap;
  mode: QuoteMode;
  onAdjust: (productId: ProductId, change: number) => void;
};

const GATEWAY_DEPENDENCIES = [
  "motion",
  "door",
  "portable_button",
  "wall_button",
] as const satisfies readonly ProductId[];

const formatMoney = (amount: number): string =>
  amount.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const DeviceList = ({
  config,
  productIds,
  lines,
  quantities,
  mode,
  onAdjust,
}: DeviceListProps) => {
  const gatewayRequired =
    mode === "home" ||
    GATEWAY_DEPENDENCIES.some((productId) => quantities[productId] > 0);

  return (
    <section aria-labelledby="device-list-title" className="device-list">
      <h2 id="device-list-title">设备明细与自由增减</h2>
      <p className="gateway-guidance">
        {mode === "home"
          ? "居家户型模式下迷你网关至少保留 1 个"
          : "选择传感器或报警按钮时，迷你网关至少保留 1 个"}
      </p>
      <div className="device-cards">
        {productIds.map((productId) => {
          const product = config.products[productId];
          const line = lines.find((candidate) => candidate.productId === productId);
          const quantity = quantities[productId];
          const locations = line?.locations ?? [product.default_location];
          const reason = line?.reason ?? product.reason;
          const decrementDisabled =
            quantity === 0 ||
            (productId === "gateway" && gatewayRequired && quantity === 1);

          return (
            <article
              key={productId}
              aria-label={product.label}
              className="device-card"
              data-selected={quantity > 0}
            >
              <h3>{product.label}</h3>
              <p>¥{formatMoney(product.price)} / {product.unit}</p>
              <div className="quantity-control">
                <button
                  type="button"
                  aria-label={`减少${product.label}数量`}
                  disabled={decrementDisabled}
                  onClick={() => onAdjust(productId, -1)}
                >
                  −
                </button>
                <span aria-live="polite">× {quantity}</span>
                <button
                  type="button"
                  aria-label={`增加${product.label}数量`}
                  disabled={quantity === 20}
                  onClick={() => onAdjust(productId, 1)}
                >
                  +
                </button>
              </div>
              <p>小计：¥{formatMoney(product.price * quantity)}</p>
              <div>
                <h4>安装位置</h4>
                <ul>
                  {locations.map((location, index) => (
                    <li key={`${location}-${index}`}>{location}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>配置原因</h4>
                <p>{reason}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
