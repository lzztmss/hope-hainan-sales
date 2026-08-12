import { and, eq, isNull, sql } from "drizzle-orm";

import type { QuoteCalculation } from "../../shared/pricing/types.js";
import type {
  AppDatabase,
  DbClient,
  DbTransaction,
} from "../db/client.js";
import {
  customers,
  printEvents,
  quoteLines,
  quotes,
} from "../db/schema.js";
import type {
  ConfirmedQuote,
  CustomerWriteRecord,
  QuoteRepository,
  QuoteWriteRecord,
} from "./quoteService.js";

type QueryExecutor = AppDatabase | DbTransaction;
type QuoteRow = typeof quotes.$inferSelect;

const mapQuote = (row: QuoteRow): ConfirmedQuote => ({
  id: row.id,
  quoteNo: row.quoteNo,
  idempotencyKey: row.idempotencyKey,
  customerId: row.customerId,
  storeId: row.storeId,
  sellerId: row.sellerId,
  status: row.status,
  paymentMode: row.paymentMode,
  fttrKind: row.fttrKind,
  fttrPlan: row.fttrPlan,
  customFttrNote: row.customFttrNote,
  fttrMonthlyFen: row.fttrMonthlyFen,
  heartMonthlyFen: row.heartMonthlyFen,
  oneTimeFen: row.oneTimeFen,
  monthlyTotalFen: row.monthlyTotalFen,
  contract36Fen: row.contract36Fen,
  catalogVersion: row.catalogVersion,
  customerSnapshot: row.customerSnapshot,
  quoteSnapshot: row.quoteSnapshot,
  confirmedAt: row.confirmedAt,
  deletedAt: row.deletedAt,
});

const quoteCalculationFromSnapshot = (
  snapshot: Record<string, unknown>,
): QuoteCalculation => {
  const calculation = snapshot.calculation;
  if (!calculation || typeof calculation !== "object") {
    throw new Error("报价快照缺少核价结果");
  }
  return calculation as QuoteCalculation;
};

export class DrizzleQuoteRepository implements QuoteRepository {
  constructor(
    private readonly client: DbClient,
    private readonly executor: QueryExecutor = client.db,
    private readonly insideTransaction = false,
  ) {}

  async runConfirmationTransaction<T>(
    work: (repository: QuoteRepository) => Promise<T>,
  ): Promise<T> {
    if (this.insideTransaction) return work(this);
    return this.client.withTransaction((tx) =>
      work(new DrizzleQuoteRepository(this.client, tx, true)),
    );
  }

  async findByIdempotencyKey(key: string): Promise<ConfirmedQuote | null> {
    const [row] = await this.executor
      .select()
      .from(quotes)
      .where(eq(quotes.idempotencyKey, key))
      .limit(1);
    return row ? mapQuote(row) : null;
  }

  async upsertCustomer(
    input: CustomerWriteRecord,
  ): Promise<{ id: string }> {
    const [existing] = await this.executor
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.storeId, input.storeId),
          eq(customers.ownerUserId, input.ownerUserId),
          eq(customers.phoneLookupHash, input.phoneLookupHash),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await this.executor
        .update(customers)
        .set({
          nameEncrypted: input.nameEncrypted,
          phoneEncrypted: input.phoneEncrypted,
          phoneTail: input.phoneTail,
          districtEncrypted: input.districtEncrypted,
          addressEncrypted: input.addressEncrypted,
          roomType: input.roomType,
          elderCount: input.elderCount,
          source: input.source,
          notesEncrypted: input.notesEncrypted,
          updatedAt: new Date(),
          version: sql`${customers.version} + 1`,
        })
        .where(eq(customers.id, existing.id))
        .returning({ id: customers.id });
      if (!updated) throw new Error("客户更新失败");
      return updated;
    }

    const [created] = await this.executor
      .insert(customers)
      .values(input)
      .returning({ id: customers.id });
    if (!created) throw new Error("客户创建失败");
    return created;
  }

  async createQuote(input: QuoteWriteRecord): Promise<ConfirmedQuote> {
    const [created] = await this.executor
      .insert(quotes)
      .values(input)
      .returning();
    if (!created) throw new Error("报价单创建失败");

    const calculation = quoteCalculationFromSnapshot(input.quoteSnapshot);
    const lineValues: Array<typeof quoteLines.$inferInsert> = [
      ...calculation.chargeLines.map((line) => ({
        quoteId: created.id,
        lineType: "charge" as const,
        sku: line.sku,
        label: line.label,
        unit: line.unit,
        quantity: line.quantity,
        oneTimeUnitFen: line.oneTimeUnitFen,
        monthlyUnitFen: line.monthlyUnitFen,
        oneTimeSubtotalFen: line.oneTimeSubtotalFen,
        monthlySubtotalFen: line.monthlySubtotalFen,
        locations: [],
      })),
      ...calculation.componentLines.map((line) => ({
        quoteId: created.id,
        lineType: "component" as const,
        sku: line.componentId,
        label: line.label,
        unit: line.unit,
        quantity: line.quantity,
        oneTimeUnitFen: 0,
        monthlyUnitFen: 0,
        oneTimeSubtotalFen: 0,
        monthlySubtotalFen: 0,
        locations: line.locations,
        reason: line.reason,
      })),
    ];
    if (lineValues.length > 0) {
      await this.executor.insert(quoteLines).values(lineValues);
    }
    return mapQuote(created);
  }

  async findById(id: string): Promise<ConfirmedQuote | null> {
    const [row] = await this.executor
      .select()
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);
    return row ? mapQuote(row) : null;
  }

  async setDeletedAt(
    id: string,
    deletedAt: Date | null,
  ): Promise<ConfirmedQuote | null> {
    const [row] = await this.executor
      .update(quotes)
      .set({
        deletedAt,
        updatedAt: new Date(),
        version: sql`${quotes.version} + 1`,
      })
      .where(eq(quotes.id, id))
      .returning();
    return row ? mapQuote(row) : null;
  }

  async recordPrint(input: {
    quoteId: string;
    userId: string;
  }): Promise<void> {
    const [previous] = await this.executor
      .select({ id: printEvents.id })
      .from(printEvents)
      .where(eq(printEvents.quoteId, input.quoteId))
      .limit(1);
    await this.executor.insert(printEvents).values({
      quoteId: input.quoteId,
      userId: input.userId,
      eventType: previous ? "reprint" : "initial",
    });
  }
}
