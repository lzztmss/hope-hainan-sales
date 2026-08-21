import { calculateCommission } from "../../shared/commission/commissionEngine.js";
import type {
  CommissionCalculation,
  CommissionOrderLine,
  CommissionRule,
} from "../../shared/commission/types.js";
import type { PaymentMode } from "../../shared/pricing/types.js";
import {
  scopeForUser,
  type AuthenticatedUser,
  type UserScope,
} from "../auth/authorization.js";
import type { CommissionPolicyForAccrual } from "./ledgerService.js";

export type DashboardLedgerEntryType =
  | "accrual"
  | "return_reversal"
  | "manual_positive"
  | "manual_negative";

export type DashboardSettlementStatus = "draft" | "approved" | "paid";

export interface DashboardLedgerRecord {
  id: string;
  orderId: string | null;
  orderNo: string | null;
  orderStatus: string | null;
  customerNameEncrypted: string | null;
  customerPhoneTail: string | null;
  customerSnapshot: Record<string, unknown> | null;
  beneficiaryId: string;
  beneficiaryName: string;
  storeId: string | null;
  entryType: DashboardLedgerEntryType;
  eventKey: string;
  amountFen: number;
  reason: string | null;
  occurredAt: Date;
  ruleId: string | null;
  ruleSku: string | null;
  ruleName: string | null;
  activatedAt: Date | null;
  orderCreatedAt: Date | null;
  calculationSnapshot: Record<string, unknown> | null;
  settlementStatus: DashboardSettlementStatus | null;
  settlementAmountFen: number | null;
  paidAt: Date | null;
}

export interface EstimatedCommissionAttribution {
  beneficiaryId: string;
  role: "primary" | "collaborator";
  basisPoints: number;
}

export interface EstimatedCommissionOrder {
  id: string;
  orderNo: string;
  status: "pending" | "accepted";
  storeId: string;
  sellerId: string;
  paymentMode: PaymentMode;
  personnelType: "unicom" | "auxiliary" | "admin";
  customerNameEncrypted: string | null;
  customerPhoneTail: string | null;
  customerSnapshot: Record<string, unknown>;
  createdAt: Date;
  lines: readonly CommissionOrderLine[];
  attributions: readonly EstimatedCommissionAttribution[];
}

export interface MissingCommissionOrder {
  id: string;
  orderNo: string;
  customerNameEncrypted: string | null;
  customerPhoneTail: string | null;
  customerSnapshot: Record<string, unknown>;
  activatedAt: Date;
}

export interface CommissionDashboardRepositoryFilters {
  storeId?: string;
  beneficiaryId?: string;
  orderId?: string;
}

export interface CommissionDashboardRepository {
  listLedger(
    scope: UserScope,
    filters: CommissionDashboardRepositoryFilters,
  ): Promise<readonly DashboardLedgerRecord[]>;
  listEstimatedOrders(
    scope: UserScope,
    filters: CommissionDashboardRepositoryFilters,
  ): Promise<readonly EstimatedCommissionOrder[]>;
  listMissingAccrualOrders(
    scope: UserScope,
    filters: CommissionDashboardRepositoryFilters,
  ): Promise<readonly MissingCommissionOrder[]>;
  findEffectivePolicy(at: Date): Promise<CommissionPolicyForAccrual | null>;
}

export interface CommissionDashboardFilters {
  month?: string;
  storeId?: string;
  beneficiaryId?: string;
  cursor?: string;
  limit?: number;
  page?: number;
}

export interface CommissionDashboardSummary {
  estimatedFen: number;
  accruedNetFen: number;
  pendingSettlementFen: number;
  pendingPaymentFen: number;
  paidThisMonthFen: number;
  paidLifetimeFen: number;
  reversedLifetimeFen: number;
  netLifetimeFen: number;
}

export interface CommissionDashboardOrderLine {
  sku: string;
  label: string;
  quantity: number;
  unitCommissionFen: number;
  subtotalFen: number;
}

