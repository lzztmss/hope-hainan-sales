import type {
  FttrResult,
  PricingStructure,
  ProductId,
  PublicPriceReference,
  QuantityMap,
  QuoteConfig,
  QuoteContext,
  QuoteLine,
  QuoteMode,
  QuoteTotals,
  RoomType,
} from "./types";

const PRODUCT_IDS = [
  "watch",
  "mattress",
  "gateway",
  "motion",
  "door",
  "portable_button",
  "wall_button",
] as const satisfies readonly ProductId[];

const emptyQuantities = (): QuantityMap => ({
  watch: 0,
  mattress: 0,
  gateway: 0,
  motion: 0,
  door: 0,
  portable_button: 0,
  wall_button: 0,
});

const normalizeQuantity = (quantity: number): number => {
  if (!Number.isFinite(quantity)) {
    return 0;
  }

  return Math.min(20, Math.max(0, Math.trunc(quantity)));
};

const completeQuantities = (
  partial: Partial<Record<ProductId, number>>,
): QuantityMap => {
  const quantities = emptyQuantities();

  for (const productId of PRODUCT_IDS) {
    quantities[productId] = normalizeQuantity(partial[productId] ?? 0);
  }

  return quantities;
};

const isProductId = (value: string): value is ProductId =>
  PRODUCT_IDS.some((productId) => productId === value);

const elderKey = (context: QuoteContext): "1" | "2" | "3" | "4" =>
  String(context.elderCount ?? 1) as "1" | "2" | "3" | "4";

export const presetQuantities = (
  config: QuoteConfig,
  roomType: RoomType,
  elderCount: 1 | 2 | 3 | 4,
): QuantityMap => {
  const room = config.room_types[roomType];
  if (!room) {
    throw new Error(`Unknown room type: ${roomType}`);
  }

  const quantities = completeQuantities(room.shared_quantities);
  quantities.motion = normalizeQuantity(
    room.motion_locations[String(elderCount) as "1" | "2" | "3" | "4"]
      .length,
  );
  quantities.watch = elderCount;
  quantities.mattress = elderCount;

  return quantities;
};

export const guardianQuantities = (
  config: QuoteConfig,
  comboId: string,
): QuantityMap => {
  const combo = config.guardian_combos[comboId];
  if (!combo) {
    throw new Error(`Unknown guardian combo: ${comboId}`);
  }

  return completeQuantities(combo.quantities);
};

export const enforceGateway = (
  mode: QuoteMode,
  quantities: QuantityMap,
): QuantityMap => {
  const normalized = completeQuantities(quantities);
  const requiresGateway =
    mode === "home" ||
    normalized.motion > 0 ||
    normalized.door > 0 ||
    normalized.portable_button > 0 ||
    normalized.wall_button > 0;

  if (requiresGateway) {
    normalized.gateway = Math.max(1, normalized.gateway);
  }

  return normalized;
};

const personalizedLocations = (
  productId: "watch" | "mattress",
  quantity: number,
): string[] =>
  Array.from({ length: quantity }, (_, index) =>
    productId === "watch"
      ? `第 ${index + 1} 位长者随身佩戴`
      : `第 ${index + 1} 位长者睡眠床位`,
  );

const presetLocations = (
  config: QuoteConfig,
  productId: ProductId,
  context: QuoteContext,
): readonly string[] => {
  if (context.mode === "guardian" && context.comboId) {
    return config.guardian_combos[context.comboId]?.locations?.[productId] ?? [];
  }

  if (context.mode === "home" && context.roomType && productId === "motion") {
    return config.room_types[context.roomType].motion_locations[elderKey(context)];
  }

  return [];
};

const buildLocations = (
  config: QuoteConfig,
  productId: ProductId,
  quantity: number,
  context: QuoteContext,
): string[] => {
  if (productId === "watch" || productId === "mattress") {
    return personalizedLocations(productId, quantity);
  }

  const configured = presetLocations(config, productId, context).slice(
    0,
    quantity,
  );

  if (productId === "motion") {
    return [
      ...configured,
      ...Array.from(
        { length: quantity - configured.length },
        (_, index) => `新增点位 ${index + 1}（现场确认）`,
      ),
    ];
  }

  return [
    ...configured,
    ...Array.from(
      { length: quantity - configured.length },
      () => config.products[productId].default_location,
    ),
  ];
};

const buildReason = (
  config: QuoteConfig,
  productId: ProductId,
  quantity: number,
  locations: readonly string[],
  context: QuoteContext,
): string => {
  if (context.mode === "home" && context.roomType && productId === "motion") {
    const recommendedQuantity = presetLocations(
      config,
      productId,
      context,
    ).length;

    if (quantity !== recommendedQuantity) {
      return `当前配置 ${quantity} 个：${locations.join(
        "、",
      )}。已按客户选择调整数量，建议结合现场动线确认最终覆盖范围。`;
    }

    return (
      config.room_types[context.roomType].motion_reasons?.[elderKey(context)] ??
      config.products.motion.reason
    );
  }

  return config.products[productId].reason;
};

