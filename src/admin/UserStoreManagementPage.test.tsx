import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserStoreManagementPage, type ManagedStoreView } from "./UserStoreManagementPage";

afterEach(cleanup);

const store: ManagedStoreView = {
  id: "00000000-0000-4000-8000-000000000001",
  code: "TEST001",
  name: "测试营业厅",
  active: true,
  activeUserCount: 0,
  managerUserId: null,
  managerName: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("营业厅与账号管理表单", () => {
  it("新增账号原因少于两个字符时给出明确提示", async () => {
    const user = userEvent.setup();
    const onCreateUser = vi.fn();
    render(
      <UserStoreManagementPage
        stores={[store]}
        users={[]}
        onCreateUser={onCreateUser}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新增账号" }));
    await user.type(screen.getByLabelText("工号"), "LZ");
    await user.type(screen.getByLabelText("姓名"), "lz");
    await user.selectOptions(screen.getByLabelText("所属营业厅"), store.id);
    await user.type(screen.getByLabelText("初始密码"), "Hainan@2026Test");
    await user.type(
      screen.getByLabelText("新增账号原因（至少 2 个字符）"),
      "1",
    );
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "新增账号原因至少填写 2 个字符",
    );
    expect(onCreateUser).not.toHaveBeenCalled();
  });

  it("指定营业厅主经理时明确提示原因最小长度", async () => {
    const user = userEvent.setup();
    const onUpdateStore = vi.fn();
    render(
      <UserStoreManagementPage
        stores={[store]}
        users={[]}
        onUpdateStore={onUpdateStore}
      />,
    );

    const managerButton = screen
      .getAllByRole("button", { name: "指定经理" })
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(managerButton).toBeDefined();
    await user.click(managerButton!);
    await user.type(
      screen.getByLabelText("变更原因（至少 2 个字符）"),
      "1",
    );
    await user.click(screen.getByRole("button", { name: "确认指定" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "指定营业厅经理的原因至少填写 2 个字符",
    );
    expect(onUpdateStore).not.toHaveBeenCalled();
  });
});
