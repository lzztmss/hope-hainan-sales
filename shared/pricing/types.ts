export type PaymentMode = "one_time" | "contract_36";

export type FttrPlan = 129 | 159 | 199 | 239 | 299 | 399;

export type FttrKind = "none" | "standard" | "custom";

export type RoomType = "one_bedroom" | "two_bedroom" | "three_bedroom";

export type ChargeSku =
  | "FULL_FAMILY"
  | "WATCH_MATTRESS"
  | "WATCH_STANDARD"
  | "MATTRESS_STANDARD"
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
  fttrPlan: number | null;
  customFttrNote?: string;
  selection: QuoteSelection;
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
  readonly fttrPlans: readonly FttrPlan[];
  readonly charges: Readonly<Record<ChargeSku, CatalogCharge>>;
  readonly components: Readonly<Record<ComponentId, ComponentDefinition>>;
  readonly entitlements: readonly {
    readonly label: string;
    readonly display: string;
  }[];
}

export interface QuoteChargeLine {
  sku: ChargeSku;
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
  fttrKind: FttrKind;
  fttrPlan: number | null;
  customFttrNote: string | null;
  chargeLines: QuoteChargeLine[];
  componentLines: QuoteComponentLine[];
  fttrMonthlyFen: number;
  heartMonthlyFen: number;
  oneTimeFen: number;
  monthlyTotalFen: number;
  contract36Fen: number;
}
