import type { AppRole, NavigationItem } from "./types";
import {
  ArchiveRestore,
  BadgeDollarSign,
  BarChart3,
  Contact,
  FilePlus2,
  FileText,
  LayoutDashboard,
  PackageCheck,
  Settings2,
  ShieldCheck,
  Tags,
  Undo2,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";

export const ROLE_LABELS: Record<AppRole, string> = {
  sales: "营业员",
  manager: "营业厅主管",
  regional: "大区经理",
  hr: "人力资源",
  finance: "财务",
  admin: "管理员",
};

const SALES_NAVIGATION: readonly NavigationItem[] = [
  { group: "workspace", href: "/", icon: LayoutDashboard, label: "工作台" },
  { group: "workspace", href: "/quotes", icon: FileText, label: "报价管理" },
  { group: "workspace", href: "/customers", icon: Contact, label: "我的客户" },
  { group: "workspace", href: "/orders", icon: PackageCheck, label: "我的订单" },
  { group: "insights", href: "/commissions/my", icon: BadgeDollarSign, label: "我的提成" },
  { group: "system", href: "/profile", icon: UserRound, label: "个人中心" },
];

const MANAGER_NAVIGATION: readonly NavigationItem[] = [
  { group: "workspace", href: "/", icon: LayoutDashboard, label: "工作台" },
  { group: "workspace", href: "/quotes", icon: FileText, label: "报价管理" },
  { group: "workspace", href: "/customers", icon: Contact, label: "客户管理" },
  { group: "workspace", href: "/orders", icon: PackageCheck, label: "订单管理" },
  { group: "workspace", href: "/returns", icon: Undo2, label: "售后审批" },
  { group: "insights", href: "/reports/team", icon: BarChart3, label: "团队报表" },
  { group: "insights", href: "/commissions", icon: BadgeDollarSign, label: "提成汇总" },
  { group: "system", href: "/profile", icon: UserRound, label: "个人中心" },
];

const ADMIN_NAVIGATION: readonly NavigationItem[] = [
  { group: "workspace", href: "/", icon: LayoutDashboard, label: "全局工作台" },
  { group: "workspace", href: "/customers", icon: Contact, label: "客户管理" },
  { group: "workspace", href: "/quotes", icon: FileText, label: "报价管理" },
  { group: "workspace", href: "/orders", icon: PackageCheck, label: "订单管理" },
  { group: "workspace", href: "/returns", icon: Undo2, label: "售后管理" },
  { group: "insights", href: "/reports", icon: BarChart3, label: "销售报表" },
  { group: "insights", href: "/commissions/sales", icon: BadgeDollarSign, label: "销售提成详情" },
  { group: "insights", href: "/commissions/regional", icon: WalletCards, label: "大区经理提成" },
  { group: "insights", href: "/commissions/regional/personal-orders", icon: FilePlus2, label: "个人渠道订单" },
  { group: "system", href: "/admin/users", icon: Users, label: "营业厅与账号" },
  { group: "system", href: "/admin/pricing", icon: Tags, label: "价格版本" },
  { group: "system", href: "/admin/commissions", icon: Settings2, label: "提成规则" },
  { group: "system", href: "/admin/settlements", icon: ShieldCheck, label: "结算批次" },
  { group: "system", href: "/admin/audit", icon: ArchiveRestore, label: "审计与回收站" },
  { group: "system", href: "/profile", icon: UserRound, label: "个人中心" },
];

const REGIONAL_NAVIGATION: readonly NavigationItem[] = [
  { group: "workspace", href: "/", icon: LayoutDashboard, label: "大区工作台" },
  { group: "workspace", href: "/quotes", icon: FileText, label: "报价查询" },
  { group: "workspace", href: "/customers", icon: Contact, label: "客户查询" },
  { group: "workspace", href: "/orders", icon: PackageCheck, label: "订单管理" },
  { group: "workspace", href: "/returns", icon: Undo2, label: "售后审批" },
  { group: "insights", href: "/reports/team", icon: BarChart3, label: "大区报表" },
  { group: "insights", href: "/commissions/regional", icon: BadgeDollarSign, label: "我的提成" },
  { group: "system", href: "/regional/users", icon: Users, label: "销售名单" },
  { group: "system", href: "/profile", icon: UserRound, label: "个人中心" },
];

const HR_NAVIGATION: readonly NavigationItem[] = [
  { group: "workspace", href: "/", icon: LayoutDashboard, label: "全局工作台" },
  { group: "workspace", href: "/customers", icon: Contact, label: "客户查询" },
  { group: "workspace", href: "/quotes", icon: FileText, label: "报价查询" },
  { group: "workspace", href: "/orders", icon: PackageCheck, label: "订单管理" },
  { group: "workspace", href: "/returns", icon: Undo2, label: "售后查询" },
  { group: "insights", href: "/reports", icon: BarChart3, label: "销售报表" },
  { group: "insights", href: "/commissions/sales", icon: BadgeDollarSign, label: "销售提成详情" },
  { group: "insights", href: "/commissions/regional", icon: WalletCards, label: "大区经理提成" },
  { group: "insights", href: "/commissions/regional/personal-orders", icon: FilePlus2, label: "个人渠道订单" },
  { group: "system", href: "/profile", icon: UserRound, label: "个人中心" },
];

const FINANCE_NAVIGATION: readonly NavigationItem[] = HR_NAVIGATION.filter(
  (item) => !["/commissions/sales", "/commissions/regional/personal-orders"].includes(item.href),
);

export const MOBILE_NAVIGATION: readonly NavigationItem[] = [
  { group: "workspace", href: "/", icon: LayoutDashboard, label: "工作台" },
  { group: "workspace", href: "/quotes/new", icon: FilePlus2, label: "报价" },
  { group: "workspace", href: "/orders", icon: PackageCheck, label: "订单" },
  { group: "insights", href: "/commissions/my", icon: BadgeDollarSign, label: "提成" },
  { group: "system", href: "/profile", icon: UserRound, label: "我的" },
];

export const navigationForRole = (
  role: AppRole,
): readonly NavigationItem[] => {
  if (role === "admin") {
    return ADMIN_NAVIGATION;
  }

  if (role === "manager") {
    return MANAGER_NAVIGATION;
  }

  if (role === "regional") return REGIONAL_NAVIGATION;
  if (role === "hr") return HR_NAVIGATION;
  if (role === "finance") return FINANCE_NAVIGATION;

  return SALES_NAVIGATION;
};

export const resolveActiveHref = (
  currentPath: string,
  items: readonly NavigationItem[],
): string | undefined =>
  items
    .filter(({ href }) =>
      href === "/"
        ? currentPath === href
        : currentPath === href || currentPath.startsWith(`${href}/`),
    )
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
