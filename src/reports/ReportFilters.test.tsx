import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReportFilters } from "./ReportFilters";

describe("报表筛选", () => {
  it("选择营业厅后更新筛选值并联动销售员", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <ReportFilters
        allowTeamFilters
        initialValue={{ from: "2026-08-01", to: "2026-08-13", groupBy: "seller" }}
        onApply={onApply}
        onExport={vi.fn()}
        stores={[
          { id: "store-1", label: "海口营业厅" },
          { id: "store-2", label: "三亚营业厅" },
        ]}
        sellers={[
          { id: "seller-1", label: "海口销售员", storeId: "store-1" },
          { id: "seller-2", label: "三亚销售员", storeId: "store-2" },
        ]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("营业厅"), "store-1");
    expect(screen.getByRole("option", { name: "海口销售员" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "三亚销售员" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查询报表" }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ storeId: "store-1" }));
  });
});
