import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpUrlFetcher } from '../src/adapters/url-fetcher/http.js';
import { ValidationError } from '../src/platform/errors.js';

/**
 * The SSRF guard for the skills import-from-URL flow. Rejection paths never
 * touch the network (IP-literal hostnames skip DNS, scheme checks are pure) —
 * deterministic, no real fetch. The "allowed" cases mock undici's own
 * `fetch` (NOT `globalThis.fetch` — the real fetcher calls undici's fetch
 * directly, since Node's global fetch rejects a dispatcher built from the
 * `undici` package) rather than hitting the network, per this repo's
 * no-real-network test rule. Mocked via `vi.mock` (not `vi.spyOn`) because
 * Node's ESM/CJS interop exposes `undici`'s named exports as non-writable
 * getters, which `vi.spyOn`'s property redefinition can't touch.
 */
const undiciFetchMock = vi.hoisted(() => vi.fn());
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: undiciFetchMock };
});

describe('HttpUrlFetcher (SSRF guard)', () => {
  const fetcher = new HttpUrlFetcher();

  afterEach(() => {
    undiciFetchMock.mockReset();
  });

  it.each([
    ['http://127.0.0.1/', 'loopback'],
    ['http://127.0.0.1:5432/', 'loopback with port'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata / link-local'],
    ['http://10.0.0.5/', 'RFC1918 10.0.0.0/8'],
    ['http://172.16.0.1/', 'RFC1918 172.16.0.0/12'],
    ['http://172.31.255.255/', 'RFC1918 172.16.0.0/12 upper bound'],
    ['http://192.168.1.1/', 'RFC1918 192.168.0.0/16'],
    ['http://0.0.0.0/', 'unspecified'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[fe80::1]/', 'IPv6 link-local'],
    ['http://[fd00::1]/', 'IPv6 unique-local'],
    ['http://[::ffff:127.0.0.1]/', 'IPv4-mapped IPv6 loopback (dotted form)'],
    ['http://[::ffff:169.254.169.254]/', 'IPv4-mapped IPv6 cloud metadata (dotted form)'],
    ['http://[::ffff:7f00:1]/', 'IPv4-mapped IPv6 loopback (compressed-hex form, as URL normalizes it)'],
    ['http://[::ffff:a9fe:a9fe]/', 'IPv4-mapped IPv6 cloud metadata (compressed-hex form)'],
  ])('rejects %s (%s) before ever fetching', async (url) => {
    await expect(fetcher.fetch(url)).rejects.toThrow(ValidationError);
  });

  it.each([
    ['ftp://example.com/skill.md', 'ftp scheme'],
    ['file:///etc/passwd', 'file scheme'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['not a url', 'unparsable'],
  ])('rejects %s (%s)', async (url) => {
    await expect(fetcher.fetch(url)).rejects.toThrow(ValidationError);
  });

  it('172.15.x.x and 172.32.x.x are OUTSIDE the 172.16/12 block — not rejected on that basis', async () => {
    // Boundary check on the range math itself; both are public-looking IPs so
    // we only assert they get PAST the guard to the real fetch call, which we
    // mock rather than hit the network.
    const spy = undiciFetchMock.mockResolvedValue(new Response('ok'));
    await fetcher.fetch('http://172.15.0.1/');
    await fetcher.fetch('http://172.32.0.1/');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('allows a public IP-literal http(s) URL through to the real fetch call (mocked, no network)', async () => {
    const spy = undiciFetchMock.mockResolvedValue(new Response('# ok', { status: 200 }));
    const res = await fetcher.fetch('http://93.184.216.34/skill.md');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      'http://93.184.216.34/skill.md',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('does not follow redirects (redirect: "error" is passed to the real fetch)', async () => {
    const spy = undiciFetchMock.mockResolvedValue(new Response('ok'));
    await fetcher.fetch('http://93.184.216.34/');
    const [, opts] = spy.mock.calls[0]!;
    expect((opts as { redirect?: string }).redirect).toBe('error');
  });

  it('pins the real connection to the SAME address the SSRF guard validated, via a custom dispatcher lookup (DNS-rebinding guard)', async () => {
    // Regression test for the TOCTOU gap: without pinning, the real fetch
    // would re-resolve `hostname` independently, so a rebinding DNS server
    // could return a public address here and a private one at connect time.
    const spy = undiciFetchMock.mockResolvedValue(new Response('ok'));
    await fetcher.fetch('http://93.184.216.34/');
    const [, opts] = spy.mock.calls[0]!;
    const dispatcher = (opts as { dispatcher?: { constructor: { name: string } } }).dispatcher;
    expect(dispatcher).toBeDefined();
    expect(dispatcher!.constructor.name).toBe('Agent');
  });
});
