import type {
  PublicPriceReference,
  QuoteConfig,
} from "../domain/types";

type PublicPriceCatalogProps = {
  config: QuoteConfig;
  references: readonly PublicPriceReference[];
};

const formatMoney = (amount: number): string =>
  amount.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const PublicPriceCatalog = ({
  config,
  references,
}: PublicPriceCatalogProps) => (
  <section
    aria-labelledby="public-price-title"
    className="public-price-catalog"
  >
    <div className="section-heading-row">
      <div>
        <h2 id="public-price-title">大客户特优价基准</h2>
        <p>按手表、睡眠床垫、标准套装、拆分配件顺序列示</p>
      </div>
      <span>价格透明</span>
    </div>
    <div className="public-price-grid">
      {references.map((reference, index) => (
        <article
          key={reference.id}
          aria-label={reference.label}
          className="public-price-item"
          data-featured={index < 3}
          data-standard-bundle={reference.id === "standard_bundle"}
        >
          <div>
            <h3>{reference.label}</h3>
            <p>
              ¥{formatMoney(reference.price)} / {reference.unit}
            </p>
          </div>
          {reference.detail ? (
            <div className="bundle-detail">
              <h4>套装明细</h4>
              <p>{reference.detail}</p>
              <p>{config.standard_bundle.motion_reason}</p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  </section>
);
