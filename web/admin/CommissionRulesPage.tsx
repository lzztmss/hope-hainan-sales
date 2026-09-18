import { useEffect, useMemo, useState } from "react";

import { formatFen, yuanToFen } from "../../shared/money";
import "./commissionRules.css";

export type CommissionPolicyStatus = "draft" | "published" | "stopped";

export interface CommissionRuleView {
  id: string;
  sku: string;
  label: string;
  amountFen: number;
  enabled: boolean;
}

export interface CommissionPolicyHistoryView {
  id: string;
  at: string;
  actor: string;
  action: string;
}

export interface CommissionPolicyView {
  id: string;
  version: number;
  name: string;
  status: CommissionPolicyStatus;
  effectiveFrom: string;
  rules: CommissionRuleView[];
  history: CommissionPolicyHistoryView[];
}

export interface SaveCommissionRuleInput {
  policyId: string;
  ruleId: string;
  amountFen: number;
  enabled: boolean;
  reason: string;
}

export interface CommissionSimulationView {
  orderName: string;
  totalFen: number;
  unconfiguredCount: number;
}

export interface CommissionRulesPageProps {
  policy: CommissionPolicyView;
  onSaveRule?(input: SaveCommissionRuleInput): Promise<void>;
  onSimulate?(policyId: string): Promise<CommissionSimulationView>;
  onPublish?(policyId: string, reason: string): Promise<void>;
  onStop?(policyId: string, reason: string): Promise<void>;
  onCopy?(policyId: string, reason: string): Promise<void>;
}

interface DraftRuleState {
  amount: string;
  enabled: boolean;
  reason: string;
  error: string | null;
  saving: boolean;
}

const amountForInput = (amountFen: number): string => {
  const formatted = formatFen(amountFen);
  return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
};

const statusLabel: Record<CommissionPolicyStatus, string> = {
  draft: "草稿",
  published: "已发布",
  stopped: "已停用",
};

const RULE_GROUPS = [
  {
    id: "devices" as const,
    title: "单独销售设备",
    description: "手表、床垫和所有配件都按物理设备计提；月付套餐和一次性套装均按其内含设备数量汇总。",
  },
];

const buildDrafts = (
  rules: readonly CommissionRuleView[],
): Record<string, DraftRuleState> =>
  Object.fromEntries(
    rules.map((rule) => [
      rule.id,
      {
        amount: amountForInput(rule.amountFen),
        enabled: rule.enabled,
        reason: "",
        error: null,
        saving: false,
      },
    ]),
  );

