import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, AuthenticatedUser, MyCommissionDashboardResponse } from "../api/client";
import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { SalesCommissionDetailRoute } from "./SalesCommissionDetailRoute";

afterEach(cleanup);

const CONFIG_STORE_ID = "10000000-0000-4000-8000-000000000001";
const CONFIG_SELLER_ID = "20000000-0000-4000-8000-000000000001";

const emptyDashboard: MyCommissionDashboardResponse = {
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
  unconfiguredOrders: 0,
  orders: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

const actor: AuthenticatedUser = {
  id: "admin",
  displayName: "验收管理员",
  role: "admin",
  storeId: null,
  mustChangePassword: false,
};

const makeClient = () =>
  ({
    listOrderFilterOptions: vi.fn().mockResolvedValue({
      stores: [{ id: CONFIG_STORE_ID, label: "海口验收营业厅" }],
      sellers: [
        {
          id: CONFIG_SELLER_ID,
          label: "验收营业员（SALE）",
          storeId: CONFIG_STORE_ID,
        },
      ],
    }),
    getCommissionDashboard: vi.fn().mockResolvedValue(emptyDashboard),
  }) as unknown as ApiClient;

const filterSelect = (index: number): HTMLSelectElement => {
  const form = document.querySelector(".sales-commission-filters");
  if (!form) throw new Error("未找到筛选表单");
  const select = form.querySelectorAll("select")[index];
  if (!select) throw new Error(`未找到第 ${index + 1} 个筛选下拉框`);
  return select;
};

describe("销售提成详情筛选", () => {
  it("选择销售员后保留筛选值，并在查询时传给接口", async () => {
    const client = makeClient();

    render(<SalesCommissionDetailRoute actor={actor} client={client} />);

    await screen.findByRole("option", { name: "验收营业员（SALE）" });
    const salesperson = screen.getByLabelText("销售员");
    fireEvent.change(salesperson, { target: { value: CONFIG_SELLER_ID } });
    expect(salesperson).toHaveValue(CONFIG_SELLER_ID);

    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(client.getCommissionDashboard).toHaveBeenLastCalledWith(
        expect.objectContaining({
          beneficiaryId: CONFIG_SELLER_ID,
          page: 1,
          limit: 20,
        }),
      ),
    );
  });

  it("切换销售员不会触发页面崩溃", async () => {
    const client = makeClient();

    render(
      <AppErrorBoundary>
        <SalesCommissionDetailRoute actor={actor} client={client} />
      </AppErrorBoundary>,
    );

    await screen.findByRole("option", { name: "验收营业员（SALE）" });
    fireEvent.change(filterSelect(1), { target: { value: CONFIG_SELLER_ID } });

    await waitFor(() => expect(filterSelect(1).value).toBe(CONFIG_SELLER_ID));
    await screen.findByText("销售提成明细");
    expect(screen.queryByText("当前页面暂时无法使用")).toBeNull();
  });

  it("切换营业厅并联动清空销售员不会触发页面崩溃", async () => {
    const client = makeClient();

    render(
      <AppErrorBoundary>
        <SalesCommissionDetailRoute actor={actor} client={client} />
      </AppErrorBoundary>,
    );

    await screen.findByRole("option", { name: "验收营业员（SALE）" });
    fireEvent.change(filterSelect(1), { target: { value: CONFIG_SELLER_ID } });
    await waitFor(() => expect(filterSelect(1).value).toBe(CONFIG_SELLER_ID));

    fireEvent.change(filterSelect(0), { target: { value: CONFIG_STORE_ID } });
    await waitFor(() => expect(filterSelect(0).value).toBe(CONFIG_STORE_ID));
    expect(filterSelect(1).value).toBe("");

    await screen.findByText("销售提成明细");
    expect(screen.queryByText("当前页面暂时无法使用")).toBeNull();
  });
});
