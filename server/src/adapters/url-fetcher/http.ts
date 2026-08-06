import dns from 'node:dns/promises';
import net from 'node:net';
import type { UrlFetcher } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

const FETCH_TIMEOUT_MS = 10_000;

/**
 * True for IPv4/IPv6 addresses that must never be reachable from this
 * server's own outbound requests: loopback, link-local (incl. the
 * 169.254.169.254 cloud-metadata endpoint), and RFC1918/unique-local
 * private ranges. This is the actual SSRF guard — every caller-supplied
 * URL's resolved address is checked against this before the real fetch.
 */
function isDisallowedTarget(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const [a = -1, b = -1] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 0) return true;
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('fe80:')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
    return false;
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(parsed.toString(), { signal: controller.signal, redirect: 'error' });
    } finally {
      clearTimeout(timeout);
    }
  }
}
