import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { randomBytes, createCipheriv } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import assert from "node:assert/strict";
const root = process.cwd();
const schema = `sparecash_bootstrap_${process.pid}`;
const database = new URL(process.env.DATABASE_URL);
database.searchParams.set("schema", schema);
await mkdir(".local", { recursive: true });
const directory = await mkdtemp(resolve(".local/bootstrap-check-"));
const childEnv = {
  DATABASE_URL: database.toString(),
  OWNER_PASSWORD: randomBytes(24).toString("base64url"),
  NODE_ENV: "production",
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};
const db = new PrismaClient({ datasourceUrl: database.toString() });
let server;
function run(command, args, cwd, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...childEnv, ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`Bootstrap subprocess exited ${code}: ${output}`)),
    );
  });
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}
const seed = () =>
  run(process.execPath, [resolve("dist/server/seed.js")], directory);
const configuration = () =>
  db.appConfiguration.findUniqueOrThrow({ where: { id: "main" } });
const origin = "https://sparecash.leadtechx.com";
function encryptedFixture(secrets, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("sparecash:configuration:v1"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secrets)),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}
try {
  await run("npx", ["prisma", "migrate", "deploy"], root);
  for (const missing of [undefined, "", "😀".repeat(19)]) {
    await assert.rejects(
      run(process.execPath, [resolve("dist/server/seed.js")], directory, {
        OWNER_PASSWORD: missing,
      }),
      /OWNER_PASSWORD/,
    );
  }
  assert.equal(await db.appConfiguration.count(), 0);
  await seed();
  await assert.rejects(access(join(directory, "data")), { code: "ENOENT" });
  const portProbe = createServer();
  await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  async function start() {
    server = spawn(process.execPath, [resolve("dist/server/index.js")], {
      cwd: directory,
      env: { ...childEnv, PORT: String(port) },
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null)
        throw new Error("Production server failed to start");
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Production startup timed out");
  }
  const login = (password) =>
    fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ password }),
    });
  const view = (cookie) =>
    fetch(`${base}/api/admin/configuration`, { headers: { Cookie: cookie } });
  const session = async () => {
    const response = await login(childEnv.OWNER_PASSWORD);
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  await start();
  // Development disables CSP, so check OneSignal's JSONP script in production.
  const health = await fetch(`${base}/health`);
  const csp = health.headers.get("content-security-policy");
  assert.ok(csp, "Production responses must include a Content Security Policy");
  const directives = new Map(
    csp.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  const scriptSources =
    directives.get("script-src-elem") ?? directives.get("script-src");
  for (const source of [
    "'self'",
    "https://challenges.cloudflare.com",
    "https://cdn.onesignal.com",
    "https://api.onesignal.com",
  ]) {
    assert.ok(
      scriptSources?.includes(source),
      `CSP must allow scripts from ${source}`,
    );
  }
  for (const source of ["*", "https:", "'unsafe-inline'", "'unsafe-eval'"]) {
    assert.ok(
      !scriptSources.includes(source),
      `CSP must not allow ${source} scripts`,
    );
  }
  let cookie = await session();
  const first = await (await view(cookie)).json();
  assert.equal(first.values.APP_URL, origin);
  assert.equal(first.values.LIVE_DELIVERY, "false");
  assert.equal(first.values.LIVE_SOURCE_BLOCKING, "false");
  assert.equal(first.secrets.ROUNDSKY_WEBHOOK_TOKEN, true);
  assert.equal(first.credentialsNeedReview, false);
  const before = await configuration();
  assert.equal(before.encryptedSecrets, null);
  assert.ok(before.secrets.ADMIN_PASSWORD_HASH.startsWith("$2"));
  assert.ok(!JSON.stringify(before).includes(childEnv.OWNER_PASSWORD));
  await stop();
  // Emulate replacement of the entire container, including its working directory.
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory);
  await seed();
  await start();
  assert.deepEqual((await configuration()).secrets, before.secrets);
  assert.equal((await view(cookie)).status, 200);
  await assert.rejects(access(join(directory, "data")), { code: "ENOENT" });
  await stop();

  // An environment password change revokes sessions while retaining all provider tokens.
  const oldPassword = childEnv.OWNER_PASSWORD;
  childEnv.OWNER_PASSWORD = randomBytes(24).toString("base64url");
  await seed();
  await start();
  assert.equal((await view(cookie)).status, 401);
  assert.equal((await login(oldPassword)).status, 401);
  cookie = await session();
  const afterRotation = await configuration();
  assert.notEqual(
    afterRotation.secrets.ADMIN_PASSWORD_HASH,
    before.secrets.ADMIN_PASSWORD_HASH,
  );
  assert.deepEqual(
    { ...afterRotation.secrets, ADMIN_PASSWORD_HASH: null },
    { ...before.secrets, ADMIN_PASSWORD_HASH: null },
  );
  await stop();

  // A pre-upgrade configuration with its matching key migrates unchanged.
  const key = randomBytes(32);
  const legacySecrets = {
    ...afterRotation.secrets,
    BREVO_API_KEY: "legacy-provider-key",
  };
  const legacyCiphertext = encryptedFixture(legacySecrets, key);
  await mkdir(join(directory, "data"));
  await writeFile(join(directory, "data/master.key"), key, { mode: 0o600 });
  await db.appConfiguration.update({
    where: { id: "main" },
    data: {
      secrets: Prisma.DbNull,
      encryptedSecrets: legacyCiphertext,
      values: {
        ...afterRotation.values,
        LIVE_DELIVERY: "true",
        LIVE_SOURCE_BLOCKING: "true",
      },
    },
  });
  await seed();
  const migrated = await configuration();
  assert.deepEqual(migrated.secrets, legacySecrets);
  assert.equal(migrated.encryptedSecrets, legacyCiphertext);
  assert.equal(migrated.credentialsNeedReview, false);
  assert.equal(migrated.values.LIVE_DELIVERY, "true");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory);
  await seed();
  assert.deepEqual((await configuration()).secrets, migrated.secrets);
  await start();
  assert.equal((await view(cookie)).status, 200);
  await stop();

  // Missing or wrong legacy keys recover without deleting business records.
  const preservedExperiment = await db.experiment.findFirstOrThrow();
  const counts = {
    experiments: await db.experiment.count(),
    chains: await db.chain.count(),
  };
  for (const keyState of ["missing", "wrong"]) {
    if (keyState === "wrong") {
      await mkdir(join(directory, "data"));
      await writeFile(join(directory, "data/master.key"), randomBytes(32));
    }
    await db.appConfiguration.update({
      where: { id: "main" },
      data: {
        secrets: Prisma.DbNull,
        encryptedSecrets: legacyCiphertext,
        credentialsNeedReview: false,
        values: {
          ...migrated.values,
          LIVE_DELIVERY: "true",
          LIVE_SOURCE_BLOCKING: "true",
        },
      },
    });
    const output = await seed();
    assert.ok(output.includes("Previous credentials could not be read"));
    assert.ok(!output.includes(childEnv.OWNER_PASSWORD));
    const recovered = await configuration();
    assert.equal(recovered.encryptedSecrets, legacyCiphertext);
    assert.equal(recovered.secrets.BREVO_API_KEY, "");
    assert.notEqual(recovered.secrets.TOKEN_SECRET, legacySecrets.TOKEN_SECRET);
    assert.notEqual(
      recovered.secrets.ROUNDSKY_WEBHOOK_TOKEN,
      legacySecrets.ROUNDSKY_WEBHOOK_TOKEN,
    );
    assert.equal(recovered.credentialsNeedReview, true);
    assert.equal(recovered.values.LIVE_DELIVERY, "false");
    assert.equal(recovered.values.LIVE_SOURCE_BLOCKING, "false");
    assert.equal(await db.experiment.count(), counts.experiments);
    assert.equal(await db.chain.count(), counts.chains);
    assert.deepEqual(
      await db.experiment.findUnique({ where: { id: preservedExperiment.id } }),
      preservedExperiment,
    );
    await start();
    assert.equal((await view(cookie)).status, 401);
    cookie = await session();
    assert.equal(
      (await (await view(cookie)).json()).credentialsNeedReview,
      true,
    );
    const acknowledged = await fetch(`${base}/api/admin/configuration`, {
      method: "PATCH",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secrets: { BREVO_API_KEY: "replacement-provider-key" },
        credentialsReviewed: true,
      }),
    });
    assert.equal(acknowledged.status, 200);
    assert.equal((await acknowledged.json()).credentialsNeedReview, false);
    await stop();
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory);
    await seed();
    assert.equal(
      (await configuration()).secrets.BREVO_API_KEY,
      "replacement-provider-key",
    );
    assert.equal(
      (await configuration()).secrets.TOKEN_SECRET,
      recovered.secrets.TOKEN_SECRET,
    );
    assert.equal((await configuration()).credentialsNeedReview, false);
  }
  console.log(
    "Production checks passed: environment login, no data volume, password rotation, legacy import, missing/wrong-key recovery, and restart persistence.",
  );
} finally {
  await stop();
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
