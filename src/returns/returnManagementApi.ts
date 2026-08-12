import {
  ApiError,
  type ReturnRecordDto,
} from "../api/client";
import type { ReturnStatus } from "../orders/types";

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
  listReturns(status?: ReturnStatus): Promise<readonly ReturnRecordDto[]>;
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
    typeof value.orderId === "string" &&
    typeof value.requestedBy === "string" &&
    typeof value.reason === "string" &&
    typeof value.requestedAt === "string" &&
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

const defaultKeyFactory = (): string => {
  if (typeof crypto.randomUUID === "function") {
    return `return-complete-${crypto.randomUUID()}`;
  }
  return `return-complete-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

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
    async listReturns(status) {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return readReturns(await request(`/api/returns${query}`));
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
