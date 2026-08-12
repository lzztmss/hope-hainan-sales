import { ACTIVE_CATALOG } from "./catalog.js";
import type {
  ChargeSku,
  ComponentId,
  FttrKind,
  PricingCatalog,
  QuoteCalculation,
  QuoteChargeLine,
  QuoteComponentLine,
  QuoteInput,
  QuoteSelection,
} from "./types.js";

const COMPONENT_ORDER: readonly ComponentId[] = [
  "watch",
  "mattress",
  "gateway",
  "motion",
  "door",
  "portableButton",
  "wallButton",
];

type QuantityField = Exclude<keyof QuoteSelection, "locations">;

const validateQuantity = (
  field: QuantityField,
  value: number | undefined,
): number => {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isInteger(value) || value < 0 || value > 20) {
    throw new Error(`${field} 数量必须是 0 至 20 的整数`);
  }

  return value;
};

type NormalizedSelection = Required<
  Omit<QuoteSelection, "locations">
> & {
  locations: QuoteSelection["locations"];
};

const normalizeSelection = (selection: QuoteSelection): NormalizedSelection => ({
  watch: validateQuantity("watch", selection.watch),
  mattress: validateQuantity("mattress", selection.mattress),
  standardBundle: validateQuantity(
    "standardBundle",
    selection.standardBundle,
  ),
  oneKey: validateQuantity("oneKey", selection.oneKey),
  homeDual: validateQuantity("homeDual", selection.homeDual),
  gateway: validateQuantity("gateway", selection.gateway),
  motion: validateQuantity("motion", selection.motion),
  door: validateQuantity("door", selection.door),
  portableButton: validateQuantity(
    "portableButton",
    selection.portableButton,
  ),
  wallButton: validateQuantity("wallButton", selection.wallButton),
  locations: selection.locations,
});

interface ResolvedFttr {
  kind: FttrKind;
  plan: number | null;
  monthlyFen: number;
  customNote: string | null;
}

const resolveFttr = (
  input: QuoteInput,
  catalog: PricingCatalog,
): ResolvedFttr => {
  if (input.fttrPlan === null) {
    if (input.mode === "contract_36") {
      throw new Error("36 个月月付必须选择 FTTR 档位");
    }

    return {
      kind: "none",
      plan: null,
      monthlyFen: 0,
      customNote: null,
    };
  }

  if (
    !Number.isInteger(input.fttrPlan) ||
    input.fttrPlan < 1 ||
    input.fttrPlan > 9_999
  ) {
    throw new Error("FTTR 月费必须是 1 至 9999 元的整数");
  }

  const isStandard = catalog.fttrPlans.some(
    (plan) => plan === input.fttrPlan,
  );
  if (isStandard) {
    return {
      kind: "standard",
      plan: input.fttrPlan,
      monthlyFen: input.fttrPlan * 100,
      customNote: null,
    };
  }

  const customNote = input.customFttrNote?.trim();
  if (!customNote) {
    throw new Error("自定义 FTTR 月费必须填写说明");
  }

  return {
    kind: "custom",
    plan: input.fttrPlan,
    monthlyFen: input.fttrPlan * 100,
    customNote,
  };
};

const pushSku = (
  target: Array<{ sku: ChargeSku; quantity: number }>,
  sku: ChargeSku,
  quantity: number,
): void => {
  if (quantity > 0) {
    target.push({ sku, quantity });
  }
};

const canonicalCharges = (
  selection: NormalizedSelection,
  catalog: PricingCatalog,
): Array<{ sku: ChargeSku; quantity: number }> => {
  const charges: Array<{ sku: ChargeSku; quantity: number }> = [];
  pushSku(charges, "WATCH", selection.watch);
  pushSku(charges, "MATTRESS", selection.mattress);
  pushSku(charges, "STANDARD_BUNDLE", selection.standardBundle);
  pushSku(charges, "ONE_KEY", selection.oneKey);
  pushSku(charges, "HOME_DUAL", selection.homeDual);

  let gateway = selection.gateway;
  const packageGatewayCount = charges.reduce(
    (total, entry) =>
      total +
      (catalog.charges[entry.sku].components.gateway ?? 0) * entry.quantity,
    0,
  );
  const requiresGateway =
    selection.motion > 0 ||
    selection.door > 0 ||
    selection.portableButton > 0 ||
    selection.wallButton > 0;

  if (requiresGateway && gateway + packageGatewayCount === 0) {
    gateway = 1;
  }

  pushSku(charges, "GATEWAY", gateway);
  pushSku(charges, "MOTION", selection.motion);
  pushSku(charges, "DOOR", selection.door);
  pushSku(charges, "PORTABLE_BUTTON", selection.portableButton);
  pushSku(charges, "WALL_BUTTON", selection.wallButton);

  return charges;
};

