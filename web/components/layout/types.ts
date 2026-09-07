import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type AppRole = "sales" | "manager" | "regional" | "hr" | "finance" | "admin";

export type AppShellUser = {
  displayName: string;
  role: AppRole;
  storeName?: string;
};

export type NavigationItem = {
  group: "workspace" | "insights" | "system";
  href: string;
  icon: LucideIcon;
  label: string;
};

export type NavigationLinkRenderProps = {
  isCurrent: boolean;
  item: NavigationItem;
};

export type NavigationLinkRenderer = (
  props: NavigationLinkRenderProps,
) => ReactNode;
