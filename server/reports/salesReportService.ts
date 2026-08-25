import type { SalesReportFilters, SalesReportMetrics, SalesReportResponse } from "../../shared/reports/types.js";
import type { AuthenticatedUser } from "../auth/authorization.js";
import { buildSalesReportCsv } from "./csv.js";
import { parseReportPeriod, type ReportPeriod } from "./reportPeriod.js";

export interface SalesReportFact {
  storeId: string;
  storeName: string;
  sellerId: string;
  sellerName: string;
  quoteCount: number;
  orderCount: number;
  oneTimeOriginalFen: number;
  returnedFen: number;
  fttrMonthlyFen: number;
  heartMonthlyFen: number;
  contract36Fen: number;
  commissionEstimatedFen: number;
  commissionPendingSettlementFen: number;
  commissionPaidFen: number;
  commissionReversedFen: number;
  commissionNetFen: number;
}

export type SalesReportScope =
  | { kind: "seller"; storeId: string; sellerId: string }
  | { kind: "store"; storeId: string; sellerId?: string }
  | { kind: "region"; storeIds: readonly string[]; storeId?: string; sellerId?: string }
  | { kind: "global"; storeId?: string; sellerId?: string };

export interface ReportExportAudit {
  actorUserId: string;
  storeId: string | null;
  sourceIp?: string;
  filters: Required<Pick<SalesReportFilters, "from" | "to" | "groupBy">> &
    Pick<SalesReportFilters, "storeId" | "sellerId">;
  scope: SalesReportScope;
  rowCount: number;
  createdAt: Date;
}

export interface SalesReportRepository {
  loadFacts(scope: SalesReportScope, period: ReportPeriod): Promise<readonly SalesReportFact[]>;
  listActiveStores(storeId?: string): Promise<readonly { id: string; name: string }[]>;
  recordExportAudit(event: ReportExportAudit): Promise<void>;
}

export class SalesReportError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

export class ReportAuthorizationError extends SalesReportError {
  constructor(message = "无权查询该销售范围") {
    super(message, 403);
  }
}

const emptyMetrics = (): SalesReportMetrics => ({
  quoteCount: 0,
  orderCount: 0,
  conversionRateBps: 0,
  oneTimeOriginalFen: 0,
  returnedFen: 0,
  oneTimeNetFen: 0,
  fttrMonthlyFen: 0,
  heartMonthlyFen: 0,
  contract36Fen: 0,
  commissionEstimatedFen: 0,
  commissionPendingSettlementFen: 0,
  commissionPaidFen: 0,
  commissionReversedFen: 0,
  commissionNetFen: 0,
});

const addSafe = (left: number, right: number): number => {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new SalesReportError("报表金额超出安全范围", 500);
  return total;
};

const metricsForFacts = (facts: readonly SalesReportFact[]): SalesReportMetrics => {
  const result = emptyMetrics();
  for (const fact of facts) {
    for (const key of [
      "quoteCount",
      "orderCount",
      "oneTimeOriginalFen",
      "returnedFen",
      "fttrMonthlyFen",
      "heartMonthlyFen",
      "contract36Fen",
      "commissionEstimatedFen",
      "commissionPendingSettlementFen",
      "commissionPaidFen",
      "commissionReversedFen",
      "commissionNetFen",
    ] as const) {
      result[key] = addSafe(result[key], fact[key]);
    }
  }
  result.oneTimeNetFen = addSafe(result.oneTimeOriginalFen, -result.returnedFen);
  result.conversionRateBps =
    result.quoteCount === 0
      ? 0
      : Math.min(10_000, Math.round((result.orderCount * 10_000) / result.quoteCount));
  return result;
};

const normalizeScope = (
  user: AuthenticatedUser,
  filters: SalesReportFilters,
): SalesReportScope => {
  if (user.role === "sales") {
    if (!user.storeId) throw new ReportAuthorizationError("销售员未绑定营业厅");
    if (filters.storeId && filters.storeId !== user.storeId) throw new ReportAuthorizationError();
    if (filters.sellerId && filters.sellerId !== user.id) throw new ReportAuthorizationError();
    return { kind: "seller", storeId: user.storeId, sellerId: user.id };
  }
  if (user.role === "store_manager") {
    if (!user.storeId) throw new ReportAuthorizationError("主管未绑定营业厅");
    if (filters.storeId && filters.storeId !== user.storeId) throw new ReportAuthorizationError();
    return {
      kind: "store",
      storeId: user.storeId,
      ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
    };
  }
  if (user.role === "regional_manager") {
    const storeIds = (user.managedStores ?? []).map((store) => store.id);
    if (filters.storeId && !storeIds.includes(filters.storeId)) {
      throw new ReportAuthorizationError();
    }
    return {
      kind: "region",
      storeIds,
      ...(filters.storeId ? { storeId: filters.storeId } : {}),
      ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
    };
  }
  return {
    kind: "global",
    ...(filters.storeId ? { storeId: filters.storeId } : {}),
    ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
  };
};

