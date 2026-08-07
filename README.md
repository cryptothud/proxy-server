# proxy-server

A small HTTP proxy for fetching third-party resources from a browser without tripping CORS —
built so it cannot be turned against the network it runs on.

Most tutorial proxies accept any URL and fetch it. That is an SSRF vector: a caller can point
the server at `169.254.169.254` to read cloud instance credentials, at `localhost` to reach
services never meant to be public, or simply use the host to launder outbound traffic. This
one requires an explicit allowlist and refuses to start without one.

## How requests are validated

Every request passes four checks before a single byte leaves the server:

1. **Protocol** — `http` and `https` only, so `file://`, `gopher://` and friends are out.
2. **Host allowlist** — the hostname must match `ALLOWED_HOSTS` or be a subdomain of an entry.
   This layer is opt-in: unset (or `*`) accepts any public host. The other three always apply.
3. **Resolved address** — DNS is resolved and the result rejected if it lands on loopback,
   link-local (`169.254.0.0/16`, which covers cloud metadata), RFC1918, or carrier-grade NAT.
   This matters independently of the allowlist: an allowed hostname can still resolve to a
   private address, whether by misconfiguration or by someone controlling DNS for a subdomain.
4. **Redirects** — not followed. Otherwise an allowed host could bounce the request to a
   blocked one and defeat every check above.

## Limits

| Limit | Default | Enforcement |
|---|---|---|
| Upstream response | 5 MB | Running byte count while streaming; transfer aborted on breach |
| Request payload | 8 KB | Rejected on `content-length` before the body is read (`413`) |
| Request URL | 4 KB | Rejected before routing (`414`) |
| Upstream timeout | 10 s | `AbortController` on the fetch |
| Requests per IP | 120/min | `express-rate-limit`, throttling from 60 |

The response limit is counted as bytes arrive rather than read from `content-length`. A
chunked response omits that header, so a check against it alone is trivially bypassed — and
buffering the body in order to measure it would allocate exactly the payload the limit exists
to prevent. Writes respect backpressure, so a slow client cannot cause the upstream to
accumulate unbounded in the response stream instead.

Requests are capped by time as well as size, so a slow or enormous upstream cannot hold
the process open. Upstream error text is never forwarded — it can disclose internal hostnames
and paths — so failures return a generic message and the detail goes to the server log.

## Setup

```bash
git clone https://github.com/cryptothud/proxy-server.git
cd proxy-server
npm install
cp .env.example .env      # optional; sensible defaults for everything
npm run dev
```

## Usage

```
GET /?url=https://arweave.net/<id>
GET /health
```

```bash
curl "http://localhost:3006/?url=https://arweave.net/some-id"
```

Rejected requests return `400` with a reason:

```json
{ "error": "That host is not on this proxy's allowlist." }
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3006` | Port to listen on |
| `ALLOWED_HOSTS` | `*` | Hostnames the proxy may fetch. Defaults to any public host |
| `ALLOWED_ORIGINS` | empty | Browser origins allowed to call the proxy |
| `REQUEST_TIMEOUT_MS` | `10000` | Upstream request timeout |
| `MAX_RESPONSE_BYTES` | `5242880` | Maximum upstream response size |
| `MAX_REQUEST_BYTES` | `8192` | Maximum request payload |
| `MAX_URL_LENGTH` | `4096` | Maximum request URL length |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `120` | Max requests per window per IP |
| `RATE_LIMIT_DELAY_AFTER` | `60` | Requests before throttling begins |
| `RATE_LIMIT_DELAY_MS` | `500` | Delay added per request once throttling starts |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run from source with ts-node |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `npm test` | Run the URL guard test suite |
| `npm run typecheck` | `tsc --noEmit` |

## Tests

`npm test` covers the URL guard — the allowlist, protocol filtering, and private-address
blocking.

The private-address tests deliberately put loopback, RFC1918 and metadata addresses **on**
the allowlist. Otherwise the allowlist rejects them first and the address check never runs,
so the suite would pass just as happily with that layer deleted. Each layer is verified on
its own.

## Deployment notes

`trust proxy` is enabled, which platform proxies (Railway, Fly, Render) require for rate
limiting to see the real client IP rather than attributing every request to the load balancer.

Rate limit counters are per-process and in-memory. Across multiple instances each one limits
independently — back it with Redis if you need a global limit.

## License

MIT

### Running as a general-purpose CORS proxy

This is the default. With no environment variables at all, the proxy accepts any public
host — which is the point of a CORS proxy — and that is not the same thing as the open
proxy it replaced, because the private-address check is an independent layer that stays on.

The active policy is printed at startup, so which mode is live is visible in the logs
rather than inferred from the environment:

```
Proxy listening on port 3006
Host policy: any public host (ALLOWED_HOSTS unset, using default) — private and internal addresses blocked
```

```
?url=https://any-public-site.com/x   → allowed
?url=http://10.0.0.5/internal        → 400, private address
?url=http://169.254.169.254/         → 400, private address
```

What that leaves open is relay use — anyone can route public traffic through your host, and
requests reach third parties carrying your IP. Rate limiting caps the throughput but does not
change who can use it. If the service is reachable from the open internet and you care about
that, `ALLOWED_HOSTS` is the lever.
