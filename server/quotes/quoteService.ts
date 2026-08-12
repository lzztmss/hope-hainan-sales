import { randomBytes } from "node:crypto";

import { calculateQuote } from "../../shared/pricing/quoteEngine.js";
import type {
  QuoteCalculation,
  QuoteInput,
  RoomType,
} from "../../shared/pricing/types.js";
import {
  canAccessOwnedRecord,
  scopeForUser,
  type AuthenticatedUser,
  type UserScope,
} from "../auth/authorization.js";
import { maskPhone, normalizeMainlandPhone } from "../security/pii.js";

export interface QuoteCustomerDraft {
  name: string;
  phone: string;
  district?: string;
  address?: string;
  roomType?: RoomType;
  elderCount: number;
  source?: string;
  notes?: string;
}

export interface QuoteDraft {
  customer: QuoteCustomerDraft;
  pricing: QuoteInput;
  clientClaimedTotals?: {
    oneTimeFen?: number;
    monthlyTotalFen?: number;
    contract36Fen?: number;
  };
  clientSellerId?: string;
}

export interface CustomerWriteRecord {
  storeId: string;
  ownerUserId: string;
  nameEncrypted: string;
  phoneEncrypted: string;
  phoneLookupHash: string;
  phoneTail: string;
  districtEncrypted: string | null;
  addressEncrypted: string | null;
  roomType: RoomType | null;
  elderCount: number;
  source: string | null;
  notesEncrypted: string | null;
  createdBy: string;
}

export interface QuoteWriteRecord {
  quoteNo: string;
  idempotencyKey: string;
  customerId: string;
  storeId: string;
  sellerId: string;
  status: "confirmed" | "converted" | "expired" | "lost" | "voided";
  paymentMode: QuoteCalculation["mode"];
  fttrKind: QuoteCalculation["fttrKind"];
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
  confirmedAt: Date;
}

