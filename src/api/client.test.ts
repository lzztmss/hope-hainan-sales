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
});
