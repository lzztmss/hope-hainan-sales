import type { ReactNode } from "react";

export type AppRole = "sales" | "manager" | "admin";

export type AppShellUser = {
  displayName: string;
  role: AppRole;
  storeName?: string;
};

export type NavigationItem = {
  href: string;
  label: string;
};

export type NavigationLinkRenderProps = {
  isCurrent: boolean;
  item: NavigationItem;
};

export type NavigationLinkRenderer = (
  props: NavigationLinkRenderProps,
) => ReactNode;
