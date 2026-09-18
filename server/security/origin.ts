/**
 * Check a browser Origin against the configured application origin.
 *
 * Local development commonly uses either localhost or 127.0.0.1 for the
 * same Vite server. Treat those loopback aliases as equivalent while keeping
 * protocol and port checks strict. Public/production origins still require an
 * exact match.
 */
export const isTrustedOrigin = (origin: string, appOrigin: string): boolean => {
  if (origin === appOrigin) return true;

  try {
    const actual = new URL(origin);
    const expected = new URL(appOrigin);
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return (
      loopbackHosts.has(actual.hostname) &&
      loopbackHosts.has(expected.hostname) &&
      actual.protocol === expected.protocol &&
      actual.port === expected.port
    );
  } catch {
    return false;
  }
};
