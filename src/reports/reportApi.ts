import type { SalesReportFilters, SalesReportResponse } from "../../shared/reports/types";

export interface ReportsApi {
  getSalesReport(filters: SalesReportFilters): Promise<SalesReportResponse>;
  exportSalesReport(filters: SalesReportFilters): Promise<void>;
}

const queryString = (filters: SalesReportFilters): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  return query.toString();
};

export const createReportsApi = (
  fetcher: typeof fetch = fetch,
  baseUrl = "",
): ReportsApi => ({
  async getSalesReport(filters) {
    const response = await fetcher(`${baseUrl}/api/reports/sales?${queryString(filters)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "销售报表加载失败");
    }
    return (await response.json()) as SalesReportResponse;
  },
  async exportSalesReport(filters) {
    const response = await fetcher(`${baseUrl}/api/reports/sales/export.csv`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "text/csv" },
      body: JSON.stringify(filters),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "销售报表导出失败");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const fileName = encodedName ? decodeURIComponent(encodedName) : "FTTR心连心销售报表.csv";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  },
});

export const reportsApi = createReportsApi();
