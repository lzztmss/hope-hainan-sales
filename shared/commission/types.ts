import type { PaymentMode } from "../pricing/types.js";

export type CommissionScope =
  | { kind: "global" }
  | { kind: "personnel_type"; value: "unicom" | "auxiliary" | "admin" }
  | { kind: "store"; value: string }
  | { kind: "salesperson"; value: string };

export interface CommissionRule {
  id: string;
  sku: string;
  amountFen: number;
  paymentMode: PaymentMode | "all";
  scope: CommissionScope;
  enabled: boolean;
}

export interface CommissionOrderLine {
  sku: string;
  label: string;
  quantity: number;
  lineType: "charge" | "component";
}

export interface SellerCommissionContext {
  salespersonId: string;
  storeId: string;
  personnelType: "unicom" | "auxiliary" | "admin";
  paymentMode: PaymentMode;
}

export interface CommissionCalculationItem {
  sku: string;
  label: string;
  quantity: number;
  ruleId: string;
  unitAmountFen: number;
  subtotalFen: number;
}

export interface UnconfiguredCommissionItem {
  sku: string;
  label: string;
  quantity: number;
}

export interface CommissionCalculation {
  totalFen: number;
  items: CommissionCalculationItem[];
  unconfigured: UnconfiguredCommissionItem[];
  ignoredComponentCount: number;
}
