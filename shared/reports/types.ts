export type ReportGroupBy = "none" | "store" | "seller";

export interface SalesReportFilters {
  from?: string;
  to?: string;
  storeId?: string;
  sellerId?: string;
  groupBy?: ReportGroupBy;
}

export interface SalesReportMetrics {
  quoteCount: number;
  orderCount: number;
  conversionRateBps: number;
  oneTimeOriginalFen: number;
  returnedFen: number;
  oneTimeNetFen: number;
  fttrMonthlyFen: number;
  heartMonthlyFen: number;
  contract36Fen: number;
  commissionEstimatedFen: number;
  commissionPendingSettlementFen: number;
  commissionPaidFen: number;
  commissionReversedFen: number;
  commissionNetFen: number;
}

export interface SalesReportRow extends SalesReportMetrics {
  key: string;
  label: string;
  storeId: string | null;
  storeName: string | null;
  sellerId: string | null;
  sellerName: string | null;
}

export interface SalesReportResponse {
  generatedAt: string;
  period: {
    from: string;
    to: string;
    timeZone: "Asia/Shanghai";
  };
  scope: {
    kind: "seller" | "store" | "global";
    label: string;
  };
  totals: SalesReportMetrics;
  rows: SalesReportRow[];
}
