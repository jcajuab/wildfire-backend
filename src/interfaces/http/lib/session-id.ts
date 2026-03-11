export const extractSessionId = (payload: {
  sid?: string;
  jti?: string;
  sub: string;
  iat?: number;
}): string | undefined => {
  if (payload.sid) {
    return payload.sid;
  }
  if (payload.jti) {
    return payload.jti;
  }
  if (payload.iat) {
    return `${payload.sub}:${payload.iat}`;
  }
  return undefined;
};
