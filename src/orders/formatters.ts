const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatOrderMoney = (fen: number): string => {
  if (!Number.isSafeInteger(fen)) throw new Error("金额必须使用整数分");
  return `¥${moneyFormatter.format(fen / 100)}`;
};

export const formatOrderPrice = (
  oneTimeFen: number,
  monthlyFen: number,
): string =>
  monthlyFen > 0
    ? `${formatOrderMoney(monthlyFen)}/月`
    : formatOrderMoney(oneTimeFen);
