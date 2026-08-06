import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpUrlFetcher } from '../src/adapters/url-fetcher/http.js';
import { ValidationError } from '../src/platform/errors.js';

/**
 * The SSRF guard for the skills import-from-URL flow. Rejection paths never
 * touch the network (IP-literal hostnames skip DNS, scheme checks are pure) —
 * deterministic, no real fetch. The one "allowed" case mocks global `fetch`
 * rather than hitting the network, per this repo's no-real-network test rule.
 */
describe('HttpUrlFetcher (SSRF guard)', () => {
  const fetcher = new HttpUrlFetcher();

  afterEach(() => {
    vi.restoreAllMocks();
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
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await fetcher.fetch('http://172.15.0.1/');
    await fetcher.fetch('http://172.32.0.1/');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('allows a public IP-literal http(s) URL through to the real fetch call (mocked, no network)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('# ok', { status: 200 }));
    const res = await fetcher.fetch('http://93.184.216.34/skill.md');
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      'http://93.184.216.34/skill.md',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('does not follow redirects (redirect: "error" is passed to the real fetch)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    await fetcher.fetch('http://93.184.216.34/');
    const [, opts] = spy.mock.calls[0]!;
    expect((opts as RequestInit).redirect).toBe('error');
  });
});
