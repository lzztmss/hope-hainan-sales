import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedUser } from "../auth/authorization.js";
import {
  createSalesReportService,
  type SalesReportRepository,
} from "./salesReportService.js";

const admin: AuthenticatedUser = {
  id: "admin-1",
  displayName: "管理员",
  role: "admin",
  storeId: null,
  mustChangePassword: false,
};

const repository = (): SalesReportRepository => ({
  loadFacts: vi.fn().mockResolvedValue([
    {
      storeId: "store-1",
      storeName: "第一营业厅",
      sellerId: "seller-1",
      sellerName: "销售员一",
      quoteCount: 2,
      orderCount: 1,
      oneTimeOriginalFen: 10000,
      returnedFen: 0,
      fttrMonthlyFen: 0,
      heartMonthlyFen: 0,
      contract36Fen: 0,
      commissionEstimatedFen: 0,
      commissionPendingSettlementFen: 0,
      commissionPaidFen: 0,
      commissionReversedFen: 0,
      commissionNetFen: 0,
    },
  ]),
  listActiveStores: vi.fn().mockResolvedValue([
    { id: "store-1", name: "第一营业厅" },
    { id: "store-2", name: "第二营业厅" },
    { id: "store-3", name: "第三营业厅" },
  ]),
  recordExportAudit: vi.fn().mockResolvedValue(undefined),
});

describe("sales report store rows", () => {
  it("管理员按营业厅查看时补齐没有业务数据的启用营业厅", async () => {
    const source = repository();
    const service = createSalesReportService({
      repository: source,
      now: () => new Date("2026-08-25T00:00:00.000Z"),
    });

    const report = await service.getReport(admin, {
      from: "2026-08-01",
      to: "2026-08-31",
      groupBy: "store",
    });

    expect(report.rows.map((row) => row.label)).toEqual([
      "第一营业厅",
      "第二营业厅",
      "第三营业厅",
    ]);
    expect(report.rows[1]).toMatchObject({ quoteCount: 0, orderCount: 0, oneTimeNetFen: 0 });
    expect(report.total).toBe(3);
    expect(source.listActiveStores).toHaveBeenCalledWith(undefined);
  });

  it("按销售员分组时不生成空白销售员行", async () => {
    const source = repository();
    const service = createSalesReportService({ repository: source });

    const report = await service.getReport(admin, { groupBy: "seller" });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.label).toBe("销售员一");
    expect(source.listActiveStores).not.toHaveBeenCalled();
  });
});