const buildChargeLines = (
  input: QuoteInput,
  catalog: PricingCatalog,
  charges: readonly { sku: ChargeSku; quantity: number }[],
): QuoteChargeLine[] =>
  charges.map(({ sku, quantity }) => {
    const definition = catalog.charges[sku];
    const useMonthly = input.mode === "contract_36" && definition.monthlyFen > 0;
    const oneTimeUnitFen = useMonthly ? 0 : definition.oneTimeFen;
    const monthlyUnitFen = useMonthly ? definition.monthlyFen : 0;

    return {
      sku,
      label: definition.label,
      unit: definition.unit,
      quantity,
      oneTimeUnitFen,
      monthlyUnitFen,
      oneTimeSubtotalFen: oneTimeUnitFen * quantity,
      monthlySubtotalFen: monthlyUnitFen * quantity,
    };
  });

const defaultLocations = (
  componentId: ComponentId,
  quantity: number,
  catalog: PricingCatalog,
): string[] => {
  if (componentId === "watch") {
    return Array.from(
      { length: quantity },
      (_, index) => `第 ${index + 1} 位长者随身佩戴`,
    );
  }

  if (componentId === "mattress") {
    return Array.from(
      { length: quantity },
      (_, index) => `第 ${index + 1} 位长者睡眠床位`,
    );
  }

  if (componentId === "motion") {
    const standard = ["长者卧室", "卫生间", "客厅"];
    return Array.from(
      { length: quantity },
      (_, index) => standard[index] ?? `新增点位 ${index - 2}（现场确认）`,
    );
  }

  return Array.from(
    { length: quantity },
    () => catalog.components[componentId].defaultLocation,
  );
};

const buildComponentLines = (
  charges: readonly { sku: ChargeSku; quantity: number }[],
  selection: NormalizedSelection,
  catalog: PricingCatalog,
): QuoteComponentLine[] => {
  const quantities = Object.fromEntries(
    COMPONENT_ORDER.map((componentId) => [componentId, 0]),
  ) as Record<ComponentId, number>;

  for (const charge of charges) {
    const components = catalog.charges[charge.sku].components;
    for (const componentId of COMPONENT_ORDER) {
      quantities[componentId] +=
        (components[componentId] ?? 0) * charge.quantity;
    }
  }

  return COMPONENT_ORDER.flatMap((componentId) => {
    const quantity = quantities[componentId];
    if (quantity === 0) {
      return [];
    }

    const definition = catalog.components[componentId];
    const configuredLocations = selection.locations?.[componentId];
    const defaults = defaultLocations(componentId, quantity, catalog);
    const locations = Array.from(
      { length: quantity },
      (_, index) => configuredLocations?.[index] ?? defaults[index]!,
    );

    return [
      {
        componentId,
        label: definition.label,
        unit: definition.unit,
        quantity,
        locations,
        reason: definition.reason,
      },
    ];
  });
};

export const calculateQuote = (
  input: QuoteInput,
  catalog: PricingCatalog = ACTIVE_CATALOG,
): QuoteCalculation => {
  const fttr = resolveFttr(input, catalog);
  const selection = normalizeSelection(input.selection);
  const charges = canonicalCharges(selection, catalog);
  const chargeLines = buildChargeLines(input, catalog, charges);
  const componentLines = buildComponentLines(charges, selection, catalog);
  const fttrMonthlyFen = fttr.monthlyFen;
  const heartMonthlyFen = chargeLines.reduce(
    (total, line) => total + line.monthlySubtotalFen,
    0,
  );
  const oneTimeFen = chargeLines.reduce(
    (total, line) => total + line.oneTimeSubtotalFen,
    0,
  );
  const monthlyTotalFen = fttrMonthlyFen + heartMonthlyFen;

  return {
    catalogVersion: catalog.version,
    mode: input.mode,
    fttrKind: fttr.kind,
    fttrPlan: fttr.plan,
    customFttrNote: fttr.customNote,
    chargeLines,
    componentLines,
    fttrMonthlyFen,
    heartMonthlyFen,
    oneTimeFen,
    monthlyTotalFen,
    contract36Fen:
      input.mode === "contract_36" ? monthlyTotalFen * 36 : 0,
  };
};
