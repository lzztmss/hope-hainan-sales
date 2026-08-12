import type { ProductId, QuoteConfig } from "../domain/types";

type GuardianComboSelectorProps = {
  config: QuoteConfig;
  comboIds: readonly string[];
  selectedId: string;
  onSelect: (comboId: string) => void;
};

const formatMoney = (amount: number): string =>
  amount.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const GuardianComboSelector = ({
  config,
  comboIds,
  selectedId,
  onSelect,
}: GuardianComboSelectorProps) => (
  <section aria-labelledby="guardian-combos-title" className="combo-selector">
    <h2 id="guardian-combos-title">选择轻量守护组合</h2>
    <div className="combo-options">
      {comboIds.map((comboId) => {
        const combo = config.guardian_combos[comboId];
        if (!combo) {
          return null;
        }

        const contents = Object.entries(combo.quantities).map(
          ([productId, quantity]) => {
            const product = config.products[productId as ProductId];
            return `${product.label} ×${quantity}`;
          },
        );
        const total = Object.entries(combo.quantities).reduce(
          (sum, [productId, quantity]) =>
            sum +
            config.products[productId as ProductId].price * (quantity ?? 0),
          0,
        );

        return (
          <article key={comboId} className="combo-card">
            <button
              type="button"
              aria-pressed={selectedId === comboId}
              onClick={() => onSelect(comboId)}
            >
              {combo.name}
            </button>
            <p>{contents.join("、")}</p>
            {combo.summary ? <p>{combo.summary}</p> : null}
            <p>起始设备合计：¥{formatMoney(total)}</p>
          </article>
        );
      })}
    </div>
  </section>
);
