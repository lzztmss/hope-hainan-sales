export const normalizeAppBasePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/" || trimmed === "./") return "";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
};

export const APP_BASE_PATH = normalizeAppBasePath(import.meta.env.BASE_URL);

