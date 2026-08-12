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

  return (
    <nav className="role-navigation" aria-label={`${ROLE_LABELS[role]}主导航`}>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            {renderLink ? (
              renderLink({
                isCurrent: selectedHref === item.href,
                item,
              })
            ) : (
              <a
                href={item.href}
                aria-current={selectedHref === item.href ? "page" : undefined}
              >
                {item.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
};
