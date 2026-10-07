import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
const root = process.cwd();
const schema = `sparecash_bootstrap_${process.pid}`;
const database = new URL(process.env.DATABASE_URL);
database.searchParams.set("schema", schema);
await mkdir(".local", { recursive: true });
const directory = await mkdtemp(resolve(".local/bootstrap-check-"));
const childEnv = {
  DATABASE_URL: database.toString(),
  NODE_ENV: "production",
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};
const db = new PrismaClient({ datasourceUrl: database.toString() });
let server;
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
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
try {
  await run("npx", ["prisma", "migrate", "deploy"], root);
  await run(process.execPath, [resolve("dist/server/seed.js")], directory);
  const key = await readFile(join(directory, "data/master.key"));
  assert.equal(key.length, 32);
  assert.equal(
    (await stat(join(directory, "data/master.key"))).mode & 0o777,
    0o600,
  );
  const password = (
    await readFile(join(directory, "data/owner-password.txt"), "utf8")
  ).trim();
  assert.ok(password.length >= 24);
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
    for (let attempt = 0; attempt < 80; attempt++) {
      if (server.exitCode !== null)
        throw new Error("Fresh production server failed to start");
      try {
        if ((await fetch(`${base}/health`)).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Fresh production startup timed out");
  }
  await start();
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://sparecash.leadtechx.com",
    },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const first = await (
    await fetch(`${base}/api/admin/configuration`, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(first.values.APP_URL, "https://sparecash.leadtechx.com");
  assert.equal(first.values.LIVE_DELIVERY, "false");
  assert.equal(first.values.LIVE_SOURCE_BLOCKING, "false");
  assert.equal(first.secrets.ROUNDSKY_WEBHOOK_TOKEN, true);
  const before = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  await stop();
  await run(process.execPath, [resolve("dist/server/seed.js")], directory);
  await start();
  const after = await db.appConfiguration.findUniqueOrThrow({
    where: { id: "main" },
  });
  assert.equal(after.encryptedSecrets, before.encryptedSecrets);
  assert.equal(
    (
      await fetch(`${base}/api/admin/configuration`, {
        headers: { Cookie: cookie },
      })
    ).status,
    200,
  );
  assert.deepEqual(await readFile(join(directory, "data/master.key")), key);
  console.log(
    "Fresh production startup passed: DATABASE_URL only, generated owner login, encrypted settings, and restart persistence.",
  );
} finally {
  await stop();
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
