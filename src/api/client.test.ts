import { describe, expect, it } from "vitest";

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
