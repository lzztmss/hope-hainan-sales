import { describe, expect, it } from "vitest";

import { normalizeAppBasePath } from "./appBasePath";

describe("应用部署基础路径", () => {
  it("根路径保持为空", () => {
    expect(normalizeAppBasePath("/")).toBe("");
    expect(normalizeAppBasePath(" ")).toBe("");
  });

  it("子路径统一为无结尾斜杠的 basename", () => {
    expect(normalizeAppBasePath("/hainan-sales/")).toBe(
      "/hainan-sales",
    );
    expect(normalizeAppBasePath("hainan-sales")).toBe(
      "/hainan-sales",
    );
  });
});
