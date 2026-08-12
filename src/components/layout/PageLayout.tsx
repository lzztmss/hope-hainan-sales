import type { ReactNode } from "react";

import { PageHeader, type PageHeaderProps } from "./PageHeader";

export type PageLayoutProps = PageHeaderProps & {
  aside?: ReactNode;
  asideLabel?: string;
  children: ReactNode;
};

export const PageLayout = ({
  actions,
  aside,
  asideLabel = "页面摘要",
  children,
  description,
  eyebrow,
  title,
}: PageLayoutProps) => (
  <div className="page-layout" data-with-aside={Boolean(aside)}>
    <PageHeader
      actions={actions}
      description={description}
      eyebrow={eyebrow}
      title={title}
    />
    <div className="page-layout__body">
      <div className="page-layout__content">{children}</div>
      {aside ? (
        <aside className="page-layout__aside" aria-label={asideLabel}>
          {aside}
        </aside>
      ) : null}
    </div>
  </div>
);
