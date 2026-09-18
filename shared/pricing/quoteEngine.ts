import { ACTIVE_CATALOG } from "./catalog.js";
import type {
  ChargeSku,
  ComponentId,
  PricingCatalog,
  QuoteCalculation,
  QuoteChargeLine,
  QuoteComponentLine,
  QuoteInput,
  QuoteSelection,
  SubscriptionPlanDefinition,
  SubscriptionPlanSnapshot,
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

const resolveSubscriptionPlan = (
  input: QuoteInput,
  plan: SubscriptionPlanDefinition | null | undefined,
): SubscriptionPlanSnapshot | null => {
  if (input.mode === "one_time") {
    if (input.subscriptionPlanId !== null) {
      throw new Error("一次性购买不能选择月付套餐");
    }
    return null;
  }
  if (!input.subscriptionPlanId || !plan || plan.id !== input.subscriptionPlanId) {
    throw new Error("36 个月月付必须选择有效套餐");
  }
  if (!plan.active) throw new Error("所选月付套餐已停用");
  if (plan.contractMonths !== 36) throw new Error("月付套餐必须为36个月");
  if (!Number.isSafeInteger(plan.monthlyFen) || plan.monthlyFen <= 0) {
    throw new Error("月付套餐价格不正确");
  }
  if (plan.items.length === 0) throw new Error("月付套餐必须包含设备");
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyFen: plan.monthlyFen,
    contractMonths: 36,
    version: plan.version,
    items: plan.items.map((item) => ({ ...item })),
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
  catalog: PricingCatalog,
  charges: readonly { sku: ChargeSku; quantity: number }[],
  plan: SubscriptionPlanSnapshot | null,
): QuoteChargeLine[] =>
  plan
    ? [{
        sku: `PLAN:${plan.id}`,
        label: plan.name,
        unit: "套",
        quantity: 1,
        oneTimeUnitFen: 0,
        monthlyUnitFen: plan.monthlyFen,
        oneTimeSubtotalFen: 0,
        monthlySubtotalFen: plan.monthlyFen,
      }]
    :
  charges.map(({ sku, quantity }) => {
    const definition = catalog.charges[sku];
    const oneTimeUnitFen = definition.oneTimeFen;
    const monthlyUnitFen = 0;

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
  plan?: SubscriptionPlanDefinition | null,
): QuoteCalculation => {
  const subscriptionPlan = resolveSubscriptionPlan(input, plan);
  const selection = normalizeSelection(input.selection);
  const selectedOneTimeCharges = canonicalCharges(selection, catalog);
  if (
    subscriptionPlan &&
    selectedOneTimeCharges.some((entry) => entry.quantity > 0)
  ) {
    throw new Error("月付订单只能选择一个套餐，不能混入一次性设备");
  }
  const charges = subscriptionPlan
    ? subscriptionPlan.items.map((item) => ({ ...item }))
    : selectedOneTimeCharges;
  const chargeLines = buildChargeLines(catalog, charges, subscriptionPlan);
  const componentLines = buildComponentLines(charges, selection, catalog);
  const oneTimeFen = chargeLines.reduce(
    (total, line) => total + line.oneTimeSubtotalFen,
    0,
  );
  const monthlyTotalFen = subscriptionPlan?.monthlyFen ?? 0;

  return {
    catalogVersion: catalog.version,
    mode: input.mode,
    subscriptionPlan,
    chargeLines,
    componentLines,
    oneTimeFen,
    monthlyTotalFen,
    contract36Fen:
      input.mode === "contract_36" ? monthlyTotalFen * 36 : 0,
  };
};
