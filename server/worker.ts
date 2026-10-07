import { initializeRuntimeConfiguration } from "./runtime-config.js";
import { tick } from "./services/engine.js";
import { db } from "./db.js";
await initializeRuntimeConfiguration();
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
while (!stopped) {
  try {
    console.log(
      JSON.stringify({ at: new Date().toISOString(), ...(await tick()) }),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Worker tick failed",
    );
  }
  for (let i = 0; i < 30 && !stopped; i++)
    await new Promise((r) => setTimeout(r, 1000));
}
await db.$disconnect();
