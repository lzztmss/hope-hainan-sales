import type {
  CommissionCalculation,
  CommissionOrderLine,
  CommissionRule,
  CommissionScope,
  SellerCommissionContext,
} from "../../shared/commission/types";
import type {
  QuoteCalculation,
  QuoteInput,
  RoomType,
} from "../../shared/pricing/types";
import type { MyCommissionDashboard } from "../commissions/MyCommissionPage";
import type {
  OrderPaymentMode,
  OrderStatus,
  OrderTransitionCommand,
  ReturnStatus,
  ReturnType,
} from "../orders/types";

export type ApiUserRole = "sales" | "store_manager" | "admin";

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  role: ApiUserRole;
  storeId: string | null;
  mustChangePassword: boolean;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface QuoteCustomerInput {
  name: string;
  phone: string;
  district?: string;
  address?: string;
  roomType?: RoomType;
  elderCount: number;
  source?: string;
  notes?: string;
}

export interface ConfirmQuoteInput {
  customer: QuoteCustomerInput;
  pricing: QuoteInput;
}

export interface ConfirmedQuoteSummary {
  id: string;
  quoteNo: string;
  status: "confirmed" | "converted" | "expired" | "lost" | "voided";
  confirmedAt: string;
  oneTimeFen: number;
  monthlyTotalFen: number;
  contract36Fen: number;
  calculation: QuoteCalculation;
}

export type CommissionPolicyStatus = "draft" | "published" | "stopped";

export interface CommissionPolicyVersionDto {
  id: string;
  version: number;
  name: string;
  status: CommissionPolicyStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  rules: readonly CommissionRule[];
  sourceVersionId: string | null;
  createdBy: string;
  createdAt: string;
  publishedBy: string | null;
  publishedAt: string | null;
  stoppedBy: string | null;
  stoppedAt: string | null;
  changeNote: string;
  revision: number;
}

export interface CommissionRuleDraftDto {
  sku: string;
  amountFen: number;
  paymentMode: CommissionRule["paymentMode"];
  scope: CommissionScope;
  enabled: boolean;
}

export interface CreateCommissionPolicyDraftInput {
  name: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  rules: readonly CommissionRuleDraftDto[];
  reason: string;
}

export interface UpdateCommissionRuleInput {
  amountFen: number;
  enabled: boolean;
  expectedRevision: number;
  reason: string;
}

export interface CommissionSimulationInput {
  versionId?: string;
  at?: string;
  orderLines: readonly CommissionOrderLine[];
  sellerContext: SellerCommissionContext;
}

export interface CommissionSimulationResponse {
  versionId: string;
  versionNumber: number;
  versionStatus: CommissionPolicyStatus;
  calculation: CommissionCalculation;
}

export interface CopyCommissionPolicyInput {
  name?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  rules?: readonly CommissionRuleDraftDto[];
  reason: string;
}

export interface MyCommissionDashboardQuery {
  month: string;
  cursor?: string;
  limit?: number;
}

export type MyCommissionDashboardResponse = MyCommissionDashboard & {
  nextCursor?: string | null;
};

export interface OrderCustomerDto {
  name?: string | null;
  phoneMasked?: string | null;
  address?: string | null;
  roomType?: RoomType | null;
  elderCount?: number | null;
}

export interface OrderLineDto {
  id: string | null;
  lineType: "charge" | "component";
  sku: string;
  label: string;
  unit: string;
  quantity: number;
  oneTimeUnitFen: number;
  monthlyUnitFen: number;
  oneTimeSubtotalFen: number;
  monthlySubtotalFen: number;
  locations: readonly string[];
  reason?: string | null;
}

