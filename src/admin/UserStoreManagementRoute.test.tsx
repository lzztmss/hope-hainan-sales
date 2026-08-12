import { render, screen, waitFor } from "@testing-library/react";
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
});
