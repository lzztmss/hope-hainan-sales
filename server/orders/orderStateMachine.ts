import type { UserRole } from "../auth/authorization.js";

export type OrderStatus =
  | "pending"
  | "accepted"
  | "activated"
  | "signed"
  | "reconciled"
  | "paid"
  | "cancelled"
  | "return_pending"
  | "partially_returned"
  | "returned"
  | "voided";

export type OrderCommand =
  | "ACCEPT"
  | "ACTIVATE"
  | "SIGN"
  | "RECONCILE"
  | "MARK_PAID"
  | "CANCEL"
  | "VOID"
  | "REQUEST_RETURN"
  | "COMPLETE_PARTIAL_RETURN"
  | "COMPLETE_FULL_RETURN";

type TransitionKey = `${OrderStatus}->${OrderStatus}`;

const ORDER_INTAKE_ROLES: readonly UserRole[] = ["sales", "store_manager", "admin"];
const RETURN_REQUEST_ROLES: readonly UserRole[] = ["sales", "store_manager", "regional_manager", "admin"];
const ACTIVATION_ROLES: readonly UserRole[] = ["store_manager", "regional_manager", "admin"];
const SIGNING_ROLES: readonly UserRole[] = ["sales", "store_manager", "regional_manager", "hr", "finance", "admin"];
const RECONCILIATION_ROLES: readonly UserRole[] = ["hr", "admin"];
const PAYMENT_ROLES: readonly UserRole[] = ["finance", "admin"];

const TRANSITIONS: Readonly<Partial<Record<TransitionKey, readonly UserRole[]>>> =
  Object.freeze({
    "pending->accepted": ORDER_INTAKE_ROLES,
    "pending->cancelled": ORDER_INTAKE_ROLES,
    "pending->voided": ["admin"],
    "accepted->activated": ACTIVATION_ROLES,
    "accepted->cancelled": ORDER_INTAKE_ROLES,
    "accepted->voided": ["admin"],
    "activated->signed": SIGNING_ROLES,
    "signed->reconciled": RECONCILIATION_ROLES,
    "reconciled->paid": PAYMENT_ROLES,
    "activated->return_pending": RETURN_REQUEST_ROLES,
    "signed->return_pending": RETURN_REQUEST_ROLES,
    "reconciled->return_pending": RETURN_REQUEST_ROLES,
    "paid->return_pending": RETURN_REQUEST_ROLES,
    "partially_returned->return_pending": RETURN_REQUEST_ROLES,
    "return_pending->partially_returned": ACTIVATION_ROLES,
    "return_pending->returned": ACTIVATION_ROLES,
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
    case "SIGN":
      return "signed";
    case "RECONCILE":
      return "reconciled";
    case "MARK_PAID":
      return "paid";
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
