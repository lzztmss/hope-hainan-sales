import { useEffect, useMemo, useState } from "react";

import type { AuthenticatedUser } from "../api/client";
import {
  createOrderManagementAdapter,
  type OrderApiClient,
} from "./OrderApiAdapter";
import { OrderListPage } from "./OrderListPage";

export interface OrderManagementRouteProps {
  client: OrderApiClient;
  initialOrderId?: string;
  viewer: AuthenticatedUser;
}

export const OrderManagementRoute = ({
  client,
  initialOrderId,
  viewer,
}: OrderManagementRouteProps) => {
  const [filterOptions, setFilterOptions] = useState<{
    stores: Array<{ id: string; label: string }>;
    sellers: Array<{ id: string; label: string; storeId: string }>;
  }>({ stores: [], sellers: [] });
  const adapter = useMemo(
    () => createOrderManagementAdapter(client, viewer),
    [client, viewer],
  );

  useEffect(() => {
    if (viewer.role === "sales") return;
    void client.listOrderFilterOptions().then(setFilterOptions).catch(() => {
      setFilterOptions({ stores: [], sellers: [] });
    });
  }, [client, viewer.role]);

  return (
    <OrderListPage
      adapter={adapter}
      initialOrderId={initialOrderId}
      storeOptions={filterOptions.stores}
      sellerOptions={filterOptions.sellers}
      viewer={viewer}
    />
  );
};
