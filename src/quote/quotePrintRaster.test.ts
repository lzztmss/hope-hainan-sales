import { describe, expect, it } from "vitest";

import { getA4PageSlices } from "./quotePrintRaster";

describe("getA4PageSlices", () => {
  it("keeps a short document on one A4 page", () => {
    expect(getA4PageSlices(800, 600)).toEqual({
      pageHeight: 849,
      slices: [{ height: 800, top: 0 }],
    });
  });

  it("splits a long document into sequential A4 pages", () => {
    expect(getA4PageSlices(1800, 600)).toEqual({
      pageHeight: 849,
      slices: [
        { height: 849, top: 0 },
        { height: 849, top: 849 },
        { height: 102, top: 1698 },
      ],
    });
  });
});
