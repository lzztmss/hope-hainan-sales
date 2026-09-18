import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ApiClient } from "../api/client";
import { SubscriptionPlansPage } from "./SubscriptionPlansPage";

const client = (): ApiClient => ({
  listSubscriptionPlans: vi.fn().mockResolvedValue([]),
} as unknown as ApiClient);

describe("月付套餐编辑表单", () => {
  it("连续输入套餐字段时不会因 React 事件失效而崩溃", async () => {
    const user = userEvent.setup();
    render(<SubscriptionPlansPage client={client()} />);

    await screen.findByText("尚未配置月付套餐。");
    await user.type(screen.getByLabelText("套餐编码"), "plan_a");
    await user.type(screen.getByLabelText("套餐名称"), "套餐 A");
    await user.type(screen.getByLabelText("月费（元）"), "99");
    await user.type(screen.getByLabelText("套餐说明"), "包含手表和床垫");
    await user.clear(screen.getByLabelText("AI 健康智能手表"));
    await user.type(screen.getByLabelText("AI 健康智能手表"), "1");
    await user.type(screen.getByLabelText("修改原因"), "新增套餐");

    expect(screen.getByLabelText("套餐编码")).toHaveValue("PLAN_A");
    expect(screen.getByLabelText("套餐名称")).toHaveValue("套餐 A");
    expect(screen.getByLabelText("月费（元）")).toHaveValue(99);
    expect(screen.getByLabelText("AI 健康智能手表")).toHaveValue(1);
    expect(screen.getByRole("heading", { name: "新增套餐" })).toBeInTheDocument();
  });
});
