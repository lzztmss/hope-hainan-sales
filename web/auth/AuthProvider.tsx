import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  type ApiClient,
  type AuthenticatedUser,
  type ChangePasswordInput,
  type LoginInput,
} from "../api/client";

export type AuthStatus =
  | "loading"
  | "anonymous"
  | "authenticated"
  | "error";

export interface AuthContextValue {
  changePassword(input: ChangePasswordInput): Promise<void>;
  error: string | null;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  status: AuthStatus;
  user: AuthenticatedUser | null;
}

export type AuthClient = Pick<
  ApiClient,
  "changePassword" | "getCurrentUser" | "login" | "logout"
>;

type AuthProviderProps = {
  children: ReactNode;
  client: AuthClient;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "请求失败，请稍后重试";

export const AuthProvider = ({ children, client }: AuthProviderProps) => {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setStatus("loading");
    setError(null);

    try {
      const nextUser = await client.getCurrentUser();
      if (requestVersion.current !== version) return;
      setUser(nextUser);
      setStatus("authenticated");
    } catch (requestError) {
      if (requestVersion.current !== version) return;
      setUser(null);
      if (requestError instanceof ApiError && requestError.status === 401) {
        setStatus("anonymous");
      } else {
        setError(messageFor(requestError));
        setStatus("error");
      }
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (input: LoginInput) => {
      const version = ++requestVersion.current;
      setError(null);
      const nextUser = await client.login(input);
      if (requestVersion.current !== version) return;
      setUser(nextUser);
      setStatus("authenticated");
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    requestVersion.current += 1;
    setUser(null);
    setError(null);
    setStatus("anonymous");
  }, [client]);

  const changePassword = useCallback(
    async (input: ChangePasswordInput) => {
      const nextUser = await client.changePassword(input);
      requestVersion.current += 1;
      setUser(nextUser);
      setError(null);
      setStatus("authenticated");
    },
    [client],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      changePassword,
      error,
      login,
      logout,
      refresh,
      status,
      user,
    }),
    [changePassword, error, login, logout, refresh, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return context;
};
