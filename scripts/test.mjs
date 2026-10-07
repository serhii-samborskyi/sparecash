import "dotenv/config";
import { spawnSync } from "node:child_process";
const database = new URL(
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "",
);
database.searchParams.set("schema", "sparecash_test");
const env = {
  DATABASE_URL: database.toString(),
  NODE_ENV: "test",
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};
for (const args of [
  ["prisma", "migrate", "deploy"],
  ["vitest", "run"],
]) {
  const r = spawnSync("npx", args, { env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
