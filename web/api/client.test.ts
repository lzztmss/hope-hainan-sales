import { describe, expect, it } from "vitest";

import { DEFAULT_REGIONAL_COMMISSION_RULES } from "../../shared/regionalCommission/types.js";
import { createApiClient } from "./client.js";

describe("API client order filters", () => {
  it("sends the unified order search query to the server", async () => {
    let requestedUrl = "";
    const fetcher: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ items: [], nextCursor: null, total: 45, page: 2, pageSize: 20 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createApiClient({ fetcher });

    await client.listOrders({
      query: "XLX-RT-20260818-89E127",
      page: 2,
      limit: 20,
    });

    expect(requestedUrl).toBe(
      "/api/orders?query=XLX-RT-20260818-89E127&page=2&limit=20",
    );
  });

  it("exports all orders with the same filters and reads the server filename", async () => {
    let requestedUrl = "";
    const fetcher: typeof fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": "attachment; filename=orders.xlsx; filename*=UTF-8''%E8%AE%A2%E5%8D%95%E5%AF%B9%E8%B4%A6%E6%98%8E%E7%BB%86.xlsx",
          "X-Export-Order-Count": "45",
        },
      });
    };
    const client = createApiClient({ fetcher });

    const result = await client.exportOrders({
      status: "paid",
      reconciledDateFrom: "2026-08-01",
      reconciledDateTo: "2026-08-31",
    });

    expect(requestedUrl).toBe(
      "/api/orders/export?status=paid&reconciledDateFrom=2026-08-01&reconciledDateTo=2026-08-31",
    );
    expect(result.filename).toBe("订单对账明细.xlsx");
    expect(result.orderCount).toBe(45);
    expect(result.blob.size).toBe(4);
  });
});

describe("API client regional commission templates", () => {
  it("sends update, copy and stop requests to the template endpoints", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: "template" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createApiClient({ fetcher });

    await client.updateRegionalTemplate("template/1", {
      rules: DEFAULT_REGIONAL_COMMISSION_RULES,
      reason: "调整规则",
    });
    await client.copyRegionalTemplate("template/1", {
      effectiveFrom: "2026-10-01",
      reason: "复制新版本",
    });
    await client.stopRegionalTemplate("template/1", "规则到期");

    expect(requests.map(({ url, init }) => [url, init?.method])).toEqual([
      ["/api/admin/regional-commission-templates/template%2F1", "PATCH"],
      ["/api/admin/regional-commission-templates/template%2F1/copy", "POST"],
      ["/api/admin/regional-commission-templates/template%2F1/stop", "POST"],
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      reason: "调整规则",
      rules: DEFAULT_REGIONAL_COMMISSION_RULES,
    });
  });
});
