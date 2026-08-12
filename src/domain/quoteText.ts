export type QuoteTextLine = {
  label: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  locations: readonly string[];
  reason: string;
};

export type QuoteTextEntitlement = {
  label: string;
  display: string;
};

export type QuoteTextPriceReference = {
  label: string;
  unit: string;
  price: number;
  detail?: string;
};

export type QuoteTextPricingLine = {
  label: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type QuoteTextInput = {
  companyName: string;
  quoteDate: string;
  planName: string;
  roomLabel?: string;
  elderCount?: number;
  priceReferences: readonly QuoteTextPriceReference[];
  pricingStructure: readonly QuoteTextPricingLine[];
  lines: readonly QuoteTextLine[];
  deviceTotal: number;
  fttrDisplay: string;
  finalTotal: number;
  entitlements: readonly QuoteTextEntitlement[];
};

const formatMoney = (amount: number): string =>
  amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });

export const formatQuoteText = (input: QuoteTextInput): string => {
  const contextLines = [
    `方案名称：${input.planName}`,
    input.roomLabel ? `户型：${input.roomLabel}` : null,
    input.elderCount ? `长者人数：${input.elderCount} 位` : null,
  ].filter((line): line is string => line !== null);
  const detailLines = input.lines.flatMap((line, index) => [
    `${index + 1}. ${line.label} × ${line.quantity} ${line.unit}`,
    `   单价：¥${formatMoney(line.unitPrice)}`,
    `   小计：¥${formatMoney(line.subtotal)}`,
    `   安装位置：${line.locations.join("；")}`,
    `   配置原因：${line.reason}`,
  ]);
  const entitlementLines = input.entitlements.map(
    (entitlement) => `- ${entitlement.label}：${entitlement.display}`,
  );
  const priceReferenceLines = input.priceReferences.flatMap(
    (reference, index) => [
      `${index + 1}. ${reference.label}：¥${formatMoney(reference.price)} / ${reference.unit}`,
      ...(reference.detail ? [`   套装明细：${reference.detail}`] : []),
    ],
  );
  const pricingStructureLines = input.pricingStructure.map(
    (line) =>
      `- ${line.label} × ${line.quantity} ${line.unit}：¥${formatMoney(line.subtotal)}`,
  );

  return [
    input.companyName,
    "海南联通 FTTR · 心连心智慧守护报价",
    `报价日期：${input.quoteDate}`,
    ...contextLines,
    "",
    "大客户特优价基准",
    ...priceReferenceLines,
    "",
    "当前方案核算结构",
    ...pricingStructureLines,
    "",
    "设备明细",
    ...detailLines,
    "",
    `设备合计：¥${formatMoney(input.deviceTotal)}`,
    `联通 FTTR：${input.fttrDisplay}`,
    `最终合计：¥${formatMoney(input.finalTotal)}`,
    "",
    "专属权益",
    ...entitlementLines,
  ].join("\n");
};
