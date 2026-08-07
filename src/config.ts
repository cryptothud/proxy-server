const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const withDefault = (values: string[], fallback: string[]): string[] =>
  values.length > 0 ? values : fallback;

/** True when ALLOWED_HOSTS was never set, so the permissive default is in play. */
export const usingDefaultHostPolicy = list(process.env.ALLOWED_HOSTS).length === 0;

export const config = {
  port: Number(process.env.PORT ?? 3006),

  /**
   * Hostnames this proxy may fetch from.
   *
   * Defaults to `*` — any public host — so the service runs as a general-purpose CORS proxy
   * with no configuration. Narrow it by listing hostnames when the proxy fronts a known set
   * of upstreams.
   *
   * This list never governs internal reachability. Private, loopback, link-local and
   * cloud-metadata addresses are rejected by `url-guard` regardless of what is set here, so
   * the permissive default cannot expose a private network.
   */
  allowedHosts: withDefault(list(process.env.ALLOWED_HOSTS), ["*"]),

  /** Browser origins allowed to call the proxy. Empty means same-origin/non-browser only. */
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),

  /** Abandon upstream requests that exceed this. */
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 10_000),

  /**
   * Refuse upstream responses larger than this, in bytes.
   *
   * Enforced against a running byte count while streaming, not against `content-length` —
   * a chunked response omits that header, and buffering first to measure it would allocate
   * the payload the limit exists to prevent.
   */
  maxResponseBytes: Number(process.env.MAX_RESPONSE_BYTES ?? 5 * 1024 * 1024),

  /**
   * Reject request payloads larger than this, in bytes.
   *
   * This proxy only serves GET and parses no body, so the default is deliberately tiny;
   * it exists to refuse uploads at the door rather than accept and discard them.
   */
  maxRequestBytes: Number(process.env.MAX_REQUEST_BYTES ?? 8 * 1024),

  /** Reject request URLs longer than this. Node caps headers at 16 KB by default. */
  maxUrlLength: Number(process.env.MAX_URL_LENGTH ?? 4096),

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    maxRequests: Number(process.env.RATE_LIMIT_MAX ?? 120),
    delayAfter: Number(process.env.RATE_LIMIT_DELAY_AFTER ?? 60),
    delayMs: Number(process.env.RATE_LIMIT_DELAY_MS ?? 500),
  },
} as const;

/** True when ALLOWED_HOSTS is `*` — any public host is permitted. */
export const allowsAnyHost = config.allowedHosts.includes("*");

/**
 * Reports the active host policy at startup.
 *
 * The permissive default is deliberate, so it is stated in the log rather than enforced by
 * refusing to boot — an operator reading the logs should be able to tell which mode is live
 * without inspecting the environment.
 */
export const describeHostPolicy = (): string =>
  allowsAnyHost
    ? `any public host${usingDefaultHostPolicy ? " (ALLOWED_HOSTS unset, using default)" : ""}` +
      " — private and internal addresses blocked"
    : `allowlist: ${config.allowedHosts.join(", ")}`;
