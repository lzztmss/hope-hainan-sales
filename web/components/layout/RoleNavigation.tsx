import {
  navigationForRole,
  resolveActiveHref,
  ROLE_LABELS,
} from "./navigation";
import type { AppRole, NavigationLinkRenderer } from "./types";
import "./layout.css";

export type RoleNavigationProps = {
  currentPath: string;
  renderLink?: NavigationLinkRenderer;
  role: AppRole;
};

export const RoleNavigation = ({
  currentPath,
  renderLink,
  role,
}: RoleNavigationProps) => {
  const items = navigationForRole(role);
  const selectedHref = resolveActiveHref(currentPath, items);
  const groups = [
    { id: "workspace" as const, label: "工作区" },
    { id: "insights" as const, label: "分析与激励" },
    { id: "system" as const, label: "系统" },
  ];

  return (
    <nav className="role-navigation" aria-label={`${ROLE_LABELS[role]}主导航`}>
      {groups.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (!groupItems.length) return null;
        return <section className="role-navigation__group" key={group.id} aria-labelledby={`navigation-${group.id}`}>
          <h2 id={`navigation-${group.id}`}>{group.label}</h2>
          <ul>
            {groupItems.map((item) => {
              const Icon = item.icon;
              return <li key={item.href}>
                {renderLink ? renderLink({ isCurrent: selectedHref === item.href, item }) : (
                  <a href={item.href} aria-current={selectedHref === item.href ? "page" : undefined}>
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </a>
                )}
              </li>;
            })}
          </ul>
        </section>;
      })}
    </nav>
  );
};
