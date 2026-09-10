import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ChangePasswordPage } from "./ChangePasswordPage";

const changePassword = vi.fn().mockResolvedValue(undefined);

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ changePassword, user: { mustChangePassword: true } }),
}));

describe("临时密码首次改密", () => {
  it("只要求输入两次新密码，不重复询问临时密码", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ChangePasswordPage /></MemoryRouter>);

    expect(screen.queryByLabelText("当前密码")).not.toBeInTheDocument();
    expect(screen.getByText(/管理员设置的临时密码/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("新密码"), "MySecret88");
    await user.type(screen.getByLabelText("确认新密码"), "MySecret88");
    await user.click(screen.getByRole("button", { name: "修改密码并继续" }));

    expect(changePassword).toHaveBeenCalledWith({ newPassword: "MySecret88" });
  });
});
