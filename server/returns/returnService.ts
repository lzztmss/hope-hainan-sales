import { randomBytes } from "node:crypto";

import {
  canAccessOwnedRecord,
  requireRole,
  scopeForUser,
  type AuthenticatedUser,
  type UserScope,
} from "../auth/authorization.js";

export type ReturnableOrderStatus =
  | "pending"
  | "accepted"
  | "activated"
  | "completed"
  | "cancelled"
  | "return_pending"
  | "partially_returned"
  | "returned"
  | "voided";

export interface ReturnOrderLineRecord {
  id: string;
  lineType: "charge" | "component";
  sku: string;
  label: string;
  quantity: number;
  returnedQuantity: number;
  refundableUnitFen: number;
}

export interface ReturnOrderRecord {
  id: string;
  orderNo: string;
  sellerId: string;
  storeId: string;
  status: ReturnableOrderStatus;
  refundedFen: number;
  lines: ReturnOrderLineRecord[];
}

export interface ReturnItemRecord {
  orderLineId: string;
  orderLineQuantity: number;
  sku: string;
  label: string;
  quantity: number;
  maxRefundFen: number;
}

export type ReturnRequestStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "completed";

export interface ReturnRequestRecord {
  id: string;
  returnNo: string;
  idempotencyKey: string;
  completionIdempotencyKey: string | null;
  orderId: string;
  returnType: "full" | "partial";
  status: ReturnRequestStatus;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  completedBy: string | null;
  completedAt: Date | null;
  refundFen: number;
  maxRefundFen: number;
  items: ReturnItemRecord[];
}

export interface ReturnRequestWrite {
  returnNo: string;
  idempotencyKey: string;
  orderId: string;
  returnType: "full" | "partial";
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  maxRefundFen: number;
  items: ReturnItemRecord[];
}

export interface ReturnDecisionWrite {
  status: "approved" | "rejected";
  decidedBy: string;
  decidedAt: Date;
  decisionNote: string;
}

export interface ReturnCompletionWrite {
  completionIdempotencyKey: string;
  completedBy: string;
  completedAt: Date;
  refundFen: number;
}

export interface ReturnAuditInput {
  actorUserId: string;
  storeId: string;
  returnId: string;
  orderId: string;
  action: string;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  reason?: string;
}

export interface ReturnRepository {
  runTransaction<T>(
    work: (repository: ReturnRepository) => Promise<T>,
  ): Promise<T>;
  findByRequestIdempotencyKey(key: string): Promise<ReturnRequestRecord | null>;
  findByCompletionIdempotencyKey(
    key: string,
  ): Promise<ReturnRequestRecord | null>;
  findOrderForReturn(orderId: string): Promise<ReturnOrderRecord | null>;
  createRequest(input: ReturnRequestWrite): Promise<ReturnRequestRecord>;
  findRequestById(id: string): Promise<ReturnRequestRecord | null>;
  listRequests(
    scope: UserScope,
    filters: { orderId?: string; status?: ReturnRequestStatus },
  ): Promise<ReturnRequestRecord[]>;
  saveDecision(
    id: string,
    decision: ReturnDecisionWrite,
  ): Promise<ReturnRequestRecord>;
  completeRequest(
    id: string,
    completion: ReturnCompletionWrite,
  ): Promise<ReturnRequestRecord>;
  writeAudit(input: ReturnAuditInput): Promise<void>;
}

export interface CommissionReversalPort {
  validateReversalForCompletedReturn(
    completedReturn: ReturnRequestRecord,
  ): Promise<void>;
  reverseForCompletedReturn(completedReturn: ReturnRequestRecord): Promise<unknown>;
}

export interface ReturnServiceOptions {
  repository: ReturnRepository;
  commissionReversal: CommissionReversalPort;
  now?: () => Date;
  numberSuffix?: () => string;
}

export interface RequestReturnInput {
  type: "full" | "partial";
  reason: string;
  items: readonly { orderLineId: string; quantity: number }[];
}

const RETURNABLE_STATUSES: readonly ReturnableOrderStatus[] = [
  "activated",
  "completed",
  "partially_returned",
];

const validateIdempotencyKey = (value: string): void => {
  if (!/^[A-Za-z0-9:_-]{12,128}$/.test(value)) {
    throw new Error("退单幂等键格式不正确");
  }
};

