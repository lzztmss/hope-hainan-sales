import type { SalesReportResponse, SalesReportRow } from "../../shared/reports/types.js";

const dangerousSpreadsheetPrefix = /^[=+\-@\t\r]/;

export const escapeCsvCell = (value: string | number): string => {
  let text = String(value);
  if (dangerousSpreadsheetPrefix.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

const fen = (value: number): string => (value / 100).toFixed(2);
const rate = (basisPoints: number): string => `${(basisPoints / 100).toFixed(2)}%`;

const headers = [
  "统计范围",
  "营业厅",
  "销售员",
  "报价数",
  "订单数",
  "成交率",
  "一次性设备原额(元)",
  "退单额(元)",
  "一次性设备净额(元)",
  "FTTR月费(元)",
  "心连心月增费(元)",
  "36个月合约月费合计(元)",
  "提成预计(元)",
  "提成待结算(元)",
  "提成已发(元)",
  "退单扣回(元)",
  "提成净额(元)",
] as const;

const rowCells = (
  label: string,
  row: Pick<
    SalesReportRow,
    | "storeName"
    | "sellerName"
    | "quoteCount"
    | "orderCount"
    | "conversionRateBps"
    | "oneTimeOriginalFen"
    | "returnedFen"
    | "oneTimeNetFen"
    | "fttrMonthlyFen"
    | "heartMonthlyFen"
    | "contract36Fen"
    | "commissionEstimatedFen"
    | "commissionPendingSettlementFen"
    | "commissionPaidFen"
    | "commissionReversedFen"
    | "commissionNetFen"
  >,
): Array<string | number> => [
  label,
  row.storeName ?? "",
  row.sellerName ?? "",
  row.quoteCount,
  row.orderCount,
  rate(row.conversionRateBps),
  fen(row.oneTimeOriginalFen),
  fen(row.returnedFen),
  fen(row.oneTimeNetFen),
  fen(row.fttrMonthlyFen),
  fen(row.heartMonthlyFen),
  fen(row.contract36Fen),
  fen(row.commissionEstimatedFen),
  fen(row.commissionPendingSettlementFen),
  fen(row.commissionPaidFen),
  fen(row.commissionReversedFen),
  fen(row.commissionNetFen),
];

export const buildSalesReportCsv = (report: SalesReportResponse): string => {
  const totalRow = {
    ...report.totals,
    storeName: report.scope.kind === "store" ? report.scope.label : null,
    sellerName: report.scope.kind === "seller" ? report.scope.label : null,
  };
  const rows = [
    headers,
    rowCells("合计", totalRow),
    ...report.rows.map((row) => rowCells(row.label, row)),
  ];
  return `\uFEFF${rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\r\n")}\r\n`;
};
