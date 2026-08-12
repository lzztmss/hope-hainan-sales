import type {
  ApiClient,
  OrderDto,
  OrderLineDto,
  ReturnRecordDto,
} from "../api/client";
import type {
  OrderDetail,
  OrderLineView,
  OrderListFilters,
  OrderManagementAdapter,
  OrderPermissions,
  OrderSummary,
  OrderTimelineEvent,
  OrderViewer,
  ReturnRecordView,
} from "./types";

export type OrderApiClient = Pick<
  ApiClient,
  | "completeOrderReturn"
  | "decideOrderReturn"
  | "deleteOrder"
  | "getOrder"
  | "listOrderReturns"
  | "listOrders"
  | "requestOrderReturn"
  | "restoreOrder"
  | "transitionOrder"
>;

const operationKey = (): string => {
  if (typeof crypto.randomUUID === "function") {
    return `order-operation-${crypto.randomUUID()}`;
  }
  return `order-operation-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
};

const readSnapshotString = (
  snapshot: Readonly<Record<string, unknown>> | null | undefined,
  ...keys: readonly string[]
): string | null => {
  for (const key of keys) {
    const value = snapshot?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const permissionsFor = (
  order: OrderDto,
  viewer: OrderViewer,
): OrderPermissions => {
  const reversibleStatus = order.status === "pending" || order.status === "accepted";
  const reviewer = viewer.role === "store_manager" || viewer.role === "admin";
  return {
    canDelete: order.deletedAt === null && reversibleStatus,
    canRestore: order.deletedAt !== null && reviewer && reversibleStatus,
    canRequestReturn:
      order.deletedAt === null &&
      (order.status === "activated" ||
        order.status === "completed" ||
        order.status === "partially_returned"),
  };
};

const mapSummary = (order: OrderDto, viewer: OrderViewer): OrderSummary => ({
  id: order.id,
  orderNo: order.orderNo,
  customerMasked: order.customer.name?.trim() || "客户姓名未提供",
  customerPhoneMasked:
    order.customer.phoneMasked?.trim() || "手机号未提供",
  sellerId: order.sellerId,
  sellerName:
    readSnapshotString(order.sellerSnapshot, "displayName", "name") ??
    `销售员姓名未提供（${order.sellerId}）`,
  storeId: order.storeId,
  storeName:
    readSnapshotString(order.storeSnapshot, "name", "storeName") ??
    `营业厅名称未提供（${order.storeId}）`,
  status: order.status,
  paymentMode: order.paymentMode,
  oneTimeFen: order.oneTimeFen,
  monthlyTotalFen: order.monthlyTotalFen,
  refundedFen: order.refundedFen,
  createdAt: formatDateTime(order.createdAt),
  deletedAt: order.deletedAt ? formatDateTime(order.deletedAt) : null,
  version: order.version,
  permissions: permissionsFor(order, viewer),
});

const fttrLabel = (order: OrderDto): string => {
  if (order.fttrKind === "none" || order.fttrPlan === null) {
    return "未新增 FTTR";
  }
  if (order.fttrKind === "custom") {
    const note = order.customFttrNote?.trim();
    return `FTTR ${order.fttrPlan} 元/月（自定义${note ? `：${note}` : ""}）`;
  }
  return `FTTR ${order.fttrPlan} 元/月`;
};

const timelineFor = (order: OrderDto): OrderTimelineEvent[] => {
  const events: OrderTimelineEvent[] = [
    {
      id: `${order.id}-created`,
      status: "pending",
      at: formatDateTime(order.createdAt),
      actorName: "操作人未提供",
      note: "订单创建",
    },
  ];
  const append = (
    value: string | null,
    status: OrderTimelineEvent["status"],
    note: string,
  ) => {
    if (!value) return;
    events.push({
      id: `${order.id}-${status}`,
      status,
      at: formatDateTime(value),
      actorName: "操作人未提供",
      note,
    });
  };
  append(order.acceptedAt, "accepted", "订单已受理");
  append(order.activatedAt, "activated", "订单已生效");
  append(order.completedAt, "completed", "订单已完成");
  append(order.cancelledAt, "cancelled", "订单已取消");
  return events;
};

const mapReturn = (
  record: ReturnRecordDto,
  viewer: OrderViewer,
): ReturnRecordView => {
  const reviewer = viewer.role === "store_manager" || viewer.role === "admin";
  return {
    id: record.id,
    returnNo: record.returnNo,
    type: record.returnType,
    status: record.status,
    reason: record.reason,
    requestedById: record.requestedBy,
    requestedByName:
      record.requestedByName?.trim() || `申请人 ${record.requestedBy}`,
    requestedAt: formatDateTime(record.requestedAt),
    refundFen: record.refundFen,
    maxRefundFen: record.maxRefundFen,
    canApprove:
      reviewer &&
      record.status === "requested" &&
      record.requestedBy !== viewer.id,
    canComplete: reviewer && record.status === "approved",
    items: record.items.map((item) => ({
      orderLineId: item.orderLineId,
      label: item.label,
      quantity: item.quantity,
      refundFen: item.maxRefundFen,
    })),
  };
};

const completedQuantityByLine = (
  returns: readonly ReturnRecordDto[],
): ReadonlyMap<string, number> => {
  const quantities = new Map<string, number>();
  for (const record of returns) {
    if (record.status !== "completed") continue;
    for (const item of record.items) {
      quantities.set(
        item.orderLineId,
        (quantities.get(item.orderLineId) ?? 0) + item.quantity,
      );
    }
  }
  return quantities;
};

const mapLine = (
  line: OrderLineDto,
  index: number,
  returned: ReadonlyMap<string, number>,
): OrderLineView => {
  const persistedId = line.id?.trim() || null;
  const alreadyReturned = persistedId ? returned.get(persistedId) ?? 0 : 0;
  return {
    id: persistedId ?? `missing-order-line-id-${index + 1}`,
    lineType: line.lineType,
    sku: line.sku,
    label: line.label,
    unit: line.unit,
    quantity: line.quantity,
    refundableQuantity:
      line.lineType === "charge" && persistedId
        ? Math.max(0, line.quantity - alreadyReturned)
        : 0,
    refundableUnitFen: line.lineType === "charge" ? line.oneTimeUnitFen : 0,
    oneTimeSubtotalFen: line.oneTimeSubtotalFen,
    monthlySubtotalFen: line.monthlySubtotalFen,
    locations: [...line.locations],
  };
};

const mapDetail = (
  order: OrderDto,
  returns: readonly ReturnRecordDto[],
  viewer: OrderViewer,
): OrderDetail => {
  const returned = completedQuantityByLine(returns);
  return {
    ...mapSummary(order, viewer),
    customerAddress: order.customer.address?.trim() || "客户地址未提供",
    fttrLabel: fttrLabel(order),
    heartMonthlyFen: order.heartMonthlyFen,
    contract36Fen: order.contract36Fen,
    lines: order.lines.map((line, index) => mapLine(line, index, returned)),
    timeline: timelineFor(order),
    returns: returns.map((record) => mapReturn(record, viewer)),
  };
};

const listQueryFor = (filters: OrderListFilters) => {
  const search = filters.search.trim();
  return {
    recycleBin: filters.recycleBin,
    ...(search
      ? /^\d{4}$/.test(search)
        ? { customerPhoneTail: search }
        : { orderNo: search }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.paymentMode ? { paymentMode: filters.paymentMode } : {}),
    ...(filters.storeQuery ? { storeQuery: filters.storeQuery.trim() } : {}),
    ...(filters.sellerQuery ? { sellerQuery: filters.sellerQuery.trim() } : {}),
    limit: 100,
  };
};

export const createOrderManagementAdapter = (
  client: OrderApiClient,
  viewer: OrderViewer,
  createIdempotencyKey: () => string = operationKey,
): OrderManagementAdapter => {
  const returnRequestKeys = new Map<string, string>();
  const returnCompletionKeys = new Map<string, string>();
  const stableKey = (
    keys: Map<string, string>,
    fingerprint: string,
  ): string => {
    const existing = keys.get(fingerprint);
    if (existing) return existing;
    const created = createIdempotencyKey();
    keys.set(fingerprint, created);
    return created;
  };

  return {
    async listOrders(filters) {
      const response = await client.listOrders(listQueryFor(filters));
      const items = response.items.map((order) => mapSummary(order, viewer));
      return { items, total: items.length };
    },
    async getOrder(orderId) {
      const [order, returns] = await Promise.all([
        client.getOrder(orderId),
        client.listOrderReturns(orderId),
      ]);
      return mapDetail(order, returns, viewer);
    },
    async transitionOrder(input) {
      await client.transitionOrder(
        input.orderId,
        input.command,
        input.expectedVersion,
      );
    },
    async softDeleteOrder(orderId) {
      await client.deleteOrder(orderId);
    },
    async restoreOrder(orderId) {
      await client.restoreOrder(orderId);
    },
    async requestReturn(input) {
      const body = {
        type: input.type,
        items: input.items,
        reason: input.reason,
      };
      const fingerprint = JSON.stringify({ orderId: input.orderId, ...body });
      return mapReturn(
        await client.requestOrderReturn(
          input.orderId,
          body,
          stableKey(returnRequestKeys, fingerprint),
        ),
        viewer,
      );
    },
    async decideReturn(input) {
      return mapReturn(
        await client.decideOrderReturn(
          input.returnId,
          input.decision === "approve" ? "approved" : "rejected",
          input.note,
        ),
        viewer,
      );
    },
    async completeReturn(input) {
      const fingerprint = JSON.stringify(input);
      return mapReturn(
        await client.completeOrderReturn(
          input.returnId,
          input.refundFen,
          stableKey(returnCompletionKeys, fingerprint),
        ),
        viewer,
      );
    },
  };
};
