import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePageAutoRefresh } from "./usePageAutoRefresh";

const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
};

describe("usePageAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes on the configured interval and when the page regains focus", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePageAutoRefresh({ intervalMs: 15_000, onRefresh: refresh }));

    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("pauses while hidden and never overlaps an unfinished refresh", async () => {
    let finish: (() => void) | undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderHook(() => usePageAutoRefresh({ intervalMs: 15_000, onRefresh: refresh }));

    setVisibility("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(refresh).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    finish?.();
  });
});