export interface CommissionDashboardLedgerEntry {
  id: string;
  beneficiaryId: string;
  beneficiaryName: string;
  entryType: DashboardLedgerEntryType;
  amountFen: number;
  reason: string | null;
  occurredAt: string;
  settlementStatus: "unsettled" | DashboardSettlementStatus;
}

export interface CommissionDashboardOrder {
  orderId: string;
  orderNo: string;
  customerMasked: string;
  activatedAt: string;
  status: "estimated" | "accrued" | "settled" | "paid" | "reversed" | "exception";
  statusLabel: string;
  amountFen: number;
  lines: CommissionDashboardOrderLine[];
  ledgerEntries: CommissionDashboardLedgerEntry[];
}

export interface CommissionDashboard {
  periodLabel: string;
  summary: CommissionDashboardSummary;
  orders: CommissionDashboardOrder[];
  unconfiguredOrders: number;
  nextCursor: string | null;
  total: number;
  page: number;
  pageSize: number;
}

export class CommissionDashboardError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "CommissionDashboardError";
  }
}

export interface CommissionDashboardServiceOptions {
  repository: CommissionDashboardRepository;
  now?: () => Date;
  decryptPii?: (encrypted: string) => string;
}

interface Period {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

interface PresentedOrder extends CommissionDashboardOrder {
  sortAt: Date;
}

interface SnapshotItem {
  sku: string;
  label: string;
  quantity: number;
  ruleId: string;
  unitAmountFen: number;
  subtotalFen: number;
}

const MONEY_ENTRY_TYPES: readonly DashboardLedgerEntryType[] = [
  "accrual",
  "return_reversal",
  "manual_positive",
  "manual_negative",
];

const assertFen = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value)) {
    throw new CommissionDashboardError(`${label}不是安全的分整数`, 500);
  }
  return value;
};

const addFen = (left: number, right: number, label: string): number =>
  assertFen(left + assertFen(right, label), label);

const snapshotString = (
  snapshot: Record<string, unknown> | null,
  key: string,
): string | null => {
  const value = snapshot?.[key];
  return typeof value === "string" ? value : null;
};

const currentShanghaiMonth = (now: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("无法确定当前月份");
  return `${year}-${month}`;
};

const formatShanghaiDateTime = (value: Date): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
};

const parsePeriod = (month: string): Period => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new CommissionDashboardError("提成月份格式不正确", 400);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 2020 || year > 2100) {
    throw new CommissionDashboardError("提成月份超出可查询范围", 400);
  }
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const two = (value: number) => String(value).padStart(2, "0");
  return {
    key: month,
    label: `${year}年${monthNumber}月`,
    start: new Date(`${year}-${two(monthNumber)}-01T00:00:00+08:00`),
    end: new Date(`${nextYear}-${two(nextMonth)}-01T00:00:00+08:00`),
  };
};

const normalizeFilters = (
  user: AuthenticatedUser,
  filters: CommissionDashboardFilters,
): { scope: UserScope; repository: CommissionDashboardRepositoryFilters } => {
  const scope = scopeForUser(user);
  if (scope.kind === "region") {
    throw new CommissionDashboardError("大区经理提成功能暂未开放", 403);
  }
  if (scope.kind === "seller") {
    if (filters.storeId && filters.storeId !== scope.storeId) {
      throw new CommissionDashboardError("无权查询其他营业厅提成", 403);
    }
    if (filters.beneficiaryId && filters.beneficiaryId !== scope.sellerId) {
      throw new CommissionDashboardError("无权查询其他销售员提成", 403);
    }
    return {
      scope,
      repository: {
        storeId: scope.storeId,
        beneficiaryId: scope.sellerId,
      },
    };
  }
  if (scope.kind === "store") {
    if (filters.storeId && filters.storeId !== scope.storeId) {
      throw new CommissionDashboardError("无权查询其他营业厅提成", 403);
    }
    return {
      scope,
      repository: {
        storeId: scope.storeId,
        beneficiaryId: filters.beneficiaryId,
      },
    };
  }
  return {
    scope,
    repository: {
      storeId: filters.storeId,
      beneficiaryId: filters.beneficiaryId,
    },
  };
};

