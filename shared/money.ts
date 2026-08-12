const VALID_MONEY = /^\d+(?:\.\d{1,2})?$/;

export const yuanToFen = (value: string): number => {
  const normalized = value.trim();

  if (/^-/.test(normalized)) {
    throw new Error("请输入不小于 0 的金额");
  }

  if (/^\d+\.\d{3,}$/.test(normalized)) {
    throw new Error("金额最多保留两位小数");
  }

  if (!VALID_MONEY.test(normalized)) {
    throw new Error("请输入有效金额");
  }

  const [yuanPart, decimalPart = ""] = normalized.split(".");
  const yuan = Number(yuanPart);
  const fen = Number(decimalPart.padEnd(2, "0"));
  const result = yuan * 100 + fen;

  if (!Number.isSafeInteger(result)) {
    throw new Error("金额超出支持范围");
  }

  return result;
};

export const formatFen = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new Error("金额必须使用整数分");
  }

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
};
