import { eq, or } from "drizzle-orm";

import type { AppDatabase } from "../db/client.js";
import { sessions, stores, users } from "../db/schema.js";
import type {
  AuthRepository,
  AuthUserRecord,
  StoredSession,
} from "./authService.js";

const userSelection = {
  id: users.id,
  workNo: users.workNo,
  phoneLookupHash: users.phoneLookupHash,
  displayName: users.displayName,
  passwordHash: users.passwordHash,
  role: users.role,
  storeId: users.storeId,
  storeName: stores.name,
  active: users.active,
  mustChangePassword: users.mustChangePassword,
};

export class DrizzleAuthRepository implements AuthRepository {
  constructor(private readonly db: AppDatabase) {}

  async findUserByIdentifier(identifier: string): Promise<AuthUserRecord | null> {
    const [row] = await this.db
      .select(userSelection)
      .from(users)
      .leftJoin(stores, eq(stores.id, users.storeId))
      .where(
        or(
          eq(users.workNo, identifier),
          eq(users.phoneLookupHash, identifier),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findUserById(id: string): Promise<AuthUserRecord | null> {
    const [row] = await this.db
      .select(userSelection)
      .from(users)
      .leftJoin(stores, eq(stores.id, users.storeId))
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.db.insert(sessions).values({
      tokenHash: session.tokenHash,
      userId: session.userId,
      expiresAt: session.expiresAt,
    });
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const [row] = await this.db
      .select({
        tokenHash: sessions.tokenHash,
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async touchSuccessfulLogin(userId: string, at: Date): Promise<void> {
    await this.db
      .update(users)
      .set({ lastLoginAt: at, updatedAt: at })
      .where(eq(users.id, userId));
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }
}
