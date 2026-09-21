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
  SubscriptionPlanDefinition,
  SubscriptionPlanItem,
} from "../../shared/pricing/types";
import type { RegionalCommissionRules } from "../../shared/regionalCommission/types";
import type { SalesOrderTrendResponse } from "../../shared/reports/types";
import type { MyCommissionDashboard } from "../commissions/MyCommissionPage";
import type {
  OrderPaymentMode,
  OrderStatus,
  OrderTransitionCommand,
  ReturnStatus,
  ReturnType,
} from "../orders/types";
import { APP_BASE_PATH } from "../appBasePath";

export type ApiUserRole = "sales" | "store_manager" | "regional_manager" | "hr" | "finance" | "admin";

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  role: ApiUserRole;
  storeId: string | null;
  storeName?: string | null;
  mustChangePassword: boolean;
  managedStores?: readonly { id: string; name: string }[];
}
export interface RegionalCommissionSummaryQuery { managerId?: string; month?: string; }
export type RegionalVerificationStatus = "pending" | "verified" | "rejected";
export type RegionalCooperationStatus = "submitted" | "finance_verified" | "confirmed" | "revoked";
export interface RegionalReceiptDto {
  id: string;
  month: string;
  netReceiptFen: number;
  evidenceNo: string;
  note: string | null;
  verificationStatus: RegionalVerificationStatus;
  verificationReason: string | null;
}
export interface RegionalCooperationDto {
  id: string;
  stageCode: string;
  stageLabel: string;
  amountFen: number;
  achievedOn: string;
  evidenceNo: string;
  note: string | null;
  status: RegionalCooperationStatus;
  revokeReason: string | null;
  condition?: { label: string; satisfied: boolean };
}
export type RegionalTargetPlanType = "quarter" | "half_year" | "year";
export interface RegionalTargetPlanPeriodDto {
  id?: string;
  sequence: number;
  startsOn: string;
  endsOn: string;
  targetOrderCount: number;
  cumulativeTargetOrderCount: number;
}
export interface RegionalTargetPlanDto {
  id: string;
  regionalManagerId: string;
  planType: RegionalTargetPlanType;
  periodCount: number;
  startsOn: string;
  endsOn: string;
  isPreset: boolean;
  status: "draft" | "active" | "replaced";
  replacedByPlanId: string | null;
  changeReason: string;
  periods: readonly RegionalTargetPlanPeriodDto[];
}
export interface RegionalPersonalOrderLineDto {
  id: string;
  sku: string;
  label: string;
  quantity: number;
  returnedQuantity: number;
  unitCommissionFen: number;
  subtotalFen: number;
}
export interface RegionalPersonalOrderDto {
  id: string;
  orderNo: string;
  regionalManagerId: string;
  channel: string;
  orderCount: number;
  businessDate: string;
  signedOn: string;
  effectiveOn: string;
  evidenceNo: string;
  note: string | null;
  status: "active" | "returned" | "voided";
  voidReason: string | null;
  returnedOn: string | null;
  returnReason: string | null;
  lines: readonly RegionalPersonalOrderLineDto[];
}
export interface RegionalCommissionSummary {
  managerId: string; month: string; templateVersionId: string | null;
  templateName: string | null; templateVersionNo: number | null; templateEffectiveFrom: string | null; templateEffectiveTo: string | null;
  targetPlanId: string | null; targetPlanType: RegionalTargetPlanType | null; targetPlanStartsOn: string | null; targetPlanEndsOn: string | null; targetPlanStatus: RegionalTargetPlanDto["status"] | null;
  statisticsStartsOn: string | null; statisticsEndsOn: string;
  employmentStartDate: string | null; employmentEndDate: string | null;
  orderCount: number; managedOrderCount: number; personalOrderCount: number;
  completionFen: number; tieredOrderFen: number; milestoneFen: number; topUpFen: number; revenueAccelerationFen: number; currentMonthRevenueAccelerationFen: number; personalProductFen: number; cooperationFen: number; directReturnFen: number; totalFen: number;
  settlementPreviewFen: number;
  settlementCoveredBy?: { id: string; settlementMonth: string; status: "confirmed" | "paid"; totalFen: number } | null;
  settlementEntries: readonly { category: string; accruedFen: number; previouslySettledFen: number; payableFen: number }[];
  periods: readonly { sequence: number; startsOn: string; endsOn: string; targetOrderCount: number; orderCount: number; cumulativeOrderCount: number; rewardFen: number }[];
  receipt: RegionalReceiptDto | null;
  cooperation: readonly RegionalCooperationDto[];
  revenueAcceleration: { unlockOrderCount: number; currentOrderCount: number; unlocked: boolean; ratePartsPerMillion: number; monthlyCapFen: number };
}
export interface RegionalValidOrderItem {
  id: string;
  source: "store" | "personal";
  orderNo: string;
  place: string;
  signedOn: string | null;
  effectiveOn: string;
  orderCount: number;
  status: "valid" | "returned";
  periodSequence: number | null;
}
export interface RegionalValidOrdersReport {
  month: string;
  statisticsStartsOn: string | null;
  statisticsEndsOn: string;
  targetPlanStartsOn: string | null;
  targetPlanEndsOn: string | null;
  managedOrderCount: number;
  personalOrderCount: number;
  orderCount: number;
  periods: readonly { sequence: number; startsOn: string; endsOn: string }[];
  items: readonly RegionalValidOrderItem[];
}
export interface RegionalManagerOption { id: string; displayName: string; workNo: string; active: boolean; employmentStartDate: string | null; employmentEndDate: string | null; }
export interface RegionalTemplateDto {
  id: string;
  name: string;
  templateCode: string;
  versionNo: number;
  status: "draft" | "published" | "stopped";
  effectiveFrom: string;
  effectiveTo: string | null;
  rulesSnapshot: RegionalCommissionRules;
  changeReason: string;
}
export interface RegionalStatementDto {
  id: string;
  settlementMonth: string;
  status: "draft" | "confirmed" | "paid";
  totalFen: number;
  templateVersionId: string;
  targetPlanId: string | null;
  calculationSnapshot: RegionalCommissionSummary;
  confirmedAt: string | null;
  paidAt: string | null;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword?: string;
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

export type SubscriptionPlanDto = SubscriptionPlanDefinition;

export interface SaveSubscriptionPlanInput {
  code: string;
  name: string;
  description?: string | null;
  monthlyFen: number;
  active: boolean;
  items: readonly SubscriptionPlanItem[];
  reason: string;
  expectedVersion?: number;
}

export interface DeleteSubscriptionPlanInput {
  expectedVersion: number;
  reason: string;
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

export type QuoteStatus = ConfirmedQuoteSummary["status"];

export interface QuoteDetailDto {
  id: string;
  quoteNo: string;
  status: QuoteStatus;
  sellerId: string;
  storeId: string;
  confirmedAt: string;
  deletedAt: string | null;
  version: number;
  updatedAt: string;
  customer: QuoteCustomerInput & { phoneMasked: string };
  calculation: QuoteCalculation;
  pricing: QuoteInput;
}

export interface QuoteListQuery {
  query?: string;
  status?: QuoteStatus;
  storeId?: string;
  sellerId?: string;
  dateFrom?: string;
  dateTo?: string;
  deletedOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CustomerListQuery {
  query?: string;
  storeId?: string;
  sellerId?: string;
  page?: number;
  pageSize?: number;
}

export interface CustomerListItemDto {
  id: string;
  storeId: string;
  storeName: string;
  ownerUserId: string;
  ownerName: string;
  name: string;
  phoneMasked: string;
  roomType: string | null;
  elderCount: number;
  quoteCount: number;
  orderCount: number;
  lastQuoteAt: string | null;
  updatedAt: string;
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
  page?: number;
  limit?: number;
}

export interface CommissionDashboardQuery extends MyCommissionDashboardQuery {
  storeId?: string;
  beneficiaryId?: string;
}

export type MyCommissionDashboardResponse = MyCommissionDashboard & {
  nextCursor?: string | null;
  total: number;
  page: number;
  pageSize: number;
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
  hardwareNumbers: readonly string[];
  reason?: string | null;
}

export interface OrderDto {
  id: string;
  orderNo: string;
  quoteId: string;
  sellerId: string;
  storeId: string;
  status: OrderStatus;
  salesChannel: "online" | "offline";
  paymentMode: OrderPaymentMode;
  subscriptionPlanId: string | null;
  oneTimeFen: number;
  monthlyTotalFen: number;
  contract36Fen: number;
  refundedFen: number;
  commissionPayoutStatus: "ineligible" | "pending" | "paid";
  commissionNetFen: number;
  commissionPaidFen: number;
  commissionReversedFen: number;
  customer: OrderCustomerDto;
  storeSnapshot?: Readonly<Record<string, unknown>> | null;
  sellerSnapshot?: Readonly<Record<string, unknown>> | null;
  lines: readonly OrderLineDto[];
  acceptedAt: string | null;
  activatedAt: string | null;
  signedAt: string | null;
  signedBy: string | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
  paidAt: string | null;
  paidBy: string | null;
  lifecycleEvents?: readonly {
    action: string;
    actorName: string;
    at: string;
  }[];
  cancelledAt: string | null;
  deletedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListApiQuery {
  recycleBin?: boolean;
  query?: string;
  orderNo?: string;
  customerPhoneTail?: string;
  storeQuery?: string;
  sellerQuery?: string;
  status?: OrderStatus;
  statuses?: readonly OrderStatus[];
  paymentMode?: OrderPaymentMode;
  signedDateFrom?: string;
  signedDateTo?: string;
  reconciledDateFrom?: string;
  reconciledDateTo?: string;
  commissionPayoutStatus?: "ineligible" | "pending" | "paid";
  reconciliationStatus?: "pending" | "reconciled";
  collectionStatus?: "unpaid" | "paid";
  cursor?: string;
  page?: number;
  limit?: number;
}

export interface OrderListApiResponse {
  items: readonly OrderDto[];
  nextCursor: string | null;
  total: number;
  page: number;
  pageSize: number;
}

export interface OrderExportDownload {
  blob: Blob;
  filename: string;
  orderCount: number | null;
}

export interface OrderFilterOptionsApiResponse {
  stores: Array<{ id: string; label: string }>;
  sellers: Array<{ id: string; label: string; storeId: string }>;
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
  salesChannel: "online" | "offline";
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
  orderNo: string;
  orderId: string;
  serviceType: "refund" | "exchange";
  returnType: ReturnType;
  returnKind: "normal" | "special";
  reasonCategory: "no_reason" | "quality" | "order_mismatch" | "service_issue" | "other";
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
  requestedRefundFen: number;
  refundFen: number;
  maxRefundFen: number;
  items: readonly ReturnItemDto[];
}

export interface RequestOrderReturnApiInput {
  serviceType: "refund" | "exchange";
  type: ReturnType;
  kind: "normal" | "special";
  reasonCategory: "no_reason" | "quality" | "order_mismatch" | "service_issue" | "other";
  requestedRefundFen: number;
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
  listSubscriptionPlans(includeInactive?: boolean): Promise<readonly SubscriptionPlanDto[]>;
  createSubscriptionPlan(input: SaveSubscriptionPlanInput): Promise<SubscriptionPlanDto>;
  updateSubscriptionPlan(id: string, input: SaveSubscriptionPlanInput): Promise<SubscriptionPlanDto>;
  deleteSubscriptionPlan(id: string, input: DeleteSubscriptionPlanInput): Promise<void>;
  createOrderFromQuote(
    quoteId: string,
    idempotencyKey: string,
    salesChannel: "online" | "offline",
    attributions?: readonly OrderAttributionApiInput[],
  ): Promise<OrderMutationDto>;
  confirmQuote(
    input: ConfirmQuoteInput,
    idempotencyKey: string,
  ): Promise<ConfirmedQuoteSummary>;
  getQuote(quoteId: string): Promise<QuoteDetailDto>;
  listQuotes(query?: QuoteListQuery): Promise<{ items: readonly QuoteDetailDto[]; total: number; page: number; pageSize: number }>;
  listCustomers(query?: CustomerListQuery): Promise<{ items: readonly CustomerListItemDto[]; total: number; page: number; pageSize: number }>;
  updateQuote(
    quoteId: string,
    input: ConfirmQuoteInput,
    expectedVersion: number,
  ): Promise<QuoteDetailDto>;
  getCurrentUser(): Promise<AuthenticatedUser>;
  getOrder(orderId: string): Promise<OrderDto>;
  getMyCommissionDashboard(
    query: MyCommissionDashboardQuery,
  ): Promise<MyCommissionDashboardResponse>;
  getCommissionDashboard(
    query: CommissionDashboardQuery,
  ): Promise<MyCommissionDashboardResponse>;
  listCommissionPolicyVersions(): Promise<readonly CommissionPolicyVersionDto[]>;
  listOrderReturns(orderId: string): Promise<readonly ReturnRecordDto[]>;
  listOrders(query: OrderListApiQuery): Promise<OrderListApiResponse>;
  getSalesOrderTrend(query: { from: string; to: string }): Promise<SalesOrderTrendResponse>;
  exportOrders(query: OrderListApiQuery): Promise<OrderExportDownload>;
  listOrderFilterOptions(): Promise<OrderFilterOptionsApiResponse>;
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
    actualSignedDate?: string,
  ): Promise<OrderMutationDto>;
  batchTransitionOrders(
    items: readonly { orderId: string; expectedVersion: number }[],
    command: "RECONCILE" | "MARK_PAID",
  ): Promise<{ updated: number }>;
  batchPayOrderCommissions(orderIds: readonly string[], idempotencyKey: string): Promise<{ paidOrders: number; totalFen: number }>;
  updateCommissionRule(
    policyId: string,
    ruleId: string,
    input: UpdateCommissionRuleInput,
  ): Promise<CommissionPolicyVersionDto>;
  getRegionalCommissionSummary(query?: RegionalCommissionSummaryQuery): Promise<RegionalCommissionSummary>;
  listRegionalValidOrders(query?: RegionalCommissionSummaryQuery): Promise<RegionalValidOrdersReport>;
  listRegionalTargetPlans(managerId: string): Promise<readonly RegionalTargetPlanDto[]>;
  createSuggestedRegionalTargetPlan(managerId: string, reason: string): Promise<RegionalTargetPlanDto>;
  saveRegionalTargetPlan(input: { id?: string; managerId: string; planType: RegionalTargetPlanType; startsOn: string; periodTargets: readonly number[]; reason: string }): Promise<RegionalTargetPlanDto>;
  activateRegionalTargetPlan(id: string, reason: string): Promise<RegionalTargetPlanDto>;
  listRegionalPersonalOrders(managerId: string): Promise<{ items: readonly RegionalPersonalOrderDto[] }>;
  createRegionalPersonalOrder(input: Record<string, unknown>): Promise<{ id: string }>;
  returnRegionalPersonalOrder(id: string, input: Record<string, unknown>): Promise<void>;
  voidRegionalPersonalOrder(id: string, reason: string): Promise<void>;
  saveRegionalReceipt(input: { managerId: string; month: string; netReceiptFen: number; evidenceNo: string; note?: string }): Promise<{ id: string }>;
  listRegionalManagers(): Promise<readonly RegionalManagerOption[]>;
  listRegionalTemplates(): Promise<readonly RegionalTemplateDto[]>;
  createRegionalTemplate(input: { name: string; effectiveFrom: string; reason: string }): Promise<RegionalTemplateDto>;
  updateRegionalTemplate(id: string, input: { rules: RegionalCommissionRules; reason: string }): Promise<RegionalTemplateDto>;
  copyRegionalTemplate(id: string, input: { name?: string; effectiveFrom: string; reason: string }): Promise<RegionalTemplateDto>;
  publishRegionalTemplate(id: string, reason: string): Promise<RegionalTemplateDto>;
  stopRegionalTemplate(id: string, reason: string): Promise<RegionalTemplateDto>;
  assignRegionalTemplate(input: { managerId: string; templateVersionId: string; effectiveFrom: string; reason: string }): Promise<void>;
  listRegionalCooperation(managerId: string): Promise<readonly RegionalCooperationDto[]>;
  submitRegionalCooperation(input: { managerId: string; stageCode: string; achievedOn: string; evidenceNo: string; note?: string }): Promise<RegionalCooperationDto>;
  transitionRegionalCooperation(id: string, action: "verify" | "confirm" | "revoke", reason?: string): Promise<void>;
  calculateRegionalStatement(managerId: string, month: string): Promise<RegionalStatementDto>;
  listRegionalStatements(managerId: string): Promise<readonly RegionalStatementDto[]>;
  transitionRegionalStatement(id: string, action: "confirm" | "pay"): Promise<RegionalStatementDto>;
  verifyRegionalReceipt(id: string, approved: boolean, reason?: string): Promise<void>;
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

const readQuoteDetail = (payload: unknown): QuoteDetailDto => {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("id" in payload) ||
    typeof payload.id !== "string" ||
    !("quoteNo" in payload) ||
    typeof payload.quoteNo !== "string" ||
    !("customer" in payload) ||
    !("pricing" in payload) ||
    !("calculation" in payload)
  ) {
    throw new ApiError("服务响应格式异常，请稍后重试", 500);
  }
  return payload as QuoteDetailDto;
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
    typeof payload.returnNo !== "string" ||
    !("orderNo" in payload) ||
    typeof payload.orderNo !== "string"
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

