export enum AuthCookieName {
  ACCESS = 'access_token',
  REFRESH = 'refresh_token',
  CSRF = 'csrf_token',
}

export enum AuthExpiryUnit {
  SECOND = 's',
  MINUTE = 'm',
  HOUR = 'h',
  DAY = 'd',
  WEEK = 'w',
}

export enum AuthCookiePath {
  ROOT = '/',
  AUTH = '/api/v1/auth',
}

export enum AuthCookieSameSite {
  LAX = 'lax',
  STRICT = 'strict',
}

export enum RefreshTokenFamilyRevocationReason {
  LOGOUT = 'logout',
  IMPERSONATION_ENDED = 'impersonation_ended',
  REPLAY_DETECTED = 'replay_detected',
}
