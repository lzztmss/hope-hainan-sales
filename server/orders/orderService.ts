import { randomBytes } from "node:crypto";

import type { PaymentMode, FttrKind } from "../../shared/pricing/types.js";
import {
  canAccessOwnedRecord,
  scopeForUser,
  type AuthenticatedUser,
  type UserRole,
  type UserScope,
} from "../auth/authorization.js";
import {
  nextStatusForCommand,
  type OrderCommand,
  type OrderStatus,
} from "./orderStateMachine.js";

export interface SourceOrderLine {
  quoteLineId: string | null;
  lineType: "charge" | "component";
  sku: string;
  label: string;
  unit: string;
  quantity: number;
  oneTimeUnitFen: number;
  monthlyUnitFen: number;
  oneTimeSubtotalFen: number;
  monthlySubtotalFen: number;
  locations: string[];
  reason: string | null;
}

export interface SourceQuoteForOrder {
  id: string;
  quoteNo: string;
  customerId: string;
  storeId: string;
  sellerId: string;
  status: "confirmed" | "converted" | "expired" | "lost" | "voided";
  deletedAt: Date | null;
  paymentMode: PaymentMode;
  fttrKind: FttrKind;
  fttrPlan: number | null;
  customFttrNote: string | null;
  fttrMonthlyFen: number;
  heartMonthlyFen: number;
  oneTimeFen: number;
  monthlyTotalFen: number;
  contract36Fen: number;
  catalogVersion: string;
  customerSnapshot: Record<string, unknown>;
  quoteSnapshot: Record<string, unknown>;
  storeSnapshot: Record<string, unknown>;
  sellerSnapshot: Record<string, unknown>;
  lines: SourceOrderLine[];
}

export interface AttributionCandidate {
  id: string;
  storeId: string | null;
  workNo: string;
  displayName: string;
  role: UserRole;
  personnelType: "unicom" | "auxiliary" | "admin";
  active: boolean;
}

export interface OrderAttributionInput {
  beneficiaryId: string;
  attributionRole: "primary" | "collaborator";
  basisPoints: number;
}

export interface OrderAttributionRecord extends OrderAttributionInput {
  beneficiarySnapshot: Record<string, unknown>;
}

export interface OrderLineRecord extends SourceOrderLine {
  id: string | null;
  lineSnapshot: Record<string, unknown>;
}

export interface OrderWriteRecord {
  orderNo: string;
  idempotencyKey: string;
  quoteId: string;
  customerId: string;
  storeId: string;
  sellerId: string;
  status: OrderStatus;
  paymentMode: PaymentMode;
  fttrKind: FttrKind;
  fttrPlan: number | null;
  customFttrNote: string | null;
  fttrMonthlyFen: number;
  heartMonthlyFen: number;
  oneTimeFen: number;
  monthlyTotalFen: number;
  contract36Fen: number;
  catalogVersion: string;
  catalogSnapshot: Record<string, unknown>;
  customerSnapshot: Record<string, unknown>;
  quoteSnapshot: Record<string, unknown>;
  storeSnapshot: Record<string, unknown>;
  sellerSnapshot: Record<string, unknown>;
  createdBy: string;
}

export interface OrderRecord extends OrderWriteRecord {
  id: string;
  refundedFen: number;
  acceptedAt: Date | null;
  activatedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  deletedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lines: OrderLineRecord[];
  attributions: OrderAttributionRecord[];
}

export interface OrderListFilters {
  orderNo?: string;
  customerPhoneTail?: string;
  storeQuery?: string;
  sellerQuery?: string;
  status?: OrderStatus;
  paymentMode?: PaymentMode;
  fttrKind?: FttrKind;
  fttrPlan?: number;
  roomType?: string;
  productSku?: string;
  dateFrom?: Date;
  dateTo?: Date;
  cursor?: string;
  limit: number;
  deletedOnly?: boolean;
}

export interface OrderListResult {
  items: OrderRecord[];
  nextCursor: string | null;
}

export interface OrderFilterOptions {
  stores: Array<{ id: string; label: string }>;
  sellers: Array<{ id: string; label: string; storeId: string }>;
}

