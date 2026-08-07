import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * `config` reads the environment once at import time, so ALLOWED_HOSTS must be set before
 * `url-guard` is required. Each block therefore loads the module through a fresh cache.
 */
const loadGuard = async (allowedHosts: string | undefined) => {
  if (allowedHosts === undefined) {
    delete process.env.ALLOWED_HOSTS;
  } else {
    process.env.ALLOWED_HOSTS = allowedHosts;
  }
  delete require.cache[require.resolve("../config")];
  delete require.cache[require.resolve("../url-guard")];
  return (await import("../url-guard")) as typeof import("../url-guard");
};

describe("guardUrl — allowlist", () => {
  const allowed = "arweave.net,example.com";

  it("permits a listed host", async () => {
    const { guardUrl } = await loadGuard(allowed);
    assert.equal((await guardUrl("https://arweave.net/abc")).ok, true);
  });

  it("permits a subdomain of a listed host", async () => {
    const { guardUrl } = await loadGuard(allowed);
    assert.equal((await guardUrl("https://cdn.arweave.net/abc")).ok, true);
  });

  it("rejects an unlisted host", async () => {
    const { guardUrl } = await loadGuard(allowed);
    const result = await guardUrl("https://evil.com/abc");
    assert.deepEqual(result, { ok: false, reason: "host-not-allowed" });
  });

  it("does not treat a suffix match as a subdomain", async () => {
    const { guardUrl } = await loadGuard(allowed);
    // "notexample.com" ends with "example.com" as a string but is a different domain.
    const result = await guardUrl("https://notexample.com/abc");
    assert.deepEqual(result, { ok: false, reason: "host-not-allowed" });
  });
});

describe("guardUrl — protocol", () => {
  it("rejects non-http protocols", async () => {
    const { guardUrl } = await loadGuard("example.com");
    for (const url of ["file:///etc/passwd", "gopher://example.com/", "ftp://example.com/"]) {
      const result = await guardUrl(url);
      assert.deepEqual(result, { ok: false, reason: "unsupported-protocol" }, url);
    }
  });

  it("rejects a malformed URL", async () => {
    const { guardUrl } = await loadGuard("example.com");
    assert.deepEqual(await guardUrl("not-a-url"), { ok: false, reason: "invalid-url" });
  });
});

/**
 * These hosts are deliberately allowlisted so the address check is exercised on its own.
 * Without that, the allowlist would reject them first and this layer would never run —
 * which is exactly how a broken SSRF guard passes its own test suite.
 */
describe("guardUrl — private address blocking (allowlist bypassed)", () => {
  const permissive =
    "localhost,127.0.0.1,169.254.169.254,10.0.0.5,192.168.1.1,172.16.0.1,0.0.0.0,100.64.0.1";

  const blocked: Array<[string, string]> = [
    ["http://127.0.0.1/", "loopback"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://10.0.0.5/", "RFC1918 10/8"],
    ["http://192.168.1.1/", "RFC1918 192.168/16"],
    ["http://172.16.0.1/", "RFC1918 172.16/12"],
    ["http://0.0.0.0/", "this-host"],
    ["http://100.64.0.1/", "carrier-grade NAT"],
    ["http://localhost/", "localhost resolved via DNS"],
  ];

  for (const [url, label] of blocked) {
    it(`blocks ${label}`, async () => {
      const { guardUrl } = await loadGuard(permissive);
      const result = await guardUrl(url);
      assert.deepEqual(result, { ok: false, reason: "private-address" });
    });
  }

  it("still allows a public host", async () => {
    const { guardUrl } = await loadGuard(`${permissive},example.com`);
    assert.equal((await guardUrl("https://example.com/")).ok, true);
  });
});

/**
 * ALLOWED_HOSTS=* is the "general purpose CORS proxy" mode: any public host is fine.
 * It must not become a way back into the private network — the address check is a
 * separate layer and stays on.
 */
describe("guardUrl — wildcard host mode", () => {
  it("allows arbitrary public hosts", async () => {
    const { guardUrl } = await loadGuard("*");
    for (const url of ["https://example.com/", "https://arweave.net/x", "https://any.site/y"]) {
      assert.equal((await guardUrl(url)).ok, true, url);
    }
  });

  it("still blocks private and internal addresses", async () => {
    const { guardUrl } = await loadGuard("*");
    const blocked = [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://localhost/",
      "http://[::1]/",
    ];
    for (const url of blocked) {
      const result = await guardUrl(url);
      assert.deepEqual(result, { ok: false, reason: "private-address" }, url);
    }
  });

  it("still rejects non-http protocols", async () => {
    const { guardUrl } = await loadGuard("*");
    const result = await guardUrl("file:///etc/passwd");
    assert.deepEqual(result, { ok: false, reason: "unsupported-protocol" });
  });
});

/**
 * With ALLOWED_HOSTS unset the proxy runs permissively by default, so an existing
 * deployment keeps working without new environment variables. The address guard is what
 * makes that default safe, so it is asserted here rather than assumed.
 */
describe("guardUrl — ALLOWED_HOSTS unset (default policy)", () => {
  it("allows arbitrary public hosts", async () => {
    const { guardUrl } = await loadGuard(undefined);
    for (const url of ["https://example.com/", "https://arweave.net/x"]) {
      assert.equal((await guardUrl(url)).ok, true, url);
    }
  });

  it("blocks private and internal addresses", async () => {
    const { guardUrl } = await loadGuard(undefined);
    for (const url of [
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://localhost/",
    ]) {
      assert.deepEqual(await guardUrl(url), { ok: false, reason: "private-address" }, url);
    }
  });

  it("reports the default policy in the startup description", async () => {
    delete process.env.ALLOWED_HOSTS;
    delete require.cache[require.resolve("../config")];
    const { describeHostPolicy } = await import("../config");
    const description = describeHostPolicy();
    assert.match(description, /any public host/);
    assert.match(description, /ALLOWED_HOSTS unset/);
  });
});
