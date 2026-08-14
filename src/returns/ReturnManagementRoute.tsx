import { useCallback, useEffect, useState } from "react";

import type {
  ApiClient,
  AuthenticatedUser,
  ReturnRecordDto,
} from "../api/client";
import type { ReturnStatus } from "../orders/types";
import { usePageAutoRefresh } from "../hooks/usePageAutoRefresh";
import { ReturnManagementPage } from "./ReturnManagementPage";
import {
  returnManagementApi,
  type ReturnManagementApi,
} from "./returnManagementApi";

export interface ReturnManagementRouteProps {
  actor: AuthenticatedUser;
  client: Pick<ApiClient, "listOrderFilterOptions">;
  api?: ReturnManagementApi;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "退单数据加载失败，请重试";

export const ReturnManagementRoute = ({
  actor,
  client,
  api = returnManagementApi,
}: ReturnManagementRouteProps) => {
  const [items, setItems] = useState<readonly ReturnRecordDto[]>([]);
  const [status, setStatus] = useState<ReturnStatus | "">("");
  const [storeId, setStoreId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [filterOptions, setFilterOptions] = useState<{ stores: Array<{ id: string; label: string }>; sellers: Array<{ id: string; label: string; storeId: string }> }>({ stores: [], sellers: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const load = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      setItems(await api.listReturns({ status: status || undefined, storeId: storeId || undefined, sellerId: sellerId || undefined }));
      setLoadError(null);
    } catch (error) {
      if (!background) {
        setItems([]);
        setLoadError(errorMessage(error));
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [api, sellerId, status, storeId]);

  useEffect(() => {
    void client.listOrderFilterOptions().then(setFilterOptions).catch(() => setFilterOptions({ stores: [], sellers: [] }));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load, reloadVersion]);

  usePageAutoRefresh({
    enabled: !loading,
    intervalMs: 15_000,
    onRefresh: () => load(true),
  });

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
      onStoreChange={(value) => { setStoreId(value); setSellerId(""); }}
      onSellerChange={setSellerId}
      storeId={storeId}
      sellerId={sellerId}
      stores={filterOptions.stores}
      sellers={filterOptions.sellers}
      status={status}
    />
  );
};
