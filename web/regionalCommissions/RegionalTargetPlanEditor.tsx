import { useEffect, useMemo, useState } from "react";

import type {
  ApiClient,
  RegionalTargetPlanDto,
  RegionalTargetPlanType,
} from "../api/client";

type TargetPlanClient = Pick<
  ApiClient,
  | "activateRegionalTargetPlan"
  | "createSuggestedRegionalTargetPlan"
  | "saveRegionalTargetPlan"
>;

const PLAN_LABELS: Record<RegionalTargetPlanType, string> = {
  quarter: "季度（3期）",
  half_year: "半年（6期）",
  year: "全年（12期）",
};

const PLAN_STATUS_LABELS: Record<RegionalTargetPlanDto["status"], string> = {
  draft: "建议草稿",
  active: "已启用",
  replaced: "已替代",
};

const DEFAULT_TARGETS = [1_000, 4_000, 8_000, 10_000, 13_000, 14_000];
const periodCount = (type: RegionalTargetPlanType) =>
  type === "quarter" ? 3 : type === "half_year" ? 6 : 12;

const addDay = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

interface DraftForm {
  id?: string;
  planType: RegionalTargetPlanType;
  startsOn: string;
  periodTargets: number[];
  reason: string;
}

const formFromPlan = (plan: RegionalTargetPlanDto): DraftForm => ({
  id: plan.id,
  planType: plan.planType,
  startsOn: plan.startsOn,
  periodTargets: plan.periods.map((period) => period.targetOrderCount),
  reason: "",
});

