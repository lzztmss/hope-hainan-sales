import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { APP_BASE_PATH } from "../appBasePath";
import { Pagination } from "../components/Pagination";
import "./userStoreManagement.css";

export type ManagedUserRole = "sales" | "store_manager" | "regional_manager" | "admin";
export type ManagedPersonnelType = "unicom" | "auxiliary" | "admin";

export interface ManagedStoreView {
  id: string;
  code: string;
  name: string;
  active: boolean;
  activeUserCount: number;
  managerUserId: string | null;
  managerName: string | null;
  regionalManagerUserId?: string | null;
  regionalManagerName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUserView {
  id: string;
  workNo: string;
  displayName: string;
  phoneMasked: string | null;
  role: ManagedUserRole;
  personnelType: ManagedPersonnelType;
  storeId: string | null;
  managedStoreIds?: readonly string[];
  storeName: string | null;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateManagedStoreInput {
  code: string;
  name: string;
  reason: string;
}

export interface UpdateManagedStoreInput {
  name?: string;
  active?: boolean;
  managerUserId?: string | null;
  reason: string;
}

export interface CreateManagedUserInput {
  workNo: string;
  displayName: string;
  phone?: string | null;
  role: ManagedUserRole;
  personnelType: ManagedPersonnelType;
  storeId: string | null;
  managedStoreIds?: readonly string[];
  active: boolean;
  initialPassword: string;
  reason: string;
}

export interface UpdateManagedUserInput {
  workNo?: string;
  displayName?: string;
  phone?: string | null;
  role?: ManagedUserRole;
  personnelType?: ManagedPersonnelType;
  storeId?: string | null;
  managedStoreIds?: readonly string[];
  active?: boolean;
  reason: string;
}

export interface ResetManagedPasswordInput {
  initialPassword: string;
  reason: string;
}

export interface UserStoreManagementPageProps {
  currentUserId?: string;
  regionalOnly?: boolean;
  stores: readonly ManagedStoreView[];
  users: readonly ManagedUserView[];
  managerCandidates?: readonly ManagedUserView[];
  userPage?: number;
  userTotal?: number;
  activeUserTotal?: number;
  mustChangePasswordTotal?: number;
  onUserPageChange?(page: number): void;
  onUserQueryChange?(query: string): void;
  onCreateStore?(input: CreateManagedStoreInput): Promise<void>;
  onUpdateStore?(id: string, input: UpdateManagedStoreInput): Promise<void>;
  onCreateUser?(input: CreateManagedUserInput): Promise<void>;
  onUpdateUser?(id: string, input: UpdateManagedUserInput): Promise<void>;
  onResetPassword?(id: string, input: ResetManagedPasswordInput): Promise<void>;
}

export interface ManagedUserFilters {
  storeId?: string;
  role?: ManagedUserRole;
  active?: boolean;
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface ManagedUserPage {
  users: ManagedUserView[];
  total: number;
  activeTotal: number;
  mustChangePasswordTotal: number;
  page: number;
  pageSize: number;
}

export interface UserStoreManagementApi {
  listStores(): Promise<ManagedStoreView[]>;
  createStore(input: CreateManagedStoreInput): Promise<ManagedStoreView>;
  updateStore(
    id: string,
    input: UpdateManagedStoreInput,
  ): Promise<ManagedStoreView>;
  listUsers(filters?: ManagedUserFilters): Promise<ManagedUserPage>;
  createUser(input: CreateManagedUserInput): Promise<ManagedUserView>;
  updateUser(
    id: string,
    input: UpdateManagedUserInput,
  ): Promise<ManagedUserView>;
  resetPassword(
    id: string,
    input: ResetManagedPasswordInput,
  ): Promise<ManagedUserView>;
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const apiRequest = async <T,>(
  fetcher: FetchLike,
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetcher(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) throw new Error(payload.error ?? "管理员操作失败，请重试");
  return payload;
};

export const createUserStoreManagementApi = (
  fetcher: FetchLike = fetch,
  baseUrl = APP_BASE_PATH,
): UserStoreManagementApi => ({
  async listStores() {
    const result = await apiRequest<{ stores: ManagedStoreView[] }>(
      fetcher,
      `${baseUrl}/api/admin/stores`,
      { method: "GET" },
    );
    return result.stores;
  },
  async createStore(input) {
    const result = await apiRequest<{ store: ManagedStoreView }>(
      fetcher,
      `${baseUrl}/api/admin/stores`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return result.store;
  },
  async updateStore(id, input) {
    const result = await apiRequest<{ store: ManagedStoreView }>(
      fetcher,
      `${baseUrl}/api/admin/stores/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return result.store;
  },
  async listUsers(filters = {}) {
    const query = new URLSearchParams();
    if (filters.storeId) query.set("storeId", filters.storeId);
    if (filters.role) query.set("role", filters.role);
    if (filters.active !== undefined) query.set("active", String(filters.active));
    if (filters.query) query.set("query", filters.query);
    query.set("page", String(filters.page ?? 1));
    query.set("pageSize", String(filters.pageSize ?? 20));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return apiRequest<ManagedUserPage>(
      fetcher,
      `${baseUrl}/api/admin/users${suffix}`,
      { method: "GET" },
    );
  },
  async createUser(input) {
    const result = await apiRequest<{ user: ManagedUserView }>(
      fetcher,
      `${baseUrl}/api/admin/users`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return result.user;
  },
  async updateUser(id, input) {
    const result = await apiRequest<{ user: ManagedUserView }>(
      fetcher,
      `${baseUrl}/api/admin/users/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return result.user;
  },
  async resetPassword(id, input) {
    const result = await apiRequest<{ user: ManagedUserView }>(
      fetcher,
      `${baseUrl}/api/admin/users/${encodeURIComponent(id)}/reset-password`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return result.user;
  },
});

const roleLabels: Record<ManagedUserRole, string> = {
  sales: "销售员",
  store_manager: "营业厅经理",
  regional_manager: "大区经理",
  admin: "管理员",
};

const personnelLabels: Record<ManagedPersonnelType, string> = {
  unicom: "联通人员",
  auxiliary: "辅助销售",
  admin: "管理员",
};

const initialUserDraft = {
  workNo: "",
  displayName: "",
  phone: "",
  role: "sales" as ManagedUserRole,
  personnelType: "unicom" as ManagedPersonnelType,
  storeId: "",
  managedStoreIds: [] as string[],
  initialPassword: "",
  reason: "",
};

interface EditDraft {
  userId: string;
  workNo: string;
  displayName: string;
  phone: string;
  role: ManagedUserRole;
  personnelType: ManagedPersonnelType;
  storeId: string;
  managedStoreIds: string[];
  reason: string;
}

interface ResetDraft {
  userId: string;
  displayName: string;
  initialPassword: string;
  reason: string;
}

interface StatusAction {
  kind: "store" | "user";
  id: string;
  name: string;
  nextActive: boolean;
  reason: string;
}

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const statusBadge = (active: boolean) => (
  <span className={`management-status is-${active ? "active" : "inactive"}`}>
    {active ? "启用" : "停用"}
  </span>
);

const ManagedStoreChecklist = ({
  selectedIds,
  stores,
  onChange,
}: {
  selectedIds: readonly string[];
  stores: readonly ManagedStoreView[];
  onChange(nextIds: string[]): void;
}) => (
  <fieldset className="managed-store-picker management-wide">
    <legend>管理营业厅（可多选）</legend>
    <div className="managed-store-picker__summary">
      已选择 {selectedIds.length} 个营业厅
    </div>
    <div className="managed-store-picker__options">
      {stores.map((store) => {
        const selected = selectedIds.includes(store.id);
        const occupied = Boolean(store.regionalManagerUserId) && !selected;
        return (
          <label className={occupied ? "is-disabled" : undefined} key={store.id}>
            <input
              checked={selected}
              disabled={occupied}
              onChange={(event) =>
                onChange(
                  event.currentTarget.checked
                    ? [...selectedIds, store.id]
                    : selectedIds.filter((id) => id !== store.id),
                )
              }
              type="checkbox"
            />
            <span>
              <strong>{store.name}</strong>
              <small>
                {occupied
                  ? `已归属 ${store.regionalManagerName ?? "其他大区经理"}`
                  : store.code}
              </small>
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

export const UserStoreManagementPage = ({
  currentUserId,
  regionalOnly = false,
  stores,
  users,
  managerCandidates = users,
  userPage = 1,
  userTotal = users.length,
  activeUserTotal = users.filter((user) => user.active).length,
  mustChangePasswordTotal = users.filter((user) => user.mustChangePassword).length,
  onUserPageChange,
  onUserQueryChange,
  onCreateStore,
  onUpdateStore,
  onCreateUser,
  onUpdateUser,
  onResetPassword,
}: UserStoreManagementPageProps) => {
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [storeDraft, setStoreDraft] = useState({ code: "", name: "", reason: "" });
  const [showUserForm, setShowUserForm] = useState(false);
  const [userDraft, setUserDraft] = useState(initialUserDraft);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [resetDraft, setResetDraft] = useState<ResetDraft | null>(null);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [managerStoreId, setManagerStoreId] = useState<string | null>(null);
  const [managerUserId, setManagerUserId] = useState("");
  const [managerReason, setManagerReason] = useState("");
  const [search, setSearch] = useState("");
  const lastReportedSearch = useRef("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordInvalid, setPasswordInvalid] = useState(false);
  const actionPanelRef = useRef<HTMLElement | null>(null);
  const actionPanelKey = managerStoreId
    ? `manager:${managerStoreId}`
    : statusAction
      ? `status:${statusAction.kind}:${statusAction.id}`
      : editDraft
        ? `edit:${editDraft.userId}`
        : resetDraft
          ? `reset:${resetDraft.userId}`
          : null;

  useEffect(() => {
    if (!actionPanelKey) return;
    const frame = window.requestAnimationFrame(() => {
      actionPanelRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
      actionPanelRef.current
        ?.querySelector<HTMLElement>("input, select")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionPanelKey]);

  const activeStores = useMemo(
    () => stores.filter((store) => store.active),
    [stores],
  );
  useEffect(() => {
    const normalized = search.trim();
    if (normalized === lastReportedSearch.current) return;
    const timer = window.setTimeout(() => {
      lastReportedSearch.current = normalized;
      onUserQueryChange?.(normalized);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [onUserQueryChange, search]);

  const begin = (): void => {
    setBusy(true);
    setError(null);
    setMessage(null);
  };

  const createStore = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (storeDraft.code.trim().length < 2) {
      setError("营业厅编码至少填写 2 个字符");
      return;
    }
    if (storeDraft.reason.trim().length < 2) {
      setError("新增营业厅原因至少填写 2 个字符");
      return;
    }
    begin();
    try {
      await onCreateStore?.({
        code: storeDraft.code.trim().toUpperCase(),
        name: storeDraft.name.trim(),
        reason: storeDraft.reason.trim(),
      });
      setStoreDraft({ code: "", name: "", reason: "" });
      setShowStoreForm(false);
      setMessage("营业厅已创建");
    } catch (caught) {
      setError(errorText(caught, "营业厅创建失败"));
    } finally {
      setBusy(false);
    }
  };

  const changeCreateRole = (role: ManagedUserRole): void => {
    setUserDraft((current) => ({
      ...current,
      role,
      personnelType: role === "admin" ? "admin" : current.personnelType === "admin" ? "unicom" : current.personnelType,
      storeId: role === "admin" || role === "regional_manager" ? "" : current.storeId,
      managedStoreIds: role === "regional_manager" ? current.managedStoreIds : [],
    }));
  };

  const createUser = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (userDraft.initialPassword.length < 8 || userDraft.initialPassword.length > 128) {
      setPasswordInvalid(true);
      setError("初始密码长度必须为8至128位");
      return;
    }
    setPasswordInvalid(false);
    if (userDraft.reason.trim().length < 2) {
      setError("新增账号原因至少填写 2 个字符");
      return;
    }
    if (userDraft.role !== "admin" && userDraft.role !== "regional_manager" && !userDraft.storeId) {
      setError("请选择所属营业厅");
      return;
    }
    begin();
    try {
      await onCreateUser?.({
        workNo: userDraft.workNo.trim().toUpperCase(),
        displayName: userDraft.displayName.trim(),
        ...(userDraft.phone.trim() ? { phone: userDraft.phone.trim() } : {}),
        role: userDraft.role,
        personnelType: userDraft.personnelType,
        storeId: userDraft.role === "admin" || userDraft.role === "regional_manager" ? null : userDraft.storeId,
        managedStoreIds: userDraft.role === "regional_manager" ? userDraft.managedStoreIds : [],
        active: true,
        initialPassword: userDraft.initialPassword,
        reason: userDraft.reason.trim(),
      });
      setUserDraft(initialUserDraft);
      setShowUserForm(false);
      setMessage("账号已创建，首次登录必须修改密码");
    } catch (caught) {
      setError(errorText(caught, "账号创建失败"));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (user: ManagedUserView): void => {
    setEditDraft({
      userId: user.id,
      workNo: user.workNo,
      displayName: user.displayName,
      phone: "",
      role: user.role,
      personnelType: user.personnelType,
      storeId: user.storeId ?? "",
      managedStoreIds: [...(user.managedStoreIds ?? [])],
      reason: "",
    });
    setResetDraft(null);
    setStatusAction(null);
    setManagerStoreId(null);
    setError(null);
  };

  const saveEdit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!editDraft) return;
    if (editDraft.workNo.trim().length < 2) {
      setError("工号至少填写 2 个字符");
      return;
    }
    if (editDraft.reason.trim().length < 2) {
      setError("编辑账号原因至少填写 2 个字符");
      return;
    }
    if (editDraft.role !== "admin" && editDraft.role !== "regional_manager" && !editDraft.storeId) {
      setError("请选择所属营业厅");
      return;
    }
    begin();
    try {
      await onUpdateUser?.(editDraft.userId, {
        workNo: editDraft.workNo.trim().toUpperCase(),
        displayName: editDraft.displayName.trim(),
        ...(editDraft.phone.trim() ? { phone: editDraft.phone.trim() } : {}),
        role: editDraft.role,
        personnelType: editDraft.personnelType,
        storeId: editDraft.role === "admin" || editDraft.role === "regional_manager" ? null : editDraft.storeId,
        managedStoreIds: editDraft.role === "regional_manager" ? editDraft.managedStoreIds : [],
        reason: editDraft.reason.trim(),
      });
      setEditDraft(null);
      setMessage("账号资料已更新");
    } catch (caught) {
      setError(errorText(caught, "账号更新失败"));
    } finally {
      setBusy(false);
    }
  };

  const runStatusAction = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!statusAction) return;
    if (statusAction.reason.trim().length < 2) {
      setError("启停原因至少填写 2 个字符");
      return;
    }
    begin();
    try {
      if (statusAction.kind === "store") {
        await onUpdateStore?.(statusAction.id, {
          active: statusAction.nextActive,
          reason: statusAction.reason.trim(),
        });
      } else {
        await onUpdateUser?.(statusAction.id, {
          active: statusAction.nextActive,
          reason: statusAction.reason.trim(),
        });
      }
      setMessage(`${statusAction.name}已${statusAction.nextActive ? "启用" : "停用"}`);
      setStatusAction(null);
    } catch (caught) {
      setError(errorText(caught, "启停操作失败"));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!resetDraft) return;
    if (resetDraft.initialPassword.length < 8 || resetDraft.initialPassword.length > 128) {
      setError("新初始密码长度必须为8至128位");
      return;
    }
    if (resetDraft.reason.trim().length < 2) {
      setError("重置密码原因至少填写 2 个字符");
      return;
    }
    begin();
    try {
      await onResetPassword?.(resetDraft.userId, {
        initialPassword: resetDraft.initialPassword,
        reason: resetDraft.reason.trim(),
      });
      setResetDraft(null);
      setMessage("初始密码已重置，原会话已失效");
    } catch (caught) {
      setError(errorText(caught, "密码重置失败"));
    } finally {
      setBusy(false);
    }
  };

  const saveStoreManager = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!managerStoreId) {
      setError("请先选择需要设置主经理的营业厅");
      return;
    }
    if (managerReason.trim().length < 2) {
      setError("指定营业厅经理的原因至少填写 2 个字符");
      return;
    }
    begin();
    try {
      await onUpdateStore?.(managerStoreId, {
        managerUserId: managerUserId || null,
        reason: managerReason.trim(),
      });
      setManagerStoreId(null);
      setManagerUserId("");
      setManagerReason("");
      setMessage("营业厅主经理已更新");
    } catch (caught) {
      setError(errorText(caught, "营业厅主经理更新失败"));
    } finally {
      setBusy(false);
    }
  };

  const storeActions = (store: ManagedStoreView) => (
    <div className="management-row-actions">
    <button
      type="button"
      disabled={busy || !onUpdateStore}
      onClick={() => {
        setManagerStoreId(store.id);
        setManagerUserId(store.managerUserId ?? "");
        setManagerReason("");
        setStatusAction(null);
        setEditDraft(null);
        setResetDraft(null);
      }}
    >
      指定经理
    </button>
    <button
      type="button"
      className={store.active ? "management-danger" : "management-secondary"}
      disabled={busy || !onUpdateStore}
      aria-label={`${store.active ? "停用" : "启用"}营业厅`}
      onClick={() => {
        setStatusAction({
          kind: "store",
          id: store.id,
          name: store.name,
          nextActive: !store.active,
          reason: "",
        });
        setEditDraft(null);
        setResetDraft(null);
        setManagerStoreId(null);
      }}
    >
      {store.active ? "停用" : "启用"}
    </button>
    </div>
  );

  const userActions = (managedUser: ManagedUserView) => (
    <div className="management-row-actions">
      <button
        type="button"
        disabled={busy || !onUpdateUser}
        aria-label="编辑账号"
        onClick={() => startEdit(managedUser)}
      >
        编辑
      </button>
      <button
        type="button"
        disabled={busy || !onResetPassword}
        aria-label="重置密码"
        onClick={() => {
          setResetDraft({
            userId: managedUser.id,
            displayName: managedUser.displayName,
            initialPassword: "",
            reason: "",
          });
          setEditDraft(null);
          setStatusAction(null);
          setManagerStoreId(null);
          setError(null);
        }}
      >
        重置密码
      </button>
      <button
        type="button"
        className={managedUser.active ? "management-danger" : "management-secondary"}
        disabled={busy || !onUpdateUser}
        aria-label={`${managedUser.active ? "停用" : "启用"}账号`}
        onClick={() => {
          setStatusAction({
            kind: "user",
            id: managedUser.id,
            name: managedUser.displayName,
            nextActive: !managedUser.active,
            reason: "",
          });
          setEditDraft(null);
          setResetDraft(null);
          setManagerStoreId(null);
        }}
      >
        {managedUser.active ? "停用" : "启用"}
      </button>
    </div>
  );

  return (
    <section className="user-store-management" aria-labelledby="user-store-title">
      <header className="user-store-management__header">
        <div>
          <p>{regionalOnly ? "大区人员管理" : "管理员专区"}</p>
          <h1 id="user-store-title">{regionalOnly ? "名下账号" : "营业厅与账号管理"}</h1>
          <span>{regionalOnly ? "查看并维护所管营业厅的销售员与营业厅经理账号。" : "统一维护销售归属、登录权限与人员状态；历史订单快照不会被改写。"}</span>
        </div>
      </header>

      <section className="management-summary" aria-label="管理汇总">
        <article><span>启用营业厅</span><strong>{activeStores.length}</strong></article>
        <article><span>启用账号</span><strong>{activeUserTotal}</strong></article>
        <article><span>首次登录待改密</span><strong>{mustChangePasswordTotal}</strong></article>
      </section>

      <div className="management-live" aria-live="polite">
        {message ? <p className="management-success">{message}</p> : null}
        {error ? <p id={passwordInvalid ? "initial-password-error" : undefined} role="alert">{error}</p> : null}
      </div>

      {!regionalOnly ? <section className="management-section" aria-labelledby="stores-title">
        <div className="management-section__heading">
          <div><h2 id="stores-title">营业厅管理</h2><p>停用前须先停用或转移该厅全部启用账号。</p></div>
          <button type="button" className="management-primary" onClick={() => setShowStoreForm((value) => !value)}>
            {showStoreForm ? "收起新增营业厅" : "新增营业厅"}
          </button>
        </div>

        {showStoreForm ? (
          <form className="management-form" onSubmit={(event) => void createStore(event)}>
            <fieldset><legend>新增营业厅资料</legend>
              <label>营业厅编码（至少 2 个字符）<input required minLength={2} value={storeDraft.code} onChange={(event) => setStoreDraft({ ...storeDraft, code: event.currentTarget.value.toUpperCase() })} /></label>
              <label>营业厅名称<input required value={storeDraft.name} onChange={(event) => setStoreDraft({ ...storeDraft, name: event.currentTarget.value })} /></label>
              <label className="management-wide">新增营业厅原因（至少 2 个字符）<input required minLength={2} value={storeDraft.reason} onChange={(event) => setStoreDraft({ ...storeDraft, reason: event.currentTarget.value })} /></label>
              <div className="management-form-actions"><button type="submit" className="management-primary" disabled={busy || !onCreateStore}>创建营业厅</button></div>
            </fieldset>
          </form>
        ) : null}

        <div className="management-mobile-list" aria-label="营业厅移动列表">
          {stores.map((store) => (
            <article className="management-mobile-card" data-testid={`managed-store-mobile-${store.id}`} key={store.id}>
              <header><div><span>{store.code}</span><h3>{store.name}</h3></div>{statusBadge(store.active)}</header>
              <dl><div><dt>启用账号</dt><dd>{store.activeUserCount} 人</dd></div><div><dt>主经理</dt><dd>{store.managerName ?? "未指定"}</dd></div></dl>
              {storeActions(store)}
            </article>
          ))}
        </div>

        <div className="management-desktop-table">
          <table aria-label="营业厅桌面列表"><thead><tr><th>编码</th><th>营业厅</th><th>主经理</th><th>启用账号</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{stores.map((store) => <tr key={store.id}><td>{store.code}</td><td>{store.name}</td><td>{store.managerName ?? "未指定"}</td><td>{store.activeUserCount} 人</td><td>{statusBadge(store.active)}</td><td>{storeActions(store)}</td></tr>)}</tbody>
          </table>
        </div>
      </section> : null}

      {managerStoreId ? (
        <section ref={actionPanelRef} className="management-action-panel" aria-labelledby="manager-action-title">
          <h2 id="manager-action-title">指定营业厅主经理</h2>
          <form onSubmit={(event) => void saveStoreManager(event)}>
              <label>主经理<select value={managerUserId} onChange={(event) => setManagerUserId(event.currentTarget.value)}><option value="">暂不指定</option>{managerCandidates.filter((user) => user.storeId === managerStoreId && user.role === "store_manager" && user.active).map((user) => <option key={user.id} value={user.id}>{user.displayName}（{user.workNo}）</option>)}</select></label>
            <label>变更原因（至少 2 个字符）<input required minLength={2} value={managerReason} onChange={(event) => setManagerReason(event.currentTarget.value)} /></label>
            <div className="management-form-actions"><button type="button" onClick={() => setManagerStoreId(null)}>取消</button><button className="management-primary" disabled={busy} type="submit">确认指定</button></div>
          </form>
        </section>
      ) : null}

      {statusAction ? (
        <section ref={actionPanelRef} className="management-action-panel" aria-labelledby="status-action-title">
          <h2 id="status-action-title">{statusAction.nextActive ? "启用" : "停用"}{statusAction.kind === "store" ? "营业厅" : "账号"}</h2>
          <p>{statusAction.name} · 所有启停操作都会写入审计记录。</p>
          <form onSubmit={(event) => void runStatusAction(event)}>
            <label>{`${statusAction.nextActive ? "启用" : "停用"}${statusAction.name}的原因（至少 2 个字符）`}<input required minLength={2} value={statusAction.reason} onChange={(event) => setStatusAction({ ...statusAction, reason: event.currentTarget.value })} /></label>
            <div className="management-form-actions"><button type="button" onClick={() => setStatusAction(null)}>取消</button><button type="submit" className={statusAction.nextActive ? "management-primary" : "management-danger"} disabled={busy}>{`确认${statusAction.nextActive ? "启用" : "停用"}${statusAction.kind === "store" ? "营业厅" : "账号"}`}</button></div>
          </form>
        </section>
      ) : null}

      <section className="management-section" aria-labelledby="users-title">
        <div className="management-section__heading">
          <div><h2 id="users-title">账号管理</h2><p>停用账号立即退出所有设备；重置后首次登录必须改密。</p></div>
          <button type="button" className="management-primary" onClick={() => setShowUserForm((value) => !value)}>{showUserForm ? "收起新增账号" : "新增账号"}</button>
        </div>

        {showUserForm ? (
          <form className="management-form" onSubmit={(event) => void createUser(event)}>
            <fieldset><legend>新增账号资料</legend>
              <label>工号<input required autoCapitalize="characters" value={userDraft.workNo} onChange={(event) => setUserDraft({ ...userDraft, workNo: event.currentTarget.value.toUpperCase() })} /></label>
              <label>姓名<input required value={userDraft.displayName} onChange={(event) => setUserDraft({ ...userDraft, displayName: event.currentTarget.value })} /></label>
              <label>手机号（选填）<input inputMode="tel" value={userDraft.phone} onChange={(event) => setUserDraft({ ...userDraft, phone: event.currentTarget.value })} /></label>
              <label>账号角色<select value={userDraft.role} onChange={(event) => changeCreateRole(event.currentTarget.value as ManagedUserRole)}><option value="sales">销售员</option><option value="store_manager">营业厅经理</option>{!regionalOnly ? <><option value="regional_manager">大区经理</option><option value="admin">管理员</option></> : null}</select></label>
              <label>人员类型<select value={userDraft.personnelType} disabled={userDraft.role === "admin"} onChange={(event) => setUserDraft({ ...userDraft, personnelType: event.currentTarget.value as ManagedPersonnelType })}><option value="unicom">联通人员</option><option value="auxiliary">辅助销售</option><option value="admin">管理员</option></select></label>
              <label>所属营业厅<select required={userDraft.role !== "admin" && userDraft.role !== "regional_manager"} disabled={userDraft.role === "admin" || userDraft.role === "regional_manager"} value={userDraft.storeId} onChange={(event) => setUserDraft({ ...userDraft, storeId: event.currentTarget.value })}><option value="">{userDraft.role === "regional_manager" ? "大区经理不绑定单一营业厅" : "请选择营业厅"}</option>{activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
              {userDraft.role === "regional_manager" ? <ManagedStoreChecklist selectedIds={userDraft.managedStoreIds} stores={activeStores} onChange={(managedStoreIds) => setUserDraft({ ...userDraft, managedStoreIds })} /> : null}
              <label>初始密码（8 至 128 位）<input type="password" required minLength={8} maxLength={128} aria-invalid={passwordInvalid} aria-describedby={passwordInvalid ? "initial-password-error" : undefined} value={userDraft.initialPassword} onChange={(event) => { setPasswordInvalid(false); setUserDraft({ ...userDraft, initialPassword: event.currentTarget.value }); }} /></label>
              <label className="management-wide">新增账号原因（至少 2 个字符）<input required minLength={2} value={userDraft.reason} onChange={(event) => setUserDraft({ ...userDraft, reason: event.currentTarget.value })} /></label>
              <div className="management-form-actions"><button type="submit" className="management-primary" disabled={busy || !onCreateUser}>创建账号</button></div>
            </fieldset>
          </form>
        ) : null}

        <label className="management-search">搜索账号<input type="search" placeholder="工号、姓名、营业厅或手机号后四位" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>

        <div className="management-mobile-list" aria-label="账号移动列表">
          {users.map((managedUser) => (
            <article className="management-mobile-card" data-testid={`managed-user-mobile-${managedUser.id}`} key={managedUser.id}>
              <header><div><span>{managedUser.workNo}</span><h3>{managedUser.displayName}</h3></div>{statusBadge(managedUser.active)}</header>
              <div className="management-tags"><span>{roleLabels[managedUser.role]}</span><span>{personnelLabels[managedUser.personnelType]}</span>{managedUser.mustChangePassword ? <span className="is-warning">待改初始密码</span> : null}</div>
              <dl><div><dt>营业厅</dt><dd>{managedUser.storeName ?? "公司管理员"}</dd></div><div><dt>手机号</dt><dd>{managedUser.phoneMasked ?? "未绑定"}</dd></div></dl>
              {userActions(managedUser)}
            </article>
          ))}
        </div>

        <div className="management-desktop-table">
          <table aria-label="账号桌面列表"><thead><tr><th>工号 / 姓名</th><th>角色</th><th>营业厅</th><th>手机号</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{users.map((managedUser) => <tr key={managedUser.id}><td><strong>{managedUser.workNo}</strong><span>{managedUser.displayName}</span></td><td>{roleLabels[managedUser.role]}<small>{personnelLabels[managedUser.personnelType]}</small></td><td>{managedUser.storeName ?? "公司管理员"}</td><td>{managedUser.phoneMasked ?? "未绑定"}</td><td>{statusBadge(managedUser.active)}{managedUser.mustChangePassword ? <small>待改密码</small> : null}</td><td>{userActions(managedUser)}</td></tr>)}</tbody>
          </table>
        </div>
        <Pagination
          onPageChange={(nextPage) => onUserPageChange?.(nextPage)}
          page={userPage}
          totalItems={userTotal}
        />
      </section>

      {editDraft ? (
        <section ref={actionPanelRef} className="management-action-panel" aria-labelledby="edit-account-title">
          <h2 id="edit-account-title">编辑账号</h2><p>留空手机号不会改动原绑定；历史订单仍使用原销售快照。</p>
          <form className="management-form" onSubmit={(event) => void saveEdit(event)}><fieldset><legend>账号资料</legend>
            <label>编辑工号<input required value={editDraft.workNo} onChange={(event) => setEditDraft({ ...editDraft, workNo: event.currentTarget.value.toUpperCase() })} /></label>
            <label>编辑姓名<input required value={editDraft.displayName} onChange={(event) => setEditDraft({ ...editDraft, displayName: event.currentTarget.value })} /></label>
            <label>更新手机号（留空保持）<input inputMode="tel" value={editDraft.phone} onChange={(event) => setEditDraft({ ...editDraft, phone: event.currentTarget.value })} /></label>
            <label>编辑角色<select value={editDraft.role} disabled={regionalOnly} onChange={(event) => { const role = event.currentTarget.value as ManagedUserRole; setEditDraft({ ...editDraft, role, personnelType: role === "admin" ? "admin" : editDraft.personnelType === "admin" ? "unicom" : editDraft.personnelType, storeId: role === "admin" || role === "regional_manager" ? "" : editDraft.storeId, managedStoreIds: role === "regional_manager" ? editDraft.managedStoreIds : [] }); }}><option value="sales">销售员</option><option value="store_manager">营业厅经理</option>{!regionalOnly ? <><option value="regional_manager">大区经理</option><option value="admin">管理员</option></> : null}</select></label>
            <label>编辑人员类型<select disabled={editDraft.role === "admin"} value={editDraft.personnelType} onChange={(event) => setEditDraft({ ...editDraft, personnelType: event.currentTarget.value as ManagedPersonnelType })}><option value="unicom">联通人员</option><option value="auxiliary">辅助销售</option><option value="admin">管理员</option></select></label>
            <label>编辑所属营业厅<select disabled={editDraft.role === "admin" || editDraft.role === "regional_manager"} required={editDraft.role !== "admin" && editDraft.role !== "regional_manager"} value={editDraft.storeId} onChange={(event) => setEditDraft({ ...editDraft, storeId: event.currentTarget.value })}><option value="">{editDraft.role === "regional_manager" ? "大区经理不绑定单一营业厅" : "请选择营业厅"}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}{store.active ? "" : "（已停用）"}</option>)}</select></label>
            {editDraft.role === "regional_manager" ? <ManagedStoreChecklist selectedIds={editDraft.managedStoreIds} stores={activeStores} onChange={(managedStoreIds) => setEditDraft({ ...editDraft, managedStoreIds })} /> : null}
            <label className="management-wide">编辑账号原因（至少 2 个字符）<input required minLength={2} value={editDraft.reason} onChange={(event) => setEditDraft({ ...editDraft, reason: event.currentTarget.value })} /></label>
            <div className="management-form-actions"><button type="button" onClick={() => setEditDraft(null)}>取消</button><button type="submit" className="management-primary" disabled={busy}>保存账号修改</button></div>
          </fieldset></form>
        </section>
      ) : null}

      {resetDraft ? (
        <section ref={actionPanelRef} className="management-action-panel" aria-labelledby="reset-password-title">
          <h2 id="reset-password-title">{resetDraft.userId === currentUserId ? "修改本人密码" : `重置${resetDraft.displayName}的临时密码`}</h2><p>{resetDraft.userId === currentUserId ? "保存后当前会话会立即失效，请使用新密码重新登录；无需再次修改。" : "请将临时密码通过电话、当面或内部通讯单独告知本人。该账号所有会话会立即失效，登录后须设置只有本人知道的新密码。"}</p>
          <form onSubmit={(event) => void resetPassword(event)}><label>{resetDraft.userId === currentUserId ? "新密码" : "新临时密码"}（8 至 128 位）<input aria-label={resetDraft.userId === currentUserId ? "新密码（8 至 128 位）" : "新临时密码（8 至 128 位）"} type="password" required minLength={8} maxLength={128} value={resetDraft.initialPassword} onChange={(event) => setResetDraft({ ...resetDraft, initialPassword: event.currentTarget.value })} /></label><label>重置密码原因（至少 2 个字符）<input required minLength={2} value={resetDraft.reason} onChange={(event) => setResetDraft({ ...resetDraft, reason: event.currentTarget.value })} /></label><div className="management-form-actions"><button type="button" onClick={() => setResetDraft(null)}>取消</button><button type="submit" className="management-primary" disabled={busy}>确认{resetDraft.userId === currentUserId ? "修改" : "重置"}密码</button></div></form>
        </section>
      ) : null}
    </section>
  );
};
