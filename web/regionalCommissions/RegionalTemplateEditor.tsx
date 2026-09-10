import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  RegionalCommissionRules,
  RegionalProductSku,
  RegionalTargetCycleType,
} from "../../shared/regionalCommission/types";
import { normalizeRegionalCommissionRules } from "../../shared/regionalCommission/types";
import type { ApiClient, RegionalTemplateDto } from "../api/client";

type RegionalTemplateClient = Pick<
  ApiClient,
  | "assignRegionalTemplate"
  | "copyRegionalTemplate"
  | "createRegionalTemplate"
  | "listRegionalTemplates"
  | "publishRegionalTemplate"
  | "stopRegionalTemplate"
  | "updateRegionalTemplate"
>;

export interface RegionalTemplateEditorProps {
  client: RegionalTemplateClient;
  managerId: string;
  assignedTemplateVersionId?: string | null;
  employmentStartDate?: string | null;
  onAssignmentChange?(): void | Promise<void>;
  onError?(message: string): void;
  onMessage?(message: string): void;
}

const STATUS_LABELS: Record<RegionalTemplateDto["status"], string> = {
  draft: "草稿",
  published: "已发布",
  stopped: "已停用",
};

const PRODUCT_LABELS: Record<RegionalProductSku, string> = {
  WATCH: "智能手表",
  MATTRESS: "智能床垫",
  GATEWAY: "迷你网关",
  MOTION: "人体传感器",
  DOOR: "门磁",
  PORTABLE_BUTTON: "随身报警按钮",
  WALL_BUTTON: "壁挂报警按钮",
};

const PRODUCT_SKUS = Object.keys(PRODUCT_LABELS) as RegionalProductSku[];

const shanghaiToday = (): string => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const cloneRules = (rules: RegionalCommissionRules): RegionalCommissionRules => {
  const normalized = normalizeRegionalCommissionRules(rules);
  return {
    targetCycle: {
      startsOn: normalized.targetCycle.startsOn,
      planType: normalized.targetCycle.planType,
      periodTargets: [...normalized.targetCycle.periodTargets],
    },
    completionRewards: normalized.completionRewards.map((item) => ({ ...item })),
    orderTiers: normalized.orderTiers.map((item) => ({ ...item })),
    milestones: normalized.milestones.map((item) => ({ ...item })),
    topUp: { ...normalized.topUp },
    revenueAcceleration: { ...normalized.revenueAcceleration },
    cooperationStages: normalized.cooperationStages.map((item) => ({ ...item })),
    productCommissionFen: { ...normalized.productCommissionFen },
  };
};

const fenToYuan = (fen: number): string => (fen / 100).toFixed(2);
const yuanToFen = (yuan: string): number => Math.round(Number(yuan) * 100);
const basisPointsToPercent = (basisPoints: number): string =>
  (basisPoints / 100).toFixed(2).replace(/\.00$/, "");
const percentToBasisPoints = (percent: string): number =>
  Math.round(Number(percent) * 100);
