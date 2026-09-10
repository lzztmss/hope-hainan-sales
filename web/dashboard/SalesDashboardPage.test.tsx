import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SalesOrderTrendResponse, SalesReportResponse } from "../../shared/reports/types";
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
    fttrMonthlyFen: 10000,
    heartMonthlyFen: 8000,
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

const trend = (days: ReadonlyArray<[string, number]>): SalesOrderTrendResponse => ({
  generatedAt: "2026-09-04T08:00:00.000Z",
  period: { from: "2026-08-29", to: "2026-09-04", timeZone: "Asia/Shanghai" },
  scope: { kind: "seller", label: "本人" },
  days: days.map(([date, signedOrderCount]) => ({ date, signedOrderCount })),
  total: days.reduce((sum, [, count]) => sum + count, 0),
});

const viewer = (role: AuthenticatedUser["role"]): AuthenticatedUser => ({
  id: role === "sales" ? "sales-1" : `${role}-1`,
  displayName: role === "sales" ? "测试销售" : "测试用户",
  role,
  storeId: role === "sales" ? "store-1" : null,
  storeName: role === "sales" ? "国贸营业厅" : null,
  mustChangePassword: false,
});

const client = (overrides: Record<string, unknown> = {}) => ({
  listQuotes: vi.fn().mockResolvedValue({ items: [quote], total: 1, page: 1, pageSize: 8 }),
  listOrders: vi.fn().mockResolvedValue({ items: [order], total: 1, page: 1, pageSize: 12, nextCursor: null }),
  listOrderFilterOptions: vi.fn().mockResolvedValue({
    stores: [{ id: "store-1", label: "国贸营业厅" }],
    sellers: [{ id: "sales-1", label: "测试销售", storeId: "store-1" }],
  }),
  getSalesOrderTrend: vi.fn().mockResolvedValue(trend([])),
  ...overrides,
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
    expect(screen.getByText("统计周期 09-01 ~ 09-04")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Q20260904001")).toBeInTheDocument());
    expect(screen.getByText(/等待确认签收/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /新建客户报价/ })[0]).toHaveAttribute("href", "/quotes/new");
  });

  it("待办只显示当前账号可操作的订单，成交趋势按签收时间统计", async () => {
    const signedOrder = {
      ...order,
      id: "order-signed",
      orderNo: "O20260904002",
      status: "signed",
      updatedAt: "2026-08-20T02:00:00.000Z",
      signedAt: "2026-09-04T02:00:00.000Z",
    } as OrderDto;
    const activatedOrder = {
      ...order,
      id: "order-activated",
      orderNo: "O20260904001",
      status: "activated",
      signedAt: null,
    } as OrderDto;
    const listOrders = vi.fn().mockResolvedValue({
      items: [signedOrder, activatedOrder],
      total: 2,
      page: 1,
      pageSize: 12,
      nextCursor: null,
    });

    render(
      <MemoryRouter>
        <SalesDashboardPage
          client={client({
            listOrders,
            getSalesOrderTrend: vi.fn().mockResolvedValue(trend([["2026-09-04", 1]])),
          })}
          initialReport={report}
          viewer={viewer("sales")}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTitle(/09\/04：1 笔已签收/)).toBeInTheDocument());
    expect(screen.getByText(/等待确认签收/)).toBeInTheDocument();
    expect(screen.queryByText(/等待财务对账/)).toBeNull();
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
