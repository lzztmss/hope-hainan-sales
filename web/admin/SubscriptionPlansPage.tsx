import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ACTIVE_CATALOG } from "../../shared/pricing/catalog";
import type { SubscriptionPlanItem } from "../../shared/pricing/types";
import type {
  ApiClient,
  SaveSubscriptionPlanInput,
  SubscriptionPlanDto,
} from "../api/client";
import { PageLayout } from "../components/layout";
import "./subscriptionPlans.css";

const PRODUCT_SKUS: readonly SubscriptionPlanItem["sku"][] = [
  "WATCH",
  "MATTRESS",
  "GATEWAY",
  "MOTION",
  "DOOR",
  "PORTABLE_BUTTON",
  "WALL_BUTTON",
];

type Draft = {
  code: string;
  name: string;
  description: string;
  monthlyYuan: string;
  active: boolean;
  quantities: Record<SubscriptionPlanItem["sku"], number>;
  reason: string;
};

const emptyQuantities = () => Object.fromEntries(
  PRODUCT_SKUS.map((sku) => [sku, 0]),
) as Draft["quantities"];

const emptyDraft = (): Draft => ({
  code: "",
  name: "",
  description: "",
  monthlyYuan: "",
  active: true,
  quantities: emptyQuantities(),
  reason: "",
});

const draftFor = (plan: SubscriptionPlanDto): Draft => ({
  code: plan.code,
  name: plan.name,
  description: plan.description ?? "",
  monthlyYuan: String(plan.monthlyFen / 100),
  active: plan.active,
  quantities: {
    ...emptyQuantities(),
    ...Object.fromEntries(plan.items.map((item) => [item.sku, item.quantity])),
  },
  reason: "",
});

const toInput = (draft: Draft, expectedVersion?: number): SaveSubscriptionPlanInput => {
  const monthlyFen = Math.round(Number(draft.monthlyYuan) * 100);
  return {
    code: draft.code,
    name: draft.name,
    description: draft.description || null,
    monthlyFen,
    active: draft.active,
    items: PRODUCT_SKUS.flatMap((sku) => {
      const quantity = draft.quantities[sku];
      return quantity > 0 ? [{ sku, quantity }] : [];
    }),
    reason: draft.reason,
    ...(expectedVersion ? { expectedVersion } : {}),
  };
};

export const SubscriptionPlansPage = ({ client }: { client: ApiClient }) => {
  const [plans, setPlans] = useState<readonly SubscriptionPlanDto[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const editing = useMemo(
    () => plans.find((plan) => plan.id === editingId) ?? null,
    [editingId, plans],
  );

  const load = async () => {
    setLoading(true);
    try {
      setPlans(await client.listSubscriptionPlans(true));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "套餐加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const select = (plan: SubscriptionPlanDto | null) => {
    setEditingId(plan?.id ?? null);
    setDraft(plan ? draftFor(plan) : emptyDraft());
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await client.updateSubscriptionPlan(editing.id, toInput(draft, editing.version))
        : await client.createSubscriptionPlan(toInput(draft));
      await load();
      select(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "套餐保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const reason = draft.reason.trim();
    if (!reason) {
      setError("请先填写删除原因");
      return;
    }
    if (!window.confirm(`确定删除月付套餐“${editing.name}”吗？删除后不可恢复。`)) return;
    setBusy(true);
    setError(null);
    try {
      await client.deleteSubscriptionPlan(editing.id, {
        expectedVersion: editing.version,
        reason,
      });
      select(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "套餐删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageLayout
      eyebrow="系统配置"
      title="36个月月付套餐"
      description="月付报价只能选择这里启用的套餐；订单会保存套餐和设备快照。停用套餐请先点击左侧套餐，取消启用勾选后保存。"
      actions={<button type="button" onClick={() => select(null)}>新增套餐</button>}
    >
      <div className="subscription-plans">
        <section aria-label="套餐列表" className="subscription-plans__list">
          {loading ? <p>正在加载套餐…</p> : null}
          {!loading && plans.length === 0 ? <p>尚未配置月付套餐。</p> : null}
          {plans.map((plan) => (
            <button
              className={plan.id === editingId ? "is-selected" : ""}
              key={plan.id}
              type="button"
              onClick={() => select(plan)}
            >
              <strong>{plan.name}</strong>
              <span>{plan.code} · ¥{(plan.monthlyFen / 100).toFixed(2)}/月</span>
              <small>{plan.active ? "已启用" : "已停用"} · {plan.items.length}种设备</small>
            </button>
          ))}
        </section>

        <form className="subscription-plans__editor" onSubmit={(event) => void submit(event)}>
          <h2>{editing ? `编辑：${editing.name}` : "新增套餐"}</h2>
          <label>套餐编码<input required maxLength={32} pattern="[A-Z0-9][A-Z0-9_-]{0,31}" title="1至32位大写字母、数字、下划线或连字符" value={draft.code} onChange={(event) => {
            const code = event.currentTarget.value.toUpperCase();
            setDraft((current) => ({ ...current, code }));
          }} /></label>
          <label>套餐名称<input required maxLength={80} value={draft.name} onChange={(event) => {
            const name = event.currentTarget.value;
            setDraft((current) => ({ ...current, name }));
          }} /></label>
          <label>月费（元）<input required type="number" min="0.01" step="0.01" value={draft.monthlyYuan} onChange={(event) => {
            const monthlyYuan = event.currentTarget.value;
            setDraft((current) => ({ ...current, monthlyYuan }));
          }} /></label>
          <label>套餐说明<textarea maxLength={500} value={draft.description} onChange={(event) => {
            const description = event.currentTarget.value;
            setDraft((current) => ({ ...current, description }));
          }} /></label>
          <fieldset>
            <legend>包含设备</legend>
            {PRODUCT_SKUS.map((sku) => (
              <label key={sku}>
                <span>{ACTIVE_CATALOG.charges[sku].label}</span>
                <input type="number" min="0" max="20" value={draft.quantities[sku]} onChange={(event) => {
                  const quantity = Math.max(0, Math.min(20, Number(event.currentTarget.value) || 0));
                  setDraft((current) => ({
                    ...current,
                    quantities: { ...current.quantities, [sku]: quantity },
                  }));
                }} />
              </label>
            ))}
          </fieldset>
          <label className="subscription-plans__active"><input type="checkbox" checked={draft.active} onChange={(event) => {
            const active = event.currentTarget.checked;
            setDraft((current) => ({ ...current, active }));
          }} />{draft.active ? "启用套餐（当前已启用，取消勾选后保存即可停用）" : "启用套餐（当前已停用，勾选后保存即可启用）"}</label>
          <label>修改原因<input required maxLength={500} value={draft.reason} onChange={(event) => {
            const reason = event.currentTarget.value;
            setDraft((current) => ({ ...current, reason }));
          }} /></label>
          {error ? <p role="alert" className="subscription-plans__error">{error}</p> : null}
          <div className="subscription-plans__actions">
            <button className="is-primary" disabled={busy} type="submit">{busy ? "正在保存…" : "保存套餐"}</button>
            {editing ? <button className="is-danger" disabled={busy} type="button" onClick={() => void remove()}>删除套餐</button> : null}
          </div>
        </form>
      </div>
    </PageLayout>
  );
};
