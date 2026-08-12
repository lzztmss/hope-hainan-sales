import { useCallback, useEffect, useState } from "react";

import type {
  AuthenticatedUser,
  ReturnRecordDto,
} from "../api/client";
import type { ReturnStatus } from "../orders/types";
import { ReturnManagementPage } from "./ReturnManagementPage";
import {
  returnManagementApi,
  type ReturnManagementApi,
} from "./returnManagementApi";

export interface ReturnManagementRouteProps {
  actor: AuthenticatedUser;
  api?: ReturnManagementApi;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "退单数据加载失败，请重试";

export const ReturnManagementRoute = ({
  actor,
  api = returnManagementApi,
}: ReturnManagementRouteProps) => {
  const [items, setItems] = useState<readonly ReturnRecordDto[]>([]);
  const [status, setStatus] = useState<ReturnStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await api.listReturns(status || undefined));
    } catch (error) {
      setItems([]);
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [api, status]);

  useEffect(() => {
    void load();
  }, [load, reloadVersion]);

  const replaceRecord = (next: ReturnRecordDto) => {
    setItems((current) =>
      current.map((record) => (record.id === next.id ? next : record)),
    );
  };

  return (
    <ReturnManagementPage
      actor={actor}
      items={items}
      loadError={loadError}
      loading={loading}
      onComplete={async (input) => {
        replaceRecord(await api.completeReturn(input));
      }}
      onDecide={async (input) => {
        replaceRecord(await api.decideReturn(input));
      }}
      onReload={() => setReloadVersion((version) => version + 1)}
      onStatusChange={setStatus}
      status={status}
    />
  );
};
