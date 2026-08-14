import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QuoteWorkflowPage,
  type QuoteWorkflowClient,
} from "./QuoteWorkflowPage";

const client: QuoteWorkflowClient = {
  confirmQuote: vi.fn(),
  createOrderFromQuote: vi.fn(),
  recordQuotePrint: vi.fn(),
  updateQuote: vi.fn(),
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <QuoteWorkflowPage client={client} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("新建报价套餐说明与场景切换", () => {
  it("三个套餐卡片提供包含设备提示", () => {
    renderPage();

    const standardBundle = screen.getByRole("article", {
      name: "标准居家养老套装",
    });
    expect(
      within(standardBundle).getByRole("button", {
        name: "查看标准居家养老套装包含的设备",
      }),
    ).toBeInTheDocument();
    expect(within(standardBundle).getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "迷你网关 × 1 个",
    );
    expect(within(standardBundle).getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "人体传感器 × 3 个",
    );

    expect(
      within(screen.getByRole("article", { name: "心连心·一键守护" })).getByRole(
        "tooltip", { hidden: true },
      ),
    ).toHaveTextContent("壁挂报警按钮 × 1 个");
    expect(
      within(screen.getByRole("article", { name: "心连心·居家双护" })).getByRole(
        "tooltip", { hidden: true },
      ),
    ).toHaveTextContent("人体传感器 × 1 个");
  });

  it("显式选择自选产品时清空，手动改数量时保留当前配置", async () => {
    const user = userEvent.setup();
    renderPage();
    const custom = screen.getByRole("radio", { name: "自选产品" });
    const oneKey = screen.getByLabelText("心连心·一键守护数量");

    expect(screen.getByLabelText("AI 健康智能手表数量")).toHaveValue(0);
    await user.click(screen.getByRole("radio", { name: "一键守护" }));
    expect(oneKey).toHaveValue(1);

    await user.clear(oneKey);
    await user.type(oneKey, "2");
    expect(custom).toBeChecked();
    expect(oneKey).toHaveValue(2);

    await user.click(custom);
    expect(oneKey).toHaveValue(0);
    expect(screen.getByText("已切换为自选产品并清空原商品数量。")).toBeInTheDocument();
  });
});
