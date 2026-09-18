import type { AuthenticatedUser } from "../auth/authorization.js";
import type {
  SubscriptionPlanDefinition,
  SubscriptionPlanItem,
} from "../../shared/pricing/types.js";

export type SubscriptionPlanRecord = SubscriptionPlanDefinition & {
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface SubscriptionPlanWrite {
  code: string;
  name: string;
  description: string | null;
  monthlyFen: number;
  contractMonths: 36;
  active: boolean;
  items: readonly SubscriptionPlanItem[];
  createdBy: string;
  at: Date;
}

export interface SubscriptionPlanRepository {
  list(includeInactive: boolean): Promise<readonly SubscriptionPlanRecord[]>;
  findById(id: string): Promise<SubscriptionPlanRecord | null>;
  findByCode(code: string): Promise<SubscriptionPlanRecord | null>;
  create(input: SubscriptionPlanWrite): Promise<SubscriptionPlanRecord>;
  update(
    id: string,
    expectedVersion: number,
    input: SubscriptionPlanWrite,
  ): Promise<SubscriptionPlanRecord | null>;
  delete(id: string, expectedVersion: number): Promise<boolean>;
  writeAudit(input: {
    actorUserId: string;
    planId: string;
    action:
      | "subscription_plan.create"
      | "subscription_plan.update"
      | "subscription_plan.delete";
    beforeSnapshot: Record<string, unknown> | null;
    afterSnapshot: Record<string, unknown> | null;
    reason: string;
  }): Promise<void>;
}

export interface SubscriptionPlanDraft {
  code: string;
  name: string;
  description?: string | null;
  monthlyFen: number;
  active?: boolean;
  items: readonly SubscriptionPlanItem[];
  reason: string;
  expectedVersion?: number;
}

const PRODUCT_SKUS = new Set<SubscriptionPlanItem["sku"]>([
  "WATCH",
  "MATTRESS",
  "GATEWAY",
  "MOTION",
  "DOOR",
  "PORTABLE_BUTTON",
  "WALL_BUTTON",
]);

const snapshot = (record: SubscriptionPlanRecord): Record<string, unknown> => ({
  id: record.id,
  code: record.code,
  name: record.name,
  description: record.description,
  monthlyFen: record.monthlyFen,
  contractMonths: record.contractMonths,
  active: record.active,
  version: record.version,
  items: record.items.map((item) => ({ ...item })),
});

const normalizeDraft = (
  actor: AuthenticatedUser,
  draft: SubscriptionPlanDraft,
  at: Date,
): SubscriptionPlanWrite => {
  const code = draft.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(code)) {
    throw new Error("套餐编码必须为1至32位大写字母、数字、下划线或连字符");
  }
  const name = draft.name.trim();
  if (!name || name.length > 80) throw new Error("套餐名称必须为1至80个字符");
  const description = draft.description?.trim() || null;
  if (description && description.length > 500) throw new Error("套餐说明不能超过500个字符");
  if (!Number.isSafeInteger(draft.monthlyFen) || draft.monthlyFen <= 0) {
    throw new Error("套餐月费必须大于0元");
  }
  const quantities = new Map<SubscriptionPlanItem["sku"], number>();
  for (const item of draft.items) {
    if (!PRODUCT_SKUS.has(item.sku)) throw new Error(`套餐设备不合法：${item.sku}`);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
      throw new Error("套餐设备数量必须为1至20的整数");
    }
    quantities.set(item.sku, (quantities.get(item.sku) ?? 0) + item.quantity);
  }
  if (quantities.size === 0) throw new Error("套餐至少需要包含一种设备");
  return {
    code,
    name,
    description,
    monthlyFen: draft.monthlyFen,
    contractMonths: 36,
    active: draft.active ?? true,
    items: Array.from(quantities, ([sku, quantity]) => ({ sku, quantity })),
    createdBy: actor.id,
    at,
  };
};

export const createSubscriptionPlanService = (options: {
  repository: SubscriptionPlanRepository;
  now?: () => Date;
}) => {
  const now = options.now ?? (() => new Date());
  const requireAdmin = (actor: AuthenticatedUser) => {
    if (actor.role !== "admin") throw new Error("仅管理员可管理月付套餐");
  };
  return {
    async list(actor: AuthenticatedUser, includeInactive = false) {
      if (includeInactive) requireAdmin(actor);
      return options.repository.list(includeInactive);
    },
    async requireActive(planId: string): Promise<SubscriptionPlanRecord> {
      const plan = await options.repository.findById(planId);
      if (!plan || !plan.active) throw new Error("所选月付套餐不存在或已停用");
      return plan;
    },
    async create(actor: AuthenticatedUser, draft: SubscriptionPlanDraft) {
      requireAdmin(actor);
      const write = normalizeDraft(actor, draft, now());
      if (await options.repository.findByCode(write.code)) throw new Error("套餐编码已存在");
      const created = await options.repository.create(write);
      await options.repository.writeAudit({
        actorUserId: actor.id,
        planId: created.id,
        action: "subscription_plan.create",
        beforeSnapshot: null,
        afterSnapshot: snapshot(created),
        reason: draft.reason.trim() || "新增月付套餐",
      });
      return created;
    },
    async update(actor: AuthenticatedUser, id: string, draft: SubscriptionPlanDraft) {
      requireAdmin(actor);
      if (!Number.isInteger(draft.expectedVersion) || draft.expectedVersion! < 1) {
        throw new Error("套餐版本号不正确");
      }
      const current = await options.repository.findById(id);
      if (!current) throw new Error("套餐不存在");
      const write = normalizeDraft(actor, draft, now());
      const duplicate = await options.repository.findByCode(write.code);
      if (duplicate && duplicate.id !== id) throw new Error("套餐编码已存在");
      const updated = await options.repository.update(id, draft.expectedVersion!, write);
      if (!updated) throw new Error("套餐已被其他人修改，请刷新后重试");
      await options.repository.writeAudit({
        actorUserId: actor.id,
        planId: id,
        action: "subscription_plan.update",
        beforeSnapshot: snapshot(current),
        afterSnapshot: snapshot(updated),
        reason: draft.reason.trim() || "调整月付套餐",
      });
      return updated;
    },
    async delete(
      actor: AuthenticatedUser,
      id: string,
      input: { expectedVersion: number; reason: string },
    ) {
      requireAdmin(actor);
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
        throw new Error("套餐版本号不正确");
      }
      const reason = input.reason.trim();
      if (!reason) throw new Error("请填写删除原因");
      const current = await options.repository.findById(id);
      if (!current) throw new Error("套餐不存在");
      try {
        const deleted = await options.repository.delete(id, input.expectedVersion);
        if (!deleted) throw new Error("套餐已被其他人修改，请刷新后重试");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/foreign key constraint/i.test(message)) {
          throw new Error("套餐已有报价或订单使用，不能删除，请改为停用套餐");
        }
        throw error;
      }
      await options.repository.writeAudit({
        actorUserId: actor.id,
        planId: id,
        action: "subscription_plan.delete",
        beforeSnapshot: snapshot(current),
        afterSnapshot: null,
        reason,
      });
    },
  };
};

export type SubscriptionPlanService = ReturnType<typeof createSubscriptionPlanService>;
