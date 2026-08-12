import { useCallback, useEffect, useMemo, useState } from "react";

import { ACTIVE_CATALOG } from "../../shared/pricing/catalog";
import type {
  ApiClient,
  AuthenticatedUser,
  CommissionPolicyVersionDto,
  CreateCommissionPolicyDraftInput,
} from "../api/client";
import {
  CommissionRulesPage,
  type CommissionPolicyHistoryView,
  type CommissionPolicyView,
  type CommissionSimulationView,
  type SaveCommissionRuleInput,
} from "./CommissionRulesPage";

export type CommissionRulesClient = Pick<
  ApiClient,
  | "copyCommissionPolicy"
  | "createCommissionPolicyDraft"
  | "listCommissionPolicyVersions"
  | "publishCommissionPolicy"
  | "simulateCommission"
  | "stopCommissionPolicy"
  | "updateCommissionRule"
>;

export interface CommissionRulesRouteProps {
  actor: AuthenticatedUser;
  client: CommissionRulesClient;
}

const FORMAL_DEFAULT_AMOUNTS: Readonly<Record<string, number>> = {
  WATCH: 2_000,
  MATTRESS: 4_000,
  ONE_KEY: 2_000,
  HOME_DUAL: 3_000,
  STANDARD_BUNDLE: 6_000,
  WATCH_MATTRESS: 6_000,
  WATCH_STANDARD: 8_000,
  MATTRESS_STANDARD: 10_000,
  FULL_FAMILY: 12_000,
};

const FORMAL_DISABLED_SKUS = [
  "GATEWAY",
  "MOTION",
  "DOOR",
  "PORTABLE_BUTTON",
  "WALL_BUTTON",
  "FTTR_129",
  "FTTR_159",
  "FTTR_199",
  "FTTR_239",
  "FTTR_299",
  "FTTR_399",
  "FTTR_CUSTOM",
] as const;

const PREFERRED_SIMULATION_SKUS = [
  "FULL_FAMILY",
  "MATTRESS_STANDARD",
  "WATCH_STANDARD",
  "WATCH_MATTRESS",
  "STANDARD_BUNDLE",
  "HOME_DUAL",
  "ONE_KEY",
  "MATTRESS",
  "WATCH",
] as const;

const partsForShanghai = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
};

const formatShanghaiDate = (value: string | Date): string => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = partsForShanghai(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const formatShanghaiDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
};

const labelForSku = (sku: string): string => {
  const charge = ACTIVE_CATALOG.charges[
    sku as keyof typeof ACTIVE_CATALOG.charges
  ];
  if (charge) return charge.label;

  if (sku === "FTTR_CUSTOM") return "FTTR 自定义档位";
  const fttrMatch = /^FTTR_(\d+)$/.exec(sku);
  return fttrMatch ? `FTTR ${fttrMatch[1]} 元套餐` : sku;
};

const mapHistory = (
  policy: CommissionPolicyVersionDto,
): CommissionPolicyHistoryView[] => {
  const history: CommissionPolicyHistoryView[] = [];
  const creationNote =
    policy.status === "draft" &&
    policy.revision === 1 &&
    policy.changeNote.trim()
      ? `：${policy.changeNote.trim()}`
      : "";
  history.push({
    id: `${policy.id}-created`,
    at: formatShanghaiDateTime(policy.createdAt),
    actor: policy.createdBy,
    action: `${policy.sourceVersionId ? "复制为草稿版本" : "创建草稿版本"}${creationNote}`,
  });

  if (policy.publishedBy && policy.publishedAt) {
    const publicationNote =
      policy.status === "published" && policy.changeNote.trim()
        ? `：${policy.changeNote.trim()}`
        : "";
    history.push({
      id: `${policy.id}-published`,
      at: formatShanghaiDateTime(policy.publishedAt),
      actor: policy.publishedBy,
      action: `发布版本${publicationNote}`,
    });
  }

  if (policy.stoppedBy && policy.stoppedAt) {
    const stopNote = policy.changeNote.trim()
      ? `：${policy.changeNote.trim()}`
      : "";
    history.push({
      id: `${policy.id}-stopped`,
      at: formatShanghaiDateTime(policy.stoppedAt),
      actor: policy.stoppedBy,
      action: `停用版本${stopNote}`,
    });
  }

  return history;
};

