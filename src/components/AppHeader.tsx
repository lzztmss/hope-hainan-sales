type AppHeaderProps = {
  companyName: string;
  quoteDate: string;
  quoteDateTime: string;
};

export const AppHeader = ({
  companyName,
  quoteDate,
  quoteDateTime,
}: AppHeaderProps) => (
  <header className="app-header">
    <img src="/haipo-logo.jpg" alt={companyName} className="company-logo" />
    <p className="company-name">{companyName}</p>
    <h1>海南联通 FTTR · 心连心智慧守护报价助手</h1>
    <span className="price-badge">大客户特优价</span>
    <time dateTime={quoteDateTime}>报价日期：{quoteDate}</time>
  </header>
);
