export const resolveClientIp = (input: {
  headers: {
    forwardedFor?: string;
    realIp?: string;
    cfConnectingIp?: string;
    xClientIp?: string;
    forwarded?: string;
    remoteIp?: string;
  };
  trustProxyHeaders?: boolean;
  fallback?: string;
}): string => {
  const fallbackIp = input.fallback ?? "unknown";

  const pickIp = (value?: string): string | undefined => {
    if (!value) {
      return undefined;
    }
    const first = value.split(",")[0]?.trim();
    if (!first || first === "unknown") {
      return undefined;
    }
    return first;
  };

  if (input.trustProxyHeaders) {
    const byForwardedFor = pickIp(input.headers.forwardedFor);
    if (byForwardedFor) return byForwardedFor;

    const byRealIp = pickIp(input.headers.realIp);
    if (byRealIp) return byRealIp;

    const byCfIp = pickIp(input.headers.cfConnectingIp);
    if (byCfIp) return byCfIp;

    const byXClientIp = pickIp(input.headers.xClientIp);
    if (byXClientIp) return byXClientIp;

    const byForwarded = pickIp(input.headers.forwarded);
    if (byForwarded) return byForwarded;
  }

  return pickIp(input.headers.remoteIp) ?? fallbackIp;
};
