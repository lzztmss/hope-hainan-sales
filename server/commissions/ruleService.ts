import { randomUUID } from "node:crypto";

import {
  calculateCommission,
} from "../../shared/commission/commissionEngine.js";
import type {
  CommissionCalculation,
  CommissionOrderLine,
  CommissionRule,
  CommissionScope,
  SellerCommissionContext,
} from "../../shared/commission/types.js";
import {
  requireRole,
  type AuthenticatedUser,
} from "../auth/authorization.js";

export type CommissionPolicyStatus = "draft" | "published" | "stopped";
export type CommissionRuleDraft = Omit<CommissionRule, "id">;

export interface CommissionPolicyVersion {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly status: CommissionPolicyStatus;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly rules: readonly CommissionRule[];
  readonly sourceVersionId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly publishedBy: string | null;
  readonly publishedAt: string | null;
  readonly stoppedBy: string | null;
  readonly stoppedAt: string | null;
  readonly changeNote: string;
  readonly revision: number;
}

export type CommissionRuleAuditAction =
  | "create_draft"
  | "update_draft"
  | "publish"
  | "stop"
  | "copy";

export interface CommissionRuleAuditContext {
  readonly action: CommissionRuleAuditAction;
  readonly actorId: string;
  readonly reason: string;
  readonly at: string;
  readonly before: CommissionPolicyVersion | null;
}

export interface CommissionPolicyReplacementWrite {
  readonly version: CommissionPolicyVersion;
  readonly expectedRevision: number;
  readonly audit: CommissionRuleAuditContext;
}

export interface CommissionRuleRepository {
  allocateVersionNumber(): Promise<number>;
  insertVersion(
    version: CommissionPolicyVersion,
    audit: CommissionRuleAuditContext,
  ): Promise<void>;
  findVersionById(id: string): Promise<CommissionPolicyVersion | null>;
  listVersions(): Promise<readonly CommissionPolicyVersion[]>;
  replaceVersion(
    version: CommissionPolicyVersion,
    expectedRevision: number,
    audit: CommissionRuleAuditContext,
  ): Promise<boolean>;
  publishVersion(
    published: CommissionPolicyReplacementWrite,
    predecessor?: CommissionPolicyReplacementWrite,
  ): Promise<boolean>;
  isVersionUsed(id: string): Promise<boolean>;
}

export interface CreateCommissionPolicyDraftInput {
  name: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  rules: readonly CommissionRuleDraft[];
  reason?: string;
}

export interface CopyCommissionPolicyVersionInput {
  name?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  rules?: readonly CommissionRuleDraft[];
  reason?: string;
}

export interface UpdateCommissionRuleInput {
  amountFen: number;
  enabled?: boolean;
  expectedRevision: number;
  reason: string;
}

export interface CommissionSimulationInput {
  versionId?: string;
  at?: Date;
  orderLines: readonly CommissionOrderLine[];
  sellerContext: SellerCommissionContext;
}

export interface CommissionSimulationResult {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly versionStatus: CommissionPolicyStatus;
  readonly calculation: CommissionCalculation;
}

type IdKind = "policy" | "rule";

export interface CommissionRuleServiceOptions {
  repository: CommissionRuleRepository;
  now?: () => Date;
  idFactory?: (kind: IdKind) => string;
}

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
};

const cloneScope = (scope: CommissionScope): CommissionScope =>
  scope.kind === "global" ? { kind: "global" } : { ...scope };

const cloneRule = (rule: CommissionRule): CommissionRule => ({
  ...rule,
  scope: cloneScope(rule.scope),
});

const snapshotVersion = (
  version: CommissionPolicyVersion,
): CommissionPolicyVersion =>
  deepFreeze({
    ...version,
    rules: version.rules.map(cloneRule),
  });

