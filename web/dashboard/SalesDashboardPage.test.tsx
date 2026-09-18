import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SalesReportResponse } from "../../shared/reports/types";
import type { ApiClient, AuthenticatedUser, OrderDto, QuoteDetailDto } from "../api/client";
import { SalesDashboardPage } from "./SalesDashboardPage";

const report: SalesReportResponse = {
  generatedAt: "2026-09-04T08:00:00.000Z",
  period: { from: "2026-09-01", to: "2026-09-04", timeZone: "Asia/Shanghai" },
  scope: { kind: "seller", label: "测试销售" },
  totals: {
    quoteCount: 12,
    orderCount: 6,
    conversionRateBps: 5000,
    oneTimeOriginalFen: 300000,
    returnedFen: 20000,
    oneTimeNetFen: 280000,
    monthlyFen: 18000,
    contract36Fen: 648000,
    commissionEstimatedFen: 42000,
    commissionPendingSettlementFen: 18000,
    commissionPaidFen: 24000,
    commissionReversedFen: 1200,
    commissionNetFen: 40800,
  },
  rows: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

const quote = {
  id: "quote-1",
  quoteNo: "Q20260904001",
  status: "confirmed",
  sellerId: "sales-1",
  storeId: "store-1",
  updatedAt: "2026-09-04T08:00:00.000Z",
  customer: { name: "张女士", phoneMasked: "138****0000" },
  calculation: { oneTimeFen: 328000, monthlyTotalFen: 12900 },
} as QuoteDetailDto;

const order = {
  id: "order-1",
  orderNo: "O20260904001",
  status: "activated",
  sellerId: "sales-1",
  updatedAt: "2026-09-04T08:30:00.000Z",
  customer: { name: "张女士" },
} as OrderDto;

const viewer = (role: AuthenticatedUser["role"]): AuthenticatedUser => ({
  id: role === "sales" ? "sales-1" : `${role}-1`,
  displayName: role === "sales" ? "测试销售" : "测试用户",
  role,
  storeId: role === "sales" ? "store-1" : null,
  storeName: role === "sales" ? "国贸营业厅" : null,
  mustChangePassword: false,
});

const client = () => ({
  listQuotes: vi.fn().mockResolvedValue({ items: [quote], total: 1, page: 1, pageSize: 8 }),
  listOrders: vi.fn().mockResolvedValue({ items: [order], total: 1, page: 1, pageSize: 12, nextCursor: null }),
  listOrderFilterOptions: vi.fn().mockResolvedValue({
    stores: [{ id: "store-1", label: "国贸营业厅" }],
    sellers: [{ id: "sales-1", label: "测试销售", storeId: "store-1" }],
  }),
}) as unknown as ApiClient;

afterEach(cleanup);

describe("销售运营工作台", () => {
  it("展示真实报价、订单待办并保留完整经营数据", async () => {
    render(
      <MemoryRouter>
        <SalesDashboardPage client={client()} initialReport={report} viewer={viewer("sales")} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "您好，测试销售" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "完整经营数据" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "成交趋势" })).toBeInTheDocument();
    expect(screen.getByText("本期报价")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Q20260904001")).toBeInTheDocument());
    expect(screen.getByText(/等待确认签收/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /新建客户报价/ })[0]).toHaveAttribute("href", "/quotes/new");
  });

  it("按 HR 权限展示管理快捷入口", async () => {
    render(
      <MemoryRouter>
        <SalesDashboardPage client={client()} initialReport={report} viewer={viewer("hr")} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "您好，测试用户" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /管理大区经理提成/ })[0]).toHaveAttribute("href", "/commissions/regional");
    expect(screen.getByRole("link", { name: /录入个人渠道订单/ })).toHaveAttribute("href", "/commissions/regional/personal-orders");
    expect(screen.queryByRole("link", { name: /查看我的提成/ })).not.toBeInTheDocument();
  });
});
