import { randomBytes, createDecipheriv, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { db } from "./db.js";
import { env, useRuntimeConfiguration, runtimeContext } from "./config.js";
import {
  publicRuntimeSchema,
  secretRuntimeSchema,
  runtimePatchSchema,
  defaultRuntimeValues,
  type RuntimeConfiguration,
  type RuntimeSecrets,
} from "./runtime-schema.js";
export const runtimeDirectory = resolve(
  env.NODE_ENV === "production"
    ? "data"
    : env.NODE_ENV === "test"
      ? ".local/runtime-test"
      : ".local/runtime",
);
const keyPath = resolve(runtimeDirectory, "master.key");
// Read an old key only during the one-time upgrade. New installations never create one.
async function readLegacySecrets(
  value: string,
): Promise<RuntimeSecrets | null> {
  let key: Buffer;
  try {
    key = await readFile(keyPath);
  } catch (error) {
    if (
      ["ENOENT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      return null;
    throw error;
  }
  try {
    const [version, iv, tag, text, extra] = value.split(".");
    if (version !== "v1" || extra || !text) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from("sparecash:configuration:v1"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return secretRuntimeSchema.parse(
      JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(text, "base64")),
          decipher.final(),
        ]).toString("utf8"),
      ),
    );
  } catch {
    return null;
  }
}
function newSecrets(
  ownerHash: string,
  legacy: Record<string, unknown>,
): RuntimeSecrets {
  const randomSecret = () => randomBytes(32).toString("hex");
  return secretRuntimeSchema.parse({
    TOKEN_SECRET: randomSecret(),
    MCP_TOKEN: randomSecret(),
    WEBHOOK_TOKEN: randomSecret(),
    ROUNDSKY_WEBHOOK_TOKEN:
      typeof legacy.WEBHOOK_TOKEN === "string" && legacy.WEBHOOK_TOKEN
        ? createHmac("sha256", legacy.WEBHOOK_TOKEN)
            .update("sparecash:roundsky:sold")
            .digest("hex")
        : randomSecret(),
    ...pick(secretRuntimeSchema.shape, legacy),
    // The hosting password always wins over legacy environment/database hashes.
    ADMIN_PASSWORD_HASH: ownerHash,
  });
}
function validate(value: RuntimeConfiguration) {
  const url = new URL(value.APP_URL);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        env.NODE_ENV !== "production" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Application URL must use HTTPS (localhost HTTP is allowed for development)",
    );
  for (const key of ["BLUEBUBBLES_URL", "PROPELLER_API_URL"] as const)
    if (value[key] && new URL(value[key]).protocol !== "https:")
      throw new Error(`${key} must use HTTPS`);
  if (
    env.NODE_ENV === "production" &&
    /^1x000/.test(value.TURNSTILE_SECRET_KEY)
  )
    throw new Error("Turnstile test keys cannot be used in production");
  return value;
}
function pick(shape: Record<string, unknown>, input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.keys(shape)
      .filter((key) => input[key] !== undefined && input[key] !== "")
      .map((key) => [key, input[key]]),
  );
}
export async function initializeRuntimeConfiguration(
  legacy: Record<string, unknown> = process.env,
) {
  await db.$transaction(
    async (tx) => {
      // Also serializes first boot when web and worker start together.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1629071201)`;
      await tx.$queryRaw`SELECT id FROM "AppConfiguration" WHERE id='main' FOR UPDATE`;
      const stored = await tx.appConfiguration.findUnique({
        where: { id: "main" },
      });
      let secrets =
        stored?.secrets != null
          ? secretRuntimeSchema.parse(stored.secrets)
          : stored?.encryptedSecrets
            ? await readLegacySecrets(stored.encryptedSecrets)
            : null;
      const needsRecovery = Boolean(stored && !secrets);
      const passwordChanged =
        !secrets ||
        !(await bcrypt.compare(
          env.OWNER_PASSWORD,
          secrets.ADMIN_PASSWORD_HASH,
        ));
      const ownerHash = passwordChanged
        ? await bcrypt.hash(env.OWNER_PASSWORD, 12)
        : secrets!.ADMIN_PASSWORD_HASH;
      secrets = secrets
        ? { ...secrets, ADMIN_PASSWORD_HASH: ownerHash }
        : newSecrets(ownerHash, legacy);
      const values = publicRuntimeSchema.parse(
        stored?.values ?? {
          ...defaultRuntimeValues,
          ...pick(publicRuntimeSchema.shape, legacy),
        },
      );
      if (needsRecovery) {
        values.LIVE_DELIVERY = "false";
        values.LIVE_SOURCE_BLOCKING = "false";
      }
      validate({ ...values, ...secrets });
      if (!stored) {
        await tx.appConfiguration.create({
          data: { id: "main", values, secrets },
        });
      } else if (stored.secrets == null || passwordChanged) {
        await tx.appConfiguration.update({
          where: { id: "main" },
          data: {
            values,
            secrets,
            credentialsNeedReview:
              stored.credentialsNeedReview || needsRecovery,
            revision: { increment: 1 },
          },
        });
        if (passwordChanged) await tx.adminSession.deleteMany();
        await tx.auditLog.create({
          data: {
            actor: "system",
            action: needsRecovery
              ? "configuration.credentials_reset"
              : stored.secrets == null
                ? "configuration.storage_migrated"
                : "owner.password_changed",
            details: { passwordSource: "environment" },
          },
        });
      }
    },
    { maxWait: 30000, timeout: 30000 },
  );
  const stored = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  if (stored.credentialsNeedReview)
    console.warn(
      "Previous credentials could not be read. Sign in with OWNER_PASSWORD, reconnect providers in Settings, and copy updated webhook/MCP URLs. Live sending and source exclusions were disabled during recovery. CRM data is preserved.",
    );
  return refreshRuntimeConfiguration();
}
export async function readRuntimeConfiguration() {
  const stored = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  return validate({
    ...publicRuntimeSchema.parse(stored.values),
    ...secretRuntimeSchema.parse(stored.secrets),
  });
}
export async function refreshRuntimeConfiguration() {
  const value = await readRuntimeConfiguration();
  useRuntimeConfiguration(value);
  return value;
}
export async function withRuntimeConfiguration<T>(run: () => Promise<T>) {
  return runtimeContext.run(await refreshRuntimeConfiguration(), run);
}
export async function runtimeSettingsView() {
  const config = await readRuntimeConfiguration();
  const values = Object.fromEntries(
    Object.keys(publicRuntimeSchema.shape).map((key) => [
      key,
      config[key as keyof RuntimeConfiguration],
    ]),
  );
  const stored = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  return {
    credentialsNeedReview: stored.credentialsNeedReview,
    values: publicRuntimeSchema.parse(values),
    secrets: Object.fromEntries(
      Object.keys(secretRuntimeSchema.shape)
        .filter((key) => key !== "ADMIN_PASSWORD_HASH")
        .map((key) => [
          key,
          Boolean(config[key as keyof RuntimeConfiguration]),
        ]),
    ),
  };
}
export async function saveRuntimeSettings(input: unknown, actor: string) {
  const patch = runtimePatchSchema.parse(input);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AppConfiguration" WHERE id='main' FOR UPDATE`;
    const stored = await tx.appConfiguration.findUniqueOrThrow({
      where: { id: "main" },
    });
    const values = publicRuntimeSchema.parse({
      ...(stored.values as object),
      ...patch.values,
    });
    const secrets = secretRuntimeSchema.parse({
      ...secretRuntimeSchema.parse(stored.secrets),
      ...patch.secrets,
    });
    validate({ ...values, ...secrets });
    await tx.appConfiguration.update({
      where: { id: "main" },
      data: {
        values,
        secrets,
        ...(patch.credentialsReviewed ? { credentialsNeedReview: false } : {}),
        revision: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        actor,
        action: "configuration.updated",
        details: {
          fields: [
            ...Object.keys(patch.values),
            ...Object.keys(patch.secrets),
            ...(patch.credentialsReviewed ? ["credentialsReviewed"] : []),
          ],
        },
      },
    });
  });
  await refreshRuntimeConfiguration();
  return runtimeSettingsView();
}
export async function revealRuntimeSecret(name: string) {
  if (
    !Object.hasOwn(secretRuntimeSchema.shape, name) ||
    name === "ADMIN_PASSWORD_HASH"
  )
    throw new Error("Unknown credential");
  const config = await readRuntimeConfiguration();
  await db.auditLog.create({
    data: {
      actor: "owner",
      action: "configuration.secret_viewed",
      details: { field: name },
    },
  });
  return config[name as keyof RuntimeSecrets];
}
