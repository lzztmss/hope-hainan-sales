import { useEffect, useRef } from "react";

export interface PageAutoRefreshOptions {
  enabled?: boolean;
  intervalMs: number;
  onRefresh: () => Promise<unknown> | unknown;
}

export const usePageAutoRefresh = ({
  enabled = true,
  intervalMs,
  onRefresh,
}: PageAutoRefreshOptions) => {
  const refreshRef = useRef(onRefresh);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let inFlight = false;
    let lastStartedAt = 0;

    const refresh = async () => {
      const now = Date.now();
      if (
        disposed
        || inFlight
        || document.visibilityState !== "visible"
        || now - lastStartedAt < 1_000
      ) return;
      inFlight = true;
      lastStartedAt = now;
      try {
        await refreshRef.current();
      } finally {
        inFlight = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(() => void refresh(), intervalMs);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, intervalMs]);
};
