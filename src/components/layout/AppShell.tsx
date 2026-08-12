import { useEffect, useRef, useState, type ReactNode } from "react";

import { MobileNavigation } from "./MobileNavigation";
import { ROLE_LABELS } from "./navigation";
import { RoleNavigation } from "./RoleNavigation";
import type { AppShellUser, NavigationLinkRenderer } from "./types";
import "./layout.css";

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

  useEffect(() => {
    if (!isNavigationOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
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
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isNavigationOpen]);

  return (
    <div className="sales-shell" data-role={user.role}>
      <a className="sales-shell__skip-link" href="#main-content">
        跳到主内容
      </a>
      <header className="sales-shell__header">
        <span className="sales-shell__brand">
          海南联通 FTTR 心连心融合套餐销售报价系统
        </span>
        <button
          ref={menuButtonRef}
          className="sales-shell__menu-toggle"
          type="button"
          aria-controls="application-navigation"
          aria-expanded={isNavigationOpen}
          aria-label={isNavigationOpen ? "关闭主导航" : "打开主导航"}
          onClick={() => setIsNavigationOpen((current) => !current)}
        >
          {isNavigationOpen ? "关闭" : "菜单"}
        </button>
        <div className="sales-shell__identity">
          <strong>{user.displayName}</strong>
          {user.storeName ? (
            <span className="sales-shell__store">{user.storeName}</span>
          ) : null}
          <span className="sales-shell__role">{ROLE_LABELS[user.role]}</span>
          {onLogout ? (
            <button
              className="sales-shell__logout"
              type="button"
              onClick={onLogout}
            >
              退出登录
            </button>
          ) : null}
        </div>
      </header>
      <aside
        className="sales-shell__sidebar"
        id="application-navigation"
        aria-label="应用主导航"
        data-open={isNavigationOpen}
      >
        <RoleNavigation
          currentPath={currentPath}
          renderLink={renderLink}
          role={user.role}
        />
      </aside>
      <main className="sales-shell__main" id="main-content" tabIndex={-1}>
        {children}
      </main>
      {user.role === "sales" ? (
        <MobileNavigation currentPath={currentPath} renderLink={renderLink} />
      ) : null}
    </div>
  );
};
