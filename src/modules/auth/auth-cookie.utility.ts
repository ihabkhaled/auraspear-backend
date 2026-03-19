import { randomBytes } from 'node:crypto'
import type { CookieOptions, Response } from 'express'

export const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000
export const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production'
}

function buildBaseCookieOptions(): Pick<CookieOptions, 'secure'> {
  return {
    secure: isProduction(),
  }
}

export function setAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string
): void {
  const baseOptions = buildBaseCookieOptions()

  response.cookie('access_token', accessToken, {
    ...baseOptions,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  })

  response.cookie('refresh_token', refreshToken, {
    ...baseOptions,
    httpOnly: true,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  })
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie('access_token', { path: '/' })
  response.clearCookie('refresh_token', { path: '/api/v1/auth' })
  response.clearCookie('csrf_token', { path: '/' })
}

export function issueCsrfToken(response: Response): string {
  const csrfToken = randomBytes(32).toString('hex')
  const baseOptions = buildBaseCookieOptions()

  response.cookie('csrf_token', csrfToken, {
    ...baseOptions,
    httpOnly: false,
    sameSite: 'strict',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  })

  return csrfToken
}
