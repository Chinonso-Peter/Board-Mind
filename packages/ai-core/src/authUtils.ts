import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const DEFAULT_JWT_SECRET = process.env.WS_JWT_SECRET || "boardmind-default-jwt-secret-key-32chars";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface WsTokenPayload {
  userId: string;
  boardId: string;
  role: "owner" | "editor" | "viewer";
}

export function generateWsToken(
  payload: WsTokenPayload,
  secret = DEFAULT_JWT_SECRET,
  expiresIn = "2h"
): string {
  return jwt.sign(payload, secret, { expiresIn: expiresIn as any });
}

export function verifyWsToken(
  token: string,
  secret = DEFAULT_JWT_SECRET
): WsTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as WsTokenPayload;
    return decoded;
  } catch {
    return null;
  }
}
