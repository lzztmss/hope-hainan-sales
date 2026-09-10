export const PRESET_HALF_YEAR_TARGETS = [1000, 4000, 8000, 10000, 13000, 14000] as const;

export interface RegionalCommissionTargetPeriodDraft {
  sequence: number;
  startsOn: string;
  endsOn: string;
  targetOrderCount: number;
  cumulativeTargetOrderCount: number;
}

export interface PresetHalfYearPlanDraft {
  planType: "half_year";
  periodCount: 6;
  startsOn: string;
  endsOn: string;
  periods: readonly RegionalCommissionTargetPeriodDraft[];
}

export type RegionalTargetPlanType = "quarter" | "half_year" | "year";

export interface RegionalTargetPlanDraft {
  planType: RegionalTargetPlanType;
  periodCount: 3 | 6 | 12;
  startsOn: string;
  endsOn: string;
  periods: readonly RegionalCommissionTargetPeriodDraft[];
}

const parseDate = (value: string): { year: number; month: number; day: number } => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("日期格式应为YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error("日期不是有效日期");
  }
  return { year, month, day };
};

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const addMonths = (value: string, months: number): string => {
  const { year, month, day } = parseDate(value);
  const monthIndex = year * 12 + month - 1 + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return formatDate(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))));
};

const subtractDay = (value: string): string => {
  const { year, month, day } = parseDate(value);
  return formatDate(new Date(Date.UTC(year, month - 1, day - 1)));
};

export const targetPlanPeriodCount = (planType: RegionalTargetPlanType): 3 | 6 | 12 =>
  planType === "quarter" ? 3 : planType === "half_year" ? 6 : 12;

export const buildTargetPlan = (
  startsOn: string,
  planType: RegionalTargetPlanType,
  periodTargets: readonly number[],
): RegionalTargetPlanDraft => {
  parseDate(startsOn);
  const periodCount = targetPlanPeriodCount(planType);
  if (periodTargets.length !== periodCount) {
    throw new Error(`${planType === "quarter" ? "季度" : planType === "half_year" ? "半年" : "全年"}计划必须包含 ${periodCount} 个目标周期`);
  }
  if (periodTargets.some((target) => !Number.isSafeInteger(target) || target <= 0)) {
    throw new Error("每期订单目标必须是大于 0 的整数");
  }
  let cumulativeTargetOrderCount = 0;
  const periods = periodTargets.map((targetOrderCount, index) => {
    const periodStartsOn = addMonths(startsOn, index);
    const endsOn = subtractDay(addMonths(startsOn, index + 1));
    cumulativeTargetOrderCount += targetOrderCount;
    return {
      sequence: index + 1,
      startsOn: periodStartsOn,
      endsOn,
      targetOrderCount,
      cumulativeTargetOrderCount,
    };
  });
  return {
    planType,
    periodCount,
    startsOn,
    endsOn: periods[periods.length - 1]!.endsOn,
    periods,
  };
};

export const buildPresetHalfYearPlan = (employmentStartDate: string): PresetHalfYearPlanDraft =>
  buildTargetPlan(
    employmentStartDate,
    "half_year",
    PRESET_HALF_YEAR_TARGETS,
  ) as PresetHalfYearPlanDraft;