const mapPolicy = (policy: CommissionPolicyVersionDto): CommissionPolicyView => ({
  id: policy.id,
  version: policy.version,
  name: policy.name,
  status: policy.status,
  effectiveFrom: formatShanghaiDate(policy.effectiveFrom),
  rules: policy.rules.map((rule) => ({
    id: rule.id,
    sku: rule.sku,
    label: labelForSku(rule.sku),
    amountFen: rule.amountFen,
    enabled: rule.enabled,
  })),
  history: mapHistory(policy),
});

const defaultRules = (): CreateCommissionPolicyDraftInput["rules"] =>
  [
    ...Object.entries(FORMAL_DEFAULT_AMOUNTS).map(([sku, amountFen]) => ({
      sku,
      amountFen,
      paymentMode: "all" as const,
      scope: { kind: "global" as const },
      enabled: true,
    })),
    ...FORMAL_DISABLED_SKUS.map((sku) => ({
      sku,
      amountFen: 0,
      paymentMode: "all" as const,
      scope: { kind: "global" as const },
      enabled: false,
    })),
  ];

const replacePolicy = (
  versions: readonly CommissionPolicyVersionDto[],
  next: CommissionPolicyVersionDto,
): CommissionPolicyVersionDto[] => {
  const existingIndex = versions.findIndex((version) => version.id === next.id);
  if (existingIndex < 0) {
    return [next, ...versions].sort((left, right) => right.version - left.version);
  }
  return versions.map((version) => (version.id === next.id ? next : version));
};