export interface OrderDto {
  id: string;
  orderNo: string;
  quoteId: string;
  sellerId: string;
  storeId: string;
  status: OrderStatus;
  paymentMode: OrderPaymentMode;
  fttrKind: "none" | "standard" | "custom";
  fttrPlan: number | null;
  customFttrNote?: string | null;
  fttrMonthlyFen: number;
  heartMonthlyFen: number;
  oneTimeFen: number;
  monthlyTotalFen: number;
  contract36Fen: number;
  refundedFen: number;
  customer: OrderCustomerDto;
  storeSnapshot?: Readonly<Record<string, unknown>> | null;
  sellerSnapshot?: Readonly<Record<string, unknown>> | null;
  lines: readonly OrderLineDto[];
  acceptedAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListApiQuery {
  recycleBin?: boolean;
  orderNo?: string;
  customerPhoneTail?: string;
  status?: OrderStatus;
  paymentMode?: OrderPaymentMode;
  cursor?: string;
  limit?: number;
}

export interface OrderListApiResponse {
  items: readonly OrderDto[];
  nextCursor: string | null;
}

export interface OrderAttributionApiInput {
  beneficiaryId: string;
  attributionRole: "primary" | "collaborator";
  basisPoints: number;
}

export interface OrderMutationDto {
  id: string;
  orderNo: string;
  status: OrderStatus;
  version: number;
  deletedAt: string | null;
  updatedAt: string;
}

export interface ReturnItemDto {
  orderLineId: string;
  orderLineQuantity: number;
  sku: string;
  label: string;
  quantity: number;
  maxRefundFen: number;
}

export interface ReturnRecordDto {
  id: string;
  returnNo: string;
  orderId: string;
  returnType: ReturnType;
  status: ReturnStatus;
  reason: string;
  requestedBy: string;
  requestedByName?: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  completedBy: string | null;
  completedAt: string | null;
  refundFen: number;
  maxRefundFen: number;
  items: readonly ReturnItemDto[];
}

export interface RequestOrderReturnApiInput {
  type: ReturnType;
  reason: string;
  items: readonly { orderLineId: string; quantity: number }[];
}

interface ErrorPayload {
  error?: unknown;
  fieldErrors?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export interface ApiClient {
  changePassword(input: ChangePasswordInput): Promise<AuthenticatedUser>;
  copyCommissionPolicy(
    policyId: string,
    input: CopyCommissionPolicyInput,
  ): Promise<CommissionPolicyVersionDto>;
  createCommissionPolicyDraft(
    input: CreateCommissionPolicyDraftInput,
  ): Promise<CommissionPolicyVersionDto>;
  createOrderFromQuote(
    quoteId: string,
    idempotencyKey: string,
    attributions?: readonly OrderAttributionApiInput[],
  ): Promise<OrderMutationDto>;
  confirmQuote(
    input: ConfirmQuoteInput,
    idempotencyKey: string,
  ): Promise<ConfirmedQuoteSummary>;
  getCurrentUser(): Promise<AuthenticatedUser>;
  getOrder(orderId: string): Promise<OrderDto>;
  getMyCommissionDashboard(
    query: MyCommissionDashboardQuery,
  ): Promise<MyCommissionDashboardResponse>;
  listCommissionPolicyVersions(): Promise<readonly CommissionPolicyVersionDto[]>;
  listOrderReturns(orderId: string): Promise<readonly ReturnRecordDto[]>;
  listOrders(query: OrderListApiQuery): Promise<OrderListApiResponse>;
  login(input: LoginInput): Promise<AuthenticatedUser>;
  logout(): Promise<void>;
  recordQuotePrint(quoteId: string): Promise<void>;
  requestOrderReturn(
    orderId: string,
    input: RequestOrderReturnApiInput,
    idempotencyKey: string,
  ): Promise<ReturnRecordDto>;
  decideOrderReturn(
    returnId: string,
    decision: "approved" | "rejected",
    note: string,
  ): Promise<ReturnRecordDto>;
  completeOrderReturn(
    returnId: string,
    refundFen: number,
    idempotencyKey: string,
  ): Promise<ReturnRecordDto>;
  deleteOrder(orderId: string): Promise<OrderMutationDto>;
  publishCommissionPolicy(
    policyId: string,
    reason: string,
  ): Promise<CommissionPolicyVersionDto>;
  simulateCommission(
    input: CommissionSimulationInput,
  ): Promise<CommissionSimulationResponse>;
  stopCommissionPolicy(
    policyId: string,
    reason: string,
  ): Promise<CommissionPolicyVersionDto>;
  restoreOrder(orderId: string): Promise<OrderMutationDto>;
  transitionOrder(
    orderId: string,
    command: OrderTransitionCommand,
    expectedVersion: number,
  ): Promise<OrderMutationDto>;
  updateCommissionRule(
    policyId: string,
    ruleId: string,
    input: UpdateCommissionRuleInput,
  ): Promise<CommissionPolicyVersionDto>;
}

type ApiClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value).every((item) => typeof item === "string"),
  );

