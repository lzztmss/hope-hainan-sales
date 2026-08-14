import { describe, expect, it } from "vitest";

import { createClientKey } from "./clientKey";

describe("浏览器操作键", () => {
  it("安全环境优先使用 randomUUID", () => {
    expect(createClientKey("order-create", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    })).toBe("order-create-00000000-0000-4000-8000-000000000001");
  });

  it("HTTP 环境没有 randomUUID 时使用 getRandomValues", () => {
    const getRandomValues = ((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    }) as Crypto["getRandomValues"];
    expect(createClientKey("order-create", { getRandomValues }))
      .toBe(`order-create-${"ab".repeat(16)}`);
  });

  it("旧浏览器没有 Web Crypto 时仍可生成操作键", () => {
    expect(createClientKey("quote-submit", null)).toMatch(/^quote-submit-[a-z0-9]+-[a-z0-9]+$/);
  });
});
