import { randomBytes } from "node:crypto";

import { isNonReturnablePackageSku } from "../../shared/pricing/returnPolicy.js";
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
  | "signed"
  | "reconciled"
  | "paid"
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
  signedAt: Date | null;
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
  orderNo: string;
  idempotencyKey: string;
  completionIdempotencyKey: string | null;
  orderId: string;
  serviceType: "refund" | "exchange";
  returnType: "full" | "partial";
  returnKind: "normal" | "special";
  reasonCategory: "no_reason" | "quality" | "other";
  orderStatusBefore: ReturnableOrderStatus | null;
  status: ReturnRequestStatus;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  completedBy: string | null;
  completedAt: Date | null;
  requestedRefundFen: number;
  refundFen: number;
  maxRefundFen: number;
  items: ReturnItemRecord[];
}

export interface ReturnRequestWrite {
  returnNo: string;
  idempotencyKey: string;
  orderId: string;
  serviceType: "refund" | "exchange";
  returnType: "full" | "partial";
  returnKind: "normal" | "special";
  reasonCategory: "no_reason" | "quality" | "other";
  orderStatusBefore: ReturnableOrderStatus;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  requestedRefundFen: number;
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
    filters: { orderId?: string; status?: ReturnRequestStatus; serviceType?: "refund" | "exchange"; returnKind?: "normal" | "special"; storeId?: string; sellerId?: string },
    paging?: { page: number; pageSize: number },
  ): Promise<{ items: ReturnRequestRecord[]; total: number }>;
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
  serviceType?: "refund" | "exchange";
  type: "full" | "partial";
  kind?: "normal" | "special";
  reasonCategory?: "no_reason" | "quality" | "other";
  requestedRefundFen?: number;
  reason: string;
  items: readonly { orderLineId: string; quantity: number }[];
}

const RETURNABLE_STATUSES: readonly ReturnableOrderStatus[] = [
  "signed",
  "reconciled",
  "paid",
  "partially_returned",
];

const shanghaiCalendarDay = (value: Date): number => {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
  const [year, month, day] = formatted.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
};