const readJson = async (response: Response): Promise<unknown> => {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("服务响应格式异常，请稍后重试", response.status);
  }
};

const readUser = (payload: unknown): AuthenticatedUser => {
  if (!payload || typeof payload !== "object" || !("user" in payload)) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }

  return (payload as { user: AuthenticatedUser }).user;
};

const readConfirmedQuote = (payload: unknown): ConfirmedQuoteSummary => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("id" in payload) ||
    typeof payload.id !== "string" ||
    !("quoteNo" in payload) ||
    typeof payload.quoteNo !== "string" ||
    !("calculation" in payload) ||
    !payload.calculation ||
    typeof payload.calculation !== "object"
  ) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }

  return payload as ConfirmedQuoteSummary;
};

const readProperty = <T>(payload: unknown, property: string): T => {
  if (!payload || typeof payload !== "object" || !(property in payload)) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return (payload as Record<string, T>)[property]!;
};

const readCommissionDashboard = (
  payload: unknown,
): MyCommissionDashboardResponse => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("summary" in payload) ||
    !("orders" in payload) ||
    !Array.isArray(payload.orders)
  ) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return payload as MyCommissionDashboardResponse;
};

const readOrder = (payload: unknown): OrderDto => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("id" in payload) ||
    typeof payload.id !== "string" ||
    !("orderNo" in payload) ||
    typeof payload.orderNo !== "string"
  ) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return payload as OrderDto;
};

const readOrderList = (payload: unknown): OrderListApiResponse => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("items" in payload) ||
    !Array.isArray(payload.items)
  ) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return payload as OrderListApiResponse;
};

const readReturnRecord = (payload: unknown): ReturnRecordDto => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("id" in payload) ||
    typeof payload.id !== "string" ||
    !("returnNo" in payload) ||
    typeof payload.returnNo !== "string"
  ) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return payload as ReturnRecordDto;
};

const mergeHeaders = (init: RequestInit): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  };
  if (!init.headers) return headers;

  if (init.headers instanceof Headers) {
    init.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  if (Array.isArray(init.headers)) {
    for (const [key, value] of init.headers) headers[key] = value;
    return headers;
  }

  return { ...headers, ...init.headers };
};

