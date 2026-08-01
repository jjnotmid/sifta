import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import https from 'node:https';
import dns from 'node:dns';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

/**
 * Public resolvers used when the system resolver cannot answer.
 *
 * OFAC's Sanctions List Service 302s to an S3 bucket in the us-gov-west-1
 * region. Some ISP and mobile-hotspot resolvers fail to resolve that hostname
 * (observed: NXDOMAIN on the build machine's connection while 1.1.1.1 answered
 * fine). Without this fallback `npm run ingest:ofac` dies with a bare
 * ENOTFOUND on an otherwise working internet connection.
 */
const FALLBACK_DNS = ['1.1.1.1', '8.8.8.8'];

/**
 * dns.lookup with a public-resolver fallback on NXDOMAIN/EAI_AGAIN.
 *
 * On the error paths the address argument is a placeholder: Node's
 * `LookupFunction` types it as required, and every consumer checks `err`
 * before reading it.
 */
const resilientLookup: LookupFunction = (hostname, options, callback) => {
  const fail = (err: NodeJS.ErrnoException): void => {
    (callback as (e: NodeJS.ErrnoException, a: string | LookupAddress[], f?: number) => void)(
      err,
      '',
      4,
    );
  };

  dns.lookup(hostname, options as dns.LookupOneOptions, (err, address, family) => {
    if (!err) {
      callback(null, address, family);
      return;
    }
    const resolver = new dns.promises.Resolver();
    resolver.setServers(FALLBACK_DNS);
    resolver
      .resolve4(hostname)
      .then((addresses) => {
        const first = addresses[0];
        if (!first) {
          fail(err);
          return;
        }
        callback(null, first, 4);
      })
      .catch(() => fail(err));
  });
};

export interface DownloadOptions {
  /** Skip the download when the destination already exists. */
  useCache?: boolean;
  maxRedirects?: number;
  onProgress?: (bytes: number) => void;
}

/**
 * Download a URL to a path, following redirects.
 *
 * Writes to `<dest>.part` and renames on success, so an interrupted transfer
 * can never leave a truncated file that later looks like a valid cached
 * download. (We learned this the expensive way with the CockroachDB binary.)
 */
export async function downloadTo(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<{ path: string; bytes: number; cached: boolean }> {
  const { useCache = true, maxRedirects = 10 } = options;

  if (useCache) {
    const existing = await stat(dest).catch(() => null);
    if (existing?.isFile() && existing.size > 0) {
      return { path: dest, bytes: existing.size, cached: true };
    }
  }

  await mkdir(dirname(dest), { recursive: true });
  const partial = `${dest}.part`;

  const response = await get(url, maxRedirects);
  let bytes = 0;
  response.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    options.onProgress?.(bytes);
  });

  await pipeline(response, createWriteStream(partial));
  await rename(partial, dest);
  return { path: dest, bytes, cached: false };
}

function get(url: string, redirectsLeft: number): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft < 0) {
      reject(new Error(`too many redirects fetching ${url}`));
      return;
    }
    const request = https.get(
      url,
      {
        lookup: resilientLookup,
        headers: {
          // The service returns 403 to clients with no user agent.
          'user-agent': 'sifta-ingest/0.1 (+https://github.com/jjnotmid/sifta)',
          accept: '*/*',
        },
        timeout: 120_000,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume(); // drain so the socket can be reused
          resolve(get(new URL(location, url).toString(), redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`GET ${url} returned HTTP ${status}`));
          return;
        }
        resolve(res);
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error(`timed out fetching ${url}`));
    });
    request.on('error', reject);
  });
}
