import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REGIONAL_COMMISSION_RULES,
  type RegionalCommissionRules,
} from "../../shared/regionalCommission/types";
import type { ApiClient, RegionalTemplateDto } from "../api/client";
import { RegionalTemplateEditor } from "./RegionalTemplateEditor";

afterEach(cleanup);

const cloneRules = (): RegionalCommissionRules => ({
  targetCycle: {
    startsOn: DEFAULT_REGIONAL_COMMISSION_RULES.targetCycle.startsOn,
    planType: DEFAULT_REGIONAL_COMMISSION_RULES.targetCycle.planType,
    periodTargets: [...DEFAULT_REGIONAL_COMMISSION_RULES.targetCycle.periodTargets],
  },
  completionRewards: DEFAULT_REGIONAL_COMMISSION_RULES.completionRewards.map((item) => ({ ...item })),
  orderTiers: DEFAULT_REGIONAL_COMMISSION_RULES.orderTiers.map((item) => ({ ...item })),
  milestones: DEFAULT_REGIONAL_COMMISSION_RULES.milestones.map((item) => ({ ...item })),
  topUp: { ...DEFAULT_REGIONAL_COMMISSION_RULES.topUp },
  revenueAcceleration: { ...DEFAULT_REGIONAL_COMMISSION_RULES.revenueAcceleration },
  cooperationStages: DEFAULT_REGIONAL_COMMISSION_RULES.cooperationStages.map((item) => ({ ...item })),
  productCommissionFen: { ...DEFAULT_REGIONAL_COMMISSION_RULES.productCommissionFen },
});

const template = (
  status: RegionalTemplateDto["status"],
): RegionalTemplateDto => ({
  id: `template-${status}`,
  name: "海南大区经理默认提成",
  templateCode: "REGIONAL_DEFAULT",
  versionNo: 1,
  status,
  effectiveFrom: "2026-01-15",
  effectiveTo: null,
  rulesSnapshot: cloneRules(),
  changeReason: "测试规则",
});

const clientFor = (current: RegionalTemplateDto) => ({
  listRegionalTemplates: vi.fn().mockResolvedValue([current]),
  createRegionalTemplate: vi.fn(),
  updateRegionalTemplate: vi.fn().mockImplementation(
    async (_id: string, input: { rules: RegionalCommissionRules }) => ({
      ...current,
      rulesSnapshot: input.rules,
    }),
  ),
  copyRegionalTemplate: vi.fn().mockResolvedValue({
    ...current,
    id: "template-copy",
    versionNo: 2,
    status: "draft",
  }),
  publishRegionalTemplate: vi.fn().mockResolvedValue({ ...current, status: "published" }),
  stopRegionalTemplate: vi.fn().mockResolvedValue({ ...current, status: "stopped" }),
  assignRegionalTemplate: vi.fn().mockResolvedValue(undefined),
}) as unknown as ApiClient;