  const requestDownload = async (path: string): Promise<OrderExportDownload> => {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        credentials: "include",
        headers: {
          Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });
    } catch {
      throw new ApiError("网络连接失败，请检查网络后重试", 0);
    }
    if (!response.ok) {
      const payload = await readJson(response);
      const errorPayload = (payload ?? {}) as ErrorPayload;
      throw new ApiError(
        typeof errorPayload.error === "string"
          ? errorPayload.error
          : "导出失败，请稍后重试",
        response.status,
      );
    }
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const fallback = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
    let filename = fallback ?? "订单对账明细.xlsx";
    if (encoded) {
      try {
        filename = decodeURIComponent(encoded);
      } catch {
        filename = "订单对账明细.xlsx";
      }
    }
    const countHeader = response.headers.get("X-Export-Order-Count");
    const parsedCount = countHeader === null ? Number.NaN : Number(countHeader);
    return {
      blob: await response.blob(),
      filename,
      orderCount: Number.isSafeInteger(parsedCount) ? parsedCount : null,
    };
  };

  const orderQueryParameters = (query: OrderListApiQuery): URLSearchParams => {
    const parameters = new URLSearchParams();
    if (query.query) parameters.set("query", query.query);
    if (query.orderNo) parameters.set("orderNo", query.orderNo);
    if (query.customerPhoneTail) parameters.set("customerPhoneTail", query.customerPhoneTail);
    if (query.storeQuery) parameters.set("storeQuery", query.storeQuery);
    if (query.sellerQuery) parameters.set("sellerQuery", query.sellerQuery);
    if (query.status) parameters.set("status", query.status);
    if (query.statuses?.length) parameters.set("statuses", query.statuses.join(","));
    if (query.paymentMode) parameters.set("paymentMode", query.paymentMode);
    if (query.signedDateFrom) parameters.set("signedDateFrom", query.signedDateFrom);
    if (query.signedDateTo) parameters.set("signedDateTo", query.signedDateTo);
    if (query.reconciledDateFrom) parameters.set("reconciledDateFrom", query.reconciledDateFrom);
    if (query.reconciledDateTo) parameters.set("reconciledDateTo", query.reconciledDateTo);
    if (query.commissionPayoutStatus) parameters.set("commissionPayoutStatus", query.commissionPayoutStatus);
    if (query.reconciliationStatus) parameters.set("reconciliationStatus", query.reconciliationStatus);
    if (query.collectionStatus) parameters.set("collectionStatus", query.collectionStatus);
    return parameters;
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
    async listSubscriptionPlans(includeInactive = false) {
      const suffix = includeInactive ? "?includeInactive=true" : "";
      return readProperty<readonly SubscriptionPlanDto[]>(
        await request(`/api/subscription-plans${suffix}`),
        "plans",
      );
    },
    async createSubscriptionPlan(input) {
      return readProperty<SubscriptionPlanDto>(
        await request("/api/subscription-plans", {
          method: "POST",
          body: JSON.stringify(input),
        }),
        "plan",
      );
    },
    async updateSubscriptionPlan(id, input) {
      return readProperty<SubscriptionPlanDto>(
        await request(`/api/subscription-plans/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify(input),
        }),
        "plan",
      );
    },
    async deleteSubscriptionPlan(id, input) {
      await request(`/api/subscription-plans/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify(input),
      });
    },
    async getQuote(quoteId) {
      return readQuoteDetail(
        await request(`/api/quotes/${encodeURIComponent(quoteId)}`),
      );
    },
    async listQuotes(query = {}) {
      const parameters = new URLSearchParams();
      if (query.query) parameters.set("query", query.query);
      if (query.query) parameters.set("query", query.query);
      if (query.status) parameters.set("status", query.status);
      if (query.storeId) parameters.set("storeId", query.storeId);
      if (query.sellerId) parameters.set("sellerId", query.sellerId);
      if (query.dateFrom) parameters.set("dateFrom", query.dateFrom);
      if (query.dateTo) parameters.set("dateTo", query.dateTo);
      if (query.deletedOnly) parameters.set("deletedOnly", "true");
      parameters.set("page", String(query.page ?? 1));
      parameters.set("pageSize", String(query.pageSize ?? 20));
      const payload = await request(`/api/quotes?${parameters.toString()}`);
      const items = readProperty<unknown[]>(payload, "items").map(readQuoteDetail);
      return {
        items,
        total: readProperty<number>(payload, "total"),
        page: readProperty<number>(payload, "page"),
        pageSize: readProperty<number>(payload, "pageSize"),
      };
    },
    async listCustomers(query = {}) {
      const parameters = new URLSearchParams({
        page: String(query.page ?? 1),
        pageSize: String(query.pageSize ?? 20),
      });
      if (query.query?.trim()) parameters.set("query", query.query.trim());
      if (query.storeId) parameters.set("storeId", query.storeId);
      if (query.sellerId) parameters.set("sellerId", query.sellerId);
      return (await request(`/api/customers?${parameters.toString()}`)) as {
        items: readonly CustomerListItemDto[];
        total: number;
        page: number;
        pageSize: number;
      };
    },
    async updateQuote(quoteId, input, expectedVersion) {
      return readQuoteDetail(
        await request(`/api/quotes/${encodeURIComponent(quoteId)}`, {
          method: "PUT",
          body: JSON.stringify({ ...input, expectedVersion }),
        }),
      );
    },
    async recordQuotePrint(quoteId) {
      await request(`/api/quotes/${encodeURIComponent(quoteId)}/print`, {
        method: "POST",
      });
    },
    async createOrderFromQuote(quoteId, orderKey, salesChannel, attributions) {
      return (await request("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": orderKey },
        body: JSON.stringify({
          quoteId,
          salesChannel,
          ...(attributions ? { attributions } : {}),
        }),
      })) as OrderMutationDto;
    },
    async getMyCommissionDashboard(query) {
      const parameters = new URLSearchParams({ month: query.month });
      if (query.cursor) parameters.set("cursor", query.cursor);
      if (query.page) parameters.set("page", String(query.page));
      if (query.limit !== undefined) {
        parameters.set("limit", String(query.limit));
      }
      return readCommissionDashboard(
        await request(`/api/commissions/me?${parameters.toString()}`),
      );
    },
    async getCommissionDashboard(query) {
      const parameters = new URLSearchParams({ month: query.month });
      if (query.storeId) parameters.set("storeId", query.storeId);
      if (query.beneficiaryId) parameters.set("beneficiaryId", query.beneficiaryId);
      if (query.cursor) parameters.set("cursor", query.cursor);
      if (query.page) parameters.set("page", String(query.page));
      if (query.limit !== undefined) parameters.set("limit", String(query.limit));
      return readCommissionDashboard(
        await request(`/api/commissions/dashboard?${parameters.toString()}`),
      );
    },
    async listOrders(query) {
      const parameters = orderQueryParameters(query);
      if (query.cursor) parameters.set("cursor", query.cursor);
      if (query.page) parameters.set("page", String(query.page));
      parameters.set("limit", String(query.limit ?? 100));
      const path = query.recycleBin
        ? "/api/orders/recycle-bin"
        : "/api/orders";
      return readOrderList(await request(`${path}?${parameters.toString()}`));
    },
    async getSalesOrderTrend(query) {
      const parameters = new URLSearchParams({ from: query.from, to: query.to });
      return (await request(
        `/api/reports/sales/order-trend?${parameters.toString()}`,
      )) as SalesOrderTrendResponse;
    },
    async exportOrders(query) {
      const parameters = orderQueryParameters(query);
      return requestDownload(`/api/orders/export?${parameters.toString()}`);
    },
    async listOrderFilterOptions() {
      return (await request("/api/order-filter-options")) as OrderFilterOptionsApiResponse;
    },
    async getOrder(orderId) {
      return readOrder(
        await request(`/api/orders/${encodeURIComponent(orderId)}`),
      );
    },
    async transitionOrder(orderId, command, expectedVersion, actualSignedDate) {
      return (await request(
        `/api/orders/${encodeURIComponent(orderId)}/transitions`,
        {
          method: "POST",
          body: JSON.stringify({ command, expectedVersion, ...(actualSignedDate ? { actualSignedDate } : {}) }),
        },
      )) as OrderMutationDto;
    },
    async batchTransitionOrders(items, command) {
      return (await request("/api/orders/batch-transitions", {
        method: "POST",
        body: JSON.stringify({ items, command }),
      })) as { updated: number };
    },
    async batchPayOrderCommissions(orderIds, idempotencyKey) {
      return (await request("/api/orders/batch-commission-payout", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ orderIds }),
      })) as { paidOrders: number; totalFen: number };
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
    async getRegionalCommissionSummary(query = {}) { const parameters = new URLSearchParams(); if (query.managerId) parameters.set("managerId", query.managerId); if (query.month) parameters.set("month", query.month); return (await request(`/api/regional-commissions/summary?${parameters.toString()}`)) as RegionalCommissionSummary; },
    async listRegionalValidOrders(query: RegionalCommissionSummaryQuery = {}) { const parameters = new URLSearchParams(); if (query.managerId) parameters.set("managerId", query.managerId); if (query.month) parameters.set("month", query.month); return (await request(`/api/regional-commissions/valid-orders?${parameters.toString()}`)) as RegionalValidOrdersReport; },
    async listRegionalTargetPlans(managerId) { return readProperty<readonly RegionalTargetPlanDto[]>(await request(`/api/regional-commissions/target-plans?managerId=${encodeURIComponent(managerId)}`), "items"); },
    async createSuggestedRegionalTargetPlan(managerId, reason) { return (await request("/api/regional-commissions/target-plans/suggest", { method: "POST", body: JSON.stringify({ managerId, reason }) })) as RegionalTargetPlanDto; },
    async saveRegionalTargetPlan(input) { return (await request("/api/regional-commissions/target-plans", { method: "POST", body: JSON.stringify(input) })) as RegionalTargetPlanDto; },
    async activateRegionalTargetPlan(id, reason) { return (await request(`/api/regional-commissions/target-plans/${encodeURIComponent(id)}/activate`, { method: "POST", body: JSON.stringify({ reason }) })) as RegionalTargetPlanDto; },
    async listRegionalPersonalOrders(managerId) { return (await request(`/api/regional-commissions/personal-orders?managerId=${encodeURIComponent(managerId)}`)) as { items: readonly RegionalPersonalOrderDto[] }; },
    async createRegionalPersonalOrder(input) { return (await request("/api/regional-commissions/personal-orders", { method: "POST", body: JSON.stringify(input) })) as { id: string }; },
    async returnRegionalPersonalOrder(id, input) { await request(`/api/regional-commissions/personal-orders/${encodeURIComponent(id)}/return`, { method: "POST", body: JSON.stringify(input) }); },
    async voidRegionalPersonalOrder(id, reason) { await request(`/api/regional-commissions/personal-orders/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify({ reason }) }); },
    async saveRegionalReceipt(input) { return (await request("/api/regional-commissions/receipts", { method: "POST", body: JSON.stringify(input) })) as { id: string }; },
    async listRegionalManagers() { return readProperty<readonly RegionalManagerOption[]>(await request("/api/regional-commissions/managers"), "items"); },
    async listRegionalTemplates() { return readProperty<readonly RegionalTemplateDto[]>(await request("/api/admin/regional-commission-templates"), "items"); },
    async createRegionalTemplate(input) { return (await request("/api/admin/regional-commission-templates", { method: "POST", body: JSON.stringify(input) })) as RegionalTemplateDto; },
    async updateRegionalTemplate(id, input) { return (await request(`/api/admin/regional-commission-templates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })) as RegionalTemplateDto; },
    async copyRegionalTemplate(id, input) { return (await request(`/api/admin/regional-commission-templates/${encodeURIComponent(id)}/copy`, { method: "POST", body: JSON.stringify(input) })) as RegionalTemplateDto; },
    async publishRegionalTemplate(id, reason) { return (await request(`/api/admin/regional-commission-templates/${encodeURIComponent(id)}/publish`, { method: "POST", body: JSON.stringify({ reason }) })) as RegionalTemplateDto; },
    async stopRegionalTemplate(id, reason) { return (await request(`/api/admin/regional-commission-templates/${encodeURIComponent(id)}/stop`, { method: "POST", body: JSON.stringify({ reason }) })) as RegionalTemplateDto; },
    async assignRegionalTemplate(input) { await request("/api/admin/regional-commission-assignments", { method: "POST", body: JSON.stringify(input) }); },
    async listRegionalCooperation(managerId) { return readProperty<readonly RegionalCooperationDto[]>(await request(`/api/regional-commissions/cooperation?managerId=${encodeURIComponent(managerId)}`), "items"); },
    async submitRegionalCooperation(input) { return (await request("/api/regional-commissions/cooperation", { method: "POST", body: JSON.stringify(input) })) as RegionalCooperationDto; },
    async transitionRegionalCooperation(id, action, reason) { await request(`/api/regional-commissions/cooperation/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify({ reason }) }); },
    async calculateRegionalStatement(managerId, month) { return (await request(`/api/regional-commissions/statements/${encodeURIComponent(managerId)}/${month}/calculate`, { method: "POST" })) as RegionalStatementDto; },
    async listRegionalStatements(managerId) { return readProperty<readonly RegionalStatementDto[]>(await request(`/api/regional-commissions/statements?managerId=${encodeURIComponent(managerId)}`), "items"); },
    async transitionRegionalStatement(id, action) { return (await request(`/api/regional-commissions/statements/${encodeURIComponent(id)}/${action}`, { method: "POST" })) as RegionalStatementDto; },
    async verifyRegionalReceipt(id, approved, reason) { await request(`/api/regional-commissions/receipts/${encodeURIComponent(id)}/verify`, { method: "POST", body: JSON.stringify({ approved, reason }) }); },
  };
};

export const apiClient = createApiClient({ baseUrl: APP_BASE_PATH });
