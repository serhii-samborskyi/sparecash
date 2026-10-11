import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../config.js";
import { hash } from "../security.js";

export const VERIFICATION_LIFETIME_MS = 30 * 60_000;

export function hasVisitorProof(visit: {
  verificationState: string;
  verificationExpiresAt: Date | null;
}) {
  return (
    visit.verificationState === "VERIFIED" &&
    !!visit.verificationExpiresAt &&
    visit.verificationExpiresAt > new Date()
  );
}

// Never accept the browser's success flag, or a proof from a different visit.
// Only the digest is retained. Cloudflare tokens themselves are single-use.
export async function verifyVisitor(
  visitId: string,
  response: string,
  remoteip?: string,
) {
  const digest = hash(response);
  let attempt;
  try {
    attempt = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Visit" WHERE id=${visitId} FOR UPDATE`;
      const attempt = await tx.visitorVerification.create({
        data: { visitId, tokenHash: digest, errors: [] },
      });
      await tx.visit.update({
        where: { id: visitId },
        data: {
          verificationAttemptId: attempt.id,
          verificationState: "PENDING",
          challenged: true,
          verified: false,
          verificationExpiresAt: null,
        },
      });
      return attempt;
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    )
      throw error;
    const existing = await db.visitorVerification.findUniqueOrThrow({
      where: { tokenHash: digest },
    });
    const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
    return {
      verified:
        existing.visitId === visitId &&
        existing.state === "VERIFIED" &&
        hasVisitorProof(visit),
      state: existing.visitId === visitId ? existing.state : "FAILED",
      expiresAt: visit.verificationExpiresAt,
    };
  }
  let state = "ERROR",
    errors: string[] = [];
  try {
    if (!env.TURNSTILE_SECRET_KEY) throw new Error("not-configured");
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response,
          remoteip,
          idempotency_key: attempt.id,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error("provider-unavailable");
    const result = (await res.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
      cdata?: string;
      "error-codes"?: string[];
    };
    const matches =
      result.hostname === new URL(env.APP_URL).hostname &&
      result.action === "visit" &&
      result.cdata === visitId;
    state = result.success === true && matches ? "VERIFIED" : "FAILED";
    errors =
      result.success && !matches
        ? ["binding-mismatch"]
        : (result["error-codes"] ?? []).slice(0, 10);
    if (
      errors.some((code) =>
        [
          "internal-error",
          "invalid-input-secret",
          "missing-input-secret",
          "bad-request",
        ].includes(code),
      )
    )
      state = "ERROR";
  } catch {
    errors = ["verification-unavailable"];
  }
  const expiresAt =
    state === "VERIFIED"
      ? new Date(Date.now() + VERIFICATION_LIFETIME_MS)
      : null;
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Visit" WHERE id=${visitId} FOR UPDATE`;
    await tx.visitorVerification.update({
      where: { id: attempt.id },
      data: { state, errors },
    });
    const current = await tx.visit.findUniqueOrThrow({
      where: { id: visitId },
    });
    const latest = current.verificationAttemptId === attempt.id;
    if (latest)
      await tx.visit.update({
        where: { id: visitId },
        data: {
          challenged: true,
          verified: state === "VERIFIED",
          verificationState: state,
          verificationExpiresAt: expiresAt,
          ...(state === "VERIFIED" ? { verifiedAt: new Date() } : {}),
        },
      });
    if (latest && state === "VERIFIED")
      await tx.visitEvent.updateMany({
        where: { visitId, verifiedAt: null },
        data: { verifiedAt: new Date() },
      });
  });
  const visit = await db.visit.findUniqueOrThrow({ where: { id: visitId } });
  return {
    verified: hasVisitorProof(visit),
    state: visit.verificationState,
    expiresAt: visit.verificationExpiresAt,
  };
}
