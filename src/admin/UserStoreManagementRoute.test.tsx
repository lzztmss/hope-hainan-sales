import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  UserStoreManagementRoute,
} from "./UserStoreManagementRoute";
import type { UserStoreManagementApi } from "./UserStoreManagementPage";

const api = (): UserStoreManagementApi => ({
  listStores: vi.fn().mockResolvedValue([]),
  listUsers: vi.fn().mockResolvedValue([]),
  createStore: vi.fn(),
  updateStore: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetPassword: vi.fn(),
});

describe("营业厅与账号路由", () => {
  it("父级重新渲染时不会重复加载数据", async () => {
    const managementApi = api();
    const view = render(<UserStoreManagementRoute api={managementApi} />);

    await screen.findByRole("heading", { name: "营业厅与账号管理" });
    view.rerender(<UserStoreManagementRoute api={managementApi} />);
    await waitFor(() => {
      expect(managementApi.listStores).toHaveBeenCalledTimes(1);
      expect(managementApi.listUsers).toHaveBeenCalledTimes(1);
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
    vi.mocked(managementApi.listUsers).mockResolvedValue([administrator]);
    vi.mocked(managementApi.resetPassword).mockResolvedValue({
      ...administrator,
      mustChangePassword: true,
    });
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
    await user.type(screen.getByLabelText("新初始密码（8 至 128 位）"), "NewPass88");
    await user.type(screen.getByLabelText("重置密码原因（至少 2 个字符）"), "本人改密");
    await user.click(screen.getByRole("button", { name: "确认重置密码" }));

    await waitFor(() => expect(onCurrentUserPasswordReset).toHaveBeenCalledOnce());
    expect(managementApi.listStores).toHaveBeenCalledTimes(1);
    expect(managementApi.listUsers).toHaveBeenCalledTimes(1);
  });
});