const partsPerMillionToPercent = (parts: number): string =>
  (parts / 10_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
const percentToPartsPerMillion = (percent: string): number =>
  Math.round(Number(percent) * 10_000);

const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;
const isPositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

const TARGET_CYCLE_OPTIONS: readonly { value: RegionalTargetCycleType; label: string }[] = [
  { value: "quarter", label: "季度（3期）" },
  { value: "half_year", label: "半年（6期）" },
  { value: "year", label: "全年（12期）" },
];

const targetCyclePeriodCount = (planType: RegionalTargetCycleType): number =>
  planType === "quarter" ? 3 : planType === "half_year" ? 6 : 12;

const targetCycleEndsOn = (startsOn: string | null | undefined, planType: RegionalTargetCycleType): string | null => {
  if (!startsOn) return null;
  const [year, month, day] = startsOn.split("-").map(Number);
  if (!year || !month || !day) return null;
  const months = targetCyclePeriodCount(planType);
  const monthIndex = year * 12 + month - 1 + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const nextStart = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return nextStart.toISOString().slice(0, 10);
};

export const validateRegionalCommissionRules = (
  rules: RegionalCommissionRules,
): string | null => {
  const expectedPeriods = targetCyclePeriodCount(rules.targetCycle.planType);
  if (rules.targetCycle.startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(rules.targetCycle.startsOn)) {
    return "M1 开始日期格式不正确";
  }
  if (
    rules.targetCycle.periodTargets.length !== expectedPeriods ||
    rules.targetCycle.periodTargets.some((target) => !isPositiveInteger(target))
  ) {
    return `目标周期必须包含 ${expectedPeriods} 个大于 0 的整数目标`;
  }
  if (
    rules.completionRewards.some(
      (item) =>
        !isPositiveInteger(item.thresholdBasisPoints) ||
        item.thresholdBasisPoints > 10_000 ||
        !isNonNegativeInteger(item.amountFen),
    )
  ) {
    return "完成率必须在 0% 至 100% 之间，奖励金额不能为负数";
  }
  if (
    rules.orderTiers.some(
      (item) =>
        !isPositiveInteger(item.upToOrders) ||
        !isNonNegativeInteger(item.amountFenPerOrder),
    )
  ) {
    return "分段订单上限必须大于 0，每单奖励不能为负数";
  }
  if (
    rules.orderTiers.some(
      (item, index) =>
        index > 0 && item.upToOrders <= rules.orderTiers[index - 1]!.upToOrders,
    )
  ) {
    return "分段订单上限必须按从小到大排列";
  }
  if (
    rules.milestones.some(
      (item) =>
        !isPositiveInteger(item.orderCount) ||
        !isNonNegativeInteger(item.cumulativeAmountFen),
    )
  ) {
    return "里程碑订单数必须大于 0，累计奖励不能为负数";
  }
  if (
    !isPositiveInteger(rules.topUp.orderCount) ||
    !isNonNegativeInteger(rules.topUp.cumulativeCompletionRewardFen)
  ) {
    return "补足奖订单数必须大于 0，补足金额不能为负数";
  }
  if (
    !isPositiveInteger(rules.revenueAcceleration.unlockOrderCount) ||
    !isNonNegativeInteger(rules.revenueAcceleration.ratePartsPerMillion) ||
    !isNonNegativeInteger(rules.revenueAcceleration.monthlyCapFen)
  ) {
    return "回款加速奖的订单门槛必须大于 0，比例和封顶金额不能为负数";
  }
  if (
    rules.cooperationStages.some(
      (item) => !item.label.trim() || !isNonNegativeInteger(item.amountFen),
    )
  ) {
    return "合作奖阶段名称不能为空，奖励金额不能为负数";
  }
  if (
    PRODUCT_SKUS.some(
      (sku) => !isNonNegativeInteger(rules.productCommissionFen[sku]),
    )
  ) {
    return "个人商品提成不能为负数";
  }
  return null;
};

const replaceTemplate = (
  templates: readonly RegionalTemplateDto[],
  next: RegionalTemplateDto,
): RegionalTemplateDto[] => {
  const exists = templates.some((template) => template.id === next.id);
  const updated = exists
    ? templates.map((template) => (template.id === next.id ? next : template))
    : [...templates, next];
  return updated.sort((left, right) => {
    const codeOrder = left.templateCode.localeCompare(right.templateCode);
    return codeOrder || right.versionNo - left.versionNo;
  });
};

export const RegionalTemplateEditor = ({
  client,
  managerId,
  assignedTemplateVersionId = null,
  employmentStartDate = null,
  onAssignmentChange,
  onError,
  onMessage,
}: RegionalTemplateEditorProps) => {
  const [templates, setTemplates] = useState<readonly RegionalTemplateDto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draftRules, setDraftRules] = useState<RegionalCommissionRules | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [copyForm, setCopyForm] = useState<{
    name: string;
    effectiveFrom: string;
    reason: string;
    error: string | null;
  } | null>(null);
  const [changeReason, setChangeReason] = useState("");
  const changeReasonInput = useRef<HTMLInputElement>(null);
  const [actionDate, setActionDate] = useState(shanghaiToday);
  const [createForm, setCreateForm] = useState({
    name: "海南大区经理提成",
    effectiveFrom: shanghaiToday(),
    reason: "",
  });

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates],
  );
  const pendingSwitchTemplate = useMemo(
    () => templates.find((template) => template.id === pendingSwitchId) ?? null,
    [pendingSwitchId, templates],
  );
  const readOnly = selected?.status !== "draft";
  const selectedIsAssigned = selected?.id === assignedTemplateVersionId;
  const selectedCycleEndsOn = useMemo(
    () => draftRules ? targetCycleEndsOn(draftRules.targetCycle.startsOn ?? employmentStartDate, draftRules.targetCycle.planType) : null,
    [draftRules, employmentStartDate],
  );
  const hasUnsavedChanges = useMemo(
    () =>
      selected?.status === "draft" &&
      draftRules !== null &&
      JSON.stringify(draftRules) !== JSON.stringify(selected.rulesSnapshot),
    [draftRules, selected],
  );

  const loadTemplates = async (preferredId?: string) => {
    setStatus("loading");
    setError(null);
    try {
      const loaded = await client.listRegionalTemplates();
      setTemplates(loaded);
      setSelectedId((current) =>
        preferredId && loaded.some((template) => template.id === preferredId)
          ? preferredId
          : current && loaded.some((template) => template.id === current)
            ? current
            : (loaded[0]?.id ?? ""),
      );
      setStatus("ready");
    } catch (reason) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : "提成模板加载失败");
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, [client]);

  useEffect(() => {
    setDraftRules(selected ? cloneRules(selected.rulesSnapshot) : null);
    setChangeReason("");
    if (selected) {
      const earliest = employmentStartDate && employmentStartDate > selected.effectiveFrom
        ? employmentStartDate
        : selected.effectiveFrom;
      setActionDate(earliest);
    }
  }, [selected, employmentStartDate]);

  const run = async (
    action: () => Promise<RegionalTemplateDto | void>,
    success: string,
    feedbackScope: "create" | "operation" = "operation",
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    if (feedbackScope === "operation") setOperationFeedback(null);
    try {
      const result = await action();
      if (result) {
        setTemplates((current) => replaceTemplate(current, result));
        setSelectedId(result.id);
      }
      setChangeReason("");
      if (feedbackScope === "operation") {
        setOperationFeedback({ kind: "success", message: success });
      }
      onMessage?.(success);
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "模板操作失败";
      if (feedbackScope === "operation") {
        setOperationFeedback({ kind: "error", message });
      } else {
        setError(message);
      }
      onError?.(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createTemplate = (event: FormEvent) => {
    event.preventDefault();
    if (!createForm.name.trim() || !createForm.effectiveFrom || !createForm.reason.trim()) {
      const message = "请填写模板名称、版本最早可用日期和创建原因";
      setError(message);
      onError?.(message);
      return;
    }
    void run(
      () =>
        client.createRegionalTemplate({
          name: createForm.name.trim(),
          effectiveFrom: createForm.effectiveFrom,
          reason: createForm.reason.trim(),
        }),
      "模板草稿已创建",
      "create",
    );
    setCreateForm((current) => ({ ...current, reason: "" }));
  };

  const requireReason = (): string | null => {
    const reason = changeReason.trim();
    if (!reason) {
      const message = "操作没有执行：请先填写修改或版本操作原因。";
      setOperationFeedback({ kind: "error", message });
      onError?.(message);
      changeReasonInput.current?.focus();
      changeReasonInput.current?.scrollIntoView?.({ block: "center" });
    }
    return reason || null;
  };

  const requireSavedRules = (nextAction: string): boolean => {
    if (!hasUnsavedChanges) return true;
    let message: string;
    if (!changeReason.trim()) {
      message = `当前规则尚未保存。请填写操作原因，点击“保存规则”，保存成功后再${nextAction}。`;
      setOperationFeedback({ kind: "error", message });
      changeReasonInput.current?.focus();
      changeReasonInput.current?.scrollIntoView?.({ block: "center" });
    } else {
      message = `当前规则尚未保存。请先点击“保存规则”，保存成功后再${nextAction}。`;
      setOperationFeedback({ kind: "error", message });
    }
    onError?.(message);
    return false;
  };

  const saveRules = () => {
    if (!selected || !draftRules || selected.status !== "draft") return;
    const reason = requireReason();
    if (!reason) return;
    const validationError = validateRegionalCommissionRules(draftRules);
    if (validationError) {
      const message = `操作没有执行：${validationError}`;
      setOperationFeedback({ kind: "error", message });
      onError?.(message);
      return;
    }
    void run(
      () => client.updateRegionalTemplate(selected.id, { rules: draftRules, reason }),
      "模板规则已保存",
    );
  };

  const updateCompletionReward = (
    index: number,
    patch: Partial<RegionalCommissionRules["completionRewards"][number]>,
  ) =>
    setDraftRules((current) =>
      current
        ? {
            ...current,
            completionRewards: current.completionRewards.map((item, itemIndex) =>
              itemIndex === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );

  const updateOrderTier = (
    index: number,
    patch: Partial<RegionalCommissionRules["orderTiers"][number]>,
  ) =>
    setDraftRules((current) =>
      current
        ? {
            ...current,
            orderTiers: current.orderTiers.map((item, itemIndex) =>
              itemIndex === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );

  const updateMilestone = (
    index: number,
    patch: Partial<RegionalCommissionRules["milestones"][number]>,
  ) =>
    setDraftRules((current) =>
      current
        ? {
            ...current,
            milestones: current.milestones.map((item, itemIndex) =>
              itemIndex === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );

  const updateCooperationStage = (
    index: number,
    patch: Partial<RegionalCommissionRules["cooperationStages"][number]>,
  ) =>
    setDraftRules((current) =>
      current
        ? {
            ...current,
            cooperationStages: current.cooperationStages.map((item, itemIndex) =>
              itemIndex === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );

  const updateTopUp = (patch: Partial<RegionalCommissionRules["topUp"]>) =>
    setDraftRules((current) =>
      current ? { ...current, topUp: { ...current.topUp, ...patch } } : current,
    );

  const updateRevenueAcceleration = (
    patch: Partial<RegionalCommissionRules["revenueAcceleration"]>,
  ) =>
    setDraftRules((current) =>
      current
        ? {
            ...current,
            revenueAcceleration: { ...current.revenueAcceleration, ...patch },
          }
        : current,
    );

  const updateProductCommission = (sku: RegionalProductSku, amountFen: number) =>
    setDraftRules((current) =>
      current
        ? {
            ...current,
            productCommissionFen: {
              ...current.productCommissionFen,
              [sku]: amountFen,
            },
          }
        : current,
    );

  const updateTargetCycle = (
    patch: Partial<RegionalCommissionRules["targetCycle"]>,
  ) =>
    setDraftRules((current) =>
      current
        ? {
            ...current,
            targetCycle: { ...current.targetCycle, ...patch },
          }
        : current,
    );

  const changeTargetCycleType = (planType: RegionalTargetCycleType) => {
    setDraftRules((current) => {
      if (!current) return current;
      const count = targetCyclePeriodCount(planType);
      const periodTargets = Array.from({ length: count }, (_, index) =>
        current.targetCycle.periodTargets[index] ?? 1_000,
      );
      return { ...current, targetCycle: { ...current.targetCycle, planType, periodTargets } };
    });
  };

  return (
    <div className="regional-template-workspace">
      <form className="regional-template-create" onSubmit={createTemplate}>
        <div className="regional-section-heading">
          <div>
            <h2>新建提成模板</h2>
            <p>新模板默认带出系统规则，保存为草稿后可逐项调整。</p>
          </div>
        </div>
        <div className="regional-entry-grid">
          <label>
            <span>模板名称</span>
            <input
              aria-label="新模板名称"
              value={createForm.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setCreateForm((current) => ({
                  ...current,
                  name,
                }));
              }}
            />
          </label>
          <label>
            <span>版本最早可用日期</span>
            <input
              aria-label="新模板生效日期"
              type="date"
              value={createForm.effectiveFrom}
              onChange={(event) => {
                const effectiveFrom = event.currentTarget.value;
                setCreateForm((current) => ({
                  ...current,
                  effectiveFrom,
                }));
              }}
            />
          </label>
          <label>
            <span>创建原因</span>
            <input
              aria-label="新模板创建原因"
              placeholder="说明为什么创建新版本"
              value={createForm.reason}
              onChange={(event) => {
                const reason = event.currentTarget.value;
                setCreateForm((current) => ({
                  ...current,
                  reason,
                }));
              }}
            />
          </label>
          <button disabled={busy} type="submit">新建草稿</button>
        </div>
      </form>

      {error ? <div className="report-error" role="alert">{error}</div> : null}
      {status === "loading" ? <p className="regional-empty">正在加载提成模板…</p> : null}
      {status === "error" ? (
        <button className="regional-secondary-action" type="button" onClick={() => void loadTemplates()}>
          重新加载模板
        </button>
      ) : null}

      {status === "ready" ? (
        <div className="regional-template-layout">
          <aside className="regional-template-list" aria-label="模板版本">
            <div className="regional-section-heading">
              <div>
                <h2>模板版本</h2>
                <p>选择一个版本查看完整规则。</p>
              </div>
            </div>
            {templates.map((template) => (
              <button
                aria-pressed={template.id === selectedId}
                className="regional-template-card"
                key={template.id}
                type="button"
                onClick={() => {
                  if (hasUnsavedChanges && template.id !== selectedId) {
                    setPendingSwitchId(template.id);
                    return;
                  }
                  setOperationFeedback(null);
                  setSelectedId(template.id);
                }}
              >
                <span>
                  <strong>{template.name}</strong>
                  <small>第 {template.versionNo} 版</small>
                </span>
                <span className="regional-template-card__badges">
                  {template.id === assignedTemplateVersionId ? <em className="is-assigned">本月使用</em> : null}
                  <em className={`is-${template.status}`}>{STATUS_LABELS[template.status]}</em>
                </span>
              </button>
            ))}
            {templates.length === 0 ? <p className="regional-empty">暂无模板，请先新建草稿。</p> : null}
          </aside>

          {selected && draftRules ? (
            <article className="regional-template-editor" aria-label="模板规则详情">
              <header className="regional-template-editor__header">
                <div>
                  <span>当前模板</span>
                  <h2>{selected.name} · 第 {selected.versionNo} 版</h2>
                  <p>
                    版本最早可用日期 {selected.effectiveFrom}
                    {readOnly ? " · 当前版本只读" : " · 草稿可编辑"}
                    {selectedIsAssigned ? " · 当前统计月份使用中" : ""}
                    {hasUnsavedChanges ? " · 有未保存修改" : ""}
                  </p>
                </div>
                <span className={`regional-template-status is-${selected.status}`}>
                  {selected.status === "published" && selectedCycleEndsOn && selectedCycleEndsOn < shanghaiToday()
                    ? "模板计算已结束"
                    : STATUS_LABELS[selected.status]}
                </span>
              </header>

              <fieldset className="regional-rule-group" disabled={readOnly || busy}>
                <legend>目标周期</legend>
                <p>决定模板的完整计算范围和每个非自然月周期的订单目标。M1 可独立设置，模板计算结束日由周期类型自动生成。</p>
                <div className="regional-rule-grid">
                  <label className="regional-field">
                    <span>计划类型</span>
                    <select
                      aria-label="目标周期类型"
                      value={draftRules.targetCycle.planType}
                      onChange={(event) =>
                        changeTargetCycleType(event.currentTarget.value as RegionalTargetCycleType)
                      }
                    >
                      {TARGET_CYCLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="regional-field">
                    <span>M1 开始日期</span>
                    <input
                      aria-label="M1开始日期"
                      disabled={readOnly || busy}
                      type="date"
                      value={draftRules.targetCycle.startsOn ?? employmentStartDate ?? ""}
                      onChange={(event) => updateTargetCycle({ startsOn: event.currentTarget.value })}
                    />
                    <small>首版可参考入职日期，但以这里填写的日期作为 M1 起点。{selectedCycleEndsOn ? ` 模板计算至 ${selectedCycleEndsOn}，范围外订单不计提成。` : ""}</small>
                  </label>
                </div>
                <div className="regional-rule-grid">
                  {draftRules.targetCycle.periodTargets.map((target, index) => (
                    <label className="regional-field" key={index}>
                      <span>M{index + 1} 订单目标</span>
                      <input
                        aria-label={`M${index + 1}订单目标`}
                        min="1"
                        step="1"
                        type="number"
                        value={target}
                        onChange={(event) =>
                          updateTargetCycle({
                            periodTargets: draftRules.targetCycle.periodTargets.map((value, targetIndex) =>
                              targetIndex === index ? Number(event.currentTarget.value) : value,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="regional-rule-group" disabled={readOnly || busy}>
                <legend>完成率奖励</legend>
                <p>达到对应目标完成率后，取满足条件的最高一档奖励。</p>
                <div className="regional-rule-grid">
                  {draftRules.completionRewards.map((item, index) => (
                    <div className="regional-rule-row" key={index}>
                      <label className="regional-field">
                        <span>完成率（%）</span>
                        <input
                          aria-label={`完成率奖励${index + 1}完成率`}
                          max="100"
                          min="0.01"
                          step="0.01"
                          type="number"
                          value={basisPointsToPercent(item.thresholdBasisPoints)}
                          onChange={(event) =>
                            updateCompletionReward(index, {
                              thresholdBasisPoints: percentToBasisPoints(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                      <label className="regional-field">
                        <span>奖励金额（元）</span>
                        <input
                          aria-label={`完成率奖励${index + 1}金额`}
                          min="0"
                          step="0.01"
                          type="number"
                          value={fenToYuan(item.amountFen)}
                          onChange={(event) =>
                            updateCompletionReward(index, {
                              amountFen: yuanToFen(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="regional-rule-group" disabled={readOnly || busy}>
                <legend>分段订单奖</legend>
                <p>订单量跨档后按各档分别累计，不按最高档覆盖全部订单。</p>
                <div className="regional-rule-grid">
                  {draftRules.orderTiers.map((item, index) => (
                    <div className="regional-rule-row" key={index}>
                      <label className="regional-field">
                        <span>累计订单上限</span>
                        <input
                          aria-label={`订单档位${index + 1}上限`}
                          min="1"
                          step="1"
                          type="number"
                          value={item.upToOrders}
                          onChange={(event) =>
                            updateOrderTier(index, {
                              upToOrders: Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                      <label className="regional-field">
                        <span>每单奖励（元）</span>
                        <input
                          aria-label={`订单档位${index + 1}每单奖励`}
                          min="0"
                          step="0.01"
                          type="number"
                          value={fenToYuan(item.amountFenPerOrder)}
                          onChange={(event) =>
                            updateOrderTier(index, {
                              amountFenPerOrder: yuanToFen(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="regional-rule-group" disabled={readOnly || busy}>
                <legend>累计里程碑奖</legend>
                <div className="regional-rule-grid">
                  {draftRules.milestones.map((item, index) => (
                    <div className="regional-rule-row" key={index}>
                      <label className="regional-field">
                        <span>达标订单数</span>
                        <input
                          aria-label={`里程碑${index + 1}订单数`}
                          min="1"
                          step="1"
                          type="number"
                          value={item.orderCount}
                          onChange={(event) =>
                            updateMilestone(index, {
                              orderCount: Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                      <label className="regional-field">
                        <span>累计奖励（元）</span>
                        <input
                          aria-label={`里程碑${index + 1}累计奖励`}
                          min="0"
                          step="0.01"
                          type="number"
                          value={fenToYuan(item.cumulativeAmountFen)}
                          onChange={(event) =>
                            updateMilestone(index, {
                              cumulativeAmountFen: yuanToFen(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="regional-rule-group" disabled={readOnly || busy}>
                <legend>补足奖与回款加速奖</legend>
                <div className="regional-rule-grid regional-rule-grid--three">
                  <label className="regional-field">
                    <span>补足奖订单门槛</span>
                    <input
                      aria-label="补足奖订单门槛"
                      min="1"
                      step="1"
                      type="number"
                      value={draftRules.topUp.orderCount}
                      onChange={(event) =>
                        updateTopUp({ orderCount: Number(event.currentTarget.value) })
                      }
                    />
                  </label>
                  <label className="regional-field">
                    <span>完成率奖励补足至（元）</span>
                    <input
                      aria-label="完成率奖励补足金额"
                      min="0"
                      step="0.01"
                      type="number"
                      value={fenToYuan(draftRules.topUp.cumulativeCompletionRewardFen)}
                      onChange={(event) =>
                        updateTopUp({
                          cumulativeCompletionRewardFen: yuanToFen(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                  <label className="regional-field">
                    <span>回款奖解锁订单数</span>
                    <input
                      aria-label="回款奖解锁订单数"
                      min="1"
                      step="1"
                      type="number"
                      value={draftRules.revenueAcceleration.unlockOrderCount}
                      onChange={(event) =>
                        updateRevenueAcceleration({
                          unlockOrderCount: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                  <label className="regional-field">
                    <span>净回款奖励比例（%）</span>
                    <input
                      aria-label="净回款奖励比例"
                      min="0"
                      step="0.0001"
                      type="number"
                      value={partsPerMillionToPercent(draftRules.revenueAcceleration.ratePartsPerMillion)}
                      onChange={(event) =>
                        updateRevenueAcceleration({
                          ratePartsPerMillion: percentToPartsPerMillion(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                  <label className="regional-field">
                    <span>回款奖励月度封顶（元）</span>
                    <input
                      aria-label="回款奖励月度封顶"
                      min="0"
                      step="0.01"
                      type="number"
                      value={fenToYuan(draftRules.revenueAcceleration.monthlyCapFen)}
                      onChange={(event) =>
                        updateRevenueAcceleration({
                          monthlyCapFen: yuanToFen(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="regional-rule-group" disabled={readOnly || busy}>
                <legend>海南电信合作奖</legend>
                <div className="regional-rule-grid">
                  {draftRules.cooperationStages.map((item, index) => (
                    <div className="regional-rule-row" key={item.code}>
                      <label className="regional-field">
                        <span>阶段名称</span>
                        <input
                          aria-label={`合作奖${index + 1}阶段名称`}
                          value={item.label}
                          onChange={(event) =>
                            updateCooperationStage(index, { label: event.currentTarget.value })
                          }
                        />
                      </label>
                      <label className="regional-field">
                        <span>奖励金额（元）</span>
                        <input
                          aria-label={`${item.label}奖励金额`}
                          min="0"
                          step="0.01"
                          type="number"
                          value={fenToYuan(item.amountFen)}
                          onChange={(event) =>
                            updateCooperationStage(index, {
                              amountFen: yuanToFen(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="regional-rule-group" disabled={readOnly || busy}>
                <legend>个人渠道商品提成</legend>
                <p>大区经理个人渠道订单按独立商品和设备逐件计算。</p>
                <div className="regional-product-rule-grid">
                  {PRODUCT_SKUS.map((sku) => (
                    <label className="regional-field" key={sku}>
                      <span>{PRODUCT_LABELS[sku]}（元/件）</span>
                      <input
                        aria-label={`${PRODUCT_LABELS[sku]}个人提成`}
                        min="0"
                        step="0.01"
                        type="number"
                        value={fenToYuan(draftRules.productCommissionFen[sku])}
                        onChange={(event) =>
                          updateProductCommission(sku, yuanToFen(event.currentTarget.value))
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>

              <section className="regional-template-version-actions" aria-label="模板版本操作">
                <div className="regional-template-operation-guide">
                  <strong>版本操作说明</strong>
                  <span><b>保存规则</b>：保存当前草稿上的修改。</span>
                  <span><b>创建新版本</b>：从已发布版本带出奖励规则，在确认框中填写新名称、版本最早可用日期和原因后才会创建。</span>
                  <span><b>发布模板</b>：把已保存的草稿锁定为可分配版本，发布后不能直接编辑。</span>
                  <span><b>本月使用</b>：表示所选大区经理在当前统计月份最后一天实际采用的版本。</span>
                </div>
                <label className="regional-field">
                  <span>修改或版本操作原因</span>
                  <input
                    aria-describedby={operationFeedback ? "regional-template-operation-feedback" : undefined}
                    aria-invalid={operationFeedback?.kind === "error"}
                    aria-label="修改或版本操作原因"
                    placeholder="保存、发布、停用或分配前必填"
                    ref={changeReasonInput}
                    value={changeReason}
                    onChange={(event) => {
                      setChangeReason(event.currentTarget.value);
                      if (operationFeedback?.kind === "error") setOperationFeedback(null);
                    }}
                  />
                </label>
                <label className="regional-field">
                  <span>该经理规则开始适用日期</span>
                  <input
                    aria-label="该经理规则开始适用日期"
                    type="date"
                    value={actionDate}
                    onChange={(event) => setActionDate(event.currentTarget.value)}
                  />
                </label>
                {operationFeedback ? <div
                  className={`regional-template-operation-feedback is-${operationFeedback.kind}`}
                  id="regional-template-operation-feedback"
                  role={operationFeedback.kind === "error" ? "alert" : "status"}
                >
                  <strong>{operationFeedback.kind === "error" ? "未执行" : "操作成功"}</strong>
                  <span>{operationFeedback.message}</span>
                </div> : null}
                <div className="regional-form-actions">
                  {!readOnly ? (
                    <button className="regional-primary-action" disabled={busy} type="button" onClick={saveRules}>
                      保存规则
                    </button>
                  ) : null}
                  {readOnly ? <button
                    className="regional-secondary-action"
                    disabled={busy}
                    type="button"
                    onClick={() => {
                      if (!selected) return;
                      setCopyForm({
                        name: selected.name,
                        effectiveFrom: shanghaiToday(),
                        reason: "",
                        error: null,
                      });
                    }}
                  >
                    创建新版本
                  </button> : null}
                  {selected.status === "draft" ? (
                    <button
                      className="regional-primary-action"
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        if (!requireSavedRules("发布模板")) return;
                        const reason = requireReason();
                        if (!reason) return;
                        void run(() => client.publishRegionalTemplate(selected.id, reason), "模板已发布");
                      }}
                    >
                      发布模板
                    </button>
                  ) : null}
                  {selected.status === "published" ? (
                    <>
                      <button
                        className="regional-primary-action"
                        disabled={busy || !managerId || !actionDate || selectedIsAssigned}
                        title={managerId ? undefined : "请先选择大区经理"}
                        type="button"
                        onClick={() => {
                          const reason = requireReason();
                          if (!reason || !managerId) return;
                          void run(
                            () =>
                              client.assignRegionalTemplate({
                                managerId,
                                templateVersionId: selected.id,
                                effectiveFrom: actionDate,
                                reason,
                            }),
                            "模板已分配给大区经理",
                          ).then((success) => success ? onAssignmentChange?.() : undefined);
                        }}
                      >
                        {selectedIsAssigned ? "当前月份已在使用" : "分配给当前大区经理"}
                      </button>
                      <button
                        className="regional-secondary-action"
                        disabled={busy}
                        type="button"
                        onClick={() => {
                          const reason = requireReason();
                          if (!reason) return;
                          void run(() => client.stopRegionalTemplate(selected.id, reason), "模板已停用");
                        }}
                      >
                        停用模板
                      </button>
                    </>
                  ) : null}
                </div>
              </section>
            </article>
          ) : null}
        </div>
      ) : null}
      {pendingSwitchTemplate ? <div className="regional-template-switch-backdrop" role="presentation">
        <section aria-labelledby="regional-template-switch-title" aria-modal="true" className="regional-template-switch-dialog" role="dialog">
          <h2 id="regional-template-switch-title">当前修改还没有保存</h2>
          <p>刚才的保存没有成功执行，因此不能直接切换到“{pendingSwitchTemplate.name} · 第 {pendingSwitchTemplate.versionNo} 版”。你可以返回填写原因并保存，或者明确放弃当前修改后切换。</p>
          <div className="regional-form-actions">
            <button className="regional-secondary-action" type="button" onClick={() => setPendingSwitchId(null)}>继续编辑</button>
            <button className="regional-primary-action" type="button" onClick={() => {
              setPendingSwitchId(null);
              setOperationFeedback({ kind: "error", message: "请填写操作原因并点击“保存规则”，保存成功后即可切换版本。" });
              window.requestAnimationFrame(() => {
                changeReasonInput.current?.focus();
                changeReasonInput.current?.scrollIntoView?.({ block: "center" });
              });
            }}>返回填写原因</button>
            <button className="regional-danger-action" type="button" onClick={() => {
              setPendingSwitchId(null);
              setOperationFeedback(null);
              setSelectedId(pendingSwitchTemplate.id);
            }}>放弃修改并切换</button>
          </div>
        </section>
      </div> : null}
      {copyForm && selected ? <div className="regional-template-switch-backdrop" role="presentation">
        <form
          aria-labelledby="regional-template-copy-title"
          aria-modal="true"
          className="regional-template-switch-dialog"
          role="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            const name = copyForm.name.trim();
            const reason = copyForm.reason.trim();
            if (!name || !copyForm.effectiveFrom || !reason) {
              setCopyForm((current) => current ? {
                ...current,
                error: "请填写新版本名称、版本最早可用日期和创建原因。",
              } : current);
              return;
            }
            void run(
              () => client.copyRegionalTemplate(selected.id, {
                name,
                effectiveFrom: copyForm.effectiveFrom,
                reason,
              }),
              "新版本草稿已创建",
            ).then((success) => {
              if (success) setCopyForm(null);
            });
          }}
        >
          <h2 id="regional-template-copy-title">基于第 {selected.versionNo} 版创建新版本</h2>
          <p>已发布版本会保留不变。新版本先保存为草稿，确认规则后再发布和分配，不会在打开窗口时自动创建。</p>
          <label className="regional-field">
            <span>新版本名称</span>
            <input
              aria-label="新版本名称"
              autoFocus
              value={copyForm.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setCopyForm((current) => current ? { ...current, name, error: null } : current);
              }}
            />
          </label>
          <label className="regional-field">
            <span>版本最早可用日期</span>
            <input
              aria-label="新版本生效日期"
              type="date"
              value={copyForm.effectiveFrom}
              onChange={(event) => {
                const effectiveFrom = event.currentTarget.value;
                setCopyForm((current) => current ? { ...current, effectiveFrom, error: null } : current);
              }}
            />
          </label>
          <label className="regional-field">
            <span>创建原因</span>
            <input
              aria-label="新版本创建原因"
              placeholder="例如：调整第四季度订单阶梯"
              value={copyForm.reason}
              onChange={(event) => {
                const reason = event.currentTarget.value;
                setCopyForm((current) => current ? { ...current, reason, error: null } : current);
              }}
            />
          </label>
          {copyForm.error ? <div className="regional-template-operation-feedback is-error" role="alert">
            <strong>尚未创建</strong>
            <span>{copyForm.error}</span>
          </div> : null}
          <div className="regional-form-actions">
            <button className="regional-secondary-action" disabled={busy} type="button" onClick={() => setCopyForm(null)}>取消</button>
            <button className="regional-primary-action" disabled={busy} type="submit">确认创建草稿</button>
          </div>
        </form>
      </div> : null}
    </div>
  );
};
