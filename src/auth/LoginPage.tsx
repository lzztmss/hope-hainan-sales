import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "./AuthProvider";
import "./auth.css";

type LoginLocationState = {
  from?: unknown;
  notice?: unknown;
};

const safeDestination = (state: unknown): string => {
  const from = (state as LoginLocationState | null)?.from;
  return typeof from === "string" && from.startsWith("/") ? from : "/";
};

export const LoginPage = () => {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const notice = (location.state as LoginLocationState | null)?.notice;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setError("请输入工号/手机号和密码");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await auth.login({ identifier: identifier.trim(), password });
      navigate(safeDestination(location.state), { replace: true });
    } catch (loginError) {
      setPassword("");
      const message = loginError instanceof Error
        ? loginError.message
        : "登录失败，请稍后重试";
      setError(
        message === "账号或密码错误"
          ? "账号或密码错误；如密码近期被管理员重置，请联系管理员获取临时密码。"
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-card__brand">
          <img src="/haipo-logo.jpg" alt="海魄科技" />
          <div>
            <p>海南联通 · 海魄科技</p>
            <h1 id="login-title">
              海南联通 FTTR 心连心融合套餐销售报价系统
            </h1>
          </div>
        </div>
        <p className="auth-card__introduction">
          使用工号或手机号登录。管理员重置密码后，请使用管理员单独提供的临时密码；登录成功后系统会引导你设置个人密码。
        </p>

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="login-identifier">工号或手机号</label>
          <input
            id="login-identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            disabled={submitting}
            onChange={(event) => setIdentifier(event.currentTarget.value)}
          />

          <label htmlFor="login-password">密码</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={submitting}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />

          {typeof notice === "string" ? <p role="status">{notice}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={submitting}>
            {submitting ? "正在登录…" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
};
