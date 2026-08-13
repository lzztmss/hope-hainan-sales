import { createHash, randomBytes } from "node:crypto";

import { hash, verify, type Options as Argon2Options } from "@node-rs/argon2";

import type { AuthenticatedUser, UserRole } from "./authorization.js";

export const AUTHENTICATION_FAILED_MESSAGE = "账号或密码错误";
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AuthUserRecord {
  id: string;
  workNo: string;
  phoneLookupHash: string | null;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  storeId: string | null;
  storeName: string | null;
  active: boolean;
  mustChangePassword: boolean;
}

export interface StoredSession {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  sourceIp?: string;
  userAgent?: string;
}

export interface AuthRepository {
  findUserByIdentifier(identifier: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  createSession(session: StoredSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  touchSuccessfulLogin(userId: string, at: Date): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
}

export interface LoginContext {
  ip?: string;
  userAgent?: string;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: AuthenticatedUser;
}

export interface AuthServiceOptions {
  repository: AuthRepository;
  phoneLookupHash(phone: string): string;
  now?: () => Date;
  sessionTtlMs?: number;
  passwordHashOptions?: Argon2Options;
}

const toAuthenticatedUser = (user: AuthUserRecord): AuthenticatedUser => ({
  id: user.id,
  displayName: user.displayName,
  role: user.role,
  storeId: user.storeId,
  storeName: user.storeName,
  mustChangePassword: user.mustChangePassword,
});

const normalizeIdentifier = (
  identifier: string,
  phoneLookupHash: (phone: string) => string,
): string => {
  const trimmed = identifier.trim();
  if (/^(?:\+?86)?1[3-9]\d{9}$/.test(trimmed.replace(/[\s-]/g, ""))) {
    return phoneLookupHash(trimmed);
  }
  return trimmed.toUpperCase();
};

export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const createAuthService = (options: AuthServiceOptions) => {
  const now = options.now ?? (() => new Date());
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;

  const resolveSessionRecord = async (
    token: string,
  ): Promise<AuthUserRecord | null> => {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const tokenHash = hashSessionToken(token);
    const session = await options.repository.findSessionByTokenHash(tokenHash);
    if (!session) return null;

    if (session.expiresAt.getTime() <= now().getTime()) {
      await options.repository.deleteSession(tokenHash);
      return null;
    }

    const user = await options.repository.findUserById(session.userId);
    if (!user?.active) {
      await options.repository.deleteSession(tokenHash);
      return null;
    }
    return user;
  };

  return {
    async login(
      identifier: string,
      password: string,
      context: LoginContext,
    ): Promise<LoginResult> {
      const lookupIdentifier = normalizeIdentifier(
        identifier,
        options.phoneLookupHash,
      );
      const user = await options.repository.findUserByIdentifier(lookupIdentifier);

      let passwordMatches = false;
      if (user) {
        try {
          passwordMatches = await verify(user.passwordHash, password);
        } catch {
          passwordMatches = false;
        }
      }

      if (!user || !user.active || !passwordMatches) {
        throw new Error(AUTHENTICATION_FAILED_MESSAGE);
      }

      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + sessionTtlMs);
      const token = randomBytes(32).toString("hex");
      await options.repository.createSession({
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt,
        sourceIp: context.ip,
        userAgent: context.userAgent,
      });
      await options.repository.touchSuccessfulLogin(user.id, issuedAt);

      return { token, expiresAt, user: toAuthenticatedUser(user) };
    },

    async getSessionUser(token: string): Promise<AuthenticatedUser | null> {
      const user = await resolveSessionRecord(token);
      return user ? toAuthenticatedUser(user) : null;
    },

    async logout(token: string): Promise<void> {
      if (/^[a-f0-9]{64}$/.test(token)) {
        await options.repository.deleteSession(hashSessionToken(token));
      }
    },

    async changePassword(
      token: string,
      currentPassword: string | undefined,
      newPassword: string,
    ): Promise<AuthenticatedUser> {
      const user = await resolveSessionRecord(token);
      if (!user) throw new Error("请先登录");
      if (newPassword.length < 8 || newPassword.length > 128) {
        throw new Error("新密码长度必须为8至128位");
      }

      if (!user.mustChangePassword) {
        if (!currentPassword) throw new Error("请输入当前密码");
        let currentMatches = false;
        try {
          currentMatches = await verify(user.passwordHash, currentPassword);
        } catch {
          currentMatches = false;
        }
        if (!currentMatches) throw new Error("当前密码不正确");
      }

      const nextHash = await hash(newPassword, options.passwordHashOptions);
      await options.repository.updatePassword(user.id, nextHash);
      return toAuthenticatedUser({ ...user, mustChangePassword: false });
    },
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