export const buildQuoteLines = (
  config: QuoteConfig,
  quantities: QuantityMap,
  context: QuoteContext,
): QuoteLine[] => {
  const lines: QuoteLine[] = [];

  for (const orderedId of config.product_order) {
    if (!isProductId(orderedId)) {
      continue;
    }

    const quantity = normalizeQuantity(quantities[orderedId]);
    if (quantity === 0) {
      continue;
    }

    const product = config.products[orderedId];
    const locations = buildLocations(
      config,
      orderedId,
      quantity,
      context,
    );
    lines.push({
      productId: orderedId,
      label: product.label,
      unit: product.unit,
      unitPrice: product.price,
      quantity,
      subtotal: product.price * quantity,
      locations,
      reason: buildReason(config, orderedId, quantity, locations, context),
    });
  }

  return lines;
};

export const calculateStandardBundlePrice = (config: QuoteConfig): number =>
  PRODUCT_IDS.reduce(
    (total, productId) =>
      total +
      config.products[productId].price *
        normalizeQuantity(config.standard_bundle.quantities[productId] ?? 0),
    0,
  );

const standardBundleDetail = (config: QuoteConfig): string => {
  const componentText = config.product_order.flatMap((orderedId) => {
    if (!isProductId(orderedId)) {
      return [];
    }

    const quantity = normalizeQuantity(
      config.standard_bundle.quantities[orderedId] ?? 0,
    );

    return quantity > 0
      ? [`${config.products[orderedId].label} ×${quantity}`]
      : [];
  });

  return `${componentText.join("、")}；人体传感器点位：${config.standard_bundle.motion_locations.join(
    "、",
  )}`;
};

export const buildPublicPriceReferences = (
  config: QuoteConfig,
): PublicPriceReference[] =>
  config.public_price_order.flatMap<PublicPriceReference>((priceId) => {
    if (priceId === "standard_bundle") {
      return [
        {
          id: priceId,
          label: config.standard_bundle.label,
          unit: config.standard_bundle.unit,
          price: calculateStandardBundlePrice(config),
          detail: standardBundleDetail(config),
        },
      ];
    }

    if (!isProductId(priceId)) {
      return [];
    }

    const product = config.products[priceId];
    return [
      {
        id: priceId,
        label: product.label,
        unit: product.unit,
        price: product.price,
      },
    ];
  });

export const buildPricingStructure = (
  config: QuoteConfig,
  quantities: QuantityMap,
): PricingStructure => {
  const remaining = completeQuantities(quantities);
  const bundleQuantities = completeQuantities(
    config.standard_bundle.quantities,
  );
  const usesStandardBundle = PRODUCT_IDS.every(
    (productId) => remaining[productId] >= bundleQuantities[productId],
  );
  const lines: PricingStructure["lines"] = [];

  if (usesStandardBundle) {
    for (const productId of PRODUCT_IDS) {
      remaining[productId] -= bundleQuantities[productId];
    }

    const unitPrice = calculateStandardBundlePrice(config);
    lines.push({
      id: "standard_bundle",
      label: config.standard_bundle.label,
      unit: config.standard_bundle.unit,
      unitPrice,
      quantity: 1,
      subtotal: unitPrice,
    });
  }

  for (const orderedId of config.product_order) {
    if (!isProductId(orderedId)) {
      continue;
    }

    const quantity = remaining[orderedId];
    if (quantity === 0) {
      continue;
    }

    const product = config.products[orderedId];
    lines.push({
      id: orderedId,
      label: product.label,
      unit: product.unit,
      unitPrice: product.price,
      quantity,
      subtotal: product.price * quantity,
    });
  }

  return { usesStandardBundle, lines };
};

const invalidFttr = (raw: string, error: string): FttrResult => ({
  raw,
  amount: 0,
  display: raw.trim(),
  error,
});

export const parseFttrAmount = (raw: string): FttrResult => {
  const value = raw.trim();
  if (value === "") {
    return {
      raw,
      amount: 0,
      display: "待联通填写",
      error: null,
    };
  }

  const amount = Number(value);
  if (Number.isFinite(amount) && amount < 0) {
    return invalidFttr(raw, "请输入不小于 0 的 FTTR 金额");
  }

  if (!Number.isFinite(amount)) {
    return invalidFttr(raw, "请输入有效的 FTTR 金额");
  }

  const decimalDigits = value.includes(".") ? value.split(".")[1]?.length : 0;
  if ((decimalDigits ?? 0) > 2) {
    return invalidFttr(raw, "FTTR 金额最多保留两位小数");
  }

  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) {
    return invalidFttr(raw, "请输入有效的 FTTR 金额");
  }

  return {
    raw,
    amount,
    display: value,
    error: null,
  };
};

export const calculateTotals = (
  lines: QuoteLine[],
  fttr: FttrResult,
): QuoteTotals => {
  const deviceTotal = lines.reduce((total, line) => total + line.subtotal, 0);
  const fttrTotal = fttr.error === null ? fttr.amount : 0;

  return {
    deviceTotal,
    fttrTotal,
    finalTotal: deviceTotal + fttrTotal,
  };
};
