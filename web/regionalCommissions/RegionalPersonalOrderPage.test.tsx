import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../api/client";
import { RegionalPersonalOrderPage } from "./RegionalPersonalOrderPage";

describe("个人渠道订单录入", () => {
  it("提交订单并清空订单字段", async () => {
    const createRegionalPersonalOrder = vi.fn().mockResolvedValue({ id: "order-1" });
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([
        { id: "regional-1", displayName: "海口大区经理", workNo: "R001", active: true },
      ]),
      createRegionalPersonalOrder,
    } as unknown as ApiClient;

    render(<MemoryRouter><RegionalPersonalOrderPage client={client} /></MemoryRouter>);

    fireEvent.change(await screen.findByRole("combobox", { name: "大区经理 *" }), { target: { value: "regional-1" } });
    fireEvent.change(screen.getByLabelText("订单号 *"), { target: { value: "PO-202609-001" } });
    fireEvent.change(screen.getByLabelText("个人渠道 *"), { target: { value: "政企客户转介" } });
    fireEvent.change(screen.getByLabelText("业务日期 *"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("签收日期 *"), { target: { value: "2026-09-03" } });
    fireEvent.change(screen.getByLabelText("凭据编号 *"), { target: { value: "EV-001" } });
    fireEvent.click(screen.getByRole("button", { name: "保存订单" }));

    await waitFor(() => expect(createRegionalPersonalOrder).toHaveBeenCalledWith({
      managerId: "regional-1",
      orderNo: "PO-202609-001",
      channel: "政企客户转介",
      orderCount: 1,
      businessDate: "2026-09-01",
      signedOn: "2026-09-03",
      evidenceNo: "EV-001",
      lines: [{ sku: "GATEWAY", label: "FTTR 网关", quantity: 1 }],
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("个人渠道订单已保存");
    expect(screen.getByLabelText("订单号 *")).toHaveValue("");
  });
});