export interface OrderAuditInput {
  actorUserId: string;
  storeId: string | null;
  orderId: string;
  action: string;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  reason?: string;
}

export interface OrderRepository {
  runTransaction<T>(
    work: (repository: OrderRepository) => Promise<T>,
  ): Promise<T>;
  findByIdempotencyKey(key: string): Promise<OrderRecord | null>;
  findByQuoteId(quoteId: string): Promise<OrderRecord | null>;
  findSourceQuoteForUpdate(
    quoteId: string,
    scope: UserScope,
  ): Promise<SourceQuoteForOrder | null>;
  findAttributionCandidates(ids: string[]): Promise<AttributionCandidate[]>;
  createOrder(
    input: OrderWriteRecord,
    lines: OrderLineRecord[],
    attributions: OrderAttributionRecord[],
  ): Promise<OrderRecord>;
  markQuoteConverted(quoteId: string): Promise<void>;
  findById(id: string, scope: UserScope): Promise<OrderRecord | null>;
  transition(
    id: string,
    expectedVersion: number,
    status: OrderStatus,
    at: Date,
  ): Promise<OrderRecord | null>;
  setDeletedAt(
    id: string,
    expectedVersion: number,
    deletedAt: Date | null,
  ): Promise<OrderRecord | null>;
  hasCommissionLedger(orderId: string): Promise<boolean>;
  list(scope: UserScope, filters: OrderListFilters): Promise<OrderListResult>;
  listFilterOptions(scope: UserScope): Promise<OrderFilterOptions>;
  writeAudit(input: OrderAuditInput): Promise<void>;
}

export class OrderServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "OrderServiceError";
  }
}

export interface OrderServiceOptions {
  repository: OrderRepository;
  activeCatalogVersion: string;
  commissionAccrual: {
    accrueForActivatedOrder(orderId: string, eventKey: string): Promise<unknown>;
  };
  now?: () => Date;
  randomSuffix?: () => string;
  decryptPii?: (value: string) => string;
}

const validateIdempotencyKey = (value: string): void => {
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(value)) {
    throw new OrderServiceError("幂等键格式不正确", 400);
  }
};

const formatShanghaiDate = (value: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
};

const snapshotString = (
  snapshot: Record<string, unknown>,
  key: string,
): string | null => {
  const value = snapshot[key];
  return typeof value === "string" ? value : null;
};

const snapshotNumber = (
  snapshot: Record<string, unknown>,
  key: string,
): number | null => {
  const value = snapshot[key];
  return typeof value === "number" ? value : null;
};

const canSee = (user: AuthenticatedUser, record: OrderRecord): boolean =>
  canAccessOwnedRecord(user, {
    sellerId: record.sellerId,
    storeId: record.storeId,
  });

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "23505" || String(error.code).startsWith("SQLITE_CONSTRAINT"));

