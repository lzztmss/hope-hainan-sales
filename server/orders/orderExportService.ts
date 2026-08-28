import ExcelJS from "@excel.js/exceljs";

import { isNonReturnablePackageSku } from "../../shared/pricing/returnPolicy.js";
import { scopeForUser, type AuthenticatedUser } from "../auth/authorization.js";
import type { ReturnRepository, ReturnRequestRecord } from "../returns/returnService.js";
import {
  OrderServiceError,
  type OrderListFilters,
  type OrderService,
} from "./orderService.js";

const EXPORT_LIMIT = 20_000;
const PAGE_SIZE = 100;

type ExportOrder = Awaited<ReturnType<OrderService["listOrders"]>>["items"][number];

export interface OrderExportResult {
  buffer: Buffer;
  filename: string;
  orderCount: number;
}

export interface OrderExportServiceOptions {
  orderService: OrderService;
  returnRepository: Pick<ReturnRepository, "listRequestsForOrderIds">;
  now?: () => Date;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "待受理",
  accepted: "已受理",
  activated: "已激活",
  signed: "已签收",
  reconciled: "已对账",
  paid: "已收款",
  cancelled: "已取消",
  return_pending: "退货审批中",
  partially_returned: "已部分退货",
  returned: "已退货",
  voided: "已作废",
};

const RETURN_STATUS_LABELS: Record<string, string> = {
  requested: "待审批",
  approved: "已批准",
  rejected: "已驳回",
  completed: "已完成",
};

const RETURN_REASON_LABELS: Record<string, string> = {
  no_reason: "七天无理由（仅限线上销售）",
  quality: "商品质量问题",
  order_mismatch: "商品与订单不一致",
  service_issue: "安装或服务问题",
  other: "其他原因",
};

const PAYOUT_LABELS: Record<string, string> = {
  ineligible: "未到发放条件",
  pending: "待发放",
  paid: "已发放",
};

const CURRENCY_FORMAT = '¥#,##0.00;[Red]-¥#,##0.00';
const DATE_TIME_FORMAT = "yyyy-mm-dd hh:mm";

const yuan = (fen: number): number => fen / 100;

const safeText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = String(value).replaceAll("\u0000", "").slice(0, 2_000);
  return /^[=+@]/.test(text) ? `'${text}` : text;
};

const dateValue = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shanghaiDateTime = (value: Date): string =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(value)
    .replaceAll("/", "-");