const shanghaiDate = (value: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}`;
};

const requireScopedOrder = async (
  repository: ReturnRepository,
  actor: AuthenticatedUser,
  orderId: string,
): Promise<ReturnOrderRecord> => {
  const order = await repository.findOrderForReturn(orderId);
  if (
    !order ||
    !canAccessOwnedRecord(actor, {
      sellerId: order.sellerId,
      storeId: order.storeId,
    })
  ) {
    throw new Error("订单不存在");
  }
  return order;
};

const buildItems = (
  order: ReturnOrderRecord,
  input: RequestReturnInput,
): ReturnItemRecord[] => {
  const selections =
    input.type === "full"
      ? order.lines
          .filter(
            (line) =>
              line.lineType === "charge" &&
              line.quantity - line.returnedQuantity > 0,
          )
          .map((line) => ({
            orderLineId: line.id,
            quantity: line.quantity - line.returnedQuantity,
          }))
      : [...input.items];

  if (selections.length === 0) throw new Error("请选择至少一项退货商品");
  const seen = new Set<string>();
  return selections.map((selection) => {
    if (seen.has(selection.orderLineId)) throw new Error("退货商品不能重复");
    seen.add(selection.orderLineId);
    const line = order.lines.find((entry) => entry.id === selection.orderLineId);
    if (!line) throw new Error("退货商品不存在");
    if (line.lineType !== "charge") {
      throw new Error("套装内部物理设备不能单独退");
    }
    const remaining = line.quantity - line.returnedQuantity;
    if (
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 1 ||
      selection.quantity > remaining
    ) {
      throw new Error("退货数量超过剩余可退数量");
    }
    return {
      orderLineId: line.id,
      orderLineQuantity: line.quantity,
      sku: line.sku,
      label: line.label,
      quantity: selection.quantity,
      maxRefundFen: line.refundableUnitFen * selection.quantity,
    };
  });
};

export const createReturnService = (options: ReturnServiceOptions) => {
  const now = options.now ?? (() => new Date());
  const numberSuffix =
    options.numberSuffix ??
    (() => randomBytes(5).toString("hex").slice(0, 6).toUpperCase());

  return {
    async listReturns(
      actor: AuthenticatedUser,
      status?: ReturnRequestStatus,
    ): Promise<ReturnRequestRecord[]> {
      return options.repository.listRequests(scopeForUser(actor), { status });
    },

    async listOrderReturns(
      actor: AuthenticatedUser,
      orderId: string,
    ): Promise<ReturnRequestRecord[]> {
      await requireScopedOrder(options.repository, actor, orderId);
      return options.repository.listRequests(scopeForUser(actor), { orderId });
    },

    async requestReturn(
      actor: AuthenticatedUser,
      orderId: string,
      input: RequestReturnInput,
      idempotencyKey: string,
    ): Promise<ReturnRequestRecord> {
      validateIdempotencyKey(idempotencyKey);
      const existing =
        await options.repository.findByRequestIdempotencyKey(idempotencyKey);
      if (existing) return existing;

      return options.repository.runTransaction(async (repository) => {
        const existingInside =
          await repository.findByRequestIdempotencyKey(idempotencyKey);
        if (existingInside) return existingInside;
        const order = await requireScopedOrder(repository, actor, orderId);
        if (!RETURNABLE_STATUSES.includes(order.status)) {
          throw new Error("当前订单状态不可退单");
        }
        const reason = input.reason.trim();
        if (reason.length < 2 || reason.length > 1_000) {
          throw new Error("请填写完整退单原因");
        }
        const items = buildItems(order, input);
        const maxRefundFen = items.reduce(
          (sum, item) => sum + item.maxRefundFen,
          0,
        );
        const requestedAt = now();
        const created = await repository.createRequest({
          returnNo: `XLX-RT-${shanghaiDate(requestedAt)}-${numberSuffix()}`,
          idempotencyKey,
          orderId,
          returnType: input.type,
          reason,
          requestedBy: actor.id,
          requestedAt,
          maxRefundFen,
          items,
        });
        await repository.writeAudit({
          actorUserId: actor.id,
          storeId: order.storeId,
          returnId: created.id,
          orderId,
          action: "return.request",
          afterSnapshot: {
            returnNo: created.returnNo,
            type: created.returnType,
            status: created.status,
            maxRefundFen: created.maxRefundFen,
            items: created.items,
          },
          reason,
        });
        return created;
      });
    },

    async decideReturn(
      actor: AuthenticatedUser,
      returnId: string,
      decision: "approved" | "rejected",
      note: string,
    ): Promise<ReturnRequestRecord> {
      requireRole(actor, "store_manager", "admin");
      return options.repository.runTransaction(async (repository) => {
        const request = await repository.findRequestById(returnId);
        if (!request) throw new Error("退单不存在");
        const order = await requireScopedOrder(
          repository,
          actor,
          request.orderId,
        );
        void order;
        if (request.requestedBy === actor.id) {
          throw new Error("申请人不能审批自己的退单");
        }
        if (request.status !== "requested") throw new Error("退单已完成审批");
        const normalizedNote = note.trim();
        if (!normalizedNote) throw new Error("请填写审批意见");
        const decided = await repository.saveDecision(returnId, {
          status: decision,
          decidedBy: actor.id,
          decidedAt: now(),
          decisionNote: normalizedNote,
        });
        await repository.writeAudit({
          actorUserId: actor.id,
          storeId: order.storeId,
          returnId,
          orderId: request.orderId,
          action: `return.${decision === "approved" ? "approve" : "reject"}`,
          beforeSnapshot: { status: request.status },
          afterSnapshot: { status: decided.status, note: normalizedNote },
          reason: normalizedNote,
        });
        return decided;
      });
    },

    async completeReturn(
      actor: AuthenticatedUser,
      returnId: string,
      refundFen: number,
      idempotencyKey: string,
    ): Promise<ReturnRequestRecord> {
      requireRole(actor, "store_manager", "admin");
      validateIdempotencyKey(idempotencyKey);
      const existing =
        await options.repository.findByCompletionIdempotencyKey(idempotencyKey);
      if (existing) {
        await options.commissionReversal.reverseForCompletedReturn(existing);
        return existing;
      }

      const requestForValidation = await options.repository.findRequestById(returnId);
      if (!requestForValidation) throw new Error("退单不存在");
      await requireScopedOrder(
        options.repository,
        actor,
        requestForValidation.orderId,
      );
      if (requestForValidation.status !== "approved") {
        throw new Error("只能完成已审批的退单");
      }
      if (
        !Number.isSafeInteger(refundFen) ||
        refundFen < 0 ||
        refundFen > requestForValidation.maxRefundFen
      ) {
        throw new Error("退款金额不能超过可退金额");
      }
      const completedAt = now();
      await options.commissionReversal.validateReversalForCompletedReturn({
        ...requestForValidation,
        status: "completed",
        completedBy: actor.id,
        completedAt,
        refundFen,
      });

      const completed = await options.repository.runTransaction(async (repository) => {
        const existingInside =
          await repository.findByCompletionIdempotencyKey(idempotencyKey);
        if (existingInside) return existingInside;
        const request = await repository.findRequestById(returnId);
        if (!request) throw new Error("退单不存在");
        await requireScopedOrder(repository, actor, request.orderId);
        if (request.status !== "approved") throw new Error("只能完成已审批的退单");
        if (
          !Number.isSafeInteger(refundFen) ||
          refundFen < 0 ||
          refundFen > request.maxRefundFen
        ) {
          throw new Error("退款金额不能超过可退金额");
        }
        const completed = await repository.completeRequest(returnId, {
          completionIdempotencyKey: idempotencyKey,
          completedBy: actor.id,
          completedAt,
          refundFen,
        });
        const order = await repository.findOrderForReturn(request.orderId);
        if (!order) throw new Error("订单不存在");
        await repository.writeAudit({
          actorUserId: actor.id,
          storeId: order.storeId,
          returnId,
          orderId: request.orderId,
          action: "return.complete",
          beforeSnapshot: { status: request.status },
          afterSnapshot: { status: completed.status, refundFen },
          reason: request.reason,
        });
        return completed;
      });
      await options.commissionReversal.reverseForCompletedReturn(completed);
      return completed;
    },
  };
};

export type ReturnService = ReturnType<typeof createReturnService>;
