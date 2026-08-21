import type { AppRole, NavigationItem } from "./types";

export const ROLE_LABELS: Record<AppRole, string> = {
  sales: "营业员",
  manager: "营业厅主管",
  regional: "大区经理",
  admin: "管理员",
};

const SALES_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "工作台" },
  { href: "/quotes/new", label: "新建报价" },
  { href: "/quotes", label: "我的报价" },
  { href: "/customers", label: "我的客户" },
  { href: "/orders", label: "我的订单" },
  { href: "/commissions/my", label: "我的提成" },
  { href: "/profile", label: "个人中心" },
];

const MANAGER_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "工作台" },
  { href: "/quotes", label: "报价管理" },
  { href: "/customers", label: "客户管理" },
  { href: "/orders", label: "订单管理" },
  { href: "/returns", label: "退单审批" },
  { href: "/reports/team", label: "团队报表" },
  { href: "/commissions", label: "提成汇总" },
  { href: "/profile", label: "个人中心" },
];

const ADMIN_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "全局工作台" },
  { href: "/customers", label: "客户管理" },
  { href: "/quotes", label: "报价管理" },
  { href: "/orders", label: "订单管理" },
  { href: "/returns", label: "退单管理" },
  { href: "/reports", label: "销售报表" },
  { href: "/admin/users", label: "营业厅与账号" },
  { href: "/admin/pricing", label: "价格版本" },
  { href: "/admin/commissions", label: "提成规则" },
  { href: "/admin/settlements", label: "结算批次" },
  { href: "/admin/audit", label: "审计与回收站" },
  { href: "/profile", label: "个人中心" },
];

const REGIONAL_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "大区工作台" },
  { href: "/quotes", label: "报价查询" },
  { href: "/customers", label: "客户查询" },
  { href: "/orders", label: "订单查询" },
  { href: "/returns", label: "退单查询" },
  { href: "/reports/team", label: "大区报表" },
  { href: "/regional/users", label: "名下账号" },
  { href: "/profile", label: "个人中心" },
];

export const MOBILE_NAVIGATION: readonly NavigationItem[] = [
  { href: "/", label: "工作台" },
  { href: "/quotes/new", label: "报价" },
  { href: "/orders", label: "订单" },
  { href: "/commissions/my", label: "提成" },
  { href: "/profile", label: "我的" },
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
