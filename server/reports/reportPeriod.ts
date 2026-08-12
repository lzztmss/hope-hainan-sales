export const REPORT_TIME_ZONE = "Asia/Shanghai" as const;

export interface ReportPeriod {
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
}

export class ReportPeriodError extends Error {
  readonly statusCode = 400;
}

const parseCalendarDate = (value: string, label: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ReportPeriodError(`${label}格式应为YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2020 ||
    year > 2100 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new ReportPeriodError(`${label}不是有效日期`);
  }
  return { year, month, day };
};

const shanghaiMidnight = (
  value: { year: number; month: number; day: number },
  addDays = 0,
): Date =>
  new Date(
    Date.UTC(value.year, value.month - 1, value.day + addDays) - 8 * 60 * 60 * 1000,
  );

const shanghaiParts = (date: Date) => {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    values.find((value) => value.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
};

export const defaultReportDates = (now: Date): { from: string; to: string } => {
  const parts = shanghaiParts(now);
  return {
    from: `${parts.year}-${parts.month}-01`,
    to: `${parts.year}-${parts.month}-${parts.day}`,
  };
};

export const parseReportPeriod = (
  from: string | undefined,
  to: string | undefined,
  now: Date,
): ReportPeriod => {
  const defaults = defaultReportDates(now);
  const normalizedFrom = from ?? defaults.from;
  const normalizedTo = to ?? defaults.to;
  const fromParts = parseCalendarDate(normalizedFrom, "开始日期");
  const toParts = parseCalendarDate(normalizedTo, "结束日期");
  const start = shanghaiMidnight(fromParts);
  const endExclusive = shanghaiMidnight(toParts, 1);
  if (endExclusive <= start) throw new ReportPeriodError("结束日期不得早于开始日期");
  const days = (endExclusive.getTime() - start.getTime()) / 86_400_000;
  if (days > 366) throw new ReportPeriodError("单次查询范围不得超过366天");
  return { from: normalizedFrom, to: normalizedTo, start, endExclusive };
};