const daysAfterSigning = (signedAt: Date, requestedAt: Date): number =>
  Math.max(0, Math.floor((shanghaiCalendarDay(requestedAt) - shanghaiCalendarDay(signedAt)) / 86_400_000));

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

  if (selections.length === 0) throw new Error("请选择至少一项售后商品");
  const seen = new Set<string>();
  return selections.map((selection) => {
    if (seen.has(selection.orderLineId)) throw new Error("售后商品不能重复");
    seen.add(selection.orderLineId);
    const line = order.lines.find((entry) => entry.id === selection.orderLineId);
    if (!line) throw new Error("售后商品不存在");
    if (line.lineType !== "charge") {
      throw new Error("套装内部物理设备不能单独退");
    }
    if (input.type === "partial" && isNonReturnablePackageSku(line.sku)) {
      throw new Error(`${line.label}属于套餐，只能随整单一起退回，不能单独或拆分退单`);
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
      filters: { status?: ReturnRequestStatus; serviceType?: "refund" | "exchange"; returnKind?: "normal" | "special"; storeId?: string; sellerId?: string; page?: number; pageSize?: number } = {},
    ) {
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 20;
      const result = await options.repository.listRequests(scopeForUser(actor), filters, { page, pageSize });
      return { ...result, page, pageSize };
    },

    async listOrderReturns(
      actor: AuthenticatedUser,
      orderId: string,
    ): Promise<ReturnRequestRecord[]> {
      await requireScopedOrder(options.repository, actor, orderId);
      return (await options.repository.listRequests(scopeForUser(actor), { orderId })).items;
    },

    async requestReturn(
      actor: AuthenticatedUser,
      orderId: string,
      input: RequestReturnInput,
      idempotencyKey: string,
    ): Promise<ReturnRequestRecord> {
      requireRole(actor, "sales", "store_manager", "regional_manager", "admin");
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
        if (!order.signedAt) throw new Error("订单尚未签收，不能申请退单");
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
        const elapsedDays = daysAfterSigning(order.signedAt, requestedAt);
        const serviceType = input.serviceType ?? "refund";
        const returnKind = input.kind ?? "normal";
        const reasonCategory = input.reasonCategory ?? "other";
        const requestedRefundFen = input.requestedRefundFen ?? 0;
        if (!Number.isSafeInteger(requestedRefundFen) || requestedRefundFen < 0) {
          throw new Error("申请退款金额不正确");
        }
        if (serviceType === "exchange" && requestedRefundFen !== 0) {
          throw new Error("换货申请不能填写退款金额");
        }
        if (returnKind === "normal" && serviceType === "refund" && elapsedDays > 7) {
          throw new Error("订单签收已超过7日，请改为特殊退货退款申请");
        }
        if (returnKind === "normal" && serviceType === "exchange" && elapsedDays > 15) {
          throw new Error("订单签收已超过15日，请改为特殊换货申请");
        }
        if (returnKind === "normal" && serviceType === "exchange" && reasonCategory !== "quality") {
          throw new Error("普通换货仅适用于产品质量问题");
        }
        const created = await repository.createRequest({
          returnNo: `XLX-RT-${shanghaiDate(requestedAt)}-${numberSuffix()}`,
          idempotencyKey,
          orderId,
          serviceType,
          returnType: input.type,
          returnKind,
          reasonCategory,
          orderStatusBefore: order.status,
          reason,
          requestedBy: actor.id,
          requestedAt,
          requestedRefundFen,
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
            serviceType: created.serviceType,
            type: created.returnType,
            kind: created.returnKind,
            reasonCategory: created.reasonCategory,
            signedElapsedDays: elapsedDays,
            requestedRefundFen: created.requestedRefundFen,
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
      requireRole(actor, "store_manager", "regional_manager", "admin");
      return options.repository.runTransaction(async (repository) => {
        const request = await repository.findRequestById(returnId);
        if (!request) throw new Error("退单不存在");
        const order = await requireScopedOrder(
          repository,
          actor,
          request.orderId,
        );
        void order;
        if (request.requestedBy === actor.id && actor.role !== "admin") {
          throw new Error("不能审批自己提交的退单，请由其他经理或管理员处理");
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
          afterSnapshot: {
            status: decided.status,
            note: normalizedNote,
            administratorSelfReview:
              actor.role === "admin" && request.requestedBy === actor.id,
          },
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
      requireRole(actor, "store_manager", "regional_manager", "admin");
      validateIdempotencyKey(idempotencyKey);
      const existing =
        await options.repository.findByCompletionIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.serviceType === "refund") {
          await options.commissionReversal.reverseForCompletedReturn(existing);
        }
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
      if (!Number.isSafeInteger(refundFen) || refundFen < 0) {
        throw new Error("实际退款金额不正确");
      }
      if (requestForValidation.serviceType === "exchange" && refundFen !== 0) {
        throw new Error("换货完成不应填写退款金额");
      }
      const completedAt = now();
      if (requestForValidation.serviceType === "refund") {
        await options.commissionReversal.validateReversalForCompletedReturn({
          ...requestForValidation,
          status: "completed",
          completedBy: actor.id,
          completedAt,
          refundFen,
        });
      }

      const completed = await options.repository.runTransaction(async (repository) => {
        const existingInside =
          await repository.findByCompletionIdempotencyKey(idempotencyKey);
        if (existingInside) return existingInside;
        const request = await repository.findRequestById(returnId);
        if (!request) throw new Error("退单不存在");
        await requireScopedOrder(repository, actor, request.orderId);
        if (request.status !== "approved") throw new Error("只能完成已审批的退单");
        if (!Number.isSafeInteger(refundFen) || refundFen < 0) {
          throw new Error("实际退款金额不正确");
        }
        if (request.serviceType === "exchange" && refundFen !== 0) {
          throw new Error("换货完成不应填写退款金额");
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
          action: request.serviceType === "exchange" ? "exchange.complete" : "return.complete",
          beforeSnapshot: { status: request.status },
          afterSnapshot: {
            status: completed.status,
            serviceType: request.serviceType,
            requestedRefundFen: request.requestedRefundFen,
            systemReferenceFen: request.maxRefundFen,
            actualRefundFen: request.serviceType === "refund" ? refundFen : 0,
            exceedsRequestedAmount:
              request.serviceType === "refund" && refundFen > request.requestedRefundFen,
            exceedsSystemReference:
              request.serviceType === "refund" && refundFen > request.maxRefundFen,
          },
          reason: request.reason,
        });
        return completed;
      });
      if (completed.serviceType === "refund") {
        await options.commissionReversal.reverseForCompletedReturn(completed);
      }
      return completed;
    },
  };
};

export type ReturnService = ReturnType<typeof createReturnService>;