const splitAmount = (
  amountFen: number,
  attributions: readonly EstimatedCommissionAttribution[],
): ReadonlyMap<string, number> => {
  assertFen(amountFen, "预计提成");
  if (attributions.length === 0) {
    throw new CommissionDashboardError("订单缺少销售归属", 500);
  }
  const primary = attributions.find((entry) => entry.role === "primary");
  if (!primary || attributions.filter((entry) => entry.role === "primary").length !== 1) {
    throw new CommissionDashboardError("订单主销售归属不完整", 500);
  }
  const seen = new Set<string>();
  let totalBasisPoints = 0;
  let allocated = 0;
  const result = new Map<string, number>();
  for (const attribution of attributions) {
    if (
      seen.has(attribution.beneficiaryId) ||
      !Number.isInteger(attribution.basisPoints) ||
      attribution.basisPoints < 1 ||
      attribution.basisPoints > 10_000
    ) {
      throw new CommissionDashboardError("订单销售归属比例不合法", 500);
    }
    seen.add(attribution.beneficiaryId);
    totalBasisPoints += attribution.basisPoints;
    if (attribution.role !== "primary") {
      const share = Math.floor((amountFen * attribution.basisPoints) / 10_000);
      result.set(attribution.beneficiaryId, share);
      allocated = addFen(allocated, share, "预计提成分配");
    }
  }
  if (totalBasisPoints !== 10_000) {
    throw new CommissionDashboardError("订单销售归属比例合计必须为10000bp", 500);
  }
  result.set(primary.beneficiaryId, amountFen - allocated);
  return result;
};

const selectedAmount = (
  amountFen: number,
  attributions: readonly EstimatedCommissionAttribution[],
  beneficiaryId?: string,
): number => {
  if (!beneficiaryId) return amountFen;
  return splitAmount(amountFen, attributions).get(beneficiaryId) ?? 0;
};

const selectedCalculationAmount = (
  calculation: CommissionCalculation,
  attributions: readonly EstimatedCommissionAttribution[],
  beneficiaryId?: string,
): number => {
  if (!beneficiaryId) return calculation.totalFen;
  const amountByRule = new Map<string, number>();
  for (const item of calculation.items) {
    amountByRule.set(
      item.ruleId,
      addFen(
        amountByRule.get(item.ruleId) ?? 0,
        item.subtotalFen,
        "预计提成规则小计",
      ),
    );
  }
  let selectedFen = 0;
  for (const amountFen of amountByRule.values()) {
    selectedFen = addFen(
      selectedFen,
      selectedAmount(amountFen, attributions, beneficiaryId),
      "预计提成分配合计",
    );
  }
  return selectedFen;
};

const maskCustomer = (
  encryptedName: string | null,
  phoneTail: string | null,
  snapshot: Record<string, unknown> | null,
  decryptPii?: (encrypted: string) => string,
): string => {
  let maskedName = "客户";
  if (encryptedName && decryptPii) {
    try {
      const name = decryptPii(encryptedName).trim();
      if (name) maskedName = `${Array.from(name)[0]}**`;
    } catch {
      maskedName = "客户";
    }
  }
  const phoneMasked =
    snapshotString(snapshot, "phoneMasked") ??
    (phoneTail ? `*******${phoneTail}` : "***********");
  return `${maskedName} · ${phoneMasked}`;
};

