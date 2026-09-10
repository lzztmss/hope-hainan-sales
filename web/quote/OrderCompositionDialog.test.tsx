import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { calculateQuote } from "../../shared/pricing/quoteEngine";
import { OrderCompositionDialog } from "./OrderCompositionDialog";

describe("生成订单前销售构成确认", () => {
  it("区分套餐和独立单品并二次确认", () => {
    const calculation = calculateQuote({
      mode: "contract_36",
      fttrPlan: 159,
      selection: { homeDual: 1, mattress: 1 },
    });
    const onConfirm = vi.fn();

    render(
      <OrderCompositionDialog
        busy={false}
        lines={calculation.chargeLines}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("心连心·居家双护 × 1 套")).toBeInTheDocument();
    expect(screen.getByText("睡眠监测床垫 × 1 张")).toBeInTheDocument();
    expect(screen.getByText("套餐")).toBeInTheDocument();
    expect(screen.getByText("独立单品")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并生成订单" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /线上订单/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认并生成订单" }));
    expect(onConfirm).toHaveBeenCalledWith("online");
  });
});