const shanghaiFileStamp = (value: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}${part("month")}${part("day")}_${part("hour")}${part("minute")}${part("second")}`;
};

const snapshotText = (
  snapshot: Readonly<Record<string, unknown>> | null | undefined,
  ...keys: readonly string[]
): string => {
  for (const key of keys) {
    const value = snapshot?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const fttrLabel = (order: ExportOrder): string => {
  if (order.fttrKind === "none" || order.fttrPlan === null) return "未新增FTTR";
  if (order.fttrKind === "custom") {
    return `自定义 ${order.fttrPlan}元/月${order.customFttrNote ? `（${order.customFttrNote}）` : ""}`;
  }
  return `${order.fttrPlan}元/月`;
};

const filterSummary = (filters: OrderListFilters): string => {
  const parts: string[] = [];
  if (filters.query) parts.push(`搜索：${filters.query}`);
  if (filters.orderNo) parts.push(`订单号：${filters.orderNo}`);
  if (filters.customerPhoneTail) parts.push(`手机号后四位：${filters.customerPhoneTail}`);
  if (filters.storeQuery) parts.push(`营业厅：${filters.storeQuery}`);
  if (filters.sellerQuery) parts.push(`销售员：${filters.sellerQuery}`);
  if (filters.status) parts.push(`订单状态：${ORDER_STATUS_LABELS[filters.status] ?? filters.status}`);
  if (filters.paymentMode) parts.push(`付款方式：${filters.paymentMode === "contract_36" ? "36个月合约月付" : "一次性支付"}`);
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`下单日期：${filters.dateFrom ? shanghaiDateTime(filters.dateFrom).slice(0, 10) : "不限"} 至 ${filters.dateTo ? shanghaiDateTime(new Date(filters.dateTo.getTime() - 1)).slice(0, 10) : "不限"}`);
  }
  if (filters.signedDateFrom || filters.signedDateTo) {
    parts.push(`签收日期：${filters.signedDateFrom ? shanghaiDateTime(filters.signedDateFrom).slice(0, 10) : "不限"} 至 ${filters.signedDateTo ? shanghaiDateTime(new Date(filters.signedDateTo.getTime() - 1)).slice(0, 10) : "不限"}`);
  }
  if (filters.reconciledDateFrom || filters.reconciledDateTo) {
    parts.push(`对账日期：${filters.reconciledDateFrom ? shanghaiDateTime(filters.reconciledDateFrom).slice(0, 10) : "不限"} 至 ${filters.reconciledDateTo ? shanghaiDateTime(new Date(filters.reconciledDateTo.getTime() - 1)).slice(0, 10) : "不限"}`);
  }
  if (filters.reconciliationStatus) parts.push(`对账状态：${filters.reconciliationStatus === "reconciled" ? "已对账" : "待对账"}`);
  if (filters.collectionStatus) parts.push(`收款状态：${filters.collectionStatus === "paid" ? "已收款" : "未收款"}`);
  if (filters.commissionPayoutStatus) parts.push(`提成发放：${PAYOUT_LABELS[filters.commissionPayoutStatus]}`);
  return parts.length > 0 ? parts.join("；") : "全部可见订单";
};

const styleSheet = (
  sheet: ExcelJS.Worksheet,
  title: string,
  headers: readonly string[],
  widths: readonly number[],
  moneyColumns: readonly number[],
  dateColumns: readonly number[],
  metadata: readonly string[],
): void => {
  sheet.mergeCells(1, 1, 1, headers.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Microsoft YaHei", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF174A7E" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 30;

  metadata.slice(0, 2).forEach((value, index) => {
    const rowNo = index + 2;
    sheet.mergeCells(rowNo, 1, rowNo, headers.length);
    const cell = sheet.getCell(rowNo, 1);
    cell.value = safeText(value);
    cell.font = { name: "Microsoft YaHei", size: 10, color: { argb: "FF52667A" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    sheet.getRow(rowNo).height = index === 1 ? 30 : 20;
  });

  const headerRow = sheet.getRow(5);
  headerRow.values = [...headers];
  headerRow.height = 32;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F75B5" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD5DFEA" } },
      left: { style: "thin", color: { argb: "FFD5DFEA" } },
      bottom: { style: "thin", color: { argb: "FFD5DFEA" } },
      right: { style: "thin", color: { argb: "FFD5DFEA" } },
    };
  });
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = Math.min(Math.max(width, 10), 36);
  });
  moneyColumns.forEach((column) => {
    sheet.getColumn(column).numFmt = CURRENCY_FORMAT;
  });
  dateColumns.forEach((column) => {
    sheet.getColumn(column).numFmt = DATE_TIME_FORMAT;
  });
  sheet.views = [{ state: "frozen", ySplit: 5 }];
  sheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5, column: headers.length },
  };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
};

const finishDataRows = (sheet: ExcelJS.Worksheet): void => {
  for (let rowNo = 6; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Microsoft YaHei", size: 10 };
      cell.border = {
        top: { style: "hair", color: { argb: "FFDDE5ED" } },
        left: { style: "hair", color: { argb: "FFDDE5ED" } },
        bottom: { style: "hair", color: { argb: "FFDDE5ED" } },
        right: { style: "hair", color: { argb: "FFDDE5ED" } },
      };
      if (rowNo % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F9FC" } };
      }
    });
  }
};

const returnsByOrder = (records: readonly ReturnRequestRecord[]): Map<string, ReturnRequestRecord[]> => {
  const grouped = new Map<string, ReturnRequestRecord[]>();
  for (const record of records) {
    const values = grouped.get(record.orderId) ?? [];
    values.push(record);
    grouped.set(record.orderId, values);
  }
  return grouped;
};

const completedReturnedQuantity = (
  records: readonly ReturnRequestRecord[],
): Map<string, number> => {
  const quantities = new Map<string, number>();
  for (const record of records) {
    if (record.status !== "completed" || record.serviceType !== "refund") continue;
    for (const item of record.items) {
      quantities.set(item.orderLineId, (quantities.get(item.orderLineId) ?? 0) + item.quantity);
    }
  }
  return quantities;
};

export const buildOrderExportWorkbook = async (
  orders: readonly ExportOrder[],
  returnRecords: readonly ReturnRequestRecord[],
  actor: AuthenticatedUser,
  filters: OrderListFilters,
  exportedAt: Date,
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "海南联通 FTTR 心连心融合套餐销售报价系统";
  workbook.created = exportedAt;
  workbook.modified = exportedAt;
  workbook.subject = "订单对账导出";
  const metadata = [
    `导出时间：${shanghaiDateTime(exportedAt)}　导出人：${actor.displayName}　订单数量：${orders.length}`,
    `筛选条件：${filterSummary(filters)}`,
  ];
  const groupedReturns = returnsByOrder(returnRecords);
  const returnedQuantity = completedReturnedQuantity(returnRecords);

  const orderHeaders = [
    "订单号", "销售渠道", "客户姓名", "手机号", "营业厅", "销售员", "订单状态", "付款方式",
    "FTTR档位", "FTTR月费", "心连心原月增费", "当前心连心月增费", "当前每月合计", "36个月名义金额",
    "一次性商品金额", "累计实际退款", "创建时间", "激活时间", "签收时间", "对账时间", "收款时间",
    "提成发放状态", "当前净提成", "已发放提成", "退货扣回提成", "退单号",
  ] as const;
  const orderSheet = workbook.addWorksheet("订单对账明细", { properties: { defaultRowHeight: 20 } });
  styleSheet(
    orderSheet,
    "订单对账明细",
    orderHeaders,
    [24, 11, 14, 15, 20, 16, 13, 18, 18, 14, 16, 18, 16, 18, 17, 16, 19, 19, 19, 19, 19, 16, 15, 15, 16, 28],
    [10, 11, 12, 13, 14, 15, 16, 23, 24, 25],
    [17, 18, 19, 20, 21],
    metadata,
  );
  for (const order of orders) {
    const orderReturns = groupedReturns.get(order.id) ?? [];
    const returnedMonthlyFen = order.lines.reduce((total, line) => {
      const lineId = line.id ?? "";
      return total + (returnedQuantity.get(lineId) ?? 0) * line.monthlyUnitFen;
    }, 0);
    const currentFttrFen = order.status === "returned" ? 0 : order.fttrMonthlyFen;
    const currentHeartFen = order.status === "returned"
      ? 0
      : Math.max(0, order.heartMonthlyFen - returnedMonthlyFen);
    orderSheet.addRow([
      safeText(order.orderNo),
      order.salesChannel === "online" ? "线上" : "线下",
      safeText(order.customer.name),
      safeText(order.customer.phoneMasked),
      safeText(snapshotText(order.storeSnapshot, "name", "storeName") || order.storeId),
      safeText(snapshotText(order.sellerSnapshot, "displayName", "name") || order.sellerId),
      ORDER_STATUS_LABELS[order.status] ?? order.status,
      order.paymentMode === "contract_36" ? "36个月合约月付" : "一次性支付",
      safeText(fttrLabel(order)),
      yuan(currentFttrFen),
      yuan(order.heartMonthlyFen),
      yuan(currentHeartFen),
      yuan(currentFttrFen + currentHeartFen),
      yuan(order.contract36Fen),
      yuan(order.oneTimeFen),
      yuan(order.refundedFen),
      dateValue(order.createdAt),
      dateValue(order.activatedAt),
      dateValue(order.signedAt),
      dateValue(order.reconciledAt),
      dateValue(order.paidAt),
      PAYOUT_LABELS[order.commissionPayoutStatus] ?? order.commissionPayoutStatus,
      yuan(order.commissionNetFen),
      yuan(order.commissionPaidFen),
      yuan(order.commissionReversedFen),
      safeText(orderReturns.map((record) => record.returnNo).join("、")),
    ]);
  }
  finishDataRows(orderSheet);

  const itemHeaders = [
    "订单号", "营业厅", "销售员", "SKU", "商品名称", "商品类型", "原数量", "已退数量", "剩余数量",
    "单位", "一次性单价", "月付单价", "一次性小计", "月增费小计", "安装位置", "配置说明",
  ] as const;
  const itemSheet = workbook.addWorksheet("商品明细", { properties: { defaultRowHeight: 20 } });
  styleSheet(
    itemSheet,
    "商品明细",
    itemHeaders,
    [24, 20, 16, 18, 24, 15, 11, 11, 11, 10, 14, 14, 15, 15, 30, 30],
    [11, 12, 13, 14],
    [],
    metadata,
  );
  for (const order of orders) {
    for (const line of order.lines) {
      const lineId = line.id ?? "";
      const returned = returnedQuantity.get(lineId) ?? 0;
      const lineKind = line.lineType === "component"
        ? "套餐内设备"
        : isNonReturnablePackageSku(line.sku)
          ? "套餐"
          : "独立商品";
      itemSheet.addRow([
        safeText(order.orderNo),
        safeText(snapshotText(order.storeSnapshot, "name", "storeName") || order.storeId),
        safeText(snapshotText(order.sellerSnapshot, "displayName", "name") || order.sellerId),
        safeText(line.sku),
        safeText(line.label),
        lineKind,
        line.quantity,
        returned,
        Math.max(0, line.quantity - returned),
        safeText(line.unit),
        line.lineType === "component" ? null : yuan(line.oneTimeUnitFen),
        line.lineType === "component" ? null : yuan(line.monthlyUnitFen),
        line.lineType === "component" ? null : yuan(line.oneTimeSubtotalFen),
        line.lineType === "component" ? null : yuan(line.monthlySubtotalFen),
        safeText(line.locations.join("、")),
        safeText(line.reason),
      ]);
    }
  }
  finishDataRows(itemSheet);

  const returnHeaders = [
    "退单号", "原订单号", "处理类型", "退货范围", "申请原因类型", "申请说明", "申请人", "申请时间",
    "审批状态", "审批时间", "审批意见", "退货商品明细", "申请退款金额", "实际退款金额", "完成时间", "FTTR处理",
  ] as const;
  const returnSheet = workbook.addWorksheet("售后退款明细", { properties: { defaultRowHeight: 20 } });
  styleSheet(
    returnSheet,
    "售后退款明细",
    returnHeaders,
    [24, 24, 13, 13, 22, 32, 16, 19, 13, 19, 30, 36, 16, 16, 19, 28],
    [13, 14],
    [8, 10, 15],
    metadata,
  );
  for (const record of returnRecords) {
    const fttrHandling = record.returnType === "partial"
      ? "部分退货，不影响FTTR"
      : record.status === "completed"
        ? "已按整单退订统计"
        : record.status === "rejected"
          ? "已驳回，不影响FTTR"
          : "完成后将按整单退订统计";
    returnSheet.addRow([
      safeText(record.returnNo),
      safeText(record.orderNo),
      record.returnKind === "special" ? "特殊处理" : "普通处理",
      record.returnType === "full" ? "整单退货" : "部分退货",
      RETURN_REASON_LABELS[record.reasonCategory] ?? record.reasonCategory,
      safeText(record.reason),
      safeText(record.requestedByName ?? record.requestedBy),
      dateValue(record.requestedAt),
      RETURN_STATUS_LABELS[record.status] ?? record.status,
      dateValue(record.decidedAt),
      safeText(record.decisionNote),
      safeText(record.items.map((item) => `${item.label}×${item.quantity}`).join("；")),
      yuan(record.requestedRefundFen),
      record.status === "completed" ? yuan(record.refundFen) : null,
      dateValue(record.completedAt),
      fttrHandling,
    ]);
  }
  finishDataRows(returnSheet);

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
};

export const createOrderExportService = (options: OrderExportServiceOptions) => {
  const now = options.now ?? (() => new Date());
  return {
    async exportOrders(
      actor: AuthenticatedUser,
      filters: OrderListFilters,
    ): Promise<OrderExportResult> {
      if (actor.role !== "admin" && actor.role !== "hr" && actor.role !== "finance") {
        throw new OrderServiceError("只有管理员、人力资源或财务可以导出订单", 403);
      }
      const first = await options.orderService.listOrders(actor, {
        ...filters,
        cursor: undefined,
        page: 1,
        limit: PAGE_SIZE,
        deletedOnly: false,
      });
      if (first.total > EXPORT_LIMIT) {
        throw new OrderServiceError(`当前筛选结果超过${EXPORT_LIMIT}笔，请缩小日期或其他筛选范围后再导出`, 400);
      }
      const orders: ExportOrder[] = [...first.items];
      const pages = Math.ceil(first.total / PAGE_SIZE);
      for (let page = 2; page <= pages; page += 1) {
        const result = await options.orderService.listOrders(actor, {
          ...filters,
          cursor: undefined,
          page,
          limit: PAGE_SIZE,
          deletedOnly: false,
        });
        orders.push(...result.items);
      }
      const uniqueOrders = [...new Map(orders.map((order) => [order.id, order])).values()];
      const returns = await options.returnRepository.listRequestsForOrderIds(
        scopeForUser(actor),
        uniqueOrders.map((order) => order.id),
      );
      const exportedAt = now();
      return {
        buffer: await buildOrderExportWorkbook(uniqueOrders, returns, actor, filters, exportedAt),
        filename: `订单对账明细_${shanghaiFileStamp(exportedAt)}.xlsx`,
        orderCount: uniqueOrders.length,
      };
    },
  };
};

export type OrderExportService = ReturnType<typeof createOrderExportService>;
