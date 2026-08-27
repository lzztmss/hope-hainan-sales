import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { formatOrderMoney, formatOrderPrice } from "./formatters";
import { usePageAutoRefresh } from "../hooks/usePageAutoRefresh";
import { LIST_PAGE_SIZE, Pagination } from "../components/Pagination";
import { OrderDetailPage } from "./OrderDetailPage";
import { ReturnDialog } from "./ReturnDialog";
import {
  ORDER_STATUS_LABELS,
  type CommissionPayoutStatus,
  type DecideReturnInput,
  type OrderDetail,
  type OrderListFilters,
  type OrderManagementAdapter,
  type OrderPaymentMode,
  type OrderStatus,
  type OrderSummary,
  type OrderViewer,
  type RequestReturnInput,
  type SelectOption,
} from "./types";
import "./orders.css";

export interface OrderListPageProps {
  viewer: OrderViewer;
  adapter: OrderManagementAdapter;
  initialOrderId?: string;
  storeOptions?: SelectOption[];
  sellerOptions?: SelectOption[];
}

const EMPTY_FILTERS: OrderListFilters = {
  search: "",
  status: "",
  paymentMode: "",
  recycleBin: false,
};

const ROLE_TITLES: Readonly<Record<OrderViewer["role"], string>> = {
  sales: "我的订单",
  store_manager: "本厅订单",
  regional_manager: "大区订单",
  hr: "全公司订单",
  finance: "全公司订单",
  admin: "全部订单",
};

const PAYMENT_LABELS: Readonly<Record<OrderPaymentMode, string>> = {
  one_time: "一次性支付",
  contract_36: "36 个月合约月付",
};

const globalDataRole = (role: OrderViewer["role"]): boolean =>
  role === "admin" || role === "hr" || role === "finance";

const scopeOrders = (items: OrderSummary[], viewer: OrderViewer): OrderSummary[] => {
  if (viewer.role === "sales") {
    return items.filter((order) => order.sellerId === viewer.id);
  }
  if (viewer.role === "store_manager") {
    return items.filter(
      (order) => viewer.storeId !== null && order.storeId === viewer.storeId,
    );
  }
  return items;
};

const normaliseFilters = (filters: OrderListFilters): OrderListFilters => {
  const normalised: OrderListFilters = {
    search: filters.search.trim(),
    status: filters.status,
    paymentMode: filters.paymentMode,
    recycleBin: filters.recycleBin,
  };
  if (filters.storeQuery?.trim()) normalised.storeQuery = filters.storeQuery.trim();
  if (filters.sellerQuery?.trim()) normalised.sellerQuery = filters.sellerQuery.trim();
  if (filters.signedDateFrom) normalised.signedDateFrom = filters.signedDateFrom;
  if (filters.signedDateTo) normalised.signedDateTo = filters.signedDateTo;
  if (filters.commissionPayoutStatus) normalised.commissionPayoutStatus = filters.commissionPayoutStatus;
  if (filters.reconciliationStatus) normalised.reconciliationStatus = filters.reconciliationStatus;
  if (filters.collectionStatus) normalised.collectionStatus = filters.collectionStatus;
  return normalised;
};

interface OrderStatusBadgeProps {
  status: OrderStatus;
}

const OrderStatusBadge = ({ status }: OrderStatusBadgeProps) => (
  <span className={`order-status is-${status}`}>{ORDER_STATUS_LABELS[status]}</span>
);

