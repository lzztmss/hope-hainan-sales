import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, AuthenticatedUser, RegionalCommissionSummary } from "../api/client";
import { RegionalCommissionPage } from "./RegionalCommissionPage";

afterEach(cleanup);

const summary: RegionalCommissionSummary = {
  managerId: "regional",
  month: "2026-09",
  templateVersionId: "template",
  templateName: "海南大区经理默认提成",
  templateVersionNo: 1,
  templateEffectiveFrom: "2026-01-15",
  templateEffectiveTo: null,
  targetPlanId: "plan-1",
  targetPlanType: "half_year",
  targetPlanStartsOn: "2026-01-15",
  targetPlanEndsOn: "2026-07-14",
  targetPlanStatus: "active",
  statisticsStartsOn: "2026-01-15",
  statisticsEndsOn: "2026-09-30",
  employmentStartDate: "2026-01-15",
  employmentEndDate: null,
  orderCount: 0,
  managedOrderCount: 0,
  personalOrderCount: 0,
  returnedOrderCount: 0,
  completionFen: 0,
  tieredOrderFen: 0,
  milestoneFen: 0,
  topUpFen: 0,
  revenueAccelerationFen: 0,
  currentMonthRevenueAccelerationFen: 0,
  personalProductFen: 0,
  cooperationFen: 0,
  directReturnFen: 0,
  totalFen: 0,
  settlementPreviewFen: 0,
  deferredNegativeFen: 0,
  settlementEntries: [
    { category: "tiered_order", accruedFen: 0, previouslySettledFen: 0, payableFen: 0 },
    { category: "revenue_acceleration", accruedFen: 0, previouslySettledFen: 0, payableFen: 0 },
  ],
  periods: [
    {
      sequence: 1,
      startsOn: "2026-01-15",
      endsOn: "2026-02-14",
      targetOrderCount: 1_000,
      orderCount: 0,
      cumulativeOrderCount: 0,
      rewardFen: 0,
    },
  ],
  receipt: null,
  cooperation: [],
  revenueAcceleration: {
    unlockOrderCount: 50_000,
    currentOrderCount: 0,
    unlocked: false,
    ratePartsPerMillion: 500,
    monthlyCapFen: 3_000_000,
  },
};

const targetPlan = {
  id: "plan-1",
  regionalManagerId: "regional",
  planType: "half_year",
  periodCount: 6,
  startsOn: "2026-01-15",
  endsOn: "2026-07-14",
  isPreset: true,
  status: "active",
  replacedByPlanId: null,
  changeReason: "按入职日期生成建议草稿并启用",
  periods: [
    {
      id: "period-1",
      sequence: 1,
      startsOn: "2026-01-15",
      endsOn: "2026-02-14",
      targetOrderCount: 1_000,
      cumulativeTargetOrderCount: 1_000,
    },
  ],
};

