import ExcelJS from "@excel.js/exceljs";
import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import type { ReturnRequestRecord } from "../returns/returnService.js";
import { buildOrderExportWorkbook, createOrderExportService } from "./orderExportService.js";
import type { OrderService } from "./orderService.js";

const admin: AuthenticatedUser = {
  id: "admin-1",
  displayName: "测试管理员",
  role: "admin",
  storeId: null,
  mustChangePassword: false,
};

const order = {
  id: "order-1",
  orderNo: "XLXDD-20260828-TEST01",
  quoteId: "quote-1",
  sellerId: "seller-1",
  storeId: "store-1",
  status: "paid" as const,
  salesChannel: "online" as const,
  paymentMode: "contract_36" as const,
  fttrKind: "standard" as const,
  fttrPlan: 159,
  customFttrNote: null,
  fttrMonthlyFen: 15_900,
  heartMonthlyFen: 3_000,
  oneTimeFen: 29_900,
  monthlyTotalFen: 18_900,
  contract36Fen: 680_400,
  refundedFen: 5_000,
  commissionPayoutStatus: "pending" as const,
  commissionNetFen: 4_000,
  commissionPaidFen: 0,
  commissionReversedFen: 1_000,
  customer: { name: "张三", phoneMasked: "138****8000", address: null, roomType: "one_bedroom", elderCount: 1 },
  storeSnapshot: { name: "海口营业厅" },
  sellerSnapshot: { displayName: "销售甲" },
  lines: [
    {
      id: "line-1",
      quoteLineId: "quote-line-1",
      lineType: "charge" as const,
      sku: "SENSOR",
      label: "人体传感器",
      unit: "个",
      quantity: 2,
      oneTimeUnitFen: 29_900,
      monthlyUnitFen: 1_000,
      oneTimeSubtotalFen: 59_800,
      monthlySubtotalFen: 2_000,
      locations: ["卧室"],
      reason: null,
      lineSnapshot: {},
    },
  ],
  attributions: [],
  acceptedAt: new Date("2026-08-20T02:00:00.000Z"),
  activatedAt: new Date("2026-08-20T03:00:00.000Z"),
  signedAt: new Date("2026-08-20T04:00:00.000Z"),
  signedBy: "seller-1",
  reconciledAt: new Date("2026-08-21T02:00:00.000Z"),
  reconciledBy: "admin-1",
  paidAt: new Date("2026-08-22T02:00:00.000Z"),
  paidBy: "admin-1",
  completedAt: null,
  cancelledAt: null,
  deletedAt: null,
  version: 6,
  createdAt: new Date("2026-08-20T01:00:00.000Z"),
  updatedAt: new Date("2026-08-22T02:00:00.000Z"),
};

const completedReturn: ReturnRequestRecord = {
  id: "return-1",
  returnNo: "XLX-RT-20260823-TEST01",
  idempotencyKey: "return-test-key-0001",
  completionIdempotencyKey: "return-complete-key-0001",
  orderId: order.id,
  orderNo: order.orderNo,
  serviceType: "refund",
  returnType: "partial",
  returnKind: "special",
  reasonCategory: "quality",
  orderStatusBefore: "paid",
  status: "completed",
  reason: "设备质量问题",
  requestedBy: "seller-1",
  requestedByName: "销售甲",
  requestedAt: new Date("2026-08-23T01:00:00.000Z"),
  decidedBy: "admin-1",
  decidedAt: new Date("2026-08-23T02:00:00.000Z"),
  decisionNote: "同意退款",
  completedBy: "admin-1",
  completedAt: new Date("2026-08-23T03:00:00.000Z"),
  requestedRefundFen: 5_000,
  refundFen: 5_000,
  maxRefundFen: 1_000,
  items: [{
    orderLineId: "line-1",
    orderLineQuantity: 2,
    sku: "SENSOR",
    label: "人体传感器",
    quantity: 1,
    maxRefundFen: 1_000,
    refundFen: 5_000,
  }],
};

describe("订单Excel导出", () => {
  it("生成三个可筛选工作表并保留数值、日期和退货后的月费口径", async () => {
    const buffer = await buildOrderExportWorkbook(
      [order] as never,
      [completedReturn],
      admin,
      { limit: 100, paymentMode: "contract_36" },
      new Date("2026-08-28T04:00:00.000Z"),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "订单对账明细",
      "商品明细",
      "售后退款明细",
    ]);
    const orderSheet = workbook.getWorksheet("订单对账明细")!;
    expect(orderSheet.getCell("A6").value).toBe(order.orderNo);
    expect(orderSheet.getCell("J6").value).toBe(159);
    expect(orderSheet.getCell("L6").value).toBe(20);
    expect(orderSheet.getCell("M6").value).toBe(179);
    expect(orderSheet.getCell("N5").value).toBe("36个月合约月费合计");
    expect(orderSheet.getCell("Q6").value).toBeInstanceOf(Date);
    expect(orderSheet.autoFilter).toBeTruthy();

    const itemSheet = workbook.getWorksheet("商品明细")!;
    expect(itemSheet.getCell("H6").value).toBe(1);
    expect(itemSheet.getCell("I6").value).toBe(1);

    const returnSheet = workbook.getWorksheet("售后退款明细")!;
    expect(returnSheet.getCell("C6").value).toBe("特殊处理");
    expect(returnSheet.getCell("N6").value).toBe(50);
    expect(returnSheet.getCell("P6").value).toBe("部分退货，不影响FTTR");
  });

  it("拒绝销售员导出", async () => {
    const service = createOrderExportService({
      orderService: {} as OrderService,
      returnRepository: { listRequestsForOrderIds: async () => [] },
    });
    await expect(service.exportOrders({ ...admin, role: "sales", storeId: "store-1" }, { limit: 100 }))
      .rejects.toThrow("只有管理员、人力资源或财务可以导出订单");
  });
});
