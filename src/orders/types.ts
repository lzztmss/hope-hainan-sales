export type OrderViewerRole = "sales" | "store_manager" | "regional_manager" | "admin";

export interface OrderViewer {
  id: string;
  displayName: string;
  role: OrderViewerRole;
  storeId: string | null;
}

export type OrderStatus =
  | "pending"
  | "accepted"
  | "activated"
  | "completed"
  | "cancelled"
  | "return_pending"
  | "partially_returned"
  | "returned"
  | "voided";

export type OrderPaymentMode = "one_time" | "contract_36";
export type ReturnType = "full" | "partial";
export type ReturnStatus = "requested" | "approved" | "rejected" | "completed";

export interface OrderPermissions {
  canDelete: boolean;
  canRestore: boolean;
  canRequestReturn: boolean;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  customerMasked: string;
  customerPhoneMasked: string;
  sellerId: string;
  sellerName: string;
  storeId: string;
  storeName: string;
  status: OrderStatus;
  paymentMode: OrderPaymentMode;
  oneTimeFen: number;
  monthlyTotalFen: number;
  refundedFen: number;
  createdAt: string;
  deletedAt: string | null;
  version: number;
  permissions: OrderPermissions;
}

export interface OrderLineView {
  id: string;
  lineType: "charge" | "component";
  sku: string;
  label: string;
  unit: string;
  quantity: number;
  returnedQuantity: number;
  refundableQuantity: number;
  refundableUnitFen: number;
  monthlyUnitFen: number;
  oneTimeSubtotalFen: number;
  monthlySubtotalFen: number;
  locations: string[];
}

export interface OrderTimelineEvent {
  id: string;
  status: OrderStatus;
  at: string;
  actorName: string;
  note: string;
}

export interface ReturnItemView {
  orderLineId: string;
  label: string;
  quantity: number;
  refundFen: number;
}

export interface ReturnRecordView {
  id: string;
  returnNo: string;
  type: ReturnType;
  status: ReturnStatus;
  reason: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  refundFen: number;
  maxRefundFen: number;
  canApprove: boolean;
  canComplete?: boolean;
  items: ReturnItemView[];
}

export interface OrderDetail extends OrderSummary {
  customerAddress: string;
  fttrLabel: string;
  heartMonthlyFen: number;
  contract36Fen: number;
  lines: OrderLineView[];
  timeline: OrderTimelineEvent[];
  returns: ReturnRecordView[];
}

export interface OrderListFilters {
  search: string;
  status: OrderStatus | "";
  paymentMode: OrderPaymentMode | "";
  storeQuery?: string;
  sellerQuery?: string;
  recycleBin: boolean;
}

export interface OrderListResult {
  items: OrderSummary[];
  total: number;
}

export interface RequestReturnInput {
  orderId: string;
  orderVersion: number;
  type: ReturnType;
  items: Array<{ orderLineId: string; quantity: number }>;
  reason: string;
}

export interface DecideReturnInput {
  returnId: string;
  decision: "approve" | "reject";
  note: string;
}

export type OrderTransitionCommand =
  | "ACCEPT"
  | "ACTIVATE"
  | "COMPLETE"
  | "CANCEL";

export interface TransitionOrderInput {
  orderId: string;
  expectedVersion: number;
  command: OrderTransitionCommand;
}

export interface CompleteReturnInput {
  returnId: string;
  refundFen: number;
}

export interface OrderManagementAdapter {
  listOrders(filters: OrderListFilters, page?: number, pageSize?: number): Promise<OrderListResult>;
  getOrder(orderId: string): Promise<OrderDetail>;
  transitionOrder(input: TransitionOrderInput): Promise<void>;
  softDeleteOrder(orderId: string): Promise<void>;
  restoreOrder(orderId: string): Promise<void>;
  requestReturn(input: RequestReturnInput): Promise<ReturnRecordView>;
  decideReturn(input: DecideReturnInput): Promise<ReturnRecordView>;
  completeReturn(input: CompleteReturnInput): Promise<ReturnRecordView>;
}

export interface SelectOption {
  id: string;
  label: string;
  storeId?: string;
}

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  pending: "待受理",
  accepted: "已受理",
  activated: "已生效",
  completed: "已完成",
  cancelled: "已取消",
  return_pending: "退单审批中",
  partially_returned: "已部分退单",
  returned: "已退单",
  voided: "已作废",
};

export const RETURN_STATUS_LABELS: Readonly<Record<ReturnStatus, string>> = {
  requested: "待审批",
  approved: "已同意",
  rejected: "已驳回",
  completed: "已完成退款",
};
