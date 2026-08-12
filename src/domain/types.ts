export type ProductId =
  | "watch"
  | "mattress"
  | "gateway"
  | "motion"
  | "door"
  | "portable_button"
  | "wall_button";

export type QuoteMode = "guardian" | "home";

export type RoomType =
  | "one_bedroom"
  | "two_bedroom"
  | "three_bedroom";

export type QuantityMap = Record<ProductId, number>;

export interface QuoteLine {
  productId: ProductId;
  label: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  locations: string[];
  reason: string;
}

export interface FttrResult {
  raw: string;
  amount: number;
  display: string;
  error: string | null;
}

export interface QuoteTotals {
  deviceTotal: number;
  fttrTotal: number;
  finalTotal: number;
}

export type PublicPriceId = ProductId | "standard_bundle";

export interface PublicPriceReference {
  id: PublicPriceId;
  label: string;
  unit: string;
  price: number;
  detail?: string;
}

export interface PricingStructureLine {
  id: PublicPriceId;
  label: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface PricingStructure {
  usesStandardBundle: boolean;
  lines: PricingStructureLine[];
}

export interface QuoteContext {
  mode: QuoteMode;
  roomType?: RoomType;
  elderCount?: 1 | 2 | 3 | 4;
  comboId?: string;
}

export interface ProductQuoteConfig {
  label: string;
  unit: string;
  price: number;
  reason: string;
  default_location: string;
}

export interface GuardianComboConfig {
  name: string;
  quantities: Partial<Record<ProductId, number>>;
  summary?: string;
  locations?: Partial<Record<ProductId, readonly string[]>>;
}

export interface RoomQuoteConfig {
  label: string;
  shared_quantities: Partial<Record<ProductId, number>>;
  motion_locations: Record<"1" | "2" | "3" | "4", readonly string[]>;
  motion_reasons?: Partial<Record<"1" | "2" | "3" | "4", string>>;
  optional_products?: readonly string[];
}

export interface StandardBundleConfig {
  label: string;
  unit: string;
  quantities: Partial<Record<ProductId, number>>;
  motion_locations: readonly string[];
  motion_reason: string;
}

export interface QuoteConfig {
  products: Record<ProductId, ProductQuoteConfig>;
  product_order: readonly string[];
  public_price_order: readonly string[];
  standard_bundle: StandardBundleConfig;
  guardian_combos: Record<string, GuardianComboConfig>;
  room_types: Record<RoomType, RoomQuoteConfig> & {
    custom?: RoomQuoteConfig;
  };
}
