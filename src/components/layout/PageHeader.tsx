import type { ReactNode } from "react";

import "./layout.css";

export type PageHeaderProps = {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

export const PageHeader = ({
  actions,
  description,
  eyebrow,
  title,
}: PageHeaderProps) => (
  <header className="page-header">
    <div className="page-header__copy">
      {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
      <h1 className="page-header__title">{title}</h1>
      {description ? (
        <div className="page-header__description">{description}</div>
      ) : null}
    </div>
    {actions ? <div className="page-header__actions">{actions}</div> : null}
  </header>
);
