import "dotenv/config";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import {
  defaultRuntimeValues,
  type RuntimeConfiguration,
} from "./runtime-schema.js";
// Only DATABASE_URL is supplied by the operator. Mode and port are internal defaults.
const infrastructure = z
  .object({
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3000),
  })
  .parse(process.env);
export const runtimeContext = new AsyncLocalStorage<RuntimeConfiguration>();
let current: RuntimeConfiguration | undefined;
export function useRuntimeConfiguration(value: RuntimeConfiguration) {
  current = value;
}
export function currentRuntimeConfiguration() {
  if (!current) throw new Error("Application settings are not initialized");
  return current;
}
type Environment = typeof infrastructure & RuntimeConfiguration;
// Adapters read a consistent snapshot for each request/worker cycle.
export const env = new Proxy({} as Environment, {
  get(_target, key: string) {
    if (key in infrastructure)
      return infrastructure[key as keyof typeof infrastructure];
    const snapshot = runtimeContext.getStore() ?? current;
    if (!snapshot) {
      if (key in defaultRuntimeValues)
        return defaultRuntimeValues[key as keyof typeof defaultRuntimeValues];
      throw new Error("Application credentials are not initialized");
    }
    return snapshot[key as keyof RuntimeConfiguration];
  },
});
