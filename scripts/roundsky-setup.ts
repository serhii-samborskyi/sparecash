import { mkdir, writeFile, chmod } from "node:fs/promises";
import { initializeRuntimeConfiguration } from "../server/runtime-config.js";
import { buildRoundSkyPixelUrl } from "../server/roundsky-contract.js";
import { db } from "../server/db.js";
const config = await initializeRuntimeConfiguration();
await mkdir(".local", { recursive: true, mode: 0o700 });
const path = ".local/roundsky-pixel-url.txt";
await writeFile(
  path,
  buildRoundSkyPixelUrl(config.APP_URL, config.ROUNDSKY_WEBHOOK_TOKEN) + "\n",
  { mode: 0o600 },
);
await chmod(path, 0o600);
console.log(
  "RoundSky pixel URL: .local/roundsky-pixel-url.txt. Change its URL/secret in Settings.",
);
await db.$disconnect();
