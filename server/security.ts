import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { db } from "./db.js";
import { env } from "./config.js";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const ipHash = (v: string) =>
  createHmac("sha256", env.TOKEN_SECRET).update(v).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export function equal(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export function token(kind: string, id: string, seconds = 86400 * 30) {
  const text = `${kind}:${id}:${Math.floor(Date.now() / 1000) + seconds}`;
  return (
    Buffer.from(text).toString("base64url") +
    "." +
    createHmac("sha256", env.TOKEN_SECRET).update(text).digest("base64url")
  );
}
export function verifyToken(value: string, kind: string): string | null {
  try {
    const [raw, mac] = value.split(".");
    const text = Buffer.from(raw, "base64url").toString();
    const [k, id, expires] = text.split(":");
    if (
      k !== kind ||
      Number(expires) < Date.now() / 1000 ||
      !Number.isFinite(Number(expires))
    )
      return null;
    return equal(
      mac || "",
      createHmac("sha256", env.TOKEN_SECRET).update(text).digest("base64url"),
    )
      ? id
      : null;
  } catch {
    return null;
  }
}
export async function login(password: string, res: Response) {
  if (Buffer.byteLength(password, "utf8") > 72) return false;
  if (!(await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH))) return false;
  const key = randomToken();
  await db.adminSession.create({
    data: { id: hash(key), expiresAt: new Date(Date.now() + 43200000) },
  });
  res.cookie("sc_session", key, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 43200000,
    path: "/",
  });
  return true;
}
function allowedOrigin(origin: string | undefined) {
  return (
    origin === new URL(env.APP_URL).origin ||
    (env.NODE_ENV === "development" &&
      ["http://localhost:3000", "http://127.0.0.1:3000"].includes(origin ?? ""))
  );
}
export function checkOrigin(req: Request, res: Response, next: NextFunction) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !allowedOrigin(req.headers.origin)
  ) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  next();
}
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const session = req.cookies.sc_session;
  if (typeof session !== "string") {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  const stored = await db.adminSession.findUnique({
    where: { id: hash(session) },
  });
  if (!stored || stored.expiresAt < new Date()) {
    res.status(401).json({ error: "Session expired" });
    return;
  }
  res.locals.actor = "owner";
  next();
}
export function requireMcp(req: Request, res: Response, next: NextFunction) {
  if (!equal(req.headers.authorization || "", `Bearer ${env.MCP_TOKEN}`)) {
    res.status(401).json({ error: "Valid MCP bearer token required" });
    return;
  }
  if (req.headers.origin && !allowedOrigin(req.headers.origin)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  res.locals.actor = "mcp";
  next();
}
export function requireWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const supplied = req.headers["x-webhook-token"] ?? req.query.token;
  if (typeof supplied !== "string" || !equal(supplied, env.WEBHOOK_TOKEN)) {
    res.status(401).json({ error: "Invalid webhook authentication" });
    return;
  }
  next();
}