const parseSnapshotItems = (
  snapshot: Record<string, unknown> | null,
): SnapshotItem[] => {
  const calculation = snapshot?.calculation;
  if (!calculation || typeof calculation !== "object") return [];
  const items = (calculation as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((candidate): SnapshotItem[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.sku !== "string" ||
      typeof item.label !== "string" ||
      typeof item.ruleId !== "string" ||
      !Number.isInteger(item.quantity) ||
      !Number.isSafeInteger(item.unitAmountFen) ||
      !Number.isSafeInteger(item.subtotalFen)
    ) {
      return [];
    }
    return [
      {
        sku: item.sku,
        label: item.label,
        quantity: item.quantity as number,
        ruleId: item.ruleId,
        unitAmountFen: item.unitAmountFen as number,
        subtotalFen: item.subtotalFen as number,
      },
    ];
  });
};

const hasUnconfiguredSnapshot = (
  snapshot: Record<string, unknown> | null,
): boolean => {
  const calculation = snapshot?.calculation;
  if (!calculation || typeof calculation !== "object") return false;
  const unconfigured = (calculation as { unconfigured?: unknown }).unconfigured;
  return Array.isArray(unconfigured) && unconfigured.length > 0;
};

const ledgerLineLabel = (
  row: DashboardLedgerRecord,
  baseLabel: string,
): string => {
  if (row.entryType === "return_reversal") return `${baseLabel}（退单冲回）`;
  if (row.entryType === "manual_positive") return `${baseLabel}（人工增加）`;
  if (row.entryType === "manual_negative") return `${baseLabel}（人工扣减）`;
  return baseLabel;
};

const linesForLedgerRows = (
  rows: readonly DashboardLedgerRecord[],
): CommissionDashboardOrderLine[] => {
  const groups = new Map<string, DashboardLedgerRecord[]>();
  for (const row of rows) {
    const key = [row.entryType, row.eventKey, row.ruleId ?? "", row.reason ?? ""].join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => {
    const first = group[0]!;
    const subtotalFen = group.reduce(
      (sum, row) => addFen(sum, row.amountFen, "订单提成明细"),
      0,
    );
    const snapshotItems = parseSnapshotItems(first.calculationSnapshot).filter(
      (item) => item.ruleId === first.ruleId,
    );
    const baseQuantity = snapshotItems.reduce((sum, item) => sum + item.quantity, 0);
    const baseLabel =
      snapshotItems[0]?.label ??
      first.ruleName ??
      first.ruleSku ??
      (first.entryType.startsWith("manual") ? "人工提成调整" : "订单提成");
    let quantity = first.entryType === "accrual" && baseQuantity > 0 ? baseQuantity : 1;
    if (subtotalFen % quantity !== 0) quantity = 1;
    return {
      sku: first.ruleSku ?? first.entryType.toUpperCase(),
      label: ledgerLineLabel(first, baseLabel),
      quantity,
      unitCommissionFen: subtotalFen / quantity,
      subtotalFen,
    };
  });
};

const ledgerOrderStatus = (
  rows: readonly DashboardLedgerRecord[],
): Pick<CommissionDashboardOrder, "status" | "statusLabel"> => {
  if (rows.some((row) => row.entryType === "return_reversal")) {
    return { status: "reversed", statusLabel: "含退单冲回 · 当前净额" };
  }
  if (rows.some((row) => row.settlementStatus === null || row.settlementStatus === "draft")) {
    return { status: "accrued", statusLabel: "已计提 · 待结算" };
  }
  if (rows.some((row) => row.settlementStatus === "approved")) {
    return { status: "settled", statusLabel: "已结算 · 待发放" };
  }
  return { status: "paid", statusLabel: "已发放" };
};

