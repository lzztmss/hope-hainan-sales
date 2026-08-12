import { useMemo } from "react";

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
  const adapter = useMemo(
    () => createOrderManagementAdapter(client, viewer),
    [client, viewer],
  );

  return (
    <OrderListPage
      adapter={adapter}
      initialOrderId={initialOrderId}
      viewer={viewer}
    />
  );
};
