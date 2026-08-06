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
3. **Resolved address** — DNS is resolved and the result rejected if it lands on loopback,
   link-local (`169.254.0.0/16`, which covers cloud metadata), RFC1918, or carrier-grade NAT.
   This matters independently of the allowlist: an allowed hostname can still resolve to a
   private address, whether by misconfiguration or by someone controlling DNS for a subdomain.
4. **Redirects** — not followed. Otherwise an allowed host could bounce the request to a
   blocked one and defeat every check above.

Responses are capped by size and requests by time, so a slow or enormous upstream cannot hold
the process open. Upstream error text is never forwarded — it can disclose internal hostnames
and paths — so failures return a generic message and the detail goes to the server log.

## Setup

```bash
git clone https://github.com/cryptothud/proxy-server.git
cd proxy-server
npm install
cp .env.example .env      # set ALLOWED_HOSTS — the server won't boot without it
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
| `ALLOWED_HOSTS` | — | **Required.** Comma-separated hostnames the proxy may fetch |
| `ALLOWED_ORIGINS` | empty | Browser origins allowed to call the proxy |
| `REQUEST_TIMEOUT_MS` | `10000` | Upstream request timeout |
| `MAX_RESPONSE_BYTES` | `5242880` | Maximum upstream response size |
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