const presentLedgerOrders = (
  rows: readonly DashboardLedgerRecord[],
  decryptPii?: (encrypted: string) => string,
): PresentedOrder[] => {
  const byOrder = new Map<string, DashboardLedgerRecord[]>();
  for (const row of rows) {
    if (!row.orderId) continue;
    const group = byOrder.get(row.orderId) ?? [];
    group.push(row);
    byOrder.set(row.orderId, group);
  }
  return Array.from(byOrder.entries()).map(([orderId, group]) => {
    const sorted = [...group].sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    );
    const first = sorted[0]!;
    const sortAt = sorted.reduce(
      (latest, row) => (row.occurredAt > latest ? row.occurredAt : latest),
      first.occurredAt,
    );
    const amountFen = sorted.reduce(
      (sum, row) => addFen(sum, row.amountFen, "订单提成净额"),
      0,
    );
    return {
      orderId,
      orderNo: first.orderNo ?? orderId,
      customerMasked: maskCustomer(
        first.customerNameEncrypted,
        first.customerPhoneTail,
        first.customerSnapshot,
        decryptPii,
      ),
      activatedAt: formatShanghaiDateTime(first.activatedAt ?? sortAt),
      ...ledgerOrderStatus(sorted),
      amountFen,
      lines: linesForLedgerRows(sorted),
      ledgerEntries: sorted.map((row) => ({
        id: row.id,
        beneficiaryId: row.beneficiaryId,
        beneficiaryName: row.beneficiaryName,
        entryType: row.entryType,
        amountFen: row.amountFen,
        reason: row.reason,
        occurredAt: row.occurredAt.toISOString(),
        settlementStatus: row.settlementStatus ?? "unsettled",
      })),
      sortAt,
    };
  });
};

const presentEstimatedOrders = (
  orders: readonly EstimatedCommissionOrder[],
  rules: readonly CommissionRule[],
  beneficiaryId: string | undefined,
  decryptPii?: (encrypted: string) => string,
): { orders: PresentedOrder[]; totalFen: number; unconfiguredOrders: number } => {
  let totalFen = 0;
  let unconfiguredOrders = 0;
  const presented = orders.map((order): PresentedOrder => {
    const calculation = calculateCommission(order.lines, rules, {
      salespersonId: order.sellerId,
      storeId: order.storeId,
      personnelType: order.personnelType,
      paymentMode: order.paymentMode,
    });
    if (calculation.unconfigured.length > 0) unconfiguredOrders += 1;
    const amountFen = selectedCalculationAmount(
      calculation,
      order.attributions,
      beneficiaryId,
    );
    totalFen = addFen(totalFen, amountFen, "预计提成合计");
    const lines = calculation.items.flatMap((item): CommissionDashboardOrderLine[] => {
      const subtotalFen = selectedAmount(
        item.subtotalFen,
        order.attributions,
        beneficiaryId,
      );
      if (subtotalFen === 0) return [];
      let quantity = item.quantity;
      if (subtotalFen % quantity !== 0) quantity = 1;
      return [
        {
          sku: item.sku,
          label: item.label,
          quantity,
          unitCommissionFen: subtotalFen / quantity,
          subtotalFen,
        },
      ];
    });
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      customerMasked: maskCustomer(
        order.customerNameEncrypted,
        order.customerPhoneTail,
        order.customerSnapshot,
        decryptPii,
      ),
      activatedAt: formatShanghaiDateTime(order.createdAt),
      status: "estimated",
      statusLabel: order.status === "accepted" ? "预计提成 · 待激活" : "预计提成 · 待受理",
      amountFen,
      lines,
      ledgerEntries: [],
      sortAt: order.createdAt,
    };
  });
  return { orders: presented, totalFen, unconfiguredOrders };
};

const presentMissingAccrualOrders = (
  orders: readonly MissingCommissionOrder[],
  decryptPii?: (encrypted: string) => string,
): PresentedOrder[] =>
  orders.map((order) => ({
    orderId: order.id,
    orderNo: order.orderNo,
    customerMasked: maskCustomer(
      order.customerNameEncrypted,
      order.customerPhoneTail,
      order.customerSnapshot,
      decryptPii,
    ),
    activatedAt: formatShanghaiDateTime(order.activatedAt),
    status: "exception",
    statusLabel: "提成异常 · 激活时无有效规则 · 待管理员处理",
    amountFen: 0,
    lines: [],
    ledgerEntries: [],
    sortAt: order.activatedAt,
  }));

