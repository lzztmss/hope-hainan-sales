import { calculateCommission } from "../../shared/commission/commissionEngine.js";
import type { CommissionCalculation } from "../../shared/commission/types.js";
import type { UserScope } from "../auth/authorization.js";
import { DrizzleCommissionDashboardRepository } from "../commissions/dashboardRepository.js";
import type { EstimatedCommissionAttribution } from "../commissions/dashboardService.js";
import type { DbClient } from "../db/client.js";
import { auditLogs } from "../db/schema.js";
import type {
  ReportExportAudit,
  SalesReportFact,
  SalesReportRepository,
  SalesReportScope,
} from "./salesReportService.js";
import type { ReportPeriod } from "./reportPeriod.js";

interface DimensionRow {
  store_id: string;
  store_name: string;
  seller_id: string;
  seller_name: string;
}

interface CountRow extends DimensionRow {
  count: number;
}

interface OrderAmountRow extends DimensionRow {
  one_time_fen: number;
  fttr_monthly_fen: number;
  heart_monthly_fen: number;
  contract_36_fen: number;
}

interface AmountRow extends DimensionRow {
  amount_fen: number;
}

interface LedgerRow extends DimensionRow {
  pending_fen: number;
  reversed_fen: number;
  net_fen: number;
}

const emptyFact = (dimension: DimensionRow): SalesReportFact => ({
  storeId: dimension.store_id,
  storeName: dimension.store_name,
  sellerId: dimension.seller_id,
  sellerName: dimension.seller_name,
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
});

const key = (storeId: string, sellerId: string): string => `${storeId}:${sellerId}`;

const toUserScope = (scope: SalesReportScope): UserScope => {
  if (scope.kind === "seller") return scope;
  if (scope.kind === "store") return { kind: "store", storeId: scope.storeId };
  if (scope.kind === "region") return { kind: "region", storeIds: scope.storeIds };
  return { kind: "global" };
};

const allocateCommission = (
  totalFen: number,
  attributions: readonly EstimatedCommissionAttribution[],
): ReadonlyMap<string, number> => {
  const primary = attributions.find((entry) => entry.role === "primary");
  if (!primary || attributions.reduce((sum, entry) => sum + entry.basisPoints, 0) !== 10_000) {
    throw new Error("订单销售归属不完整");
  }
  const result = new Map<string, number>();
  let allocated = 0;
  for (const entry of attributions) {
    if (entry.role === "primary") continue;
    const amount = Math.floor((totalFen * entry.basisPoints) / 10_000);
    result.set(entry.beneficiaryId, amount);
    allocated += amount;
  }
  result.set(primary.beneficiaryId, totalFen - allocated);
  return result;
};

export const allocateEstimatedCommission = (
  calculation: CommissionCalculation,
  attributions: readonly EstimatedCommissionAttribution[],
): ReadonlyMap<string, number> => {
  const amountByRule = new Map<string, number>();
  for (const item of calculation.items) {
    const subtotalFen = (amountByRule.get(item.ruleId) ?? 0) + item.subtotalFen;
    if (!Number.isSafeInteger(subtotalFen)) {
      throw new Error("预计提成规则小计超出安全范围");
    }
    amountByRule.set(item.ruleId, subtotalFen);
  }

  const result = new Map<string, number>();
  for (const amountFen of amountByRule.values()) {
    for (const [beneficiaryId, allocatedFen] of allocateCommission(
      amountFen,
      attributions,
    )) {
      const totalFen = (result.get(beneficiaryId) ?? 0) + allocatedFen;
      if (!Number.isSafeInteger(totalFen)) {
        throw new Error("预计提成分配合计超出安全范围");
      }
      result.set(beneficiaryId, totalFen);
    }
  }
  return result;
};

export class DrizzleSalesReportRepository implements SalesReportRepository {
  constructor(private readonly client: DbClient) {}

  async listActiveStores(storeId?: string): Promise<readonly { id: string; name: string }[]> {
    return this.client.raw.prepare(`
      SELECT id, name
      FROM stores
      WHERE active = 1 ${storeId ? "AND id = ?" : ""}
      ORDER BY code ASC
    `).all(...(storeId ? [storeId] : [])) as Array<{ id: string; name: string }>;
  }

