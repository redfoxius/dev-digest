import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { UrlFetcher } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

const FETCH_TIMEOUT_MS = 10_000;

function isDisallowedIPv4(ip: string): boolean {
  const [a = -1, b = -1] = ip.split('.').map(Number);
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 0) return true;
  return false;
}

/**
 * Extracts the embedded IPv4 address from an IPv4-mapped IPv6 literal —
 * either the dotted form (`::ffff:127.0.0.1`) or the compressed-hex form
 * (`::ffff:7f00:1`) that `new URL()`/`dns.lookup` normalization produces —
 * or null if `ip` isn't one.
 */
function ipv4MappedAddress(ip: string): string | null {
  const dotted = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
  }
  return null;
}

/**
 * True for IPv4/IPv6 addresses that must never be reachable from this
 * server's own outbound requests: loopback, link-local (incl. the
 * 169.254.169.254 cloud-metadata endpoint), RFC1918/unique-local private
 * ranges, and IPv4-mapped IPv6 literals whose embedded IPv4 address falls in
 * any of the above (the OS/undici route these to that embedded address, so
 * checking the IPv6 literal's own bytes alone isn't enough). This is the
 * actual SSRF guard — every caller-supplied URL's resolved address is
 * checked against this before the real fetch.
 */
function isDisallowedTarget(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isDisallowedIPv4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
    const mapped = ipv4MappedAddress(lower);
    return mapped !== null && isDisallowedIPv4(mapped);
  }
  return true; // couldn't parse — fail closed
}

/**
 * Real HTTP(S) fetch with SSRF protection: only http/https schemes, the
 * resolved address must not be loopback/private/link-local, redirects are
 * NOT followed (a public URL redirecting to an internal target is a common
 * bypass otherwise), and every request has a hard timeout.
 */
export class HttpUrlFetcher implements UrlFetcher {
  async fetch(url: string): Promise<Response> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ValidationError(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ValidationError(`Unsupported URL scheme: ${parsed.protocol}`);
    }

    // `URL.hostname` keeps the brackets for an IPv6 literal (`"[::1]"`, not
    // `"::1"`) — `net.isIP()` doesn't recognize the bracketed form at all
    // (returns 0), which would otherwise send an IPv6 literal down the
    // DNS-lookup branch below instead of being checked directly.
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(hostname)
      ? [hostname]
      : await dns.lookup(hostname, { all: true }).then(
          (rows) => rows.map((r) => r.address),
          () => {
            throw new ValidationError(`Could not resolve host: ${hostname}`);
          },
        );

    if (addresses.length === 0 || addresses.some(isDisallowedTarget)) {
      throw new ValidationError(
        `URL resolves to a disallowed private/loopback/link-local address: ${hostname}`,
      );
    }

    // Pin the real connection to the SAME address just validated above, via
    // a custom `lookup` on a one-off dispatcher. Without this, the real
    // fetch performs its OWN independent DNS resolution for `hostname` —
    // an attacker who controls that DNS record (trivial: they're supplying
    // the import URL, they already need to host the content there) can
    // return an allowed address for the check above and a private/loopback
    // one moments later (DNS rebinding, TTL=0 or round-robin), completely
    // defeating the address-based guard. Uses undici's own `fetch`, not the
    // global one — Node's global `fetch` is backed by its own internal,
    // differently-versioned undici copy and rejects a dispatcher built from
    // the `undici` package (verified: "invalid onError method").
    const pinnedAddress = addresses[0]!;
    const pinnedFamily = net.isIP(pinnedAddress) as 4 | 6;
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options?.all) callback(null, [{ address: pinnedAddress, family: pinnedFamily }]);
          else callback(null, pinnedAddress, pinnedFamily);
        },
      },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return (await undiciFetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'error',
        dispatcher,
      })) as unknown as Response;
    } finally {
      clearTimeout(timeout);
      // Not awaited — this agent serves exactly one request; closing waits
      // for it to fully finish, but the caller must be free to start
      // reading the (still-streaming) response body without waiting on it.
      void dispatcher.close().catch(() => {});
    }
  }
}