const summarizeLedger = (
  rows: readonly DashboardLedgerRecord[],
  period: Period,
): Omit<CommissionDashboardSummary, "estimatedFen"> => {
  let accruedNetFen = 0;
  let pendingSettlementFen = 0;
  let pendingPaymentFen = 0;
  let paidThisMonthFen = 0;
  let paidLifetimeFen = 0;
  let reversedLifetimeFen = 0;
  let netLifetimeFen = 0;
  for (const row of rows) {
    if (!MONEY_ENTRY_TYPES.includes(row.entryType)) continue;
    assertFen(row.amountFen, "提成账本金额");
    netLifetimeFen = addFen(netLifetimeFen, row.amountFen, "累计净提成");
    if (row.occurredAt >= period.start && row.occurredAt < period.end) {
      accruedNetFen = addFen(accruedNetFen, row.amountFen, "当月已计提净额");
    }
    if (row.entryType === "return_reversal") {
      reversedLifetimeFen = addFen(
        reversedLifetimeFen,
        Math.abs(row.amountFen),
        "累计退单冲回",
      );
    }
    if (row.settlementStatus === "approved") {
      pendingPaymentFen = addFen(
        pendingPaymentFen,
        row.settlementAmountFen ?? row.amountFen,
        "待发放提成",
      );
    } else if (row.settlementStatus === "paid") {
      const settledFen = row.settlementAmountFen ?? row.amountFen;
      paidLifetimeFen = addFen(paidLifetimeFen, settledFen, "累计已发提成");
      if (row.paidAt && row.paidAt >= period.start && row.paidAt < period.end) {
        paidThisMonthFen = addFen(paidThisMonthFen, settledFen, "本月已发提成");
      }
    } else {
      pendingSettlementFen = addFen(
        pendingSettlementFen,
        row.amountFen,
        "待结算提成",
      );
    }
  }
  return {
    accruedNetFen,
    pendingSettlementFen,
    pendingPaymentFen,
    paidThisMonthFen,
    paidLifetimeFen,
    reversedLifetimeFen,
    netLifetimeFen,
  };
};

const encodeCursor = (order: PresentedOrder): string =>
  Buffer.from(`${order.sortAt.toISOString()}|${order.orderId}`, "utf8").toString(
    "base64url",
  );

const decodeCursor = (cursor: string): { sortAt: Date; orderId: string } => {
  try {
    const [dateValue, orderId] = Buffer.from(cursor, "base64url")
      .toString("utf8")
      .split("|");
    const sortAt = new Date(dateValue ?? "");
    if (!orderId || Number.isNaN(sortAt.getTime())) throw new Error();
    return { sortAt, orderId };
  } catch {
    throw new CommissionDashboardError("分页游标格式不正确", 400);
  }
};

const paginate = (
  orders: PresentedOrder[],
  cursor: string | undefined,
  limit: number,
  requestedPage = 1,
): { orders: CommissionDashboardOrder[]; nextCursor: string | null; total: number; page: number } => {
  const sorted = [...orders].sort(
    (left, right) =>
      right.sortAt.getTime() - left.sortAt.getTime() ||
      right.orderId.localeCompare(left.orderId),
  );
  const position = cursor ? decodeCursor(cursor) : null;
  const afterCursor = position
    ? sorted.filter(
        (order) =>
          order.sortAt < position.sortAt ||
          (order.sortAt.getTime() === position.sortAt.getTime() &&
            order.orderId.localeCompare(position.orderId) < 0),
      )
    : sorted;
  const offset = position ? 0 : (requestedPage - 1) * limit;
  const pageItems = afterCursor.slice(offset, offset + limit + 1);
  const hasMore = pageItems.length > limit;
  if (hasMore) pageItems.pop();
  return {
    orders: pageItems.map(({ sortAt: _sortAt, ...order }) => order),
    nextCursor: hasMore && pageItems.length > 0 ? encodeCursor(pageItems[pageItems.length - 1]!) : null,
    total: sorted.length,
    page: requestedPage,
  };
};