const presentOrder = (
  order: OrderRecord,
  decryptPii?: (value: string) => string,
) => {
  const decryptSnapshot = (key: string): string | null => {
    const encrypted = snapshotString(order.customerSnapshot, key);
    if (!encrypted || !decryptPii) return null;
    try {
      return decryptPii(encrypted);
    } catch {
      return null;
    }
  };
  const customerName = decryptSnapshot("nameEncrypted") ?? "客户";
  return {
    id: order.id,
    orderNo: order.orderNo,
    quoteId: order.quoteId,
    sellerId: order.sellerId,
    storeId: order.storeId,
    status: order.status,
    paymentMode: order.paymentMode,
    fttrKind: order.fttrKind,
    fttrPlan: order.fttrPlan,
    customFttrNote: order.customFttrNote,
    fttrMonthlyFen: order.fttrMonthlyFen,
    heartMonthlyFen: order.heartMonthlyFen,
    oneTimeFen: order.oneTimeFen,
    monthlyTotalFen: order.monthlyTotalFen,
    contract36Fen: order.contract36Fen,
    refundedFen: order.refundedFen,
    customer: {
      name: customerName,
      phoneMasked:
        snapshotString(order.customerSnapshot, "phoneMasked") ?? "***********",
      address: decryptSnapshot("addressEncrypted"),
      roomType: snapshotString(order.customerSnapshot, "roomType"),
      elderCount: snapshotNumber(order.customerSnapshot, "elderCount"),
    },
    storeSnapshot: structuredClone(order.storeSnapshot),
    sellerSnapshot: structuredClone(order.sellerSnapshot),
    lines: order.lines,
    attributions: order.attributions,
    acceptedAt: order.acceptedAt,
    activatedAt: order.activatedAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    deletedAt: order.deletedAt,
    version: order.version,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};

export const createOrderService = (options: OrderServiceOptions) => {
  const now = options.now ?? (() => new Date());
  const randomSuffix =
    options.randomSuffix ??
    (() => randomBytes(5).toString("hex").slice(0, 6).toUpperCase());

  const requireVisibleOrder = async (
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderRecord> => {
    const order = await options.repository.findById(orderId, scopeForUser(user));
    if (!order || !canSee(user, order)) {
      throw new OrderServiceError("订单不存在", 404);
    }
    return order;
  };

  const requireVisibleExistingOrder = (
    user: AuthenticatedUser,
    order: OrderRecord,
  ): OrderRecord => {
    if (!canSee(user, order)) {
      throw new OrderServiceError("订单不存在", 404);
    }
    return order;
  };

  const buildAttributions = async (
    repository: OrderRepository,
    quote: SourceQuoteForOrder,
    requested?: OrderAttributionInput[],
  ): Promise<OrderAttributionRecord[]> => {
    const normalized =
      requested && requested.length > 0
        ? requested.map((entry) => ({ ...entry }))
        : [
            {
              beneficiaryId: quote.sellerId,
              attributionRole: "primary" as const,
              basisPoints: 10_000,
            },
          ];
    const ids = normalized.map((entry) => entry.beneficiaryId);
    if (new Set(ids).size !== ids.length) {
      throw new OrderServiceError("销售归属人员不能重复", 400);
    }
    if (
      normalized.some(
        (entry) =>
          !Number.isInteger(entry.basisPoints) ||
          entry.basisPoints < 1 ||
          entry.basisPoints > 10_000,
      )
    ) {
      throw new OrderServiceError("销售归属比例必须为有效bp整数", 400);
    }
    if (normalized.reduce((sum, entry) => sum + entry.basisPoints, 0) !== 10_000) {
      throw new OrderServiceError("销售归属比例合计必须为10000bp", 400);
    }
    const primary = normalized.filter(
      (entry) => entry.attributionRole === "primary",
    );
    if (primary.length !== 1 || primary[0]?.beneficiaryId !== quote.sellerId) {
      throw new OrderServiceError("主销售员必须为报价归属销售员", 400);
    }

    const candidates = await repository.findAttributionCandidates(ids);
    const candidateById = new Map(candidates.map((entry) => [entry.id, entry]));
    return normalized.map((entry) => {
      const candidate = candidateById.get(entry.beneficiaryId);
      if (
        !candidate ||
        !candidate.active ||
        candidate.role !== "sales" ||
        candidate.storeId !== quote.storeId
      ) {
        throw new OrderServiceError("销售归属人员无效或不属于本营业厅", 400);
      }
      return {
        ...entry,
        beneficiarySnapshot: {
          workNo: candidate.workNo,
          displayName: candidate.displayName,
          personnelType: candidate.personnelType,
          storeId: candidate.storeId,
        },
      };
    });
  };

  return {
    async createOrderFromQuote(
      user: AuthenticatedUser,
      quoteId: string,
      attributions: OrderAttributionInput[] | undefined,
      idempotencyKey: string,
    ): Promise<OrderRecord> {
      validateIdempotencyKey(idempotencyKey);
      const userScope = scopeForUser(user);
      const existing =
        await options.repository.findByIdempotencyKey(idempotencyKey);
      if (existing) return requireVisibleExistingOrder(user, existing);

      try {
        return await options.repository.runTransaction(async (repository) => {
        const existingInside =
          await repository.findByIdempotencyKey(idempotencyKey);
        if (existingInside) return requireVisibleExistingOrder(user, existingInside);

        const quote = await repository.findSourceQuoteForUpdate(
          quoteId,
          userScope,
        );
        if (
          !quote ||
          quote.deletedAt ||
          !canAccessOwnedRecord(user, {
            sellerId: quote.sellerId,
            storeId: quote.storeId,
          })
        ) {
          throw new OrderServiceError("报价单不存在", 404);
        }

        const existingForQuote = await repository.findByQuoteId(quote.id);
        if (existingForQuote) {
          return requireVisibleExistingOrder(user, existingForQuote);
        }
        if (quote.status !== "confirmed") {
          throw new OrderServiceError("当前报价不能转为订单", 409);
        }
        if (quote.catalogVersion !== options.activeCatalogVersion) {
          throw new OrderServiceError("报价价格版本已变更，请重新预览并确认报价", 409);
        }

        const attributionRecords = await buildAttributions(
          repository,
          quote,
          attributions,
        );
        const createdAt = now();
        const lineRecords = quote.lines.map((line) => ({
          id: null,
          ...structuredClone(line),
          lineSnapshot: structuredClone(line) as unknown as Record<
            string,
            unknown
          >,
        }));
        const created = await repository.createOrder(
          {
            orderNo: `XLXDD-${formatShanghaiDate(createdAt)}-${randomSuffix()}`,
            idempotencyKey,
            quoteId: quote.id,
            customerId: quote.customerId,
            storeId: quote.storeId,
            sellerId: quote.sellerId,
            status: "pending",
            paymentMode: quote.paymentMode,
            fttrKind: quote.fttrKind,
            fttrPlan: quote.fttrPlan,
            customFttrNote: quote.customFttrNote,
            fttrMonthlyFen: quote.fttrMonthlyFen,
            heartMonthlyFen: quote.heartMonthlyFen,
            oneTimeFen: quote.oneTimeFen,
            monthlyTotalFen: quote.monthlyTotalFen,
            contract36Fen: quote.contract36Fen,
            catalogVersion: quote.catalogVersion,
            catalogSnapshot: {
              catalogVersion: quote.catalogVersion,
              pricingInput: structuredClone(quote.quoteSnapshot.pricingInput),
              calculation: structuredClone(quote.quoteSnapshot.calculation),
            },
            customerSnapshot: structuredClone(quote.customerSnapshot),
            quoteSnapshot: structuredClone(quote.quoteSnapshot),
            storeSnapshot: structuredClone(quote.storeSnapshot),
            sellerSnapshot: structuredClone(quote.sellerSnapshot),
            createdBy: user.id,
          },
          lineRecords,
          attributionRecords,
        );
        await repository.markQuoteConverted(quote.id);
        await repository.writeAudit({
          actorUserId: user.id,
          storeId: quote.storeId,
          orderId: created.id,
          action: "order.create",
          afterSnapshot: {
            orderNo: created.orderNo,
            quoteId: quote.id,
            sellerId: quote.sellerId,
            attributionBasisPoints: attributionRecords.map((entry) => ({
              beneficiaryId: entry.beneficiaryId,
              role: entry.attributionRole,
              basisPoints: entry.basisPoints,
            })),
          },
        });
          return created;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const winner =
            await options.repository.findByIdempotencyKey(idempotencyKey);
          if (winner) return requireVisibleExistingOrder(user, winner);
        }
        throw error;
      }
    },

    async transitionOrder(
      user: AuthenticatedUser,
      orderId: string,
      command: OrderCommand,
      expectedVersion: number,
    ): Promise<OrderRecord> {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new OrderServiceError("订单版本号无效", 400);
      }
      const order = await requireVisibleOrder(user, orderId);
      if (order.deletedAt) {
        throw new OrderServiceError("回收站中的订单不能变更状态", 409);
      }
      if (command === "ACTIVATE" && order.status === "activated") {
        if (user.role !== "store_manager" && user.role !== "admin") {
          throw new OrderServiceError("不允许的订单状态变更", 400);
        }
        await options.commissionAccrual.accrueForActivatedOrder(
          order.id,
          `activation:${order.id}`,
        );
        return order;
      }
      if (order.version !== expectedVersion) {
        throw new OrderServiceError("订单已被其他操作更新，请刷新后重试", 409);
      }
      let nextStatus: OrderStatus;
      try {
        nextStatus = nextStatusForCommand(order.status, command, user.role);
      } catch (error) {
        throw new OrderServiceError(
          error instanceof Error ? error.message : "不允许的订单状态变更",
          400,
        );
      }
      const changedAt = now();
      const updated = await options.repository.transition(
        order.id,
        expectedVersion,
        nextStatus,
        changedAt,
      );
      if (!updated) {
        throw new OrderServiceError("订单已被其他操作更新，请刷新后重试", 409);
      }
      await options.repository.writeAudit({
        actorUserId: user.id,
        storeId: order.storeId,
        orderId: order.id,
        action: `order.${command.toLowerCase()}`,
        beforeSnapshot: { status: order.status, version: expectedVersion },
        afterSnapshot: { status: nextStatus, version: updated.version },
      });
      if (nextStatus === "activated") {
        await options.commissionAccrual.accrueForActivatedOrder(
          updated.id,
          `activation:${updated.id}`,
        );
      }
      return updated;
    },

    async softDeleteOrder(
      user: AuthenticatedUser,
      orderId: string,
    ): Promise<OrderRecord> {
      const order = await requireVisibleOrder(user, orderId);
      if (order.deletedAt) return order;
      if (order.status !== "pending" && order.status !== "accepted") {
        throw new OrderServiceError("已生效或已处理订单不能删除", 409);
      }
      if (await options.repository.hasCommissionLedger(order.id)) {
        throw new OrderServiceError("已产生提成台账的订单不能删除", 409);
      }
      const deletedAt = now();
      const updated = await options.repository.setDeletedAt(
        order.id,
        order.version,
        deletedAt,
      );
      if (!updated) {
        throw new OrderServiceError("订单已被其他操作更新，请刷新后重试", 409);
      }
      await options.repository.writeAudit({
        actorUserId: user.id,
        storeId: order.storeId,
        orderId: order.id,
        action: "order.delete",
        beforeSnapshot: { deletedAt: null, version: order.version },
        afterSnapshot: { deletedAt, version: updated.version },
      });
      return updated;
    },

    async restoreOrder(
      user: AuthenticatedUser,
      orderId: string,
    ): Promise<OrderRecord> {
      if (user.role !== "store_manager" && user.role !== "admin") {
        throw new OrderServiceError("无权恢复订单", 403);
      }
      const order = await requireVisibleOrder(user, orderId);
      if (!order.deletedAt) return order;
      if (order.status !== "pending" && order.status !== "accepted") {
        throw new OrderServiceError("该订单不能从回收站恢复", 409);
      }
      const updated = await options.repository.setDeletedAt(
        order.id,
        order.version,
        null,
      );
      if (!updated) {
        throw new OrderServiceError("订单已被其他操作更新，请刷新后重试", 409);
      }
      await options.repository.writeAudit({
        actorUserId: user.id,
        storeId: order.storeId,
        orderId: order.id,
        action: "order.restore",
        beforeSnapshot: { deletedAt: order.deletedAt, version: order.version },
        afterSnapshot: { deletedAt: null, version: updated.version },
      });
      return updated;
    },

    async getOrder(user: AuthenticatedUser, orderId: string) {
      return presentOrder(
        await requireVisibleOrder(user, orderId),
        options.decryptPii,
      );
    },

    async listOrders(
      user: AuthenticatedUser,
      filters: OrderListFilters,
    ) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 100) {
        throw new OrderServiceError("分页大小必须为1至100", 400);
      }
      const result = await options.repository.list(scopeForUser(user), {
        ...filters,
        deletedOnly: false,
      });
      return {
        items: result.items.map((order) => presentOrder(order, options.decryptPii)),
        nextCursor: result.nextCursor,
      };
    },

    async listFilterOptions(user: AuthenticatedUser) {
      return options.repository.listFilterOptions(scopeForUser(user));
    },

    async listRecycleBin(
      user: AuthenticatedUser,
      filters: OrderListFilters,
    ) {
      const result = await options.repository.list(scopeForUser(user), {
        ...filters,
        deletedOnly: true,
      });
      return {
        items: result.items.map((order) => presentOrder(order, options.decryptPii)),
        nextCursor: result.nextCursor,
      };
    },
  };
};

export type OrderService = ReturnType<typeof createOrderService>;
