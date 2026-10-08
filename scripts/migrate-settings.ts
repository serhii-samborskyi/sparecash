import { readFile, writeFile, mkdir, chmod, unlink } from "node:fs/promises";
import { parse } from "dotenv";
import {
  initializeRuntimeConfiguration,
  saveRuntimeSettings,
  readRuntimeConfiguration,
} from "../server/runtime-config.js";
import { buildRoundSkyPixelUrl } from "../server/roundsky-contract.js";
import { db } from "../server/db.js";
const contents = await readFile(".env", "utf8");
const legacy = parse(contents);
await initializeRuntimeConfiguration(legacy);
const appUrl = process.argv
  .find((value) => value.startsWith("--app-url="))
  ?.slice(10);
if (appUrl)
  await saveRuntimeSettings({ values: { APP_URL: appUrl } }, "migration");
const config = await readRuntimeConfiguration();
if (!legacy.DATABASE_URL) throw new Error("DATABASE_URL is missing");
await mkdir(".local", { recursive: true, mode: 0o700 });
await writeFile(".local/legacy-env.backup", contents, {
  mode: 0o600,
  flag: "wx",
}).catch((error) => {
  if (error.code !== "EEXIST") throw error;
});
await writeFile(
  ".env",
  `DATABASE_URL=${JSON.stringify(legacy.DATABASE_URL)}\nOWNER_PASSWORD=${JSON.stringify(process.env.OWNER_PASSWORD)}\n`,
  { mode: 0o600 },
);
await chmod(".env", 0o600);
await writeFile(
  ".local/roundsky-pixel-url.txt",
  buildRoundSkyPixelUrl(config.APP_URL, config.ROUNDSKY_WEBHOOK_TOKEN) + "\n",
  { mode: 0o600 },
);
await unlink(".local/coolify-roundsky.env").catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
console.log(
  "Configuration migrated to Settings. .env now contains DATABASE_URL and OWNER_PASSWORD.",
);
console.log("Private migration backup: .local/legacy-env.backup");
console.log("RoundSky pixel URL: .local/roundsky-pixel-url.txt");
await db.$disconnect();
