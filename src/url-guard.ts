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
    // IPv4-mapped, e.g. ::ffff:127.0.0.1
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
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

  if (net.isIP(url.hostname) !== 0) {
    return isPrivateAddress(url.hostname)
      ? { ok: false, reason: "private-address" }
      : { ok: true, url };
  }

  try {
    const resolved = await lookup(url.hostname, { all: true });
    if (resolved.some((entry) => isPrivateAddress(entry.address))) {
      return { ok: false, reason: "private-address" };
    }
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  return { ok: true, url };
};
