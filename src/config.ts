const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 3006),

  /**
   * Hostnames this proxy may fetch from.
   *
   * Set to `*` to allow any public host — useful when the proxy exists to solve CORS for
   * arbitrary URLs rather than to front a known set of upstreams. Private and internal
   * addresses stay blocked either way; that check is independent of this list.
   */
  allowedHosts: list(process.env.ALLOWED_HOSTS),

  /** Browser origins allowed to call the proxy. Empty means same-origin/non-browser only. */
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),

  /** Abandon upstream requests that exceed this. */
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 10_000),

  /** Refuse upstream responses larger than this, in bytes. */
  maxResponseBytes: Number(process.env.MAX_RESPONSE_BYTES ?? 5 * 1024 * 1024),

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
 * Fail fast rather than booting with no host policy at all.
 *
 * `*` is a valid answer, but it has to be stated. An empty variable is far more likely to
 * be an unset environment than a deliberate choice, and the two should not look the same.
 */
export const assertConfigured = (): void => {
  if (config.allowedHosts.length === 0) {
    throw new Error(
      "ALLOWED_HOSTS is not set. Either list the hostnames this proxy may fetch " +
        "(ALLOWED_HOSTS=arweave.net,api.example.com) or set ALLOWED_HOSTS=* to allow any " +
        "public host. Private and internal addresses are blocked in both cases.",
    );
  }
};
