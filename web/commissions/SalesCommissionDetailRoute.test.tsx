import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, AuthenticatedUser } from "../api/client";
import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { SalesCommissionDetailRoute } from "./SalesCommissionDetailRoute";

const dashboard = {
  periodLabel: "2026年9月",
  summary: {
    estimatedFen: 0,
    accruedNetFen: 0,
    pendingSettlementFen: 0,
    pendingPaymentFen: 0,
    pendingDeductionFen: 0,
    paidThisMonthFen: 0,
    paidLifetimeFen: 0,
    reversedLifetimeFen: 0,
    netLifetimeFen: 0,
  },
  orders: [],
  unconfiguredOrders: 0,
  total: 0,
  page: 1,
  pageSize: 20,
};

const client = {
  listOrderFilterOptions: vi.fn(async () => ({
    stores: [{ id: "store-1", label: "公司总部" }],
    sellers: [{ id: "seller-1", label: "张三（HN001）", storeId: "store-1" }],
  })),
  getCommissionDashboard: vi.fn(async () => dashboard),
} as unknown as ApiClient;

const actor = {
  id: "admin-1",
  displayName: "系统管理员",
  role: "admin",
  storeId: "store-1",
} as unknown as AuthenticatedUser;

const sellerSelect = (): HTMLSelectElement => {
  const form = document.querySelector(".sales-commission-filters");
  if (!form) throw new Error("未找到筛选表单");
  const selects = form.querySelectorAll("select");
  const select = selects[1];
  if (!select) throw new Error("未找到销售员下拉");
  return select as HTMLSelectElement;
};

afterEach(cleanup);

describe("销售提成详情筛选切换", () => {
  it("切换销售员不会让页面崩溃", async () => {
    render(
      <AppErrorBoundary>
        <SalesCommissionDetailRoute actor={actor} client={client} />
      </AppErrorBoundary>,
    );

    await waitFor(() => expect(sellerSelect().options.length).toBeGreaterThan(1));

    fireEvent.change(sellerSelect(), { target: { value: "seller-1" } });

    await waitFor(() => expect(sellerSelect().value).toBe("seller-1"));
    await screen.findByText("销售提成明细");
    expect(screen.queryByText("当前页面暂时无法使用")).toBeNull();
  });

  it("切换营业厅（并联动清空销售员）不会让页面崩溃", async () => {
    render(
      <AppErrorBoundary>
        <SalesCommissionDetailRoute actor={actor} client={client} />
      </AppErrorBoundary>,
    );

    await waitFor(() => expect(sellerSelect().options.length).toBeGreaterThan(1));
    fireEvent.change(sellerSelect(), { target: { value: "seller-1" } });
    await waitFor(() => expect(sellerSelect().value).toBe("seller-1"));

    const form = document.querySelector(".sales-commission-filters");
    const storeSelect = form?.querySelectorAll("select")[0] as HTMLSelectElement;
    fireEvent.change(storeSelect, { target: { value: "store-1" } });

    await waitFor(() => expect(storeSelect.value).toBe("store-1"));
    expect(sellerSelect().value).toBe("");
    await screen.findByText("销售提成明细");
    expect(screen.queryByText("当前页面暂时无法使用")).toBeNull();
  });
});
