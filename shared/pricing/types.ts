export type PaymentMode = "one_time" | "contract_36";

export type RoomType = "one_bedroom" | "two_bedroom" | "three_bedroom";

export type ChargeSku =
  | "WATCH"
  | "MATTRESS"
  | "STANDARD_BUNDLE"
  | "ONE_KEY"
  | "HOME_DUAL"
  | "GATEWAY"
  | "MOTION"
  | "DOOR"
  | "PORTABLE_BUTTON"
  | "WALL_BUTTON";

export type ComponentId =
  | "watch"
  | "mattress"
  | "gateway"
  | "motion"
  | "door"
  | "portableButton"
  | "wallButton";

export interface QuoteSelection {
  watch?: number;
  mattress?: number;
  standardBundle?: number;
  oneKey?: number;
  homeDual?: number;
  gateway?: number;
  motion?: number;
  door?: number;
  portableButton?: number;
  wallButton?: number;
  locations?: Partial<Record<ComponentId, readonly string[]>>;
}

export interface QuoteInput {
  mode: PaymentMode;
  subscriptionPlanId: string | null;
  selection: QuoteSelection;
}

export interface SubscriptionPlanItem {
  sku: Extract<
    ChargeSku,
    | "WATCH"
    | "MATTRESS"
    | "GATEWAY"
    | "MOTION"
    | "DOOR"
    | "PORTABLE_BUTTON"
    | "WALL_BUTTON"
  >;
  quantity: number;
}

export interface SubscriptionPlanDefinition {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyFen: number;
  contractMonths: 36;
  active: boolean;
  version: number;
  items: readonly SubscriptionPlanItem[];
}

export interface SubscriptionPlanSnapshot {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyFen: number;
  contractMonths: 36;
  version: number;
  items: SubscriptionPlanItem[];
}

export interface CatalogCharge {
  readonly sku: ChargeSku;
  readonly label: string;
  readonly unit: string;
  readonly oneTimeFen: number;
  readonly monthlyFen: number;
  readonly components: Readonly<Partial<Record<ComponentId, number>>>;
}

export interface ComponentDefinition {
  readonly componentId: ComponentId;
  readonly label: string;
  readonly unit: string;
  readonly defaultLocation: string;
  readonly reason: string;
}

export interface PricingCatalog {
  readonly version: string;
  readonly charges: Readonly<Record<ChargeSku, CatalogCharge>>;
  readonly components: Readonly<Record<ComponentId, ComponentDefinition>>;
  readonly entitlements: readonly {
    readonly label: string;
    readonly display: string;
  }[];
}

export interface QuoteChargeLine {
  sku: string;
  label: string;
  unit: string;
  quantity: number;
  oneTimeUnitFen: number;
  monthlyUnitFen: number;
  oneTimeSubtotalFen: number;
  monthlySubtotalFen: number;
}

export interface QuoteComponentLine {
  componentId: ComponentId;
  label: string;
  unit: string;
  quantity: number;
  locations: string[];
  reason: string;
}

export interface QuoteCalculation {
  catalogVersion: string;
  mode: PaymentMode;
  subscriptionPlan: SubscriptionPlanSnapshot | null;
  chargeLines: QuoteChargeLine[];
  componentLines: QuoteComponentLine[];
  oneTimeFen: number;
  monthlyTotalFen: number;
  contract36Fen: number;
}
