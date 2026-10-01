import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyRequest } from "fastify";
import { Database } from "./database";
import { ApiError, objectBody, textField } from "./errors";

export interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  password_hash: string;
  role: "player" | "moderator" | "admin";
  status: string;
  publishing_disabled: number;
  interests: string;
  created_at: string;
}
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export class AuthService {
  constructor(
    private db: Database,
    private now: () => Date,
  ) {}
  async register(input: unknown): Promise<UserRow> {
    const body = objectBody(input);
    const handle = textField(body.handle, "Handle", 3, 24).toLowerCase();
    if (!/^[a-z][a-z0-9_]+$/.test(handle))
      throw new ApiError(
        400,
        "invalid_handle",
        "Use a letter followed by letters, numbers, or underscores.",
      );
    const displayName = textField(
      body.displayName ?? handle,
      "Display name",
      2,
      40,
    );
    const password = this.password(body.password);
    if (this.db.get("SELECT id FROM users WHERE handle=?", handle))
      throw new ApiError(409, "handle_taken", "That handle is already in use.");
    const salt = randomBytes(16).toString("hex");
    const key = await derive(password, salt);
    const user: UserRow = {
      id: randomUUID(),
      handle,
      display_name: displayName,
      password_hash: `scrypt:${salt}:${key.toString("hex")}`,
      role: "player",
      status: "active",
      publishing_disabled: 0,
      interests: "[]",
      created_at: this.now().toISOString(),
    };
    try {
      this.db.run(
        "INSERT INTO users(id,handle,display_name,password_hash,created_at) VALUES(?,?,?,?,?)",
        user.id,
        handle,
        displayName,
        user.password_hash,
        user.created_at,
      );
    } catch (error) {
      if (this.db.get("SELECT id FROM users WHERE handle=?", handle))
        throw new ApiError(
          409,
          "handle_taken",
          "That handle is already in use.",
        );
      throw error;
    }
    return user;
  }
  async login(input: unknown): Promise<UserRow> {
    const body = objectBody(input);
    const handle = textField(body.handle, "Handle", 3, 24).toLowerCase();
    const password = this.password(body.password);
    const user = this.db.get<UserRow>(
      "SELECT * FROM users WHERE handle=?",
      handle,
    );
    const [, salt, expected] = user?.password_hash.split(":") ?? [
      "scrypt",
      "0123456789abcdef0123456789abcdef",
      "0".repeat(128),
    ];
    const key = await derive(password, salt);
    if (!user || !timingSafeEqual(key, Buffer.from(expected, "hex")))
      throw new ApiError(
        401,
        "invalid_credentials",
        "The handle or password is incorrect.",
      );
    if (user.status !== "active")
      throw new ApiError(
        403,
        "account_suspended",
        "This account is suspended.",
      );
    return user;
  }
  private password(value: unknown): string {
    if (typeof value !== "string" || value.length < 10 || value.length > 128)
      throw new ApiError(
        400,
        "invalid_password",
        "Use a password with 10–128 characters.",
      );
    return value;
  }
  session(userId: string): { token: string; expiresAt: Date } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + 30 * 86400000);
    this.db.run(
      "DELETE FROM sessions WHERE expires_at < ?",
      this.now().toISOString(),
    );
    this.db.run(
      "INSERT INTO sessions VALUES(?,?,?)",
      hashToken(token),
      userId,
      expiresAt.toISOString(),
    );
    return { token, expiresAt };
  }
  user(request: FastifyRequest, required = true): UserRow | null {
    const token = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : request.cookies.da_session;
    const user =
      token &&
      this.db.get<UserRow>(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
        hashToken(token),
        this.now().toISOString(),
      );
    if (!user) {
      if (required)
        throw new ApiError(
          401,
          "authentication_required",
          "Sign in to continue.",
        );
      return null;
    }
    if (user.status !== "active")
      throw new ApiError(
        403,
        "account_suspended",
        "This account is suspended.",
      );
    return user;
  }
  logout(request: FastifyRequest): void {
    const token = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : request.cookies.da_session;
    if (token)
      this.db.run("DELETE FROM sessions WHERE token_hash=?", hashToken(token));
  }
}