describe("大区经理目标周期", () => {
  it("展示已启用的目标计划周期，并明确统计截止月份", async () => {
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValue(summary),
      listRegionalStatements: vi.fn().mockResolvedValue([{
        id: "statement-september",
        settlementMonth: "2026-09",
        status: "paid",
        totalFen: 1_000_600,
        templateVersionId: "template",
        targetPlanId: "plan-1",
        calculationSnapshot: summary,
        confirmedAt: null,
        paidAt: null,
      }]),
      listRegionalTargetPlans: vi.fn().mockResolvedValue([targetPlan]),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "hr", displayName: "人力", role: "hr", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    await screen.findByRole("option", { name: "大区经理（REGIONAL）" });
    expect(await screen.findByRole("heading", { name: "目标计划周期" })).toBeVisible();
    expect(screen.getByText("2026-01-15 至 2026-02-14")).toBeVisible();
    expect(screen.getByText(/累计查询范围：2026-01-15 至 2026-09-30/)).toBeVisible();
    expect(screen.getByText(/模板计算范围：2026-01-15 至 2026-07-14（已结束）/)).toBeVisible();
    expect(screen.getByText(/范围外订单不再产生新提成/)).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "本期目标" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "周期内累计有效订单" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "保存目标草稿" })).not.toBeInTheDocument();

    const monthInput = screen.getByLabelText(/提成数据统计截止月份/);
    expect(monthInput).toHaveAttribute("min", "2026-01");
    fireEvent.change(monthInput, { target: { value: "2026-08" } });
    await waitFor(() =>
      expect(client.getRegionalCommissionSummary).toHaveBeenCalledWith({
        managerId: "regional",
        month: "2026-08",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "回款核验" }));
    expect(await screen.findByRole("heading", { name: "2026 年 08 月不含税净回款" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "月度提成结算" }));
    expect(screen.getByRole("heading", { name: "月度提成结算单" })).toBeVisible();
    expect(screen.getByText(/它不是员工工资明细/)).toBeVisible();
    expect(screen.getByText("海南大区经理默认提成 · 第 1 版")).toBeVisible();
    expect(screen.getByText(/签收满 7 天后计为有效订单/)).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "本期待结算" })).toBeVisible();
    expect(screen.getByRole("button", { name: "生成08月结算单" })).toBeVisible();
    expect(screen.queryByText("2026-09")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "目标周期" }));
    expect(screen.getByRole("heading", { name: "目标计划周期" })).toBeVisible();
  });

  it("核验回款后展示已核验状态并保留成功提示", async () => {
    const pending = {
      ...summary,
      receipt: {
        id: "receipt-1",
        month: "2026-09",
        netReceiptFen: 100_000,
        evidenceNo: "BANK-001",
        note: "银行流水",
        verificationStatus: "pending" as const,
        verificationReason: null,
      },
    };
    const verified = {
      ...pending,
      receipt: { ...pending.receipt, verificationStatus: "verified" as const },
    };
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValueOnce(pending).mockResolvedValue(verified),
      listRegionalStatements: vi.fn().mockResolvedValue([]),
      listRegionalTargetPlans: vi.fn().mockResolvedValue([targetPlan]),
      verifyRegionalReceipt: vi.fn().mockResolvedValue(undefined),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    await screen.findByText("待财务核验");
    fireEvent.click(screen.getByRole("button", { name: "回款核验" }));
    fireEvent.click(screen.getByRole("button", { name: "核验通过" }));

    await waitFor(() => expect(client.verifyRegionalReceipt).toHaveBeenCalledWith("receipt-1", true, undefined));
    expect(await screen.findByText("已核验")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("净回款已核验");
    fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("请先执行“退回更正”");
  });

  it("不允许选择未来月份，并在当前视口说明原因", async () => {
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValue(summary),
      listRegionalStatements: vi.fn().mockResolvedValue([]),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    const monthInput = await screen.findByLabelText(/提成数据统计截止月份/);
    fireEvent.change(monthInput, { target: { value: "2026-10" } });

    expect(screen.getByRole("alertdialog")).toHaveTextContent("未来月份不能提前生成结算单");
    expect(monthInput).toHaveValue("2026-09");
    expect(client.getRegionalCommissionSummary).not.toHaveBeenCalledWith({ managerId: "regional", month: "2026-10" });
  });

  it("后月已累计发放时，前月显示为已覆盖并禁止重复生成", async () => {
    const coveredSummary: RegionalCommissionSummary = {
      ...summary,
      month: "2026-06",
      statisticsEndsOn: "2026-06-30",
      settlementPreviewFen: 0,
      settlementCoveredBy: {
        id: "statement-august",
        settlementMonth: "2026-08",
        status: "paid",
        totalFen: 12_200_000,
      },
      settlementEntries: [
        { category: "tiered_order", accruedFen: 9_000_000, previouslySettledFen: 9_000_000, payableFen: 0 },
      ],
    };
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValue(coveredSummary),
      listRegionalStatements: vi.fn().mockResolvedValue([]),
      calculateRegionalStatement: vi.fn(),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    const monthInput = await screen.findByLabelText(/提成数据统计截止月份/);
    fireEvent.change(monthInput, { target: { value: "2026-06" } });
    fireEvent.click(await screen.findByRole("button", { name: "月度提成结算" }));

    expect(await screen.findByText(/2026-06 已包含在 2026-08 已发放的累计结算中/)).toBeVisible();
    expect(within(screen.getByLabelText("本月结算试算")).getByText("¥0.00")).toBeVisible();
    const coveredButton = screen.getByRole("button", { name: "已由08月结算覆盖" });
    fireEvent.click(coveredButton);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("不能再重复生成或确认结算单");
    expect(client.calculateRegionalStatement).not.toHaveBeenCalled();
  });

  it("退回回款和撤销合作奖都强制填写原因", async () => {
    const withRecords: RegionalCommissionSummary = {
      ...summary,
      receipt: {
        id: "receipt-1",
        month: "2026-09",
        netReceiptFen: 100_000,
        evidenceNo: "BANK-001",
        note: null,
        verificationStatus: "pending",
        verificationReason: null,
      },
      cooperation: [{
        id: "stage-1",
        stageCode: "PROJECT",
        stageLabel: "省级项目立项",
        amountFen: 100_000,
        achievedOn: "2026-09-01",
        evidenceNo: "PROJECT-001",
        note: "立项批复",
        status: "confirmed",
        revokeReason: null,
      }],
    };
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValue(withRecords),
      listRegionalStatements: vi.fn().mockResolvedValue([]),
      listRegionalTargetPlans: vi.fn().mockResolvedValue([targetPlan]),
      verifyRegionalReceipt: vi.fn().mockResolvedValue(undefined),
      transitionRegionalCooperation: vi.fn().mockResolvedValue(undefined),
      submitRegionalCooperation: vi.fn().mockResolvedValue({}),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    await screen.findByText("待财务核验");
    fireEvent.click(screen.getByRole("button", { name: "回款核验" }));
    fireEvent.click(screen.getByRole("button", { name: "驳回并退回" }));
    expect(screen.getByRole("status")).toHaveTextContent("退回更正时必须填写原因");
    expect(client.verifyRegionalReceipt).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("驳回原因（核验通过时可不填）"), { target: { value: "金额与流水不一致" } });
    fireEvent.click(screen.getByRole("button", { name: "驳回并退回" }));
    await waitFor(() => expect(client.verifyRegionalReceipt).toHaveBeenCalledWith("receipt-1", false, "金额与流水不一致"));

    fireEvent.click(screen.getByRole("button", { name: "合作奖" }));
    const cooperationEntry = within(screen.getByRole("heading", { name: "海南电信合作奖资料" }).closest("section")!);
    expect(cooperationEntry.getByRole("button", { name: "提交为新记录" })).toBeEnabled();
    fireEvent.change(cooperationEntry.getByLabelText("达成日期"), { target: { value: "2026-09-20" } });
    fireEvent.change(cooperationEntry.getByLabelText("凭据/文件编号"), { target: { value: "PROJECT-002" } });
    fireEvent.change(cooperationEntry.getByLabelText("备注（选填）"), { target: { value: "第二次达成" } });
    fireEvent.click(cooperationEntry.getByRole("button", { name: "提交为新记录" }));
    await waitFor(() => expect(client.submitRegionalCooperation).toHaveBeenCalledWith({
      managerId: "regional",
      stageCode: "PROJECT",
      achievedOn: "2026-09-20",
      evidenceNo: "PROJECT-002",
      note: "第二次达成",
    }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("status")).toHaveTextContent("撤销合作奖必须填写原因");
    fireEvent.change(screen.getByLabelText("省级项目立项撤销原因"), { target: { value: "立项已取消" } });
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(client.transitionRegionalCooperation).toHaveBeenCalledWith("stage-1", "revoke", "立项已取消"));
  });

  it("合作奖确认条件不满足时弹窗显示服务端具体原因", async () => {
    const withScale: RegionalCommissionSummary = {
      ...summary,
      cooperation: [{
        id: "stage-scale",
        stageCode: "SCALE",
        stageLabel: "规模验证",
        amountFen: 1_000_000,
        achievedOn: "2026-09-01",
        evidenceNo: "SCALE-001",
        note: null,
        status: "finance_verified",
        revokeReason: null,
        condition: { label: "累计达到 1,000 笔并核验回款", satisfied: false },
      }],
    };
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValue(withScale),
      listRegionalStatements: vi.fn().mockResolvedValue([]),
      transitionRegionalCooperation: vi.fn().mockRejectedValue(new Error("合作阶段条件尚未满足：累计达到 1,000 笔并核验回款")),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    await screen.findByRole("option", { name: "大区经理（REGIONAL）" });
    fireEvent.click(await screen.findByRole("button", { name: "合作奖" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认奖励" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("累计达到 1,000 笔并核验回款");
  });

  it("结算状态操作直接采用服务端返回值，不重复计算 5 万笔汇总", async () => {
    const confirmed = {
      id: "statement-september",
      settlementMonth: "2026-09",
      status: "confirmed" as const,
      totalFen: 1_000_600,
      templateVersionId: "template",
      targetPlanId: "plan-1",
      calculationSnapshot: summary,
      confirmedAt: "2026-09-08T02:00:00.000Z",
      paidAt: null,
    };
    const paid = {
      ...confirmed,
      status: "paid" as const,
      paidAt: "2026-09-08T03:00:00.000Z",
    };
    const client = {
      listRegionalManagers: vi.fn().mockResolvedValue([{ id: "regional", displayName: "大区经理", workNo: "REGIONAL", active: true, employmentStartDate: "2026-01-15", employmentEndDate: null }]),
      getRegionalCommissionSummary: vi.fn().mockResolvedValue(summary),
      listRegionalStatements: vi.fn().mockResolvedValue([confirmed]),
      transitionRegionalStatement: vi.fn().mockResolvedValue(paid),
    } as unknown as ApiClient;
    const actor: AuthenticatedUser = { id: "admin", displayName: "管理员", role: "admin", storeId: null, mustChangePassword: false };
    render(<MemoryRouter><RegionalCommissionPage actor={actor} client={client} /></MemoryRouter>);

    await screen.findByRole("option", { name: "大区经理（REGIONAL）" });
    fireEvent.click(await screen.findByRole("button", { name: "月度提成结算" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认已发放" }));

    await waitFor(() => expect(client.transitionRegionalStatement).toHaveBeenCalledWith("statement-september", "pay"));
    expect(await screen.findByText("已发放")).toBeVisible();
    expect(screen.getByText(/\u53d1\u653e.*2026/)).toBeVisible();
    expect(client.getRegionalCommissionSummary).toHaveBeenCalledTimes(1);
  });
});
