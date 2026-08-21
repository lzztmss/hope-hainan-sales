import { useCallback, useEffect, useMemo, useState } from "react";

import {
  UserStoreManagementPage,
  createUserStoreManagementApi,
  type ManagedStoreView,
  type ManagedUserView,
  type UserStoreManagementApi,
} from "./UserStoreManagementPage";

export interface UserStoreManagementRouteProps {
  api?: UserStoreManagementApi;
  currentUserId?: string;
  onCurrentUserPasswordReset?(): Promise<void> | void;
  regionalOnly?: boolean;
}

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "营业厅与账号数据加载失败";

export const UserStoreManagementRoute = ({
  api: providedApi,
  currentUserId,
  onCurrentUserPasswordReset,
  regionalOnly = false,
}: UserStoreManagementRouteProps) => {
  const api = useMemo(
    () => providedApi ?? createUserStoreManagementApi(),
    [providedApi],
  );
  const [stores, setStores] = useState<readonly ManagedStoreView[]>([]);
  const [users, setUsers] = useState<readonly ManagedUserView[]>([]);
  const [managerCandidates, setManagerCandidates] = useState<readonly ManagedUserView[]>([]);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [userStats, setUserStats] = useState({ total: 0, activeTotal: 0, mustChangePasswordTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyUserPage = useCallback((nextUsers: Awaited<ReturnType<UserStoreManagementApi["listUsers"]>>) => {
    setUsers(nextUsers.users);
    setPage(nextUsers.page);
    setUserStats({ total: nextUsers.total, activeTotal: nextUsers.activeTotal, mustChangePasswordTotal: nextUsers.mustChangePasswordTotal });
  }, []);

  const loadUsers = useCallback(async (showLoading = false, requestedPage = 1, requestedQuery = "") => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      applyUserPage(await api.listUsers({ query: requestedQuery || undefined, page: requestedPage, pageSize: 20 }));
    } catch (loadError) {
      setError(messageFor(loadError));
      throw loadError;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [api, applyUserPage]);

  const load = useCallback(async (showLoading = true, requestedPage = 1, requestedQuery = "") => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [nextStores, nextUsers, managers] = await Promise.all([
        api.listStores(),
        api.listUsers({ query: requestedQuery || undefined, page: requestedPage, pageSize: 20 }),
        api.listUsers({ role: "store_manager", active: true, page: 1, pageSize: 100 }),
      ]);
      setStores(nextStores);
      applyUserPage(nextUsers);
      setManagerCandidates(managers.users);
    } catch (loadError) {
      setError(messageFor(loadError));
      throw loadError;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [api, applyUserPage]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const refreshAfter = async (operation: () => Promise<unknown>) => {
    await operation();
    await load(false, page, query);
  };

  const changeQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    setPage(1);
    void loadUsers(false, 1, nextQuery).catch(() => undefined);
  }, [loadUsers]);

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
      currentUserId={currentUserId}
      regionalOnly={regionalOnly}
      stores={stores}
      users={users}
      managerCandidates={managerCandidates}
      userPage={page}
      userTotal={userStats.total}
      activeUserTotal={userStats.activeTotal}
      mustChangePasswordTotal={userStats.mustChangePasswordTotal}
      onUserPageChange={(nextPage) => void loadUsers(false, nextPage, query).catch(() => undefined)}
      onUserQueryChange={changeQuery}
      onCreateStore={(input) => refreshAfter(() => api.createStore(input))}
      onUpdateStore={(id, input) =>
        refreshAfter(() => api.updateStore(id, input))
      }
      onCreateUser={(input) => refreshAfter(() => api.createUser(input))}
      onUpdateUser={(id, input) =>
        refreshAfter(() => api.updateUser(id, input))
      }
      onResetPassword={(id, input) =>
        id === currentUserId
          ? api.resetPassword(id, input).then(async () => {
              await onCurrentUserPasswordReset?.();
            })
          : refreshAfter(() => api.resetPassword(id, input))
      }
    />
  );
};
