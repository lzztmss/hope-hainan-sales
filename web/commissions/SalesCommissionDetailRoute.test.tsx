import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, AuthenticatedUser, MyCommissionDashboardResponse } from "../api/client";
import { SalesCommissionDetailRoute } from "./SalesCommissionDetailRoute";

afterEach(cleanup);

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

describe("销售提成详情筛选", () => {
  it("选择销售员后保留筛选值，并在查询时传给接口", async () => {
    const client = {
      listOrderFilterOptions: vi.fn().mockResolvedValue({
        stores: [{ id: "10000000-0000-4000-8000-000000000001", label: "海口验收营业厅" }],
        sellers: [{
          id: "20000000-0000-4000-8000-000000000001",
          label: "验收营业员（SALE）",
          storeId: "10000000-0000-4000-8000-000000000001",
        }],
      }),
      getCommissionDashboard: vi.fn().mockResolvedValue(emptyDashboard),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = {
      id: "admin",
      displayName: "验收管理员",
      role: "admin",
      storeId: null,
      mustChangePassword: false,
    };

    render(<SalesCommissionDetailRoute actor={actor} client={client} />);

    await screen.findByRole("option", { name: "验收营业员（SALE）" });
    const salesperson = screen.getByLabelText("销售员");
    fireEvent.change(salesperson, { target: { value: "20000000-0000-4000-8000-000000000001" } });
    expect(salesperson).toHaveValue("20000000-0000-4000-8000-000000000001");

    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() => expect(client.getCommissionDashboard).toHaveBeenLastCalledWith(expect.objectContaining({
      beneficiaryId: "20000000-0000-4000-8000-000000000001",
      page: 1,
      limit: 20,
    })));
  });
});