  async loadFacts(
    scope: SalesReportScope,
    period: ReportPeriod,
  ): Promise<readonly SalesReportFact[]> {
    const periodStart = period.start.getTime();
    const periodEnd = period.endExclusive.getTime();
    const makeScope = (
      tableAlias: string,
      sellerColumn: "seller_id" | "beneficiary_id",
    ): { clause: string; params: string[] } => {
      const clauses: string[] = [];
      const params: string[] = [];
      if (scope.kind === "region" && !scope.storeId) {
        if (scope.storeIds.length === 0) clauses.push("AND 1 = 0");
        else {
          clauses.push(`AND ${tableAlias}.store_id IN (${scope.storeIds.map(() => "?").join(", ")})`);
          params.push(...scope.storeIds);
        }
      }
      if (scope.storeId) {
        clauses.push(`AND ${tableAlias}.store_id = ?`);
        params.push(scope.storeId);
      }
      if (scope.sellerId) {
        clauses.push(`AND ${tableAlias}.${sellerColumn} = ?`);
        params.push(scope.sellerId);
      }
      return { clause: clauses.join(" "), params };
    };
    const quoteScope = makeScope("q", "seller_id");
    const orderScope = makeScope("o", "seller_id");
    const ledgerScope = makeScope("cl", "beneficiary_id");
    const all = <T>(query: string, params: readonly unknown[]): T[] =>
      this.client.raw.prepare(query).all(...params) as T[];

    const [quoteRows, orderCountRows, orderAmountRows, returnRows, ledgerRows, paidRows] =
      [
        all<CountRow>(`
          SELECT q.store_id, s.name AS store_name, q.seller_id,
                 u.display_name AS seller_name, COUNT(*) AS count
          FROM quotes q
          JOIN stores s ON s.id = q.store_id
          JOIN users u ON u.id = q.seller_id
          WHERE q.confirmed_at >= ? AND q.confirmed_at < ?
            AND q.deleted_at IS NULL AND q.status <> 'voided'
            ${quoteScope.clause}
          GROUP BY q.store_id, s.name, q.seller_id, u.display_name
        `, [periodStart, periodEnd, ...quoteScope.params]),
        all<CountRow>(`
          SELECT o.store_id, s.name AS store_name, o.seller_id,
                 u.display_name AS seller_name, COUNT(*) AS count
          FROM orders o
          JOIN stores s ON s.id = o.store_id
          JOIN users u ON u.id = o.seller_id
          WHERE o.created_at >= ? AND o.created_at < ?
            AND o.deleted_at IS NULL
            AND o.status NOT IN ('cancelled', 'voided')
            ${orderScope.clause}
          GROUP BY o.store_id, s.name, o.seller_id, u.display_name
        `, [periodStart, periodEnd, ...orderScope.params]),
        all<OrderAmountRow>(`
          SELECT o.store_id, s.name AS store_name, o.seller_id,
                 u.display_name AS seller_name,
                 COALESCE(SUM(o.one_time_fen), 0) AS one_time_fen,
                 COALESCE(SUM(o.fttr_monthly_fen), 0) AS fttr_monthly_fen,
                 COALESCE(SUM(o.heart_monthly_fen), 0) AS heart_monthly_fen,
                 COALESCE(SUM(o.contract_36_fen), 0) AS contract_36_fen
          FROM orders o
          JOIN stores s ON s.id = o.store_id
          JOIN users u ON u.id = o.seller_id
          WHERE o.activated_at >= ? AND o.activated_at < ?
            AND o.deleted_at IS NULL
            ${orderScope.clause}
          GROUP BY o.store_id, s.name, o.seller_id, u.display_name
        `, [periodStart, periodEnd, ...orderScope.params]),
        all<AmountRow>(`
          SELECT o.store_id, s.name AS store_name, o.seller_id,
                 u.display_name AS seller_name,
                 COALESCE(SUM(r.refund_fen), 0) AS amount_fen
          FROM returns r
          JOIN orders o ON o.id = r.order_id
          JOIN stores s ON s.id = o.store_id
          JOIN users u ON u.id = o.seller_id
          WHERE r.status = 'completed'
            AND r.completed_at >= ? AND r.completed_at < ?
            ${orderScope.clause}
          GROUP BY o.store_id, s.name, o.seller_id, u.display_name
        `, [periodStart, periodEnd, ...orderScope.params]),
        all<LedgerRow>(`
          SELECT cl.store_id, s.name AS store_name,
                 cl.beneficiary_id AS seller_id, u.display_name AS seller_name,
                 COALESCE(SUM(CASE WHEN sb.id IS NULL OR sb.status = 'draft'
                   THEN cl.amount_fen ELSE 0 END), 0) AS pending_fen,
                 COALESCE(SUM(CASE WHEN cl.entry_type = 'return_reversal'
                   THEN ABS(cl.amount_fen) ELSE 0 END), 0) AS reversed_fen,
                 COALESCE(SUM(cl.amount_fen), 0) AS net_fen
          FROM commission_ledger cl
          JOIN stores s ON s.id = cl.store_id
          JOIN users u ON u.id = cl.beneficiary_id
          LEFT JOIN settlement_items si ON si.ledger_entry_id = cl.id
          LEFT JOIN settlement_batches sb ON sb.id = si.batch_id
          WHERE cl.entry_type IN ('accrual', 'return_reversal', 'manual_positive', 'manual_negative')
            AND cl.occurred_at >= ? AND cl.occurred_at < ?
            ${ledgerScope.clause}
          GROUP BY cl.store_id, s.name, cl.beneficiary_id, u.display_name
        `, [periodStart, periodEnd, ...ledgerScope.params]),
        all<AmountRow>(`
          SELECT cl.store_id, s.name AS store_name,
                 cl.beneficiary_id AS seller_id, u.display_name AS seller_name,
                 COALESCE(SUM(si.amount_fen), 0) AS amount_fen
          FROM settlement_items si
          JOIN settlement_batches sb ON sb.id = si.batch_id
          JOIN commission_ledger cl ON cl.id = si.ledger_entry_id
          JOIN stores s ON s.id = cl.store_id
          JOIN users u ON u.id = cl.beneficiary_id
          WHERE sb.status = 'paid'
            AND sb.paid_at >= ? AND sb.paid_at < ?
            ${ledgerScope.clause}
          GROUP BY cl.store_id, s.name, cl.beneficiary_id, u.display_name
        `, [periodStart, periodEnd, ...ledgerScope.params]),
      ];

    const facts = new Map<string, SalesReportFact>();
    const ensure = (row: DimensionRow) => {
      const rowKey = key(row.store_id, row.seller_id);
      const existing = facts.get(rowKey) ?? emptyFact(row);
      facts.set(rowKey, existing);
      return existing;
    };
    for (const row of quoteRows) ensure(row).quoteCount += Number(row.count);
    for (const row of orderCountRows) ensure(row).orderCount += Number(row.count);
    for (const row of orderAmountRows) {
      const fact = ensure(row);
      fact.oneTimeOriginalFen += Number(row.one_time_fen);
      fact.fttrMonthlyFen += Number(row.fttr_monthly_fen);
      fact.heartMonthlyFen += Number(row.heart_monthly_fen);
      fact.contract36Fen += Number(row.contract_36_fen);
    }
    for (const row of returnRows) ensure(row).returnedFen += Number(row.amount_fen);
    for (const row of ledgerRows) {
      const fact = ensure(row);
      fact.commissionPendingSettlementFen += Number(row.pending_fen);
      fact.commissionReversedFen += Number(row.reversed_fen);
      fact.commissionNetFen += Number(row.net_fen);
    }
    for (const row of paidRows) ensure(row).commissionPaidFen += Number(row.amount_fen);

    const dashboardRepository = new DrizzleCommissionDashboardRepository(this.client);
    const beneficiaryId = scope.sellerId;
    const estimatedOrders = (
      await dashboardRepository.listEstimatedOrders(toUserScope(scope), {
        storeId: scope.storeId,
        beneficiaryId,
      })
    ).filter(
      (order) => order.createdAt >= period.start && order.createdAt < period.endExclusive,
    );
    const policy = await dashboardRepository.findEffectivePolicy(
      new Date(period.endExclusive.getTime() - 1),
    );
    if (policy && estimatedOrders.length > 0) {
      const beneficiaryIds = Array.from(
        new Set(estimatedOrders.flatMap((order) => order.attributions.map((entry) => entry.beneficiaryId))),
      );
      const people =
        beneficiaryIds.length === 0
          ? []
          : all<DimensionRow>(`
              SELECT u.store_id, s.name AS store_name, u.id AS seller_id,
                     u.display_name AS seller_name
              FROM users u JOIN stores s ON s.id = u.store_id
              WHERE u.id IN (${beneficiaryIds.map(() => "?").join(", ")})
            `, beneficiaryIds);
      const peopleById = new Map(people.map((person) => [person.seller_id, person]));
      for (const order of estimatedOrders) {
        const calculation = calculateCommission(order.lines, policy.rules, {
          salespersonId: order.sellerId,
          storeId: order.storeId,
          personnelType: order.personnelType,
          paymentMode: order.paymentMode,
        });
        const allocation = allocateEstimatedCommission(
          calculation,
          order.attributions,
        );
        for (const [sellerId, amountFen] of allocation) {
          if (beneficiaryId && sellerId !== beneficiaryId) continue;
          const person = peopleById.get(sellerId);
          if (!person) throw new Error("预计提成销售员资料不完整");
          ensure(person).commissionEstimatedFen += amountFen;
        }
      }
    }
    return Array.from(facts.values());
  }

  async recordExportAudit(event: ReportExportAudit): Promise<void> {
    await this.client.db.insert(auditLogs).values({
      actorUserId: event.actorUserId,
      storeId: event.storeId,
      entityType: "sales_report",
      action: "sales_report.export_csv",
      afterSnapshot: {
        filters: event.filters,
        scope: event.scope,
        rowCount: event.rowCount,
      },
      sourceIp: event.sourceIp,
      createdAt: event.createdAt,
    });
  }
}
