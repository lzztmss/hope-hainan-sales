import { useCallback, useEffect, useState } from "react";

import {
  UserStoreManagementPage,
  createUserStoreManagementApi,
  type ManagedStoreView,
  type ManagedUserView,
  type UserStoreManagementApi,
} from "./UserStoreManagementPage";

export interface UserStoreManagementRouteProps {
  api?: UserStoreManagementApi;
}

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "营业厅与账号数据加载失败";

export const UserStoreManagementRoute = ({
  api = createUserStoreManagementApi(),
}: UserStoreManagementRouteProps) => {
  const [stores, setStores] = useState<readonly ManagedStoreView[]>([]);
  const [users, setUsers] = useState<readonly ManagedUserView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [nextStores, nextUsers] = await Promise.all([
        api.listStores(),
        api.listUsers(),
      ]);
      setStores(nextStores);
      setUsers(nextUsers);
    } catch (loadError) {
      setError(messageFor(loadError));
      throw loadError;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const refreshAfter = async (operation: () => Promise<unknown>) => {
    await operation();
    await load(false);
  };

  if (loading) {
    return (
      <div className="management-route-state" role="status">
        正在加载营业厅与账号…
      </div>
    );
  }

  if (error && stores.length === 0 && users.length === 0) {
    return (
      <section className="management-route-state" aria-live="polite">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void load().catch(() => undefined)}>
          重新加载
        </button>
      </section>
    );
  }

  return (
    <UserStoreManagementPage
      stores={stores}
      users={users}
      onCreateStore={(input) => refreshAfter(() => api.createStore(input))}
      onUpdateStore={(id, input) =>
        refreshAfter(() => api.updateStore(id, input))
      }
      onCreateUser={(input) => refreshAfter(() => api.createUser(input))}
      onUpdateUser={(id, input) =>
        refreshAfter(() => api.updateUser(id, input))
      }
      onResetPassword={(id, input) =>
        refreshAfter(() => api.resetPassword(id, input))
      }
    />
  );
};
