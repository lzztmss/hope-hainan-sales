import type { PricingStructure } from "../domain/types";

type PricingStructureCardProps = {
  planName: string;
  roomLabel?: string;
  elderCount?: number;
  structure: PricingStructure;
};

const formatMoney = (amount: number): string =>
  amount.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const PricingStructureCard = ({
  planName,
  roomLabel,
  elderCount,
  structure,
}: PricingStructureCardProps) => {
  const total = structure.lines.reduce(
    (sum, line) => sum + line.subtotal,
    0,
  );

  return (
    <section
      aria-labelledby="pricing-structure-title"
      className="pricing-structure"
    >
      <div className="section-heading-row">
        <div>
          <h2 id="pricing-structure-title">当前方案核算结构</h2>
          <p className="current-plan-name">{planName}</p>
        </div>
        <span>{structure.usesStandardBundle ? "套装 + 增配" : "按需拆分"}</span>
      </div>
      {roomLabel || elderCount ? (
        <p className="plan-context">
          {roomLabel ? `户型：${roomLabel}` : null}
          {roomLabel && elderCount ? " · " : null}
          {elderCount ? `长者人数：${elderCount} 位` : null}
        </p>
      ) : null}
      <p className="structure-guidance">
        {structure.usesStandardBundle
          ? "标准套装按 ¥1,280 / 套核算，其余设备作为个性增配；下方仍逐件列出完整安装明细。"
          : "当前选择未包含完整标准套装，按拆分配件逐项核算。"}
      </p>
      <ul className="structure-lines">
        {structure.lines.map((line) => (
          <li key={line.id}>
            <div>
              <strong>
                {line.label} × {line.quantity} {line.unit}
              </strong>
              <span>单价 ¥{formatMoney(line.unitPrice)}</span>
            </div>
            <b>¥{formatMoney(line.subtotal)}</b>
          </li>
        ))}
      </ul>
      <p className="structure-total">核算合计：¥{formatMoney(total)}</p>
    </section>
  );
};
