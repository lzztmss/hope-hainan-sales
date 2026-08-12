import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider";
import "./auth.css";

export const ChangePasswordPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致");
      return;
    }
    if (newPassword.length < 12) {
      setError("新密码长度必须为12至128位");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await auth.changePassword({ currentPassword, newPassword });
      navigate("/", { replace: true });
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "密码修改失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="change-password-title">
        <div className="auth-card__brand">
          <img src="/haipo-logo.jpg" alt="海魄科技" />
          <div>
            <p>首次登录安全验证</p>
            <h1 id="change-password-title">修改初始密码</h1>
          </div>
        </div>
        <p className="auth-card__introduction">
          为保护客户与订单数据，请先设置 12 至 128 位的新密码。
        </p>

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="current-password">当前密码</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            disabled={submitting}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
          />

          <label htmlFor="new-password">新密码</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            disabled={submitting}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />

          <label htmlFor="confirm-password">确认新密码</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            disabled={submitting}
            onChange={(event) => setConfirmation(event.currentTarget.value)}
          />

          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={submitting}>
            {submitting ? "正在修改…" : "修改密码并继续"}
          </button>
        </form>
      </section>
    </main>
  );
};
