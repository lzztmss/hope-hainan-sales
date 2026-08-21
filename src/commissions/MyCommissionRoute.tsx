import { useCallback, useEffect, useState } from "react";

import type {
  ApiClient,
  MyCommissionDashboardResponse,
} from "../api/client";
import { PageLayout } from "../components/layout";
import { usePageAutoRefresh } from "../hooks/usePageAutoRefresh";
import { MyCommissionPage } from "./MyCommissionPage";

export type MyCommissionRouteClient = Pick<
  ApiClient,
  "getMyCommissionDashboard"
>;

export interface MyCommissionRouteProps {
  client: MyCommissionRouteClient;
  month?: string;
}

const currentShanghaiMonth = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}`;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "提成数据加载失败，请重试";

export const MyCommissionRoute = ({
  client,
  month = currentShanghaiMonth(),
}: MyCommissionRouteProps) => {
  const [dashboard, setDashboard] =
    useState<MyCommissionDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(1);

  const load = useCallback(async (background = false, requestedPage = 1) => {
    if (!background) {
      setDashboard(null);
      setError(null);
    }
    try {
      const nextDashboard = await client.getMyCommissionDashboard({ month, limit: 20, page: requestedPage });
      setDashboard(nextDashboard);
      setPage(nextDashboard.page);
      setError(null);
    } catch (loadError) {
      if (!background) setError(errorMessage(loadError));
    }
  }, [client, month]);

  useEffect(() => {
    void load();
  }, [attempt, load]);

  usePageAutoRefresh({
    enabled: Boolean(dashboard),
    intervalMs: 60_000,
    onRefresh: () => load(true, page),
  });

  if (error) {
    return (
      <PageLayout title="提成加载失败">
        <div className="commission-route-state">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            重新加载
          </button>
        </div>
      </PageLayout>
    );
  }

  if (!dashboard) {
    return (
      <div className="commission-route-state" role="status">
        正在加载提成数据…
      </div>
    );
  }

  return <MyCommissionPage dashboard={dashboard} onPageChange={(nextPage) => void load(false, nextPage)} />;
};