export const CommissionRulesRoute = ({
  actor,
  client,
}: CommissionRulesRouteProps) => {
  const [versions, setVersions] = useState<readonly CommissionPolicyVersionDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    formatShanghaiDate(new Date()),
  );
  const [createReason, setCreateReason] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const loaded = [...(await client.listCommissionPolicyVersions())].sort(
        (left, right) => right.version - left.version,
      );
      setVersions(loaded);
      setSelectedId((current) =>
        current && loaded.some((version) => version.id === current)
          ? current
          : (loaded[0]?.id ?? null),
      );
      setStatus("ready");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "提成规则加载失败，请重试",
      );
      setStatus("error");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedDto = useMemo(
    () => versions.find((version) => version.id === selectedId) ?? null,
    [selectedId, versions],
  );
  const selectedPolicy = useMemo(
    () => (selectedDto ? mapPolicy(selectedDto) : null),
    [selectedDto],
  );

  const commitPolicy = useCallback((next: CommissionPolicyVersionDto) => {
    setVersions((current) => replacePolicy(current, next));
    setSelectedId(next.id);
  }, []);

  const refreshVersions = useCallback(
    async (preferredId: string): Promise<void> => {
      const loaded = [...(await client.listCommissionPolicyVersions())].sort(
        (left, right) => right.version - left.version,
      );
      setVersions(loaded);
      setSelectedId(
        loaded.some((version) => version.id === preferredId)
          ? preferredId
          : (loaded[0]?.id ?? null),
      );
    },
    [client],
  );

  const createDraft = async (): Promise<void> => {
    if (!draftName.trim() || !effectiveFrom || !createReason.trim()) {
      setError("请填写新版本名称、生效日期和创建原因");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await client.createCommissionPolicyDraft({
        name: draftName.trim(),
        effectiveFrom,
        rules: defaultRules(),
        reason: createReason.trim(),
      });
      commitPolicy(created);
      setDraftName("");
      setCreateReason("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "提成草稿创建失败，请重试",
      );
    } finally {
      setCreating(false);
    }
  };

  const saveRule = async (input: SaveCommissionRuleInput): Promise<void> => {
    const current = versions.find((version) => version.id === input.policyId);
    if (!current) throw new Error("当前提成版本不存在，请刷新后重试");
    const updated = await client.updateCommissionRule(
      input.policyId,
      input.ruleId,
      {
        amountFen: input.amountFen,
        enabled: input.enabled,
        expectedRevision: current.revision,
        reason: input.reason,
      },
    );
    commitPolicy(updated);
  };

  const simulate = async (policyId: string): Promise<CommissionSimulationView> => {
    const current = versions.find((version) => version.id === policyId);
    if (!current) throw new Error("当前提成版本不存在");
    const representative =
      PREFERRED_SIMULATION_SKUS.map((sku) =>
        current.rules.find((rule) => rule.sku === sku && rule.enabled),
      ).find(Boolean) ?? current.rules.find((rule) => rule.enabled);
    if (!representative) throw new Error("当前版本没有可用于模拟的启用规则");
    const label = labelForSku(representative.sku);
    const result = await client.simulateCommission({
      versionId: current.id,
      orderLines: [
        {
          sku: representative.sku,
          label,
          quantity: 1,
          lineType: "charge",
        },
      ],
      sellerContext: {
        salespersonId: actor.id,
        storeId: actor.storeId ?? "admin-simulation",
        personnelType: "admin",
        paymentMode:
          representative.paymentMode === "contract_36"
            ? "contract_36"
            : "one_time",
      },
    });
    return {
      orderName: `代表订单 · ${label}`,
      totalFen: result.calculation.totalFen,
      unconfiguredCount: result.calculation.unconfigured.length,
    };
  };

  if (status === "loading") {
    return <p className="commission-route-state">正在加载提成规则…</p>;
  }
  if (status === "error") {
    return (
      <section className="commission-route-state" aria-live="polite">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void load()}>
          重新加载
        </button>
      </section>
    );
  }

  return (
    <div className="commission-rules-route">
      <section className="commission-draft-creator" aria-labelledby="commission-create-title">
        <div>
          <h2 id="commission-create-title">新建提成草稿</h2>
          <p>新草稿使用公司正式默认提成金额，创建后可逐项调整并模拟。</p>
        </div>
        <div className="commission-draft-creator__fields">
          <label>
            新版本名称
            <input
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.currentTarget.value)}
            />
          </label>
          <label>
            计划生效日期
            <input
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.currentTarget.value)}
            />
          </label>
          <label>
            创建原因
            <input
              type="text"
              value={createReason}
              onChange={(event) => setCreateReason(event.currentTarget.value)}
            />
          </label>
          <button type="button" disabled={creating} onClick={() => void createDraft()}>
            {creating ? "正在创建…" : "创建提成草稿"}
          </button>
        </div>
      </section>

      {error ? <p role="alert">{error}</p> : null}

      {versions.length > 0 ? (
        <label className="commission-version-selector">
          查看提成版本
          <select
            value={selectedId ?? ""}
            onChange={(event) => setSelectedId(event.currentTarget.value)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                V{version.version} · {version.name} · {version.status}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="commission-route-empty">尚未创建提成版本</p>
      )}

      {selectedPolicy ? (
        <CommissionRulesPage
          policy={selectedPolicy}
          onSaveRule={saveRule}
          onSimulate={simulate}
          onPublish={async (policyId, reason) => {
            const published = await client.publishCommissionPolicy(policyId, reason);
            commitPolicy(published);
            await refreshVersions(published.id);
          }}
          onStop={async (policyId, reason) => {
            commitPolicy(await client.stopCommissionPolicy(policyId, reason));
          }}
          onCopy={async (policyId, reason) => {
            commitPolicy(
              await client.copyCommissionPolicy(policyId, { reason }),
            );
          }}
        />
      ) : null}
    </div>
  );
};