export const CommissionRulesPage = ({
  policy,
  onSaveRule,
  onSimulate,
  onPublish,
  onStop,
  onCopy,
}: CommissionRulesPageProps) => {
  const [drafts, setDrafts] = useState(() => buildDrafts(policy.rules));
  const [simulation, setSimulation] =
    useState<CommissionSimulationView | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");

  useEffect(() => {
    setDrafts(buildDrafts(policy.rules));
    setSimulation(null);
    setPageError(null);
    setActionReason("");
  }, [policy.id, policy.rules]);

  const configuredCount = useMemo(
    () => policy.rules.filter((rule) => rule.enabled).length,
    [policy.rules],
  );
  const groupedRules = useMemo(
    () =>
      RULE_GROUPS.map((group) => ({
        ...group,
        rules: policy.rules,
      })).filter((group) => group.rules.length > 0),
    [policy.rules],
  );
  const readOnly = policy.status !== "draft";

  const patchDraft = (
    ruleId: string,
    patch: Partial<DraftRuleState>,
  ): void => {
    setDrafts((current) => ({
      ...current,
      [ruleId]: { ...current[ruleId]!, ...patch },
    }));
    setSimulation(null);
  };

  const saveRule = async (rule: CommissionRuleView): Promise<void> => {
    const draft = drafts[rule.id];
    if (!draft) return;
    if (!draft.reason.trim()) {
      patchDraft(rule.id, { error: "请填写调整原因" });
      return;
    }

    let amountFen: number;
    try {
      amountFen = yuanToFen(draft.amount);
    } catch (error) {
      patchDraft(rule.id, {
        error: error instanceof Error ? error.message : "请输入有效金额",
      });
      return;
    }

    patchDraft(rule.id, { saving: true, error: null });
    try {
      await onSaveRule?.({
        policyId: policy.id,
        ruleId: rule.id,
        amountFen,
        enabled: draft.enabled,
        reason: draft.reason.trim(),
      });
      patchDraft(rule.id, { saving: false, reason: "" });
    } catch (error) {
      patchDraft(rule.id, {
        saving: false,
        error: error instanceof Error ? error.message : "保存失败，请重试",
      });
    }
  };

  const simulate = async (): Promise<void> => {
    if (!onSimulate) return;
    setBusyAction("simulate");
    setPageError(null);
    try {
      setSimulation(await onSimulate(policy.id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "模拟失败，请重试");
    } finally {
      setBusyAction(null);
    }
  };

  const runPolicyAction = async (
    action: "publish" | "stop" | "copy",
    callback: ((policyId: string, reason: string) => Promise<void>) | undefined,
  ): Promise<void> => {
    if (!callback) return;
    const reason = actionReason.trim();
    if (!reason) {
      setPageError("请填写版本操作原因");
      return;
    }
    setBusyAction(action);
    setPageError(null);
    try {
      await callback(policy.id, reason);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="commission-admin-page" aria-labelledby="commission-title">
      <header className="commission-admin-page__header">
        <div>
          <p className="commission-admin-page__eyebrow">管理员专区</p>
          <h1 id="commission-title">提成规则管理</h1>
          <p>
            设置每件物理设备的固定提成。无论单卖设备还是放入套装，
            都按实际包含的设备数量汇总，36 个月月付套餐只计提一次。
          </p>
        </div>
        <span className={`commission-policy-status is-${policy.status}`}>
          {statusLabel[policy.status]}
        </span>
      </header>

      <section className="commission-policy-summary" aria-label="当前提成版本">
        <div>
          <span>当前版本</span>
          <strong>
            {policy.name} · V{policy.version}
          </strong>
        </div>
        <div>
          <span>计划生效</span>
          <strong>{policy.effectiveFrom}</strong>
        </div>
        <div>
          <span>已配置</span>
          <strong>{configuredCount} 项</strong>
        </div>
      </section>

      {onPublish || onStop || onCopy ? (
        <div className="commission-policy-reason">
          <label htmlFor="commission-policy-action-reason">版本操作原因</label>
          <input
            id="commission-policy-action-reason"
            type="text"
            value={actionReason}
            placeholder="必填，用于发布、停用或复制审计"
            disabled={busyAction !== null}
            onChange={(event) => {
              setActionReason(event.currentTarget.value);
              setPageError(null);
            }}
          />
        </div>
      ) : null}

      <div className="commission-policy-actions">
        {policy.status === "draft" ? (
          <>
            <button
              type="button"
              className="secondary-action"
              disabled={!onSimulate || busyAction !== null}
              onClick={() => void simulate()}
            >
              {busyAction === "simulate" ? "正在模拟…" : "模拟代表订单"}
            </button>
            <button
              type="button"
              className="primary-action"
              disabled={
                !simulation ||
                !onPublish ||
                !actionReason.trim() ||
                busyAction !== null
              }
              onClick={() => void runPolicyAction("publish", onPublish)}
            >
              发布提成版本
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary-action"
            disabled={!onCopy || !actionReason.trim() || busyAction !== null}
            onClick={() => void runPolicyAction("copy", onCopy)}
          >
            复制为新草稿
          </button>
        )}
        {policy.status === "published" && onStop ? (
          <button
            type="button"
            className="danger-action"
            disabled={!actionReason.trim() || busyAction !== null}
            onClick={() => void runPolicyAction("stop", onStop)}
          >
            停用当前版本
          </button>
        ) : null}
      </div>

      {simulation ? (
        <section className="commission-simulation" aria-live="polite">
          <span>模拟通过 · {simulation.orderName}</span>
          <strong>预计提成 ¥{formatFen(simulation.totalFen)}</strong>
          <span>未配置 {simulation.unconfiguredCount} 项</span>
        </section>
      ) : null}
      {pageError ? <p role="alert">{pageError}</p> : null}

      <section aria-labelledby="fixed-rules-title">
        <div className="commission-section-heading">
          <div>
            <h2 id="fixed-rules-title">固定提成金额</h2>
            <p>单位：人民币元／件</p>
          </div>
        </div>
        {groupedRules.map((group) => (
          <section
            className="commission-rule-group"
            aria-labelledby={`commission-rule-group-${group.id}`}
            key={group.id}
          >
            <header className="commission-rule-group__header">
              <h3 id={`commission-rule-group-${group.id}`}>{group.title}</h3>
              <p>{group.description}</p>
            </header>
            <div className="commission-rule-grid">
          {group.rules.map((rule) => {
            const draft = drafts[rule.id];
            if (!draft) return null;
            return (
              <article
                className="commission-rule-card"
                data-testid={`commission-rule-${rule.sku}`}
                key={rule.id}
              >
                <div className="commission-rule-card__title">
                  <div>
                    <span>{rule.sku}</span>
                    <h4>{rule.label}</h4>
                  </div>
                  <label className="commission-switch">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      disabled={readOnly}
                      onChange={(event) =>
                        patchDraft(rule.id, {
                          enabled: event.currentTarget.checked,
                          error: null,
                        })
                      }
                    />
                    启用
                  </label>
                </div>
                <div>
                  <label htmlFor={`commission-amount-${rule.id}`}>
                    {rule.label}提成金额（元）
                  </label>
                  <div className="commission-amount-input">
                    <span aria-hidden="true">¥</span>
                    <input
                      id={`commission-amount-${rule.id}`}
                      type="text"
                      inputMode="decimal"
                      value={draft.amount}
                      disabled={readOnly}
                      onChange={(event) =>
                        patchDraft(rule.id, {
                          amount: event.currentTarget.value,
                          error: null,
                        })
                      }
                    />
                  </div>
                </div>
                {!readOnly ? (
                  <>
                    <label htmlFor={`commission-reason-${rule.id}`}>
                      {rule.label}调整原因
                    </label>
                    <input
                      id={`commission-reason-${rule.id}`}
                      type="text"
                      value={draft.reason}
                      placeholder="必填，用于审计记录"
                      onChange={(event) =>
                        patchDraft(rule.id, {
                          reason: event.currentTarget.value,
                          error: null,
                        })
                      }
                    />
                    {draft.error ? <p role="alert">{draft.error}</p> : null}
                    <button
                      type="button"
                      disabled={draft.saving}
                      onClick={() => void saveRule(rule)}
                    >
                      {draft.saving ? "正在保存…" : `保存${rule.label}`}
                    </button>
                  </>
                ) : (
                  <p className="commission-rule-card__readonly">
                    已发布版本不可修改，请复制为新草稿后调整。
                  </p>
                )}
              </article>
            );
          })}
            </div>
          </section>
        ))}
      </section>

      <section className="commission-history" aria-labelledby="history-title">
        <h2 id="history-title">变更记录</h2>
        <ol>
          {policy.history.map((entry) => (
            <li key={entry.id}>
              <time>{entry.at}</time>
              <strong>{entry.actor}</strong>
              <span>{entry.action}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
};
