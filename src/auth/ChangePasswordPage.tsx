import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider";
import "./auth.css";

export const ChangePasswordPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const requiresTemporaryChange = Boolean(auth.user?.mustChangePassword);
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
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError("新密码长度必须为8至128位");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await auth.changePassword({
        ...(requiresTemporaryChange ? {} : { currentPassword }),
        newPassword,
      });
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
            <p>{requiresTemporaryChange ? "临时密码安全验证" : "账号安全"}</p>
            <h1 id="change-password-title">{requiresTemporaryChange ? "设置个人密码" : "修改密码"}</h1>
          </div>
        </div>
        <p className="auth-card__introduction">
          {requiresTemporaryChange
            ? "你正在使用管理员设置的临时密码。请设置 8 至 128 位、只有你本人知道的新密码。"
            : "请输入当前密码，并设置 8 至 128 位的新密码。"}
        </p>

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {!requiresTemporaryChange ? (
            <>
              <label htmlFor="current-password">当前密码</label>
              <input
                id="current-password"
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete="current-password"
                value={currentPassword}
                disabled={submitting}
                onChange={(event) => setCurrentPassword(event.currentTarget.value)}
              />
            </>
          ) : null}

          <label htmlFor="new-password">新密码</label>
          <input
            id="new-password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={newPassword}
            disabled={submitting}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />

          <label htmlFor="confirm-password">确认新密码</label>
          <input
            id="confirm-password"
            type="password"
            minLength={8}
            maxLength={128}
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
