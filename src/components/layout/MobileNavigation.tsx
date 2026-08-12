import { MOBILE_NAVIGATION, resolveActiveHref } from "./navigation";
import type { NavigationLinkRenderer } from "./types";
import "./layout.css";

export type MobileNavigationProps = {
  currentPath: string;
  renderLink?: NavigationLinkRenderer;
};

export const MobileNavigation = ({
  currentPath,
  renderLink,
}: MobileNavigationProps) => {
  const selectedHref = resolveActiveHref(currentPath, MOBILE_NAVIGATION);

  return (
    <nav className="mobile-navigation" aria-label="移动端快捷导航">
      <ul>
        {MOBILE_NAVIGATION.map((item) => (
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
