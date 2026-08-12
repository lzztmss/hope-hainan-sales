export const defaultShanghaiReportFilters = (
  now: Date = new Date(),
): { from: string; to: string } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${part("day")}`,
  };
};
