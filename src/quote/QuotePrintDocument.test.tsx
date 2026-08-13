import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { calculateQuote } from "../../shared/pricing/quoteEngine";
import { QuotePrintDocument } from "./QuotePrintDocument";

describe("统一报价单", () => {
  it("同时展示客户、金额、计价商品和最终设备", () => {
    const calculation = calculateQuote({
      mode: "contract_36",
      fttrPlan: 159,
      selection: { homeDual: 1 },
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
    expect(screen.getByText(/心连心·居家双护/)).toBeInTheDocument();
  });
});
