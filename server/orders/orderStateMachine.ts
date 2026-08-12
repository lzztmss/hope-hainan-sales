import type { UserRole } from "../auth/authorization.js";

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

export type OrderCommand =
  | "ACCEPT"
  | "ACTIVATE"
  | "COMPLETE"
  | "CANCEL"
  | "VOID"
  | "REQUEST_RETURN"
  | "COMPLETE_PARTIAL_RETURN"
  | "COMPLETE_FULL_RETURN";

type TransitionKey = `${OrderStatus}->${OrderStatus}`;

const ALL_ROLES: readonly UserRole[] = ["sales", "store_manager", "admin"];
const MANAGEMENT_ROLES: readonly UserRole[] = ["store_manager", "admin"];

const TRANSITIONS: Readonly<Partial<Record<TransitionKey, readonly UserRole[]>>> =
  Object.freeze({
    "pending->accepted": ALL_ROLES,
    "pending->cancelled": ALL_ROLES,
    "pending->voided": ["admin"],
    "accepted->activated": MANAGEMENT_ROLES,
    "accepted->cancelled": ALL_ROLES,
    "accepted->voided": ["admin"],
    "activated->completed": MANAGEMENT_ROLES,
    "activated->return_pending": ALL_ROLES,
    "completed->return_pending": ALL_ROLES,
    "partially_returned->return_pending": ALL_ROLES,
    "return_pending->partially_returned": MANAGEMENT_ROLES,
    "return_pending->returned": MANAGEMENT_ROLES,
  });

const targetForCommand = (
  from: OrderStatus,
  command: OrderCommand,
): OrderStatus => {
  switch (command) {
    case "ACCEPT":
      return "accepted";
    case "ACTIVATE":
      return "activated";
    case "COMPLETE":
      return "completed";
    case "CANCEL":
      return "cancelled";
    case "VOID":
      return "voided";
    case "REQUEST_RETURN":
      return "return_pending";
    case "COMPLETE_PARTIAL_RETURN":
      return "partially_returned";
    case "COMPLETE_FULL_RETURN":
      return "returned";
    default:
      throw new Error(`不支持的订单操作：${String(command)}`);
  }
};

export const canTransition = (
  from: OrderStatus,
  to: OrderStatus,
  role: UserRole,
): boolean => {
  if (from === to) return false;
  const roles = TRANSITIONS[`${from}->${to}`];
  return roles?.includes(role) ?? false;
};

export const assertOrderTransition = (
  from: OrderStatus,
  to: OrderStatus,
  role: UserRole,
): void => {
  if (!canTransition(from, to, role)) {
    throw new Error(`不允许的订单状态变更：${from} → ${to}`);
  }
};

export const nextStatusForCommand = (
  from: OrderStatus,
  command: OrderCommand,
  role: UserRole,
): OrderStatus => {
  const target = targetForCommand(from, command);
  assertOrderTransition(from, target, role);
  return target;
};