const parseShanghaiLocalDate = (value: string, field: string): string => {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) throw new Error(`${field}必须是 YYYY-MM-DD 格式`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcCalendar = new Date(Date.UTC(year, month - 1, day));
  if (
    utcCalendar.getUTCFullYear() !== year ||
    utcCalendar.getUTCMonth() !== month - 1 ||
    utcCalendar.getUTCDate() !== day
  ) {
    throw new Error(`${field}不是有效日期`);
  }

  return new Date(
    utcCalendar.getTime() - SHANGHAI_UTC_OFFSET_MS,
  ).toISOString();
};

const assertValidInterval = (
  effectiveFrom: string,
  effectiveTo: string | null,
): void => {
  if (
    effectiveTo !== null &&
    Date.parse(effectiveTo) <= Date.parse(effectiveFrom)
  ) {
    throw new Error("提成规则失效日必须晚于生效日");
  }
};

const normalizeName = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error("提成规则版本名称不能为空");
  if (normalized.length > 100) {
    throw new Error("提成规则版本名称不能超过 100 个字符");
  }
  return normalized;
};

const normalizeReason = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim() || fallback;
  if (!normalized) throw new Error("修改原因不能为空");
  if (normalized.length > 500) throw new Error("修改原因不能超过 500 个字符");
  return normalized;
};

const normalizeScope = (scope: CommissionScope): CommissionScope => {
  if (scope.kind === "global") return { kind: "global" };
  const value = scope.value.trim();
  if (!value) throw new Error("提成规则适用范围不能为空");
  return { ...scope, value } as CommissionScope;
};

const scopeKey = (scope: CommissionScope): string =>
  scope.kind === "global" ? "global" : `${scope.kind}:${scope.value}`;

const validateAndAssignRules = (
  drafts: readonly CommissionRuleDraft[],
  idFactory: (kind: IdKind) => string,
): readonly CommissionRule[] => {
  if (drafts.length === 0) throw new Error("提成规则版本至少需要一条规则");

  const signatures = new Set<string>();
  return drafts.map((draft) => {
    const sku = draft.sku.trim();
    if (!sku) throw new Error("提成规则 SKU 不能为空");
    if (!Number.isSafeInteger(draft.amountFen) || draft.amountFen < 0) {
      throw new Error(`提成金额不合法：${sku}`);
    }
    if (
      draft.paymentMode !== "all" &&
      draft.paymentMode !== "one_time" &&
      draft.paymentMode !== "contract_36"
    ) {
      throw new Error(`提成支付方式不合法：${sku}`);
    }
    if (typeof draft.enabled !== "boolean") {
      throw new Error(`提成规则启用状态不合法：${sku}`);
    }
    if (draft.enabled && draft.amountFen === 0) {
      throw new Error("启用的提成金额必须大于 0 元");
    }

    const scope = normalizeScope(draft.scope);
    const signature = `${sku}\u0000${draft.paymentMode}\u0000${scopeKey(scope)}`;
    if (draft.enabled && signatures.has(signature)) {
      throw new Error(`提成规则冲突：${sku}`);
    }
    if (draft.enabled) signatures.add(signature);

    return {
      id: idFactory("rule"),
      sku,
      amountFen: draft.amountFen,
      paymentMode: draft.paymentMode,
      scope,
      enabled: draft.enabled,
    };
  });
};

const toRuleDrafts = (
  rules: readonly CommissionRule[],
): readonly CommissionRuleDraft[] =>
  rules.map(({ id: _id, ...rule }) => ({
    ...rule,
    scope: cloneScope(rule.scope),
  }));

const intervalEnd = (value: string | null): number =>
  value === null ? Number.POSITIVE_INFINITY : Date.parse(value);

const intervalsOverlap = (
  left: CommissionPolicyVersion,
  right: CommissionPolicyVersion,
): boolean => {
  const leftStart = Date.parse(left.effectiveFrom);
  const rightStart = Date.parse(right.effectiveFrom);
  const leftEnd = intervalEnd(left.effectiveTo);
  const rightEnd = intervalEnd(right.effectiveTo);
  if (leftEnd <= leftStart || rightEnd <= rightStart) return false;
  return leftStart < rightEnd && rightStart < leftEnd;
};