describe("大区经理提成模板规则编辑器", () => {
  it("连续填写新模板信息时不会触发页面崩溃", async () => {
    const user = userEvent.setup();
    const client = clientFor(template("published"));
    render(<RegionalTemplateEditor client={client} managerId="regional" />);

    const name = await screen.findByLabelText("新模板名称");
    await user.clear(name);
    await user.type(name, "海南九月提成模板");
    await user.type(screen.getByLabelText("新模板创建原因"), "九月规则调整");

    expect(name).toHaveValue("海南九月提成模板");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("展示完整默认规则，并将已发布版本设为只读", async () => {
    const client = clientFor(template("published"));
    render(<RegionalTemplateEditor client={client} managerId="regional" />);

    expect(await screen.findByRole("heading", { name: "海南大区经理默认提成 · 第 1 版" })).toBeVisible();
    expect(screen.queryByText(/REGIONAL_DEFAULT/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("完成率奖励1金额")).toHaveValue(2000);
    expect(screen.getByLabelText("迷你网关个人提成")).toHaveValue(6);
    expect(screen.getByLabelText("目标周期类型")).toHaveValue("half_year");
    expect(screen.getByLabelText("M1订单目标")).toHaveValue(1000);
    expect(screen.getByLabelText("完成率奖励1金额")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存规则" })).not.toBeInTheDocument();
  });

  it("编辑草稿金额时按元展示、按分提交", async () => {
    const current = template("draft");
    const client = clientFor(current);
    render(<RegionalTemplateEditor client={client} managerId="regional" />);

    const amount = await screen.findByLabelText("完成率奖励1金额");
    fireEvent.change(amount, { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText("M1开始日期"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("修改或版本操作原因"), {
      target: { value: "调整百分百达成奖励" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存规则" }));

    await waitFor(() =>
      expect(client.updateRegionalTemplate).toHaveBeenCalledWith(
        current.id,
        expect.objectContaining({
          reason: "调整百分百达成奖励",
          rules: expect.objectContaining({
            targetCycle: expect.objectContaining({ startsOn: "2026-02-01" }),
            completionRewards: expect.arrayContaining([
              expect.objectContaining({ amountFen: 250_000 }),
            ]),
          }),
        }),
      ),
    );
  });

  it("没有填写原因时阻止保存", async () => {
    const client = clientFor(template("draft"));
    render(<RegionalTemplateEditor client={client} managerId="regional" />);

    await screen.findByRole("heading", { name: "海南大区经理默认提成 · 第 1 版" });
    fireEvent.click(screen.getByRole("button", { name: "保存规则" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请先填写修改或版本操作原因");
    expect(screen.getByLabelText("修改或版本操作原因")).toHaveFocus();
    expect(client.updateRegionalTemplate).not.toHaveBeenCalled();
  });

  it("有未保存修改时点击其他版本会给出明确选择", async () => {
    const draft = { ...template("draft"), id: "draft", name: "九月草稿" };
    const published = { ...template("published"), id: "published", name: "当前已发布规则" };
    const client = {
      ...clientFor(draft),
      listRegionalTemplates: vi.fn().mockResolvedValue([draft, published]),
    } as unknown as ApiClient;
    render(<RegionalTemplateEditor client={client} managerId="regional" />);

    const amount = await screen.findByLabelText("完成率奖励1金额");
    fireEvent.change(amount, { target: { value: "2600" } });
    fireEvent.click(screen.getByRole("button", { name: /当前已发布规则.*已发布/ }));

    expect(screen.getByRole("dialog", { name: "当前修改还没有保存" })).toBeVisible();
    expect(screen.getByText(/保存没有成功执行/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并切换" }));

    expect(await screen.findByRole("heading", { name: "当前已发布规则 · 第 1 版" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存规则" })).not.toBeInTheDocument();
  });

  it("草稿直接编辑，不再提供重复复制入口", async () => {
    const client = clientFor(template("draft"));
    render(<RegionalTemplateEditor client={client} managerId="regional" />);

    await screen.findByLabelText("完成率奖励1金额");
    expect(screen.queryByRole("button", { name: "创建新版本" })).not.toBeInTheDocument();
    expect(client.copyRegionalTemplate).not.toHaveBeenCalled();
  });

  it("创建新版本时先确认可自定义名称、日期和原因", async () => {
    const current = template("published");
    const client = clientFor(current);
    render(<RegionalTemplateEditor client={client} managerId="regional" />);

    await screen.findByRole("heading", { name: "海南大区经理默认提成 · 第 1 版" });
    fireEvent.click(screen.getByRole("button", { name: "创建新版本" }));
    expect(screen.getByRole("dialog", { name: "基于第 1 版创建新版本" })).toBeVisible();
    expect(client.copyRegionalTemplate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("新版本名称"), {
      target: { value: "海南十月提成" },
    });
    fireEvent.change(screen.getByLabelText("新版本生效日期"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("新版本创建原因"), {
      target: { value: "准备十月新规则" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认创建草稿" }));

    await waitFor(() =>
      expect(client.copyRegionalTemplate).toHaveBeenCalledWith(current.id, {
        name: "海南十月提成",
        effectiveFrom: "2026-10-01",
        reason: "准备十月新规则",
      }),
    );
  });

  it("明确标记当前统计月份实际使用的模板", async () => {
    const current = template("published");
    const client = clientFor(current);
    render(<RegionalTemplateEditor assignedTemplateVersionId={current.id} client={client} managerId="regional" />);

    expect(await screen.findByText("本月使用")).toBeVisible();
    expect(await screen.findByText(/当前统计月份使用中/)).toBeVisible();
    expect(await screen.findByRole("button", { name: "当前月份已在使用" })).toBeDisabled();
  });
});
