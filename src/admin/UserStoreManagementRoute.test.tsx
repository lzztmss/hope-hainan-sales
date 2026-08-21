import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  UserStoreManagementRoute,
} from "./UserStoreManagementRoute";
import {
  createUserStoreManagementApi,
  type UserStoreManagementApi,
} from "./UserStoreManagementPage";

const api = (): UserStoreManagementApi => ({
  listStores: vi.fn().mockResolvedValue([]),
  listUsers: vi.fn().mockResolvedValue({ users: [], total: 0, activeTotal: 0, mustChangePasswordTotal: 0, page: 1, pageSize: 20 }),
  createStore: vi.fn(),
  updateStore: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetPassword: vi.fn(),
});

describe("营业厅与账号路由", () => {
  it("子路径部署时账号修改与重置请求使用应用基础路径", async () => {
    const administrator = {
      id: "admin-1",
      workNo: "ADMIN001",
      displayName: "管理员",
      phoneMasked: null,
      role: "admin" as const,
      personnelType: "admin" as const,
      storeId: null,
      storeName: null,
      active: true,
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: administrator }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const managementApi = createUserStoreManagementApi(
      fetcher,
      "/hope/hn-fttr-v3",
    );

    await managementApi.updateUser("user/1", { active: false, reason: "停用测试" });
    await managementApi.resetPassword("user/1", {
      initialPassword: "NewPass88",
      reason: "重置测试",
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/hope/hn-fttr-v3/api/admin/users/user%2F1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/hope/hn-fttr-v3/api/admin/users/user%2F1/reset-password",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("父级重新渲染时不会重复加载数据", async () => {
    const managementApi = api();
    const view = render(<UserStoreManagementRoute api={managementApi} />);

    await screen.findByRole("heading", { name: "营业厅与账号管理" });
    view.rerender(<UserStoreManagementRoute api={managementApi} />);
    await waitFor(() => {
      expect(managementApi.listStores).toHaveBeenCalledTimes(1);
      expect(managementApi.listUsers).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("正在加载营业厅与账号…")).not.toBeInTheDocument();
  });

  it("重置当前管理员密码后不再刷新已失效会话下的列表", async () => {
    const user = userEvent.setup();
    const managementApi = api();
    const administrator = {
      id: "admin-1",
      workNo: "ADMIN001",
      displayName: "管理员",
      phoneMasked: null,
      role: "admin" as const,
      personnelType: "admin" as const,
      storeId: null,
      storeName: null,
      active: true,
      mustChangePassword: false,
      lastLoginAt: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    vi.mocked(managementApi.listUsers).mockResolvedValue({ users: [administrator], total: 1, activeTotal: 1, mustChangePasswordTotal: 0, page: 1, pageSize: 20 });
    vi.mocked(managementApi.resetPassword).mockResolvedValue(administrator);
    const onCurrentUserPasswordReset = vi.fn();

    render(
      <UserStoreManagementRoute
        api={managementApi}
        currentUserId={administrator.id}
        onCurrentUserPasswordReset={onCurrentUserPasswordReset}
      />,
    );

    await screen.findByRole("heading", { name: "营业厅与账号管理" });
    await user.click(screen.getByRole("button", { name: "重置密码" }));
    expect(screen.getByText(/无需再次修改/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("新密码（8 至 128 位）"), "NewPass88");
    await user.type(screen.getByLabelText("重置密码原因（至少 2 个字符）"), "本人改密");
    await user.click(screen.getByRole("button", { name: "确认修改密码" }));

    await waitFor(() => expect(onCurrentUserPasswordReset).toHaveBeenCalledOnce());
    expect(managementApi.listStores).toHaveBeenCalledTimes(1);
    expect(managementApi.listUsers).toHaveBeenCalledTimes(2);
  });
});
