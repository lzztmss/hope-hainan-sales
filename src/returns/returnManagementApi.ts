import {
  ApiError,
  type ReturnRecordDto,
} from "../api/client";
import type { AfterSalesServiceType, ReturnKind, ReturnStatus } from "../orders/types";
import { createClientKey } from "../utils/clientKey";

export interface DecideManagedReturnInput {
  returnId: string;
  decision: "approved" | "rejected";
  note: string;
}

export interface CompleteManagedReturnInput {
  returnId: string;
  refundFen: number;
}

export interface ReturnManagementApi {
  listReturns(filters?: { status?: ReturnStatus; serviceType?: AfterSalesServiceType; returnKind?: ReturnKind; storeId?: string; sellerId?: string; page?: number; pageSize?: number }): Promise<{ items: readonly ReturnRecordDto[]; total: number; page: number; pageSize: number }>;
  decideReturn(input: DecideManagedReturnInput): Promise<ReturnRecordDto>;
  completeReturn(input: CompleteManagedReturnInput): Promise<ReturnRecordDto>;
}

export interface ReturnManagementApiOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  keyFactory?: () => string;
}

const STATUS_VALUES = new Set<ReturnStatus>([
  "requested",
  "approved",
  "rejected",
  "completed",
]);

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("服务响应格式异常，请稍后重试", response.status);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isReturnRecord = (value: unknown): value is ReturnRecordDto => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.returnNo === "string" &&
    typeof value.orderNo === "string" &&
    typeof value.orderId === "string" &&
    typeof value.requestedBy === "string" &&
    typeof value.reason === "string" &&
    typeof value.requestedAt === "string" &&
    (value.serviceType === "refund" || value.serviceType === "exchange") &&
    typeof value.requestedRefundFen === "number" &&
    typeof value.maxRefundFen === "number" &&
    typeof value.refundFen === "number" &&
    typeof value.status === "string" &&
    STATUS_VALUES.has(value.status as ReturnStatus) &&
    Array.isArray(value.items)
  );
};

const readReturn = (payload: unknown): ReturnRecordDto => {
  if (!isReturnRecord(payload)) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return payload;
};

const readReturns = (payload: unknown): readonly ReturnRecordDto[] => {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    !payload.items.every(isReturnRecord)
  ) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return payload.items;
};

const defaultKeyFactory = (): string => createClientKey("return-complete");

export const createReturnManagementApi = ({
  baseUrl = "",
  fetcher = fetch,
  keyFactory = defaultKeyFactory,
}: ReturnManagementApiOptions = {}): ReturnManagementApi => {
  const completionKeys = new Map<string, string>();

  const request = async (
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ApiError("网络连接失败，请检查网络后重试", 0);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : "请求失败，请稍后重试";
      throw new ApiError(message, response.status);
    }
    return payload;
  };

  return {
    async listReturns(filters = {}) {
      const parameters = new URLSearchParams();
      if (filters.status) parameters.set("status", filters.status);
      if (filters.serviceType) parameters.set("serviceType", filters.serviceType);
      if (filters.returnKind) parameters.set("returnKind", filters.returnKind);
      if (filters.storeId) parameters.set("storeId", filters.storeId);
      if (filters.sellerId) parameters.set("sellerId", filters.sellerId);
      parameters.set("page", String(filters.page ?? 1));
      parameters.set("pageSize", String(filters.pageSize ?? 20));
      const query = parameters.size ? `?${parameters.toString()}` : "";
      const payload = await request(`/api/returns${query}`);
      if (!isRecord(payload)) throw new ApiError("退单列表格式不正确", 500);
      return {
        items: readReturns(payload),
        total: typeof payload.total === "number" ? payload.total : 0,
        page: typeof payload.page === "number" ? payload.page : 1,
        pageSize: typeof payload.pageSize === "number" ? payload.pageSize : 20,
      };
    },
    async decideReturn(input) {
      return readReturn(
        await request(`/api/returns/${encodeURIComponent(input.returnId)}/decision`, {
          method: "POST",
          body: JSON.stringify({ decision: input.decision, note: input.note }),
        }),
      );
    },
    async completeReturn(input) {
      const fingerprint = `${input.returnId}:${input.refundFen}`;
      let key = completionKeys.get(fingerprint);
      if (!key) {
        key = keyFactory();
        completionKeys.set(fingerprint, key);
      }
      return readReturn(
        await request(`/api/returns/${encodeURIComponent(input.returnId)}/complete`, {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify({ refundFen: input.refundFen }),
        }),
      );
    },
  };
};

export const returnManagementApi = createReturnManagementApi();
