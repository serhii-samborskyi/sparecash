import { initializeRuntimeConfiguration } from "../server/runtime-config.js";
import { db } from "../server/db.js";
await initializeRuntimeConfiguration({
  ...process.env,
  APP_URL: "http://localhost:3000",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
});
await db.$disconnect();