export const createCommissionDashboardService = (
  options: CommissionDashboardServiceOptions,
) => {
  const now = options.now ?? (() => new Date());

  const loadPresented = async (
    user: AuthenticatedUser,
    filters: CommissionDashboardFilters,
    orderId?: string,
  ) => {
    const normalized = normalizeFilters(user, filters);
    const repositoryFilters = { ...normalized.repository, orderId };
    const at = now();
    const [ledgerRows, estimatedOrders, missingAccrualOrders, policy] = await Promise.all([
      options.repository.listLedger(normalized.scope, repositoryFilters),
      options.repository.listEstimatedOrders(normalized.scope, repositoryFilters),
      options.repository.listMissingAccrualOrders(normalized.scope, repositoryFilters),
      options.repository.findEffectivePolicy(at),
    ]);
    const scopedLedger = orderId
      ? ledgerRows.filter((row) => row.orderId === orderId)
      : [...ledgerRows];
    const scopedEstimated = orderId
      ? estimatedOrders.filter((order) => order.id === orderId)
      : [...estimatedOrders];
    const ledgerOrders = presentLedgerOrders(scopedLedger, options.decryptPii);
    const exceptionalOrders = presentMissingAccrualOrders(
      missingAccrualOrders,
      options.decryptPii,
    );
    const estimated = presentEstimatedOrders(
      scopedEstimated,
      policy?.rules ?? [],
      repositoryFilters.beneficiaryId,
      options.decryptPii,
    );
    const snapshotUnconfigured = new Set(
      scopedLedger
        .filter((row) => row.orderId && hasUnconfiguredSnapshot(row.calculationSnapshot))
        .map((row) => row.orderId!),
    ).size;
    return {
      normalized,
      ledgerRows: scopedLedger,
      orders: [...estimated.orders, ...ledgerOrders, ...exceptionalOrders],
      estimatedFen: estimated.totalFen,
      unconfiguredOrders: estimated.unconfiguredOrders + snapshotUnconfigured,
    };
  };

  return {
    async getDashboard(
      user: AuthenticatedUser,
      filters: CommissionDashboardFilters = {},
    ): Promise<CommissionDashboard> {
      const at = now();
      const period = parsePeriod(filters.month ?? currentShanghaiMonth(at));
      const limit = filters.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new CommissionDashboardError("每页数量必须为1至100", 400);
      }
      const loaded = await loadPresented(user, filters);
      const requestedPage = filters.page ?? 1;
      const page = paginate(loaded.orders, filters.cursor, limit, requestedPage);
      return {
        periodLabel: period.label,
        summary: {
          estimatedFen: loaded.estimatedFen,
          ...summarizeLedger(loaded.ledgerRows, period),
        },
        orders: page.orders,
        unconfiguredOrders: loaded.unconfiguredOrders,
        nextCursor: page.nextCursor,
        total: page.total,
        page: page.page,
        pageSize: limit,
      };
    },

    async getOrderDetail(
      user: AuthenticatedUser,
      orderId: string,
    ): Promise<CommissionDashboardOrder> {
      const loaded = await loadPresented(user, { limit: 100 }, orderId);
      const order = loaded.orders[0];
      if (!order) throw new CommissionDashboardError("提成订单不存在", 404);
      const { sortAt: _sortAt, ...presented } = order;
      return presented;
    },
  };
};

export type CommissionDashboardService = ReturnType<
  typeof createCommissionDashboardService
>;
