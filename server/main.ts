import { buildServer } from "./app";

const origins = process.env.ALLOWED_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const server = await buildServer({
  databasePath: process.env.DATABASE_PATH,
  origins,
  secureCookies: process.env.COOKIE_SECURE === "true",
  serveFiles: process.env.SERVE_FILES !== "false",
  rateLimits: process.env.NODE_ENV !== "test",
  logger: process.env.NODE_ENV !== "test",
});
await server.app.listen({
  port: Number(process.env.PORT ?? 5187),
  host: process.env.HOST ?? "127.0.0.1",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void server.app.close().then(() => process.exit(0));
  });