export const RegionalTargetPlanEditor = ({
  canEdit,
  client,
  employmentStartDate,
  plans,
  managerId,
  onChanged,
  onMessage,
}: {
  canEdit: boolean;
  client: TargetPlanClient;
  employmentStartDate: string | null;
  plans: readonly RegionalTargetPlanDto[];
  managerId: string;
  onChanged(): Promise<void>;
  onMessage(message: string): void;
}) => {
  const selectedDefault = plans.find((plan) => plan.status === "draft")
    ?? plans.find((plan) => plan.status === "active")
    ?? plans[0];
  const [selectedId, setSelectedId] = useState(selectedDefault?.id ?? "");
  const [form, setForm] = useState<DraftForm | null>(
    selectedDefault ? formFromPlan(selectedDefault) : null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedId === "__new__") return;
    const selected = plans.find((plan) => plan.id === selectedId)
      ?? plans.find((plan) => plan.status === "draft")
      ?? plans.find((plan) => plan.status === "active")
      ?? plans[0];
    if (!selected) {
      setSelectedId("");
      setForm(null);
      return;
    }
    setSelectedId(selected.id);
    setForm(formFromPlan(selected));
  }, [plans, selectedId]);

  const selected = useMemo(
    () => plans.find((plan) => plan.id === selectedId) ?? null,
    [plans, selectedId],
  );
  const isDraft = !selected || selected.status === "draft";

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
      onMessage(success);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "目标计划操作失败");
    } finally {
      setBusy(false);
    }
  };

  const changeType = (planType: RegionalTargetPlanType) => {
    const count = periodCount(planType);
    setForm((current) => current ? {
      ...current,
      planType,
      periodTargets: Array.from(
        { length: count },
        (_, index) => current.periodTargets[index]
          ?? DEFAULT_TARGETS[index]
          ?? DEFAULT_TARGETS.at(-1)!,
      ),
    } : current);
  };

  const save = () => {
    if (!form) return;
    if (!form.startsOn) {
      onMessage("请填写目标计划开始日期");
      return;
    }
    if (!form.reason.trim()) {
      onMessage("请填写目标计划设置原因");
      return;
    }
    void run(
      () => client.saveRegionalTargetPlan({
        id: form.id,
        managerId,
        planType: form.planType,
        startsOn: form.startsOn,
        periodTargets: form.periodTargets,
        reason: form.reason.trim(),
      }),
      "目标计划草稿已保存",
    );
  };

  return <section className="regional-target-plan-editor" aria-label="目标计划管理">
    <div className="regional-section-heading">
      <div>
        <h2>大区目标计划</h2>
        <p>首份计划从入职日开始；后续计划只能由 HR 或管理员手动创建，系统不会自动续建。</p>
      </div>
      <span>入职日期 {employmentStartDate ?? "未设置"}</span>
    </div>

    {plans.length ? <div className="regional-plan-list" aria-label="目标计划版本">
      {plans.map((plan) => <button
        aria-pressed={selectedId === plan.id}
        className="regional-plan-card"
        key={plan.id}
        onClick={() => {
          setSelectedId(plan.id);
          setForm(formFromPlan(plan));
        }}
        type="button"
      >
        <strong>{PLAN_LABELS[plan.planType]} · {plan.startsOn} 至 {plan.endsOn}</strong>
        <span className={`regional-status regional-status--${plan.status}`}>{PLAN_STATUS_LABELS[plan.status]}</span>
        <small>{plan.isPreset ? "入职目标计划" : "手动创建的后续计划"} · {plan.changeReason}</small>
      </button>)}
    </div> : <div className="regional-empty">
      <p>尚未建立目标计划。可按入职日期生成首个半年建议草稿。</p>
      {canEdit ? <button disabled={busy || !employmentStartDate} type="button" onClick={() => void run(
        () => client.createSuggestedRegionalTargetPlan(managerId, "按入职日期生成首个半年目标建议草稿"),
        "已生成目标计划建议草稿，请检查后启用",
      )}>生成入职目标草稿</button> : null}
    </div>}

    {form ? <div className="regional-plan-form">
      <div className="regional-entry-grid">
        <label>
          <span>计划类型</span>
          <select
            disabled={!canEdit || !isDraft || busy}
            value={form.planType}
            onChange={(event) => changeType(event.currentTarget.value as RegionalTargetPlanType)}
          >
            {Object.entries(PLAN_LABELS).map(([value, label]) =>
              <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>M1 开始日期</span>
          <input
            disabled={!canEdit || !isDraft || busy}
            type="date"
            value={form.startsOn}
            onChange={(event) => setForm({ ...form, startsOn: event.currentTarget.value })}
          />
          {selected?.isPreset ? <small>首个计划确认时必须与入职日期一致。</small> : null}
        </label>
        {isDraft ? <label className="regional-plan-reason">
          <span>设置或启用原因</span>
          <input
            disabled={!canEdit || busy}
            placeholder="保存和启用前必填"
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.currentTarget.value })}
          />
        </label> : null}
      </div>
      <div className="regional-target-period-grid">
        {form.periodTargets.map((target, index) => <label className="regional-field" key={index}>
          <span>M{index + 1} 订单目标</span>
          <input
            disabled={!canEdit || !isDraft || busy}
            min="1"
            step="1"
            type="number"
            value={target}
            onChange={(event) => setForm({
              ...form,
              periodTargets: form.periodTargets.map((value, targetIndex) =>
                targetIndex === index ? Number(event.currentTarget.value) : value),
            })}
          />
        </label>)}
      </div>
      {canEdit && isDraft ? <div className="regional-form-actions">
        <button disabled={busy} type="button" onClick={save}>保存目标草稿</button>
        {selected ? <button className="regional-primary-action" disabled={busy} type="button" onClick={() => {
          if (!form.reason.trim()) {
            onMessage("请填写目标计划启用原因");
            return;
          }
          void run(
            () => client.activateRegionalTargetPlan(selected.id, form.reason.trim()),
            "目标计划已由 HR 确认并启用",
          );
        }}>确认并启用</button> : null}
      </div> : null}
    </div> : null}

    {canEdit && plans.length > 0 && !plans.some((plan) => plan.status === "draft") ? <button
      className="regional-secondary-action"
      type="button"
      onClick={() => {
        const latest = [...plans].sort((left, right) => right.endsOn.localeCompare(left.endsOn))[0]!;
        setSelectedId("__new__");
        setForm({
          planType: "half_year",
          startsOn: addDay(latest.endsOn),
          periodTargets: [...DEFAULT_TARGETS],
          reason: "",
        });
      }}
    >手动新建后续计划草稿</button> : null}
  </section>;
};
