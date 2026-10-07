import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from "node:crypto";
import { mkdir, readFile, writeFile, link, unlink } from "node:fs/promises";
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
export const ownerPasswordPath = resolve(
  runtimeDirectory,
  "owner-password.txt",
);
let keyPromise: Promise<Buffer> | undefined;
async function atomicCreate(path: string, content: string | Buffer) {
  const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
  try {
    await link(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary);
  }
}
async function masterKey() {
  if (!keyPromise)
    keyPromise = (async () => {
      await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
      try {
        return await readFile(keyPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (await db.appConfiguration.count())
          throw new Error(
            "Missing settings encryption key. Restore data/master.key from backup.",
          );
        await atomicCreate(keyPath, randomBytes(32));
        return readFile(keyPath);
      }
    })();
  const key = await keyPromise;
  if (key.length !== 32) throw new Error("Invalid settings encryption key");
  return key;
}
async function encrypt(secrets: RuntimeSecrets) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await masterKey(), iv);
  cipher.setAAD(Buffer.from("sparecash:configuration:v1"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}
async function decrypt(value: string) {
  const key = await masterKey();
  try {
    const [version, iv, tag, text, extra] = value.split(".");
    if (version !== "v1" || extra || !text) throw new Error();
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
    throw new Error(
      "Unable to decrypt application settings. Restore the matching master.key and database backup.",
    );
  }
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
  let stored = await db.appConfiguration.findUnique({ where: { id: "main" } });
  if (!stored) {
    await masterKey();
    let password: string | undefined;
    if (!legacy.ADMIN_PASSWORD_HASH) {
      await atomicCreate(
        ownerPasswordPath,
        randomBytes(18).toString("base64url") + "\n",
      );
      password = (await readFile(ownerPasswordPath, "utf8")).trim();
    }
    const randomSecret = () => randomBytes(32).toString("hex");
    const values = publicRuntimeSchema.parse({
      ...defaultRuntimeValues,
      ...pick(publicRuntimeSchema.shape, legacy),
    });
    const secrets = secretRuntimeSchema.parse({
      ADMIN_PASSWORD_HASH:
        legacy.ADMIN_PASSWORD_HASH ?? (await bcrypt.hash(password!, 12)),
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
    });
    validate({ ...values, ...secrets });
    stored = await db.appConfiguration.upsert({
      where: { id: "main" },
      create: { id: "main", values, encryptedSecrets: await encrypt(secrets) },
      update: {},
    });
    if (password)
      console.log(`Initial owner password saved to ${ownerPasswordPath}`);
  }
  return refreshRuntimeConfiguration();
}
export async function readRuntimeConfiguration() {
  const stored = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  return validate({
    ...publicRuntimeSchema.parse(stored.values),
    ...(await decrypt(stored.encryptedSecrets)),
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
  return {
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
      ...(await decrypt(stored.encryptedSecrets)),
      ...patch.secrets,
    });
    validate({ ...values, ...secrets });
    await tx.appConfiguration.update({
      where: { id: "main" },
      data: {
        values,
        encryptedSecrets: await encrypt(secrets),
        revision: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: {
        actor,
        action: "configuration.updated",
        details: {
          fields: [...Object.keys(patch.values), ...Object.keys(patch.secrets)],
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
export async function changeOwnerPassword(
  currentPassword: string,
  newPassword: string,
) {
  const hashed = await bcrypt.hash(newPassword, 12);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AppConfiguration" WHERE id='main' FOR UPDATE`;
    const stored = await tx.appConfiguration.findUniqueOrThrow({
      where: { id: "main" },
    });
    const secrets = await decrypt(stored.encryptedSecrets);
    if (!(await bcrypt.compare(currentPassword, secrets.ADMIN_PASSWORD_HASH)))
      throw new Error("Current password is incorrect");
    await tx.appConfiguration.update({
      where: { id: "main" },
      data: {
        encryptedSecrets: await encrypt({
          ...secrets,
          ADMIN_PASSWORD_HASH: hashed,
        }),
        revision: { increment: 1 },
      },
    });
    await tx.adminSession.deleteMany();
    await tx.auditLog.create({
      data: { actor: "owner", action: "owner.password_changed" },
    });
  });
  await unlink(ownerPasswordPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await refreshRuntimeConfiguration();
}
