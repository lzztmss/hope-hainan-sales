import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient, AuthenticatedUser, RegionalCommissionSummary } from "../api/client";
import { RegionalCommissionPage } from "./RegionalCommissionPage";

const summary: RegionalCommissionSummary = {
  managerId: "regional",
  month: "2026-09",
  templateVersionId: "template",
  planId: null,
  orderCount: 0,
  managedOrderCount: 0,
  personalOrderCount: 0,
  completionFen: 0,
  tieredOrderFen: 0,
  milestoneFen: 0,
  topUpFen: 0,
  revenueAccelerationFen: 0,
  personalProductFen: 0,
  cooperationFen: 0,
  directReturnFen: 0,
  totalFen: 0,
  periods: [],
  receipt: null,
  cooperation: [],
};

describe("HR 设置大区经理目标计划", () => {
  it("选择今天时保持页面可用并更新日期", async () => {
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValue(summary),
      listRegionalStatements: vi.fn().mockResolvedValue([]),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    await screen.findByRole("option", { name: "大区经理（REGIONAL）" });
    fireEvent.change(screen.getByRole("combobox", { name: "大区经理" }), { target: { value: "regional" } });
    const input = await screen.findByLabelText("计划开始日期");
    await waitFor(() => expect(input).toHaveValue("2026-01-15"));
    fireEvent.change(input, { target: { value: "2026-09-03" } });
    expect(input).toHaveValue("2026-09-03");
    expect(screen.getByRole("button", { name: "保存目标计划" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "回款核验" }));
    expect(screen.getByRole("heading", { name: "不含税净回款" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存目标计划" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "目标计划" }));
    expect(screen.getByLabelText("计划开始日期")).toHaveValue("2026-09-03");
  });
});
