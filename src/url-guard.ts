import { lookup } from "node:dns/promises";
import net from "node:net";
import { allowsAnyHost, config } from "./config";

export type GuardFailure =
  "invalid-url" | "unsupported-protocol" | "host-not-allowed" | "private-address";

export type GuardResult = { ok: true; url: URL } | { ok: false; reason: GuardFailure };

/**
 * Blocks addresses that should never be reachable through a public proxy: loopback,
 * link-local (which includes cloud metadata at 169.254.169.254), and RFC1918 ranges.
 */
const isPrivateAddress = (address: string): boolean => {
  const version = net.isIP(address);

  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets as [number, number, number, number];

    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this host"
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const normalized = address.toLowerCase();

    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique-local

    // IPv4-mapped addresses (::ffff:0:0/96) reach the IPv4 stack, so they must be judged by
    // the IPv4 rules. Node normalises the dotted spelling to hex — [::ffff:127.0.0.1] arrives
    // as ::ffff:7f00:1 — so both forms have to be decoded or loopback slips through.
    const mapped = /^::ffff:(.+)$/.exec(normalized);
    if (mapped?.[1]) {
      const tail = mapped[1];
      if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return isPrivateAddress(tail);

      const groups = tail.split(":");
      if (groups.length === 2) {
        const high = parseInt(groups[0] ?? "", 16);
        const low = parseInt(groups[1] ?? "", 16);
        if (Number.isFinite(high) && Number.isFinite(low)) {
          const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
          return isPrivateAddress(dotted);
        }
      }
      // An unrecognised mapped form is treated as private rather than trusted.
      return true;
    }

    return false;
  }

  return true; // not a literal IP — caller resolves DNS first
};

const hostIsAllowed = (hostname: string): boolean => {
  if (allowsAnyHost) return true;
  const host = hostname.toLowerCase();
  return config.allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};

/**
 * Validates a proxy target before any request is made.
 *
 * The DNS check matters as much as the allowlist: an allowed hostname can still resolve to
 * a private address, either by misconfiguration or by an attacker controlling DNS for a
 * subdomain. Checking the resolved IP closes that path.
 */
export const guardUrl = async (rawUrl: string): Promise<GuardResult> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "unsupported-protocol" };
  }

  if (!hostIsAllowed(url.hostname)) {
    return { ok: false, reason: "host-not-allowed" };
  }

  // Node keeps the brackets on an IPv6 literal, so `[::1]` is not recognised by net.isIP
  // and would otherwise fall through to a DNS lookup instead of the address check.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(hostname) !== 0) {
    return isPrivateAddress(hostname)
      ? { ok: false, reason: "private-address" }
      : { ok: true, url };
  }

  try {
    const resolved = await lookup(hostname, { all: true });
    if (resolved.some((entry) => isPrivateAddress(entry.address))) {
      return { ok: false, reason: "private-address" };
    }
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  return { ok: true, url };
};
