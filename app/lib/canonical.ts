/**
 * Canonical URL = the dedup key for a story. Two URLs that describe the same
 * story (e.g. an IGN article in the RSS feed vs. a Reddit post linking to it
 * with utm_source attached) must produce the same canonical form.
 *
 * Rules:
 *  - lowercase host
 *  - strip leading "www."
 *  - drop tracking query params (utm_*, fbclid, ref, gclid, mc_*, _ga, igshid)
 *  - sort remaining params for stable ordering
 *  - remove trailing slash on the path (but keep "/" for root)
 *  - drop URL fragment (#...)
 *  - drop default ports (80, 443)
 *
 * This is intentionally NOT a full URL normalizer (we don't unicode-normalize
 * hostnames, don't follow redirects). It just has to be deterministic and
 * stable enough that the same story from two sources collapses to one row.
 */

const TRACKING_PARAM_PREFIXES = ["utm_", "mc_"];
const TRACKING_PARAM_NAMES = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "ref",
  "ref_src",
  "ref_url",
  "igshid",
  "_ga",
  "_gl",
  "yclid",
  "share",
  "shared",
]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (TRACKING_PARAM_NAMES.has(lower)) return true;
  for (const prefix of TRACKING_PARAM_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Returns the canonical form of `raw`, or null if it doesn't look like a URL
 * we can canonicalize (relative, malformed, non-http(s) scheme).
 */
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  // Hostname
  let host = u.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  // Port — drop defaults
  let portSegment = "";
  if (u.port && !((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443"))) {
    portSegment = `:${u.port}`;
  }

  // Path — strip trailing slash unless it's the root
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  // Query — filter tracking, sort the rest for stable order
  const params: [string, string][] = [];
  u.searchParams.forEach((v, k) => {
    if (!isTrackingParam(k)) params.push([k, v]);
  });
  params.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const query = params.length
    ? "?" + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : "";

  return `${u.protocol}//${host}${portSegment}${path}${query}`;
}

/**
 * Convenience: returns the canonical URL's lowercased host (or null). Used
 * for matching stories to seeded `sources` by domain.
 */
export function canonicalHost(raw: string | null | undefined): string | null {
  const c = canonicalizeUrl(raw);
  if (!c) return null;
  try {
    return new URL(c).hostname;
  } catch {
    return null;
  }
}