const isEffectiveAt = (
  version: CommissionPolicyVersion,
  at: Date,
): boolean => {
  const instant = at.getTime();
  return (
    Date.parse(version.effectiveFrom) <= instant &&
    instant < intervalEnd(version.effectiveTo)
  );
};

const assertValidInstant = (value: Date): void => {
  if (!Number.isFinite(value.getTime())) throw new Error("模拟时间不合法");
};

export const createCommissionRuleService = (
  options: CommissionRuleServiceOptions,
) => {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => randomUUID());

  const getVersion = async (id: string): Promise<CommissionPolicyVersion> => {
    const version = await options.repository.findVersionById(id);
    if (!version) throw new Error("提成规则版本不存在");
    return snapshotVersion(version);
  };

  const replaceVersion = async (
    current: CommissionPolicyVersion,
    next: CommissionPolicyVersion,
    audit: Omit<CommissionRuleAuditContext, "before">,
  ): Promise<CommissionPolicyVersion> => {
    const snapshot = snapshotVersion(next);
    const replaced = await options.repository.replaceVersion(
      snapshot,
      current.revision,
      { ...audit, before: snapshotVersion(current) },
    );
    if (!replaced) throw new Error("提成规则版本已被其他操作更新");
    return snapshotVersion(snapshot);
  };

  const createDraftRecord = async (
    actor: AuthenticatedUser,
    input: {
      name: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      rules: readonly CommissionRuleDraft[];
      sourceVersionId: string | null;
      reason: string;
      auditAction: "create_draft" | "copy";
    },
  ): Promise<CommissionPolicyVersion> => {
    assertValidInterval(input.effectiveFrom, input.effectiveTo);
    const rules = validateAndAssignRules(input.rules, idFactory);
    const createdAt = now().toISOString();
    const version: CommissionPolicyVersion = snapshotVersion({
      id: idFactory("policy"),
      version: await options.repository.allocateVersionNumber(),
      name: normalizeName(input.name),
      status: "draft",
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      rules,
      sourceVersionId: input.sourceVersionId,
      createdBy: actor.id,
      createdAt,
      publishedBy: null,
      publishedAt: null,
      stoppedBy: null,
      stoppedAt: null,
      changeNote: input.reason,
      revision: 1,
    });
    await options.repository.insertVersion(version, {
      action: input.auditAction,
      actorId: actor.id,
      reason: input.reason,
      at: createdAt,
      before: null,
    });
    return snapshotVersion(version);
  };

  return {
    async createDraft(
      actor: AuthenticatedUser,
      input: CreateCommissionPolicyDraftInput,
    ): Promise<CommissionPolicyVersion> {
      requireRole(actor, "admin");
      const effectiveFrom = parseShanghaiLocalDate(
        input.effectiveFrom,
        "提成规则生效日",
      );
      const effectiveTo =
        input.effectiveTo === undefined || input.effectiveTo === null
          ? null
          : parseShanghaiLocalDate(
              input.effectiveTo,
              "提成规则失效日",
            );
      return createDraftRecord(actor, {
        name: input.name,
        effectiveFrom,
        effectiveTo,
        rules: input.rules,
        sourceVersionId: null,
        reason: normalizeReason(input.reason, "创建提成规则草稿"),
        auditAction: "create_draft",
      });
    },

    async listVersions(
      actor: AuthenticatedUser,
    ): Promise<readonly CommissionPolicyVersion[]> {
      requireRole(actor, "admin");
      const versions = await options.repository.listVersions();
      return deepFreeze(
        versions
          .map(snapshotVersion)
          .sort((left, right) => right.version - left.version),
      );
    },

    async updateRule(
      actor: AuthenticatedUser,
      versionId: string,
      ruleId: string,
      input: UpdateCommissionRuleInput,
    ): Promise<CommissionPolicyVersion> {
      requireRole(actor, "admin");
      const current = await getVersion(versionId);
      if (current.status !== "draft") throw new Error("只能修改草稿版本");
      if (await options.repository.isVersionUsed(versionId)) {
        throw new Error("已产生提成快照的规则版本不可修改");
      }
      if (input.expectedRevision !== current.revision) {
        throw new Error("提成规则版本已被其他操作更新");
      }
      if (!Number.isSafeInteger(input.amountFen) || input.amountFen < 0) {
        throw new Error("提成金额必须是非负整数分");
      }
      const reason = normalizeReason(input.reason, "");
      const targetIndex = current.rules.findIndex((rule) => rule.id === ruleId);
      if (targetIndex < 0) throw new Error("提成规则不存在");
      const targetRule = current.rules[targetIndex]!;
      const nextEnabled = input.enabled ?? targetRule.enabled;
      if (nextEnabled && input.amountFen === 0) {
        throw new Error("启用的提成金额必须大于 0 元");
      }

      const rules = current.rules.map((rule, index) =>
        index === targetIndex
          ? {
              ...cloneRule(rule),
              amountFen: input.amountFen,
              enabled: nextEnabled,
            }
          : cloneRule(rule),
      );
      const changedAt = now().toISOString();
      return replaceVersion(
        current,
        {
          ...current,
          rules,
          changeNote: reason,
          revision: current.revision + 1,
        },
        {
          action: "update_draft",
          actorId: actor.id,
          reason,
          at: changedAt,
        },
      );
    },

    async publish(
      actor: AuthenticatedUser,
      id: string,
      reasonInput?: string,
    ): Promise<CommissionPolicyVersion> {
      requireRole(actor, "admin");
      const current = await getVersion(id);
      if (current.status !== "draft") throw new Error("只能发布草稿版本");
      if (await options.repository.isVersionUsed(id)) {
        throw new Error("已产生提成快照的规则版本不可修改");
      }

      const versions = await options.repository.listVersions();
      const publishedAt = now().toISOString();
      const reason = normalizeReason(reasonInput, "发布提成规则版本");
      const nonDraftVersions = versions
        .filter(
          (version) => version.id !== current.id && version.status !== "draft",
        )
        .map(snapshotVersion);
      const initialConflicts = nonDraftVersions.filter((version) =>
        intervalsOverlap(current, version),
      );
      let publishedEffectiveFrom = current.effectiveFrom;
      let predecessor: CommissionPolicyVersion | null = null;

      if (initialConflicts.length > 0) {
        const cutoverTime = Math.max(
          Date.parse(current.effectiveFrom),
          Date.parse(publishedAt),
        );
        const cutover = new Date(cutoverTime).toISOString();
        const covering = nonDraftVersions.filter(
          (version) =>
            version.status === "published" &&
            isEffectiveAt(version, new Date(cutoverTime)),
        );
        if (covering.length !== 1) {
          throw new Error("提成规则版本生效时间重叠");
        }
        predecessor = covering[0]!;
        if (cutoverTime <= Date.parse(predecessor.effectiveFrom)) {
          throw new Error("提成规则版本生效时间重叠");
        }
        publishedEffectiveFrom = cutover;
      }

      const published = snapshotVersion({
        ...current,
        status: "published",
        effectiveFrom: publishedEffectiveFrom,
        publishedBy: actor.id,
        publishedAt,
        changeNote: reason,
        revision: current.revision + 1,
      });
      assertValidInterval(published.effectiveFrom, published.effectiveTo);
      if (
        nonDraftVersions.some(
          (version) =>
            version.id !== predecessor?.id && intervalsOverlap(published, version),
        )
      ) {
        throw new Error("提成规则版本生效时间重叠");
      }

      const predecessorWrite = predecessor
        ? (() => {
            const stopped = snapshotVersion({
              ...predecessor,
              status: "stopped",
              effectiveTo: published.effectiveFrom,
              stoppedBy: actor.id,
              stoppedAt: publishedAt,
              changeNote: reason,
              revision: predecessor.revision + 1,
            });
            assertValidInterval(stopped.effectiveFrom, stopped.effectiveTo);
            return {
              version: stopped,
              expectedRevision: predecessor.revision,
              audit: {
                action: "stop" as const,
                actorId: actor.id,
                reason,
                at: publishedAt,
                before: snapshotVersion(predecessor),
              },
            };
          })()
        : undefined;
      const replaced = await options.repository.publishVersion(
        {
          version: published,
          expectedRevision: current.revision,
          audit: {
            action: "publish",
            actorId: actor.id,
            reason,
            at: publishedAt,
            before: snapshotVersion(current),
          },
        },
        predecessorWrite,
      );
      if (!replaced) throw new Error("提成规则版本已被其他操作更新");
      return snapshotVersion(published);
    },

    async stop(
      actor: AuthenticatedUser,
      id: string,
      reasonInput?: string,
    ): Promise<CommissionPolicyVersion> {
      requireRole(actor, "admin");
      const current = await getVersion(id);
      if (current.status !== "published") {
        throw new Error("只能停用已发布版本");
      }

      const stoppedAt = now().toISOString();
      const stopTime = Date.parse(stoppedAt);
      const currentEnd = intervalEnd(current.effectiveTo);
      const effectiveStart = Date.parse(current.effectiveFrom);
      const effectiveTo =
        stopTime <= effectiveStart
          ? current.effectiveFrom
          : stopTime < currentEnd
            ? stoppedAt
            : current.effectiveTo;
      const reason = normalizeReason(reasonInput, "停用提成规则版本");
      return replaceVersion(
        current,
        {
          ...current,
          status: "stopped",
          effectiveTo,
          stoppedBy: actor.id,
          stoppedAt,
          changeNote: reason,
          revision: current.revision + 1,
        },
        { action: "stop", actorId: actor.id, reason, at: stoppedAt },
      );
    },

    async copyVersion(
      actor: AuthenticatedUser,
      sourceId: string,
      overrides: CopyCommissionPolicyVersionInput = {},
    ): Promise<CommissionPolicyVersion> {
      requireRole(actor, "admin");
      const source = await getVersion(sourceId);
      const effectiveFrom = overrides.effectiveFrom
        ? parseShanghaiLocalDate(
            overrides.effectiveFrom,
            "提成规则生效日",
          )
        : source.effectiveFrom;
      const hasEffectiveToOverride = Object.prototype.hasOwnProperty.call(
        overrides,
        "effectiveTo",
      );
      const effectiveTo = hasEffectiveToOverride
        ? overrides.effectiveTo === null || overrides.effectiveTo === undefined
          ? null
          : parseShanghaiLocalDate(
              overrides.effectiveTo,
              "提成规则失效日",
            )
        : source.effectiveTo;

      return createDraftRecord(actor, {
        name: overrides.name ?? `${source.name}（副本）`,
        effectiveFrom,
        effectiveTo,
        rules: overrides.rules ?? toRuleDrafts(source.rules),
        sourceVersionId: source.id,
        reason: normalizeReason(overrides.reason, "复制提成规则版本"),
        auditAction: "copy",
      });
    },

    async simulate(
      actor: AuthenticatedUser,
      input: CommissionSimulationInput,
    ): Promise<CommissionSimulationResult> {
      requireRole(actor, "admin");
      let version: CommissionPolicyVersion;
      if (input.versionId) {
        version = await getVersion(input.versionId);
      } else {
        const at = input.at ?? now();
        assertValidInstant(at);
        const versions = (await options.repository.listVersions()).filter(
          (candidate) =>
            candidate.status !== "draft" && isEffectiveAt(candidate, at),
        );
        if (versions.length === 0) {
          throw new Error("当前时间没有生效的提成规则版本");
        }
        if (versions.length > 1) {
          throw new Error("同一时间存在多个生效的提成规则版本");
        }
        version = snapshotVersion(versions[0]!);
      }

      return deepFreeze({
        versionId: version.id,
        versionNumber: version.version,
        versionStatus: version.status,
        calculation: calculateCommission(
          input.orderLines,
          version.rules,
          input.sellerContext,
        ),
      });
    },
  };
};

export type CommissionRuleService = ReturnType<
  typeof createCommissionRuleService
>;
