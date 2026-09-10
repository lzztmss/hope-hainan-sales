import { reviewerRole } from "../returns/returnRoles";
import type {
  OrderDetail,
  OrderStatus,
  OrderTransitionCommand,
  OrderViewer,
} from "./types";

export interface OrderTransitionOption {
  command: OrderTransitionCommand;
  label: string;
  tone: string;
}

/**
 * 某个状态下当前账号可执行的订单操作。订单详情页按钮、工作台待办、
 * 订单列表「待办」筛选都以这里为准，避免三处各写一套角色规则。
 */
export const transitionCommandsFor = (
  status: OrderStatus,
  viewer: Pick<OrderViewer, "role">,
): OrderTransitionOption[] => {
  if (status === "pending") {
    if (viewer.role === "hr" || viewer.role === "finance" || viewer.role === "regional_manager") return [];
    return [
      { command: "ACCEPT", label: "受理订单", tone: "order-primary-action" },
      { command: "CANCEL", label: "取消订单", tone: "order-danger-action" },
    ];
  }
  if (status === "accepted") {
    const transitions: OrderTransitionOption[] =
      viewer.role === "sales" || viewer.role === "store_manager" || viewer.role === "admin"
        ? [{ command: "CANCEL", label: "取消订单", tone: "order-danger-action" }]
        : [];
    if (viewer.role === "store_manager" || viewer.role === "regional_manager" || viewer.role === "admin") {
      transitions.unshift({
        command: "ACTIVATE",
        label: "激活订单",
        tone: "order-primary-action",
      });
    }
    return transitions;
  }
  if (status === "activated") {
    return [{ command: "SIGN", label: "确认签收", tone: "order-primary-action" }];
  }
  if (status === "signed" && (viewer.role === "hr" || viewer.role === "admin")) {
    return [{ command: "RECONCILE", label: "确认对账", tone: "order-primary-action" }];
  }
  if (status === "reconciled" && (viewer.role === "finance" || viewer.role === "admin")) {
    return [{ command: "MARK_PAID", label: "确认收款", tone: "order-primary-action" }];
  }
  return [];
};

export const availableTransitions = (
  order: Pick<OrderDetail, "deletedAt" | "status">,
  viewer: Pick<OrderViewer, "role">,
): OrderTransitionOption[] =>
  order.deletedAt ? [] : transitionCommandsFor(order.status, viewer);

/** 需要有人处理的订单状态；具体谁能处理由 handlesOrderStatus 判定 */
const STATUSES_AWAITING_ACTION: readonly OrderStatus[] = [
  "pending",
  "accepted",
  "activated",
  "signed",
  "reconciled",
  "return_pending",
];

export const handlesOrderStatus = (
  status: OrderStatus,
  viewer: Pick<OrderViewer, "role">,
): boolean =>
  transitionCommandsFor(status, viewer).length > 0
  || (status === "return_pending" && reviewerRole(viewer));

/** 当前账号的「待办订单」状态集合 */
export const todoOrderStatuses = (viewer: Pick<OrderViewer, "role">): OrderStatus[] =>
  STATUSES_AWAITING_ACTION.filter((status) => handlesOrderStatus(status, viewer));