const groupFacts = (
  facts: readonly SalesReportFact[],
  groupBy: "store" | "seller",
) => {
  const groups = new Map<string, SalesReportFact[]>();
  for (const fact of facts) {
    const key = groupBy === "store" ? fact.storeId : fact.sellerId;
    const entries = groups.get(key) ?? [];
    entries.push(fact);
    groups.set(key, entries);
  }
  return Array.from(groups.entries())
    .map(([key, entries]) => {
      const first = entries[0]!;
      const metrics = metricsForFacts(entries);
      return {
        key,
        label: groupBy === "store" ? first.storeName : first.sellerName,
        storeId: first.storeId,
        storeName: first.storeName,
        sellerId: groupBy === "seller" ? first.sellerId : null,
        sellerName: groupBy === "seller" ? first.sellerName : null,
        ...metrics,
      };
    })
    .sort((left, right) => right.oneTimeNetFen - left.oneTimeNetFen || left.label.localeCompare(right.label, "zh-CN"));
};

export const createSalesReportService = (options: {
  repository: SalesReportRepository;
  now?: () => Date;
}) => {
  const now = options.now ?? (() => new Date());

  const getReport = async (
    user: AuthenticatedUser,
    filters: SalesReportFilters = {},
    paginated = true,
  ): Promise<SalesReportResponse> => {
    const generatedAt = now();
    const period = parseReportPeriod(filters.from, filters.to, generatedAt);
    const scope = normalizeScope(user, filters);
    const loadedFacts = await options.repository.loadFacts(scope, period);
    const requestedGroup = filters.groupBy ?? (user.role === "admin" || user.role === "regional_manager" ? "store" : user.role === "store_manager" ? "seller" : "none");
    const shouldCompleteStoreRows = requestedGroup === "store" && !filters.sellerId;
    const visibleStores = !shouldCompleteStoreRows
      ? []
      : scope.kind === "region"
        ? (user.managedStores ?? []).filter((store) => !scope.storeId || store.id === scope.storeId)
        : scope.kind === "global"
          ? await options.repository.listActiveStores(scope.storeId)
          : [];
    const facts = shouldCompleteStoreRows && (scope.kind === "region" || scope.kind === "global")
      ? [
          ...loadedFacts,
          ...visibleStores
            .filter((store) => !loadedFacts.some((fact) => fact.storeId === store.id))
            .map((store): SalesReportFact => ({
              storeId: store.id,
              storeName: store.name,
              sellerId: "",
              sellerName: "",
              quoteCount: 0,
              orderCount: 0,
              oneTimeOriginalFen: 0,
              returnedFen: 0,
              fttrMonthlyFen: 0,
              heartMonthlyFen: 0,
              contract36Fen: 0,
              commissionEstimatedFen: 0,
              commissionPendingSettlementFen: 0,
              commissionPaidFen: 0,
              commissionReversedFen: 0,
              commissionNetFen: 0,
            })),
        ]
      : loadedFacts;
    const groupBy = user.role === "sales" ? "none" : requestedGroup;
    const allRows = groupBy === "none" ? [] : groupFacts(facts, groupBy);
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const rows = paginated
      ? allRows.slice((page - 1) * pageSize, page * pageSize)
      : allRows;
    return {
      generatedAt: generatedAt.toISOString(),
      period: { from: period.from, to: period.to, timeZone: "Asia/Shanghai" },
      scope: {
        kind: scope.kind,
        label:
          scope.kind === "seller"
            ? "本人"
            : scope.kind === "store"
              ? "本营业厅"
              : scope.kind === "region"
                ? "所管营业厅"
              : "全公司",
      },
      totals: metricsForFacts(facts),
      rows,
      total: allRows.length,
      page,
      pageSize,
    };
  };

  return {
    getReport,
    async exportCsv(
      user: AuthenticatedUser,
      filters: SalesReportFilters,
      sourceIp?: string,
    ): Promise<{ csv: string; fileName: string }> {
      const report = await getReport(user, filters, false);
      const scope = normalizeScope(user, filters);
      const normalizedFilters = {
        from: report.period.from,
        to: report.period.to,
        groupBy: filters.groupBy ?? (user.role === "admin" || user.role === "regional_manager" ? "store" : user.role === "store_manager" ? "seller" : "none"),
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.sellerId ? { sellerId: filters.sellerId } : {}),
      };
      await options.repository.recordExportAudit({
        actorUserId: user.id,
        storeId: user.storeId,
        sourceIp,
        filters: normalizedFilters,
        scope,
        rowCount: report.rows.length + 1,
        createdAt: new Date(report.generatedAt),
      });
      return {
        csv: buildSalesReportCsv(report),
        fileName: `FTTR心连心销售报表_${report.period.from}_${report.period.to}.csv`,
      };
    },
  };
};

export type SalesReportService = ReturnType<typeof createSalesReportService>;
