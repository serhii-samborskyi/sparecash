import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { env } from "./config.js";
import { db } from "./db.js";
import { login, hash, checkOrigin } from "./security.js";
import { adminRouter } from "./routes/admin.js";
import { publicRouter } from "./routes/public.js";
import { webhookRouter } from "./routes/webhooks.js";
import { mcpRouter } from "./mcp.js";
import { mediaRouter } from "./routes/media.js";
import {
  initializeRuntimeConfiguration,
  refreshRuntimeConfiguration,
} from "./runtime-config.js";
import { runtimeContext } from "./config.js";
export const app = express();
app.disable("x-powered-by");
// Coolify terminates TLS; only trust its loopback/private reverse-proxy hop.
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.use(
  helmet({
    contentSecurityPolicy:
      env.NODE_ENV === "production"
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                "https://challenges.cloudflare.com",
                "https://cdn.onesignal.com",
                // The Web SDK loads its app configuration through a JSONP script.
                "https://api.onesignal.com",
              ],
              styleSrc: ["'self'", "'unsafe-inline'"],
              frameSrc: [
                "https://challenges.cloudflare.com",
                "https://*.onesignal.com",
              ],
              connectSrc: [
                "'self'",
                "https://*.onesignal.com",
                "https://onesignal.com",
                "https://challenges.cloudflare.com",
              ],
              imgSrc: ["'self'", "data:", "https://*.onesignal.com"],
              workerSrc: ["'self'", "blob:"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  }),
);
const ordinaryJson = express.json({ limit: "256kb" });
app.use(
  (req, res, next) => {
    // Upload parsers run only after their owner/MCP or one-use authentication.
    if (
      /^\/(?:mcp\/?|api\/admin\/landing-assets\/?|api\/media\/landing-upload\/[^/]+)$/i.test(
        req.path,
      )
    )
      next();
    else ordinaryJson(req, res, next);
  },
  express.urlencoded({ extended: false, limit: "32kb" }),
  cookieParser(),
);
app.get("/health", async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});
app.use(async (_req, _res, next) => {
  try {
    runtimeContext.run(await refreshRuntimeConfiguration(), () => next());
  } catch (error) {
    next(error);
  }
});
app.post(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  checkOrigin,
  async (req, res) => {
    const { password } = z
      .object({ password: z.string().max(200) })
      .parse(req.body);
    if (!(await login(password, res))) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }
    res.json({ ok: true });
  },
);
app.post("/api/auth/logout", checkOrigin, async (req, res) => {
  if (req.cookies.sc_session)
    await db.adminSession.deleteMany({
      where: { id: hash(req.cookies.sc_session) },
    });
  res.clearCookie("sc_session");
  res.json({ ok: true });
});
app.use(mediaRouter);
app.use("/api/admin", adminRouter);
app.use("/api/public", publicRouter);
app.use("/api/webhooks", webhookRouter);
app.use(
  "/mcp",
  rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  mcpRouter,
);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});
if (env.NODE_ENV === "development") {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.get("/{*path}", async (req, res, next) => {
    try {
      res
        .type("html")
        .send(
          await vite.transformIndexHtml(
            req.originalUrl,
            await readFile(resolve("index.html"), "utf8"),
          ),
        );
    } catch (error) {
      next(error);
    }
  });
} else if (env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist/client")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/client/index.html")),
  );
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if ((error as { type?: string })?.type === "entity.too.large") {
      res
        .status(413)
        .json({ error: "Request too large. Image uploads allow up to 4 MiB." });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      res.status(error.code === "P2025" ? 404 : 409).json({
        error:
          error.code === "P2025"
            ? "Record not found"
            : "This record conflicts with existing data",
      });
      return;
    }
    console.error(error instanceof Error ? error.message : "Request failed");
    res.status(400).json({
      error:
        error instanceof Error && !error.message.includes("prisma")
          ? error.message
          : "Request could not be completed",
    });
  },
);
if (env.NODE_ENV !== "test") {
  await initializeRuntimeConfiguration();
  const server = app.listen(env.PORT, "0.0.0.0", () =>
    console.log(`SpareCash: ${env.APP_URL}`),
  );
  process.on("SIGTERM", () =>
    server.close(() => {
      void db.$disconnect();
    }),
  );
}
