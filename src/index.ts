import express, {
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import { config, describeHostPolicy } from "./config";
import { guardUrl, type GuardFailure } from "./url-guard";
import { streamWithLimit } from "./stream-limit";

const app = express();

// Required for express-rate-limit to read the real client IP behind a platform proxy
// (Railway, Vercel, Fly). Without it every request is attributed to the load balancer.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false,
  }),
);

/**
 * Rejects request payloads outright.
 *
 * This is a GET-only proxy and registers no body parser, so a payload is never read — but
 * without this the socket still accepts the upload before the router discards it. Refusing
 * on the declared length stops that at the door, and keeps the guarantee from silently
 * lapsing if a POST route is added later.
 */
app.use((req: Request, res: ExpressResponse, next: NextFunction) => {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > config.maxRequestBytes) {
    res.status(413).json({ error: "Request body too large." });
    return;
  }

  if (req.originalUrl.length > config.maxUrlLength) {
    res.status(414).json({ error: "Request URL too long." });
    return;
  }

  next();
});

app.use(
  slowDown({
    windowMs: config.rateLimit.windowMs,
    delayAfter: config.rateLimit.delayAfter,
    delayMs: () => config.rateLimit.delayMs,
  }),
);

app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

const GUARD_MESSAGES: Record<GuardFailure, string> = {
  "invalid-url": "The url parameter is not a valid URL.",
  "unsupported-protocol": "Only http and https URLs are supported.",
  "host-not-allowed": "That host is not on this proxy's allowlist.",
  "private-address": "That host resolves to a private address.",
};

app.get("/health", (_req: Request, res: ExpressResponse) => {
  res.status(200).json({ status: "ok" });
});

app.get("/", async (req: Request, res: ExpressResponse) => {
  const { url } = req.query;

  if (typeof url !== "string" || url.length === 0) {
    res.status(400).json({ error: "Missing url parameter." });
    return;
  }

  const guard = await guardUrl(url);
  if (!guard.ok) {
    res.status(400).json({ error: GUARD_MESSAGES[guard.reason] });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const upstream = await fetch(guard.url, {
      signal: controller.signal,
      // Following redirects would let an allowed host bounce the request to a blocked one.
      redirect: "manual",
      headers: { accept: req.headers.accept ?? "*/*" },
    });

    // Fast path: reject before transferring anything when the upstream declares its size.
    const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
    if (declaredLength > config.maxResponseBytes) {
      res.status(502).json({ error: "Upstream response too large." });
      return;
    }

    const contentType = upstream.headers.get("content-type");
    if (contentType) res.set("content-type", contentType);
    res.status(upstream.status);

    const streamed = await streamWithLimit(upstream.body, res, config.maxResponseBytes, () => {
      console.warn(
        `Upstream ${guard.url.host} exceeded ${config.maxResponseBytes} bytes; aborting.`,
      );
      controller.abort();
    });

    if (!streamed.ok) return;
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    // Deliberately generic: upstream error text can disclose internal hostnames and paths.
    console.error(`Proxy request failed for ${guard.url.host}:`, error);

    // A failure part-way through streaming has already sent the status line, so there is
    // no status left to set — all that remains is to cut the connection.
    if (res.headersSent) {
      res.destroy();
      return;
    }

    res.status(aborted ? 504 : 502).json({
      error: aborted ? "Upstream request timed out." : "Failed to fetch from upstream.",
    });
  } finally {
    clearTimeout(timeout);
  }
});

// Express needs all four parameters to recognise this as an error handler.
app.use((error: Error, _req: Request, res: ExpressResponse, _next: NextFunction) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(config.port, () => {
  console.log(`Proxy listening on port ${config.port}`);
  console.log(`Host policy: ${describeHostPolicy()}`);
});
