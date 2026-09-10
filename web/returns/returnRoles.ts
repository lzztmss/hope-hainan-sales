import type { AuthenticatedUser } from "../api/client";

/** 与 server/returns/returnService.ts 的审批角色保持一致 */
export const reviewerRole = (actor: Pick<AuthenticatedUser, "role">): boolean =>
  actor.role === "store_manager" || actor.role === "regional_manager" || actor.role === "admin";