export interface ConfirmedQuote extends QuoteWriteRecord {
  id: string;
  deletedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteListFilters {
  query?: string;
  status?: ConfirmedQuote["status"];
  dateFrom?: Date;
  dateTo?: Date;
  deletedOnly?: boolean;
  limit: number;
}

export interface QuoteListResult {
  items: ConfirmedQuote[];
}

export interface QuotePresentation {
  id: string;
  quoteNo: string;
  status: ConfirmedQuote["status"];
  sellerId: string;
  storeId: string;
  confirmedAt: Date;
  deletedAt: Date | null;
  version: number;
  updatedAt: Date;
  customer: {
    name: string;
    phone: string;
    phoneMasked: string;
    district: string | null;
    address: string | null;
    roomType: RoomType | null;
    elderCount: number;
    source: string | null;
    notes: string | null;
  };
  calculation: QuoteCalculation;
  pricing: QuoteInput;
}

export interface QuoteRepository {
  runConfirmationTransaction<T>(
    work: (repository: QuoteRepository) => Promise<T>,
  ): Promise<T>;
  findByIdempotencyKey(key: string): Promise<ConfirmedQuote | null>;
  upsertCustomer(input: CustomerWriteRecord): Promise<{ id: string }>;
  createQuote(input: QuoteWriteRecord): Promise<ConfirmedQuote>;
  findById(id: string): Promise<ConfirmedQuote | null>;
  list(scope: UserScope, filters: QuoteListFilters): Promise<QuoteListResult>;
  updateQuote(
    id: string,
    expectedVersion: number,
    input: QuoteWriteRecord,
  ): Promise<ConfirmedQuote | null>;
  setDeletedAt(id: string, deletedAt: Date | null): Promise<ConfirmedQuote | null>;
  writeAudit(input: {
    actorUserId: string;
    storeId: string;
    quoteId: string;
    beforeSnapshot: Record<string, unknown>;
    afterSnapshot: Record<string, unknown>;
  }): Promise<void>;
  recordPrint(input: {
    quoteId: string;
    userId: string;
  }): Promise<void>;
}

export interface QuotePiiPort {
  encryptPii(value: string): string;
  decryptPii(value: string): string;
  phoneLookupHash(value: string): string;
}

export interface QuoteServiceOptions {
  repository: QuoteRepository;
  pii: QuotePiiPort;
  now?: () => Date;
  randomSuffix?: () => string;
}

const optionalEncrypted = (
  value: string | undefined,
  encrypt: (value: string) => string,
): string | null => {
  const normalized = value?.trim();
  return normalized ? encrypt(normalized) : null;
};

const validateIdempotencyKey = (value: string): void => {
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(value)) {
    throw new Error("幂等键格式不正确");
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

const validateCustomer = (customer: QuoteCustomerDraft): void => {
  const name = customer.name.trim();
  if (!name || name.length > 80) throw new Error("客户姓名格式不正确");
  normalizeMainlandPhone(customer.phone);
  if (
    !Number.isInteger(customer.elderCount) ||
    customer.elderCount < 1 ||
    customer.elderCount > 20
  ) {
    throw new Error("长者人数必须为1至20的整数");
  }
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

export const createQuoteService = (options: QuoteServiceOptions) => {
  const now = options.now ?? (() => new Date());
  const randomSuffix =
    options.randomSuffix ??
    (() => randomBytes(5).toString("hex").slice(0, 6).toUpperCase());

  const requireVisibleQuote = async (
    user: AuthenticatedUser,
    quoteId: string,
  ): Promise<ConfirmedQuote> => {
    const quote = await options.repository.findById(quoteId);
    if (
      !quote ||
      !canAccessOwnedRecord(user, {
        sellerId: quote.sellerId,
        storeId: quote.storeId,
      })
    ) {
      throw new Error("报价单不存在");
    }
    return quote;
  };

  const presentQuote = (quote: ConfirmedQuote): QuotePresentation => {
    const customer = quote.customerSnapshot;
    const calculation = quote.quoteSnapshot.calculation;
    const pricing = quote.quoteSnapshot.pricingInput;
    if (!calculation || typeof calculation !== "object") {
      throw new Error("报价快照缺少核价结果");
    }
    if (!pricing || typeof pricing !== "object") {
      throw new Error("报价快照缺少原始配置");
    }
    const decrypt = (key: string): string | null => {
      const encrypted = snapshotString(customer, key);
      return encrypted ? options.pii.decryptPii(encrypted) : null;
    };
    const name = decrypt("nameEncrypted");
    const phone = decrypt("phoneEncrypted");
    const elderCount = snapshotNumber(customer, "elderCount");
    if (!name || !phone || elderCount === null) {
      throw new Error("报价快照缺少客户信息");
    }

    const roomTypeValue = snapshotString(customer, "roomType");
    const roomType =
      roomTypeValue === "one_bedroom" ||
      roomTypeValue === "two_bedroom" ||
      roomTypeValue === "three_bedroom"
        ? roomTypeValue
        : null;
    return {
      id: quote.id,
      quoteNo: quote.quoteNo,
      status: quote.status,
      sellerId: quote.sellerId,
      storeId: quote.storeId,
      confirmedAt: quote.confirmedAt,
      deletedAt: quote.deletedAt,
      version: quote.version,
      updatedAt: quote.updatedAt,
      customer: {
        name,
        phone,
        phoneMasked: snapshotString(customer, "phoneMasked") ?? maskPhone(phone),
        district: decrypt("districtEncrypted"),
        address: decrypt("addressEncrypted"),
        roomType,
        elderCount,
        source: snapshotString(customer, "source"),
        notes: decrypt("notesEncrypted"),
      },
      calculation: calculation as QuoteCalculation,
      pricing: pricing as QuoteInput,
    };
  };

  const buildCustomerRecord = (
    user: AuthenticatedUser,
    customer: QuoteCustomerDraft,
  ): { record: CustomerWriteRecord; phone: string } => {
    if (!user.storeId) throw new Error("用户未绑定营业厅");
    validateCustomer(customer);
    const phone = normalizeMainlandPhone(customer.phone);
    return {
      phone,
      record: {
        storeId: user.storeId,
        ownerUserId: user.id,
        nameEncrypted: options.pii.encryptPii(customer.name.trim()),
        phoneEncrypted: options.pii.encryptPii(phone),
        phoneLookupHash: options.pii.phoneLookupHash(phone),
        phoneTail: phone.slice(-4),
        districtEncrypted: optionalEncrypted(customer.district, options.pii.encryptPii),
        addressEncrypted: optionalEncrypted(customer.address, options.pii.encryptPii),
        roomType: customer.roomType ?? null,
        elderCount: customer.elderCount,
        source: customer.source?.trim() || null,
        notesEncrypted: optionalEncrypted(customer.notes, options.pii.encryptPii),
        createdBy: user.id,
      },
    };
  };

  const customerSnapshot = (
    record: CustomerWriteRecord,
    phone: string,
  ): Record<string, unknown> => ({
    nameEncrypted: record.nameEncrypted,
    phoneEncrypted: record.phoneEncrypted,
    phoneMasked: maskPhone(phone),
    districtEncrypted: record.districtEncrypted,
    addressEncrypted: record.addressEncrypted,
    roomType: record.roomType,
    elderCount: record.elderCount,
    source: record.source,
    notesEncrypted: record.notesEncrypted,
  });

  const quoteValues = (
    base: Pick<QuoteWriteRecord, "quoteNo" | "idempotencyKey" | "storeId" | "sellerId" | "confirmedAt">,
    customerId: string,
    draft: QuoteDraft,
    customerRecord: CustomerWriteRecord,
    phone: string,
  ): QuoteWriteRecord => {
    const calculated = calculateQuote(draft.pricing);
    return {
      ...base,
      customerId,
      status: "confirmed",
      paymentMode: calculated.mode,
      fttrKind: calculated.fttrKind,
      fttrPlan: calculated.fttrPlan,
      customFttrNote: calculated.customFttrNote,
      fttrMonthlyFen: calculated.fttrMonthlyFen,
      heartMonthlyFen: calculated.heartMonthlyFen,
      oneTimeFen: calculated.oneTimeFen,
      monthlyTotalFen: calculated.monthlyTotalFen,
      contract36Fen: calculated.contract36Fen,
      catalogVersion: calculated.catalogVersion,
      customerSnapshot: customerSnapshot(customerRecord, phone),
      quoteSnapshot: {
        catalogVersion: calculated.catalogVersion,
        pricingInput: structuredClone(draft.pricing),
        calculation: structuredClone(calculated),
      },
    };
  };

  return {
    previewQuote(draft: Pick<QuoteDraft, "pricing">): QuoteCalculation {
      return calculateQuote(draft.pricing);
    },

    async confirmQuote(
      user: AuthenticatedUser,
      draft: QuoteDraft,
      idempotencyKey: string,
    ): Promise<ConfirmedQuote> {
      validateIdempotencyKey(idempotencyKey);
      if (!user.storeId) throw new Error("用户未绑定营业厅");
      const storeId = user.storeId;

      const existing =
        await options.repository.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (
          !canAccessOwnedRecord(user, {
            sellerId: existing.sellerId,
            storeId: existing.storeId,
          })
        ) {
          throw new Error("报价单不存在");
        }
        return existing;
      }

      return options.repository.runConfirmationTransaction(async (repository) => {
        const existingInsideTransaction =
          await repository.findByIdempotencyKey(idempotencyKey);
        if (existingInsideTransaction) {
          if (
            !canAccessOwnedRecord(user, {
              sellerId: existingInsideTransaction.sellerId,
              storeId: existingInsideTransaction.storeId,
            })
          ) {
            throw new Error("报价单不存在");
          }
          return existingInsideTransaction;
        }

        const { record: customerRecord, phone } = buildCustomerRecord(user, draft.customer);
        const customer = await repository.upsertCustomer(customerRecord);
        const confirmedAt = now();

        return repository.createQuote(
          quoteValues(
            {
              quoteNo: `XLX-${formatShanghaiDate(confirmedAt)}-${randomSuffix()}`,
              idempotencyKey,
              storeId,
              sellerId: user.id,
              confirmedAt,
            },
            customer.id,
            draft,
            customerRecord,
            phone,
          ),
        );
      });
    },

    async listQuotes(
      user: AuthenticatedUser,
      filters: QuoteListFilters,
    ): Promise<{ items: QuotePresentation[] }> {
      const result = await options.repository.list(scopeForUser(user), filters);
      const query = filters.query?.trim().toLocaleLowerCase("zh-CN");
      const items = result.items.map(presentQuote).filter((quote) => {
        if (!query) return true;
        return (
          quote.quoteNo.toLocaleLowerCase("zh-CN").includes(query) ||
          quote.customer.name.toLocaleLowerCase("zh-CN").includes(query) ||
          quote.customer.phone.endsWith(query)
        );
      });
      return { items: items.slice(0, filters.limit) };
    },

    async updateQuote(
      user: AuthenticatedUser,
      quoteId: string,
      draft: QuoteDraft,
      expectedVersion: number,
    ): Promise<QuotePresentation> {
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new Error("报价版本不正确");
      }
      const existing = await requireVisibleQuote(user, quoteId);
      if (existing.deletedAt || existing.status !== "confirmed") {
        throw new Error("当前报价已锁定，不能修改");
      }
      return options.repository.runConfirmationTransaction(async (repository) => {
        const current = await repository.findById(quoteId);
        if (!current || current.version !== expectedVersion) {
          throw new Error("报价已被其他人修改，请刷新后重试");
        }
        const { record, phone } = buildCustomerRecord(user, draft.customer);
        const customer = await repository.upsertCustomer(record);
        const next = quoteValues(
          {
            quoteNo: current.quoteNo,
            idempotencyKey: current.idempotencyKey,
            storeId: current.storeId,
            sellerId: current.sellerId,
            confirmedAt: current.confirmedAt,
          },
          customer.id,
          draft,
          record,
          phone,
        );
        const updated = await repository.updateQuote(quoteId, expectedVersion, next);
        if (!updated) throw new Error("报价已被其他人修改，请刷新后重试");
        await repository.writeAudit({
          actorUserId: user.id,
          storeId: current.storeId,
          quoteId,
          beforeSnapshot: { version: current.version, quoteSnapshot: current.quoteSnapshot },
          afterSnapshot: { version: updated.version, quoteSnapshot: updated.quoteSnapshot },
        });
        return presentQuote(updated);
      });
    },

    async softDeleteQuote(
      user: AuthenticatedUser,
      quoteId: string,
    ): Promise<ConfirmedQuote> {
      await requireVisibleQuote(user, quoteId);
      const updated = await options.repository.setDeletedAt(quoteId, now());
      if (!updated) throw new Error("报价单不存在");
      return updated;
    },

    async getQuote(
      user: AuthenticatedUser,
      quoteId: string,
    ): Promise<QuotePresentation> {
      return presentQuote(await requireVisibleQuote(user, quoteId));
    },

    async restoreQuote(
      user: AuthenticatedUser,
      quoteId: string,
    ): Promise<ConfirmedQuote> {
      await requireVisibleQuote(user, quoteId);
      const updated = await options.repository.setDeletedAt(quoteId, null);
      if (!updated) throw new Error("报价单不存在");
      return updated;
    },

    async recordPrint(
      user: AuthenticatedUser,
      quoteId: string,
    ): Promise<void> {
      await requireVisibleQuote(user, quoteId);
      await options.repository.recordPrint({
        quoteId,
        userId: user.id,
      });
    },
  };
};

export type QuoteService = ReturnType<typeof createQuoteService>;
