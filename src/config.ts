const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT ?? 3006),

  /**
   * Hostnames this proxy is allowed to fetch from.
   *
   * An allowlist is the whole point of the service. Without one, any caller can aim the
   * server at internal addresses or use it to launder arbitrary outbound traffic.
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

/** Fail fast rather than booting an open proxy by accident. */
export const assertConfigured = (): void => {
  if (config.allowedHosts.length === 0) {
    throw new Error(
      "ALLOWED_HOSTS is empty. Set it to a comma-separated list of hostnames this proxy " +
        "may fetch, e.g. ALLOWED_HOSTS=arweave.net,api.example.com. Refusing to start as " +
        "an open proxy.",
    );
  }
};
