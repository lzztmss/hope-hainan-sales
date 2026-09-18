import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, Menu, X } from "lucide-react";

import { navigationForRole, resolveActiveHref, ROLE_LABELS } from "./navigation";
import { RoleNavigation } from "./RoleNavigation";
import { Button } from "../ui/button";
import type { AppShellUser, NavigationLinkRenderer } from "./types";
import "./layout.css";
import "./salesOpsLayout.css";

export type AppShellProps = {
  children: ReactNode;
  currentPath: string;
  onLogout?: () => void;
  renderLink?: NavigationLinkRenderer;
  user: AppShellUser;
};

export const AppShell = ({
  children,
  currentPath,
  onLogout,
  renderLink,
  user,
}: AppShellProps) => {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isNavigationOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const controls = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter((node) => node.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setIsNavigationOpen(false);

      if (
        menuButtonRef.current &&
        getComputedStyle(menuButtonRef.current).display !== "none"
      ) {
        menuButtonRef.current.focus();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      menuButtonRef.current?.focus();
    };
  }, [isNavigationOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 48rem)");
    const closeOnDesktop = () => { if (desktop.matches) setIsNavigationOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => setIsNavigationOpen(false), [currentPath]);
  const activeHref = resolveActiveHref(currentPath, navigationForRole(user.role));
  const activeLabel = navigationForRole(user.role).find((item) => item.href === activeHref)?.label ?? "工作台";

  return (
    <div className="sales-shell" data-role={user.role}>
      <a className="sales-shell__skip-link" href="#main-content">
        跳到主内容
      </a>
      <header className="sales-shell__header">
        <div className="sales-shell__mobile-brand"><span>联</span><strong>销售运营中台</strong></div>
        <div className="sales-shell__breadcrumb"><span>海南联通心连心</span><strong>{activeLabel}</strong></div>
        <Button
          variant="outline"
          size="sm"
          ref={menuButtonRef}
          className="sales-shell__menu-toggle"
          type="button"
          aria-controls="application-navigation"
          aria-expanded={isNavigationOpen}
          aria-label={isNavigationOpen ? "关闭主导航" : "打开主导航"}
          onClick={() => setIsNavigationOpen((current) => !current)}
        >
          {isNavigationOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          <span>{isNavigationOpen ? "关闭" : "菜单"}</span>
        </Button>
        <div className="sales-shell__identity">
          <span className="sales-shell__avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span>
          <span className="sales-shell__identity-copy"><strong>{user.displayName}</strong><small>{user.storeName ?? ROLE_LABELS[user.role]}</small></span>
          {user.storeName ? (
            <span className="sales-shell__store">{user.storeName}</span>
          ) : null}
          <span className="sales-shell__role">{ROLE_LABELS[user.role]}</span>
          {onLogout ? (
            <Button
              variant="outline"
              size="sm"
              className="sales-shell__logout"
              type="button"
              onClick={onLogout}
            >
              <LogOut aria-hidden="true" />
              <span>退出登录</span>
            </Button>
          ) : null}
        </div>
      </header>
      <aside
        ref={sidebarRef}
        className="sales-shell__sidebar"
        id="application-navigation"
        aria-label="应用主导航"
        data-open={isNavigationOpen}
        role={isNavigationOpen ? "dialog" : undefined}
        aria-modal={isNavigationOpen ? true : undefined}
      >
        <div className="sales-shell__sidebar-brand">
          <span className="sales-shell__brand-mark">联</span>
          <span><strong>销售运营中台</strong><small>海南联通 · 心连心养老套餐</small></span>
          <Button className="sales-shell__drawer-close" variant="ghost" size="icon" aria-label="关闭主导航" onClick={() => setIsNavigationOpen(false)}><X aria-hidden="true" /></Button>
        </div>
        <RoleNavigation
          currentPath={currentPath}
          renderLink={renderLink}
          role={user.role}
        />
        <div className="sales-shell__sidebar-user">
          <span className="sales-shell__avatar" aria-hidden="true">{user.displayName.slice(0, 1)}</span>
          <span><strong>{user.displayName}</strong><small>{ROLE_LABELS[user.role]}{user.storeName ? ` · ${user.storeName}` : ""}</small></span>
          {onLogout ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="sales-shell__sidebar-logout"
              type="button"
              aria-label="退出登录"
              onClick={onLogout}
            >
              <LogOut aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </aside>
      {isNavigationOpen ? <button className="sales-shell__backdrop" type="button" aria-label="关闭主导航" onClick={() => setIsNavigationOpen(false)} /> : null}
      <main className="sales-shell__main" id="main-content" tabIndex={-1} inert={isNavigationOpen}>
        {children}
      </main>
    </div>
  );
};