export const createApiClient = ({
  baseUrl = "",
  fetcher = fetch,
}: ApiClientOptions = {}): ApiClient => {
  const request = async (
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        credentials: "include",
        headers: mergeHeaders(init),
      });
    } catch {
      throw new ApiError("网络连接失败，请检查网络后重试", 0);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const errorPayload = (payload ?? {}) as ErrorPayload;
      throw new ApiError(
        typeof errorPayload.error === "string"
          ? errorPayload.error
          : "请求失败，请稍后重试",
        response.status,
        isStringRecord(errorPayload.fieldErrors)
          ? errorPayload.fieldErrors
          : undefined,
      );
    }

    return payload;
  };

  return {
    async getCurrentUser() {
      return readUser(await request("/api/auth/me"));
    },
    async login(input) {
      return readUser(
        await request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    },
    async logout() {
      await request("/api/auth/logout", { method: "POST" });
    },
    async changePassword(input) {
      return readUser(
        await request("/api/auth/change-password", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      );
    },
    async confirmQuote(input, idempotencyKey) {
      return readConfirmedQuote(
        await request("/api/quotes", {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "Idempotency-Key": idempotencyKey },
        }),
      );
    },
    async recordQuotePrint(quoteId) {
      await request(`/api/quotes/${encodeURIComponent(quoteId)}/print`, {
        method: "POST",
      });
    },
    async createOrderFromQuote(quoteId, orderKey, attributions) {
      return (await request("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": orderKey },
        body: JSON.stringify({
          quoteId,
          ...(attributions ? { attributions } : {}),
        }),
      })) as OrderMutationDto;
    },
    async getMyCommissionDashboard(query) {
      const parameters = new URLSearchParams({ month: query.month });
      if (query.cursor) parameters.set("cursor", query.cursor);
      if (query.limit !== undefined) {
        parameters.set("limit", String(query.limit));
      }
      return readCommissionDashboard(
        await request(`/api/commissions/me?${parameters.toString()}`),
      );
    },
    async listOrders(query) {
      const parameters = new URLSearchParams();
      if (query.orderNo) parameters.set("orderNo", query.orderNo);
      if (query.customerPhoneTail) {
        parameters.set("customerPhoneTail", query.customerPhoneTail);
      }
      if (query.status) parameters.set("status", query.status);
      if (query.paymentMode) parameters.set("paymentMode", query.paymentMode);
      if (query.cursor) parameters.set("cursor", query.cursor);
      parameters.set("limit", String(query.limit ?? 100));
      const path = query.recycleBin
        ? "/api/orders/recycle-bin"
        : "/api/orders";
      return readOrderList(await request(`${path}?${parameters.toString()}`));
    },
    async getOrder(orderId) {
      return readOrder(
        await request(`/api/orders/${encodeURIComponent(orderId)}`),
      );
    },
    async transitionOrder(orderId, command, expectedVersion) {
      return (await request(
        `/api/orders/${encodeURIComponent(orderId)}/transitions`,
        {
          method: "POST",
          body: JSON.stringify({ command, expectedVersion }),
        },
      )) as OrderMutationDto;
    },
    async deleteOrder(orderId) {
      return (await request(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: "DELETE",
      })) as OrderMutationDto;
    },
    async restoreOrder(orderId) {
      return (await request(
        `/api/orders/${encodeURIComponent(orderId)}/restore`,
        { method: "POST" },
      )) as OrderMutationDto;
    },
    async listOrderReturns(orderId) {
      return readProperty<readonly ReturnRecordDto[]>(
        await request(
          `/api/orders/${encodeURIComponent(orderId)}/returns`,
        ),
        "items",
      );
    },
    async requestOrderReturn(orderId, input, requestKey) {
      return readReturnRecord(
        await request(
          `/api/orders/${encodeURIComponent(orderId)}/returns`,
          {
            method: "POST",
            headers: { "Idempotency-Key": requestKey },
            body: JSON.stringify(input),
          },
        ),
      );
    },
    async decideOrderReturn(returnId, decision, note) {
      return readReturnRecord(
        await request(
          `/api/returns/${encodeURIComponent(returnId)}/decision`,
          {
            method: "POST",
            body: JSON.stringify({ decision, note }),
          },
        ),
      );
    },
    async completeOrderReturn(returnId, refundFen, completionKey) {
      return readReturnRecord(
        await request(
          `/api/returns/${encodeURIComponent(returnId)}/complete`,
          {
            method: "POST",
            headers: { "Idempotency-Key": completionKey },
            body: JSON.stringify({ refundFen }),
          },
        ),
      );
    },
    async listCommissionPolicyVersions() {
      return readProperty<readonly CommissionPolicyVersionDto[]>(
        await request("/api/admin/commission-policy-versions"),
        "versions",
      );
    },
    async createCommissionPolicyDraft(input) {
      return readProperty<CommissionPolicyVersionDto>(
        await request("/api/admin/commission-policy-versions", {
          method: "POST",
          body: JSON.stringify(input),
        }),
        "version",
      );
    },
    async updateCommissionRule(policyId, ruleId, input) {
      return readProperty<CommissionPolicyVersionDto>(
        await request(
          `/api/admin/commission-policy-versions/${encodeURIComponent(policyId)}/rules/${encodeURIComponent(ruleId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(input),
          },
        ),
        "version",
      );
    },
    async simulateCommission(input) {
      return (await request("/api/admin/commission-simulate", {
        method: "POST",
        body: JSON.stringify(input),
      })) as CommissionSimulationResponse;
    },
    async publishCommissionPolicy(policyId, reason) {
      return readProperty<CommissionPolicyVersionDto>(
        await request(
          `/api/admin/commission-policy-versions/${encodeURIComponent(policyId)}/publish`,
          { method: "POST", body: JSON.stringify({ reason }) },
        ),
        "version",
      );
    },
    async stopCommissionPolicy(policyId, reason) {
      return readProperty<CommissionPolicyVersionDto>(
        await request(
          `/api/admin/commission-policy-versions/${encodeURIComponent(policyId)}/stop`,
          { method: "POST", body: JSON.stringify({ reason }) },
        ),
        "version",
      );
    },
    async copyCommissionPolicy(policyId, input) {
      return readProperty<CommissionPolicyVersionDto>(
        await request(
          `/api/admin/commission-policy-versions/${encodeURIComponent(policyId)}/copy`,
          { method: "POST", body: JSON.stringify(input) },
        ),
        "version",
      );
    },
  };
};

export const apiClient = createApiClient();
