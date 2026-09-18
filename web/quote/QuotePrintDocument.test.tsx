import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { calculateQuote } from "../../shared/pricing/quoteEngine";
import { QuotePrintDocument } from "./QuotePrintDocument";

describe("统一报价单", () => {
  it("同时展示客户、金额、计价商品和最终设备", () => {
    const calculation = calculateQuote({
      mode: "contract_36",
      subscriptionPlanId: "plan-a",
      selection: {},
    }, undefined, {
      id: "plan-a", code: "A", name: "月付套餐A", description: null,
      monthlyFen: 15_900, contractMonths: 36, active: true, version: 1,
      items: [{ sku: "GATEWAY", quantity: 1 }, { sku: "MOTION", quantity: 1 }],
    });

    render(
      <QuotePrintDocument
        calculation={calculation}
        confirmedAt="2026-08-13T08:00:00.000Z"
        customerName="报价客户"
        elderCount={1}
        phoneMasked="138****8000"
        quoteNo="XLX-PRINT-001"
        roomType="one_bedroom"
        version={1}
      />,
    );

    expect(screen.getByText("XLX-PRINT-001")).toBeInTheDocument();
    expect(screen.getByText("报价客户")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "计价商品" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最终实际设备" })).toBeInTheDocument();
    expect(screen.getAllByText(/月付套餐A/).length).toBeGreaterThan(0);
  });
});
