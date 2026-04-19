export const TRUSTED_OAUTH_API_BASE = 'https://api-pdrd3q42fa-uc.a.run.app';

export function buildTrustedOauthCompleteUrl() {
  return new URL('/oauth/authorize/complete', TRUSTED_OAUTH_API_BASE).toString();
}