export const OrderListPage = ({
  adapter,
  initialOrderId,
  sellerOptions = [],
  storeOptions = [],
  viewer,
}: OrderListPageProps) => {
  const [draftFilters, setDraftFilters] = useState<OrderListFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<OrderListFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<OrderSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<"reconcile" | "receive" | "payout" | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const openedInitialOrderId = useRef<string | null>(null);

  const loadOrders = useCallback(async (background = false, requestedPage = 1): Promise<void> => {
    if (!background) {
      setLoading(true);
      setListError(null);
    }
    try {
      const result = await adapter.listOrders(appliedFilters, requestedPage, LIST_PAGE_SIZE);
      setItems(scopeOrders(result.items, viewer));
      setTotal(result.total);
      setPage(requestedPage);
      setListError(null);
    } catch (error) {
      if (!background) {
        setItems([]);
        setListError(error instanceof Error ? error.message : "订单加载失败，请重试");
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [adapter, appliedFilters, viewer]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  usePageAutoRefresh({
    enabled: !loading,
    intervalMs: 15_000,
    onRefresh: () => loadOrders(true, page),
  });

  const openDetail = async (orderId: string): Promise<void> => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const nextDetail = await adapter.getOrder(orderId);
      const permitted = scopeOrders([nextDetail], viewer).length === 1;
      if (!permitted) throw new Error("无权查看该订单");
      setDetail(nextDetail);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "订单详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!initialOrderId || openedInitialOrderId.current === initialOrderId) {
      return;
    }
    openedInitialOrderId.current = initialOrderId;
    void openDetail(initialOrderId);
  }, [initialOrderId]);

  const reloadDetail = async (): Promise<void> => {
    if (!detail) return;
    const nextDetail = await adapter.getOrder(detail.id);
    setDetail(nextDetail);
  };

  const setFilter = <Key extends keyof OrderListFilters>(
    key: Key,
    value: OrderListFilters[Key],
  ): void => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const pageDescription = useMemo(() => {
    if (appliedFilters.recycleBin) return `回收站内共 ${total} 笔订单`;
    return `共 ${total} 笔可见订单`;
  }, [appliedFilters.recycleBin, total]);

  const submitFiltersWithResolvedOwnership = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const next = normaliseFilters(draftFilters);
    const store = availableStores.find((option) => option.label === next.storeQuery);
    const seller = availableSellers.find((option) => option.label === next.sellerQuery);
    if (store) next.storeQuery = store.id;
    if (seller) next.sellerQuery = seller.id;
    setPage(1);
    setAppliedFilters(next);
    setFilterOpen(false);
  };

  const availableStores = useMemo(() => {
    const options = new Map(storeOptions.map((option) => [option.id, option]));
    for (const order of items) {
      if (!options.has(order.storeId)) {
        options.set(order.storeId, { id: order.storeId, label: order.storeName });
      }
    }
    return Array.from(options.values()).sort((left, right) =>
      left.label.localeCompare(right.label, "zh-CN"),
    );
  }, [items, storeOptions]);

  const availableSellers = useMemo(() => {
    const options = new Map(sellerOptions.map((option) => [option.id, option]));
    for (const order of items) {
      if (!options.has(order.sellerId)) {
        options.set(order.sellerId, {
          id: order.sellerId,
          label: order.sellerName,
          storeId: order.storeId,
        });
      }
    }
    const selectedStore = availableStores.find(
      (option) => option.label === draftFilters.storeQuery,
    );
    return Array.from(options.values())
      .filter((option) => !selectedStore || !option.storeId || option.storeId === selectedStore.id)
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  }, [availableStores, draftFilters.storeQuery, items, sellerOptions]);

  const renderOrderAmount = (order: OrderSummary) => (
    <span className="order-amount">
      <strong>{formatOrderPrice(order.oneTimeFen, order.monthlyTotalFen)}</strong>
      {order.refundedFen > 0 ? (
        <small>已退 {formatOrderMoney(order.refundedFen)}</small>
      ) : null}
    </span>
  );

  const batchModes = [
    ...(viewer.role === "hr" || viewer.role === "admin" ? [
      { id: "reconcile" as const, label: "批量对账" },
    ] : []),
    ...(viewer.role === "finance" || viewer.role === "admin" ? [
      { id: "receive" as const, label: "批量确认收款" },
    ] : []),
    ...(viewer.role === "hr" || viewer.role === "admin" ? [
      { id: "payout" as const, label: "批量发放提成" },
    ] : []),
  ];
  const showCommissionStatus = viewer.role === "hr" || viewer.role === "admin";

  const batchEligibility = (order: OrderSummary): { eligible: boolean; reason: string } => {
    if (batchMode === "reconcile") {
      return order.status === "signed"
        ? { eligible: true, reason: "" }
        : { eligible: false, reason: "只有已签收订单可以对账" };
    }
    if (batchMode === "receive") {
      return order.status === "reconciled"
        ? { eligible: true, reason: "" }
        : { eligible: false, reason: "只有已对账订单可以确认收款" };
    }
    if (batchMode === "payout") {
      if (!order.paidAt) return { eligible: false, reason: "订单尚未收款" };
      if (order.commissionPayoutStatus === "paid") return { eligible: false, reason: "提成已经发放" };
      if (order.commissionNetFen <= 0) return { eligible: false, reason: "没有可发放的净提成" };
      return { eligible: true, reason: "" };
    }
    return { eligible: false, reason: "" };
  };

  const toggleSelection = (orderId: string, checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(orderId); else next.delete(orderId);
      return next;
    });
  };

  const eligiblePageIds = batchMode
    ? items.filter((order) => batchEligibility(order).eligible).map((order) => order.id)
    : [];
  const allEligibleSelected = eligiblePageIds.length > 0 && eligiblePageIds.every((id) => selectedIds.has(id));

  const toggleAllEligible = (checked: boolean): void => {
    setSelectedIds(checked ? new Set(eligiblePageIds) : new Set());
  };

  const runBatchAction = async (): Promise<void> => {
    if (!batchMode || selectedIds.size === 0) return;
    const selectedOrders = items.filter((order) => selectedIds.has(order.id));
    setBatchBusy(true);
    setListError(null);
    try {
      if (batchMode === "payout") {
        await adapter.batchPayCommissions(selectedOrders.map((order) => order.id));
      } else {
        await adapter.batchTransitionOrders(
          selectedOrders.map((order) => ({
            orderId: order.id,
            expectedVersion: order.version,
            command: batchMode === "reconcile" ? "RECONCILE" : "MARK_PAID",
          })),
          batchMode === "reconcile" ? "RECONCILE" : "MARK_PAID",
        );
      }
      setSelectedIds(new Set());
      setBatchMode(null);
      await loadOrders(false, page);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "批量操作失败");
    } finally {
      setBatchBusy(false);
    }
  };

  const payoutLabel = (status: CommissionPayoutStatus): string => ({
    ineligible: "提成：暂无可发放",
    pending: "提成：待发放",
    paid: "提成：已发放",
  })[status];

  return (
    <main className="order-page">
      <header className="order-page__header">
        <div>
          <p>海南联通 FTTR 心连心</p>
          <h1>{ROLE_TITLES[viewer.role]}</h1>
          <span>{pageDescription}</span>
        </div>
        <button
          aria-expanded={filterOpen}
          aria-controls="order-filter-panel"
          className="order-filter-toggle"
          onClick={() => setFilterOpen((current) => !current)}
          type="button"
        >
          筛选订单
        </button>
      </header>

      <form
        className="order-filter-panel"
        data-open={filterOpen ? "true" : "false"}
        id="order-filter-panel"
        onSubmit={submitFiltersWithResolvedOwnership}
      >
        <header>
          <div>
            <strong>筛选订单</strong>
            <span>按客户、状态、付款方式和归属快速查找</span>
          </div>
          <button
            aria-label="关闭筛选"
            className="order-filter-close"
            onClick={() => setFilterOpen(false)}
            type="button"
          >
            关闭
          </button>
        </header>
        <div className="order-filter-fields">
          <label className="order-filter-search">
            <span>搜索订单</span>
            <input
              onChange={(event) => setFilter("search", event.currentTarget.value)}
              placeholder="订单号、退单号、客户或手机号"
              type="search"
              value={draftFilters.search}
            />
          </label>
          <label>
            <span>订单状态</span>
            <select
              onChange={(event) => setFilter("status", event.currentTarget.value as OrderStatus | "")}
              value={draftFilters.status}
            >
              <option value="">全部状态</option>
              {(Object.entries(ORDER_STATUS_LABELS) as Array<[OrderStatus, string]>).map(
                ([value, label]) => <option key={value} value={value}>{label}</option>,
              )}
            </select>
          </label>
          <label>
            <span>付款方式</span>
            <select
              onChange={(event) => setFilter("paymentMode", event.currentTarget.value as OrderPaymentMode | "")}
              value={draftFilters.paymentMode}
            >
              <option value="">全部方式</option>
              {(Object.entries(PAYMENT_LABELS) as Array<[OrderPaymentMode, string]>).map(
                ([value, label]) => <option key={value} value={value}>{label}</option>,
              )}
            </select>
          </label>
          <label>
            <span>签收日期从</span>
            <input
              onChange={(event) => setFilter("signedDateFrom", event.currentTarget.value || undefined)}
              type="date"
              value={draftFilters.signedDateFrom ?? ""}
            />
          </label>
          <label>
            <span>签收日期至</span>
            <input
              onChange={(event) => setFilter("signedDateTo", event.currentTarget.value || undefined)}
              type="date"
              value={draftFilters.signedDateTo ?? ""}
            />
          </label>
          {viewer.role === "hr" || viewer.role === "finance" || viewer.role === "admin" ? (
            <label>
              <span>对账状态</span>
              <select
                onChange={(event) => setFilter("reconciliationStatus", event.currentTarget.value as "pending" | "reconciled" | "")}
                value={draftFilters.reconciliationStatus ?? ""}
              >
                <option value="">全部对账状态</option>
                <option value="pending">待对账</option>
                <option value="reconciled">已对账</option>
              </select>
            </label>
          ) : null}
          {viewer.role === "hr" || viewer.role === "finance" || viewer.role === "admin" ? (
            <label>
              <span>收款状态</span>
              <select
                onChange={(event) => setFilter("collectionStatus", event.currentTarget.value as "unpaid" | "paid" | "")}
                value={draftFilters.collectionStatus ?? ""}
              >
                <option value="">全部收款状态</option>
                <option value="unpaid">未收款</option>
                <option value="paid">已收款</option>
              </select>
            </label>
          ) : null}
          {viewer.role === "hr" || viewer.role === "admin" ? (
            <label>
              <span>提成发放状态</span>
              <select
                onChange={(event) => setFilter("commissionPayoutStatus", event.currentTarget.value as CommissionPayoutStatus | "")}
                value={draftFilters.commissionPayoutStatus ?? ""}
              >
                <option value="">全部发放状态</option>
                <option value="ineligible">暂无可发放</option>
                <option value="pending">待发放</option>
                <option value="paid">已发放</option>
              </select>
            </label>
          ) : null}
          {globalDataRole(viewer.role) || viewer.role === "regional_manager" ? (
            <label>
              <span>营业厅</span>
              <input
                list="order-store-options"
                onChange={(event) => setFilter("storeQuery", event.currentTarget.value || undefined)}
                placeholder="输入营业厅名称或编码"
                value={draftFilters.storeQuery ?? ""}
              />
              <datalist id="order-store-options">
                {availableStores.map((option) => (
                  <option key={option.id} value={option.label} />
                ))}
              </datalist>
            </label>
          ) : null}
          {viewer.role !== "sales" ? (
            <label>
              <span>销售员</span>
              <input
                list="order-seller-options"
                onChange={(event) => setFilter("sellerQuery", event.currentTarget.value || undefined)}
                placeholder="输入销售员姓名或工号"
                value={draftFilters.sellerQuery ?? ""}
              />
              <datalist id="order-seller-options">
                {availableSellers.map((option) => (
                  <option key={option.id} value={option.label} />
                ))}
              </datalist>
            </label>
          ) : null}
        </div>
        <footer>
          <button
            onClick={() => {
              setDraftFilters(EMPTY_FILTERS);
              setPage(1);
              setAppliedFilters(EMPTY_FILTERS);
            }}
            type="button"
          >
            重置
          </button>
          <button className="order-primary-action" type="submit">查询</button>
        </footer>
      </form>

      {listError ? (
        <section className="order-state-card is-error" role="alert">
          <strong>暂时无法读取订单</strong>
          <span>{listError}</span>
          <button onClick={() => void loadOrders()} type="button">重新加载</button>
        </section>
      ) : null}
      {detailError ? <p className="order-form-error" role="alert">{detailError}</p> : null}
      {loading || detailLoading ? <p className="order-loading" role="status">正在读取订单…</p> : null}

      {!loading && !listError && items.length === 0 ? (
        <section className="order-state-card">
          <strong>{appliedFilters.recycleBin ? "回收站暂无订单" : "暂未找到订单"}</strong>
          <span>可调整筛选条件后重新查询。</span>
        </section>
      ) : null}

      {batchModes.length > 0 && !appliedFilters.recycleBin ? (
        <section className="order-batch-toolbar" aria-label="订单批量操作">
          <div>
            {batchModes.map((mode) => (
              <button
                className={batchMode === mode.id ? "is-active" : ""}
                key={mode.id}
                onClick={() => {
                  setBatchMode((current) => current === mode.id ? null : mode.id);
                  setSelectedIds(new Set());
                }}
                type="button"
              >
                {mode.label}
              </button>
            ))}
          </div>
          {batchMode ? (
            <div className="order-batch-toolbar__action">
              <span>已选 {selectedIds.size} 笔；不符合条件的订单仍显示，但不可勾选</span>
              <button
                className="order-primary-action"
                disabled={batchBusy || selectedIds.size === 0}
                onClick={() => void runBatchAction()}
                type="button"
              >
                {batchBusy ? "正在处理…" : "确认批量处理"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="order-table-shell">
        <table aria-label="订单列表" className="order-desktop-table" data-testid="order-desktop-table">
          <thead>
            <tr>
              {batchMode ? (
                <th className="order-select-column">
                  <input
                    aria-label="选择本页全部可操作订单"
                    checked={allEligibleSelected}
                    disabled={eligiblePageIds.length === 0}
                    onChange={(event) => toggleAllEligible(event.currentTarget.checked)}
                    type="checkbox"
                  />
                </th>
              ) : null}
              <th>订单与客户</th>
              <th>归属</th>
              <th>付款方式</th>
              <th>金额</th>
              <th>状态</th>
              <th><span className="visually-hidden">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((order) => (
              <tr key={order.id}>
                {batchMode ? (
                  <td className="order-select-column">
                    <input
                      aria-label={`选择订单 ${order.orderNo}`}
                      checked={selectedIds.has(order.id)}
                      disabled={!batchEligibility(order).eligible}
                      onChange={(event) => toggleSelection(order.id, event.currentTarget.checked)}
                      title={batchEligibility(order).reason}
                      type="checkbox"
                    />
                  </td>
                ) : null}
                <td>
                  <strong>{order.customerMasked}</strong>
                  <span>{order.orderNo}·{order.customerPhoneMasked}</span>
                  <small>{order.createdAt}</small>
                </td>
                <td><strong>{order.storeName}</strong><span>{order.sellerName}</span></td>
                <td>{PAYMENT_LABELS[order.paymentMode]}</td>
                <td>{renderOrderAmount(order)}</td>
                <td>
                  <span className="order-status-stack">
                    <OrderStatusBadge status={order.status} />
                    {order.paidAt && order.status !== "paid" ? <small className="order-finance-status">收款：已收款</small> : null}
                    {showCommissionStatus ? (
                      <small className={`order-commission-status is-${order.commissionPayoutStatus}`}>
                        {payoutLabel(order.commissionPayoutStatus)}
                      </small>
                    ) : null}
                    {showCommissionStatus && order.commissionPayoutStatus === "paid" && order.commissionReversedFen > 0 ? (
                      <small>已发 {formatOrderMoney(order.commissionPaidFen)} · 扣回 {formatOrderMoney(order.commissionReversedFen)}</small>
                    ) : null}
                  </span>
                </td>
                <td>
                  <button
                    aria-label={`查看订单 ${order.orderNo}`}
                    onClick={() => void openDetail(order.id)}
                    type="button"
                  >
                    查看
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul aria-label="移动端订单列表" className="order-mobile-list">
        {items.map((order) => (
          <li className={batchMode ? "is-batch-mode" : ""} key={order.id}>
            {batchMode ? (
              <input
                aria-label={`选择订单 ${order.orderNo}`}
                checked={selectedIds.has(order.id)}
                disabled={!batchEligibility(order).eligible}
                onChange={(event) => toggleSelection(order.id, event.currentTarget.checked)}
                title={batchEligibility(order).reason}
                type="checkbox"
              />
            ) : null}
            <button
              aria-label={`查看订单 ${order.orderNo}`}
              className="order-mobile-card"
              onClick={() => void openDetail(order.id)}
              type="button"
            >
              <span className="order-mobile-card__topline">
                <span>{order.customerMasked} · {order.customerPhoneMasked}</span>
                <span className="order-status-stack">
                  <OrderStatusBadge status={order.status} />
                  {order.paidAt && order.status !== "paid" ? <small className="order-finance-status">收款：已收款</small> : null}
                  {showCommissionStatus ? (
                    <small className={`order-commission-status is-${order.commissionPayoutStatus}`}>
                      {payoutLabel(order.commissionPayoutStatus)}
                    </small>
                  ) : null}
                </span>
              </span>
              <strong>{order.orderNo}</strong>
              <span className="order-mobile-card__meta">
                {order.storeName}·{order.sellerName}
              </span>
              <span className="order-mobile-card__bottomline">
                <span>{PAYMENT_LABELS[order.paymentMode]}</span>
                {renderOrderAmount(order)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Pagination
        onPageChange={(nextPage) => void loadOrders(false, nextPage)}
        page={page}
        totalItems={total}
      />

      {detail ? (
        <div className="order-modal-backdrop">
          <OrderDetailPage
            onClose={() => {
              setDetail(null);
              setReturnOpen(false);
            }}
            onCompleteReturn={async (input) => {
              await adapter.completeReturn(input);
              await Promise.all([reloadDetail(), loadOrders()]);
            }}
            onDecideReturn={async (input: DecideReturnInput) => {
              await adapter.decideReturn(input);
              await Promise.all([reloadDetail(), loadOrders()]);
            }}
            onOpenReturn={() => setReturnOpen(true)}
            onRestore={async () => {
              await adapter.restoreOrder(detail.id);
              setDetail(null);
              await loadOrders();
            }}
            onTransition={async (input) => {
              await adapter.transitionOrder(input);
              await Promise.all([reloadDetail(), loadOrders()]);
            }}
            order={detail}
            viewer={viewer}
          />
        </div>
      ) : null}

      {detail ? (
        <ReturnDialog
          onClose={() => setReturnOpen(false)}
          onSubmit={async (input: RequestReturnInput) => {
            await adapter.requestReturn(input);
            await Promise.all([reloadDetail(), loadOrders()]);
          }}
          open={returnOpen}
          order={detail}
        />
      ) : null}
    </main>
  );
};
