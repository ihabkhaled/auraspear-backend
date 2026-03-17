import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import * as jwt from 'jsonwebtoken'
import { AuthRepository } from './auth.repository'
import {
  buildPayloadFromMembership,
  computeRemainingTtl,
  mapMembershipsToTenantInfos,
  preserveImpersonationClaims,
} from './auth.utilities'
import { TokenBlacklistService } from './token-blacklist.service'
import { AppLogFeature, AppLogOutcome, AppLogSourceType, TokenType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { MembershipStatus, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { RoleSettingsService } from '../role-settings/role-settings.service'
import type { TenantMembershipInfo } from './auth.utilities'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

// Pre-computed bcrypt hash (cost 12) used for constant-time comparison when user doesn't exist.
// Generated via: bcrypt.hash('dummy-never-matches', 12)
const DUMMY_BCRYPT_HASH = '$2b$12$mffuEnbgz2XglaCwSv1EFOwnXT8DaW5/CIE60E5/07DiN4b6Ncvxi'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private readonly jwtSecret: string
  private readonly accessExpiry: jwt.SignOptions['expiresIn']
  private readonly refreshExpiry: jwt.SignOptions['expiresIn']

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly appLogger: AppLoggerService,
    private readonly roleSettingsService: RoleSettingsService
  ) {
    const secret = this.configService.get<string>('JWT_SECRET')
    if (!secret || secret.length < 64 || !/^[\da-f]+$/i.test(secret)) {
      throw new Error('JWT_SECRET must be at least 64 hex characters (32 bytes)')
    }
    this.jwtSecret = secret
    this.accessExpiry = this.configService.get<string>(
      'JWT_ACCESS_EXPIRY',
      '15m'
    ) as jwt.SignOptions['expiresIn']
    this.refreshExpiry = this.configService.get<string>(
      'JWT_REFRESH_EXPIRY',
      '7d'
    ) as jwt.SignOptions['expiresIn']
  }

  /* ---------------------------------------------------------------- */
  /* LOGIN                                                             */
  /* ---------------------------------------------------------------- */

  async login(
    email: string,
    password: string
  ): Promise<{
    accessToken: string
    refreshToken: string
    user: JwtPayload
    permissions: string[]
    tenants: TenantMembershipInfo[]
  }> {
    const user = await this.authRepository.findUserByEmailWithMemberships(
      email,
      MembershipStatus.ACTIVE
    )
    const hashToCompare = user?.passwordHash ?? DUMMY_BCRYPT_HASH
    const valid = await bcrypt.compare(password, hashToCompare)

    if (!user?.passwordHash || !valid) {
      this.logWarn('login', { actorEmail: email })
      throw new BusinessException(
        401,
        'Invalid email or password',
        'errors.auth.invalidCredentials'
      )
    }

    const firstMembership = this.getFirstMembershipOrThrow(user, 'login')
    await this.authRepository.updateLastLogin(user.id)

    const payload = buildPayloadFromMembership(user, firstMembership)
    const permissions = await this.roleSettingsService.getUserPermissions(
      firstMembership.tenantId,
      firstMembership.role
    )
    this.logSuccess('login', {
      actorEmail: user.email,
      actorUserId: user.id,
      tenantId: firstMembership.tenantId,
    })
    return {
      accessToken: this.signAccessToken(payload),
      refreshToken: this.signRefreshToken(payload),
      user: payload,
      permissions,
      tenants: mapMembershipsToTenantInfos(user.memberships),
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET USER PERMISSIONS                                              */
  /* ---------------------------------------------------------------- */

  async getPermissions(tenantId: string, role: string): Promise<string[]> {
    return this.roleSettingsService.getUserPermissions(tenantId, role)
  }

  /* ---------------------------------------------------------------- */
  /* TOKEN SIGNING                                                     */
  /* ---------------------------------------------------------------- */

  signAccessToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, jti: _jti, ...clean } = payload
    return jwt.sign({ ...clean, jti: randomUUID(), tokenType: TokenType.ACCESS }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.accessExpiry,
    })
  }

  signRefreshToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, jti: _jti, ...clean } = payload
    return jwt.sign({ ...clean, jti: randomUUID(), tokenType: TokenType.REFRESH }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.refreshExpiry,
    })
  }

  /* ---------------------------------------------------------------- */
  /* TOKEN VERIFICATION                                                */
  /* ---------------------------------------------------------------- */

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.verifyToken(
      token,
      TokenType.ACCESS,
      'verifyAccessToken',
      'errors.auth.invalidAccessToken'
    )
  }

  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    return this.verifyToken(
      token,
      TokenType.REFRESH,
      'verifyRefreshToken',
      'errors.auth.invalidRefreshToken'
    )
  }

  /* ---------------------------------------------------------------- */
  /* REFRESH TOKENS                                                    */
  /* ---------------------------------------------------------------- */

  async refreshTokens(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await this.verifyRefreshToken(refreshToken)
    await this.blacklistTokenIfPresent(payload)

    const user = await this.authRepository.findUserByIdWithTenantMemberships(
      payload.sub,
      payload.tenantId,
      MembershipStatus.ACTIVE
    )
    if (!user) {
      this.logWarn('refreshTokens', { actorUserId: payload.sub })
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }

    const membership = this.getFirstMembershipOrThrow(user, 'refreshTokens')
    const newPayload = buildPayloadFromMembership(user, membership)
    preserveImpersonationClaims(newPayload, payload)

    this.logSuccess('refreshTokens', {
      actorEmail: user.email,
      actorUserId: user.id,
      tenantId: membership.tenantId,
    })
    return {
      accessToken: this.signAccessToken(newPayload),
      refreshToken: this.signRefreshToken(newPayload),
    }
  }

  /* ---------------------------------------------------------------- */
  /* LOGOUT                                                            */
  /* ---------------------------------------------------------------- */

  async logout(
    accessJti: string,
    refreshJti: string,
    accessExp: number,
    refreshExp: number
  ): Promise<void> {
    await Promise.all([
      this.tokenBlacklistService.blacklist(accessJti, computeRemainingTtl(accessExp)),
      this.tokenBlacklistService.blacklist(refreshJti, computeRemainingTtl(refreshExp)),
    ])
    this.logSuccess('logout')
  }

  /* ---------------------------------------------------------------- */
  /* VALIDATE USER ACTIVE                                              */
  /* ---------------------------------------------------------------- */

  async validateUserActive(userId: string): Promise<void> {
    const user = await this.authRepository.findUserByIdWithActiveMembershipCheck(
      userId,
      MembershipStatus.ACTIVE
    )
    if (!user) {
      this.logWarn('validateUserActive', { actorUserId: userId })
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }
    if (user.memberships.length === 0) {
      this.logWarn('validateUserActive', { actorUserId: userId })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
  }

  async validateMembershipActive(userId: string, tenantId: string): Promise<void> {
    const membership = await this.authRepository.findMembershipByUserAndTenant(userId, tenantId)
    if (membership?.status !== MembershipStatus.ACTIVE) {
      this.logDenied('validateMembershipActive', { actorUserId: userId, tenantId })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
  }

  /* ---------------------------------------------------------------- */
  /* GET USER TENANTS                                                  */
  /* ---------------------------------------------------------------- */

  async getUserTenants(userId: string): Promise<TenantMembershipInfo[]> {
    const memberships = await this.authRepository.findActiveMembershipsWithTenant(
      userId,
      MembershipStatus.ACTIVE
    )
    this.logSuccess('getUserTenants', {
      actorUserId: userId,
      metadata: { tenantCount: memberships.length },
    })
    return mapMembershipsToTenantInfos(memberships)
  }

  /* ---------------------------------------------------------------- */
  /* END IMPERSONATION                                                 */
  /* ---------------------------------------------------------------- */

  async endImpersonation(
    caller: JwtPayload
  ): Promise<{ accessToken: string; refreshToken: string; user: JwtPayload }> {
    if (caller.isImpersonated !== true || !caller.impersonatorSub) {
      this.logDenied('endImpersonation', { userId: caller.sub, email: caller.email })
      throw new BusinessException(
        400,
        'Not currently impersonating',
        'errors.impersonation.notImpersonating'
      )
    }

    await this.blacklistTokenIfPresent(caller)

    const admin = await this.authRepository.findUserByIdWithAllActiveMemberships(
      caller.impersonatorSub,
      MembershipStatus.ACTIVE
    )
    if (!admin) {
      this.logWarn('endImpersonation', { impersonatorSub: caller.impersonatorSub })
      throw new BusinessException(
        401,
        'Original admin user no longer exists',
        'errors.auth.userNotFound'
      )
    }

    const firstMembership = this.getFirstMembershipOrThrow(admin, 'endImpersonation')
    const adminPayload = buildPayloadFromMembership(admin, firstMembership)

    this.logSuccess('endImpersonation', {
      actorEmail: admin.email,
      actorUserId: admin.id,
      metadata: { impersonatedEmail: caller.email, impersonatedUserId: caller.sub },
    })
    return {
      accessToken: this.signAccessToken(adminPayload),
      refreshToken: this.signRefreshToken(adminPayload),
      user: adminPayload,
    }
  }

  /* ---------------------------------------------------------------- */
  /* FIND OR CREATE USER (OIDC)                                        */
  /* ---------------------------------------------------------------- */

  async findOrCreateUser(
    tenantId: string,
    oidcSub: string,
    email: string,
    name: string
  ): Promise<{ id: string; role: UserRole }> {
    try {
      const user = await this.authRepository.upsertUserByOidcSub(oidcSub, email, name)
      const membership = await this.authRepository.upsertTenantMembership(
        user.id,
        tenantId,
        UserRole.SOC_ANALYST_L1
      )
      this.logSuccess('findOrCreateUser', {
        actorUserId: user.id,
        actorEmail: email,
        tenantId,
        metadata: { role: membership.role },
      })
      return { id: user.id, role: membership.role as UserRole }
    } catch (error) {
      this.logger.error('Failed to upsert user', error)
      this.logError('findOrCreateUser', { actorEmail: email, tenantId, error })
      throw new BusinessException(401, 'Unable to provision user', 'errors.auth.provisionFailed')
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Helpers                                                  */
  /* ---------------------------------------------------------------- */

  private getFirstMembershipOrThrow(
    user: {
      id: string
      email: string
      memberships: Array<{
        tenantId: string
        role: string
        tenant: { id: string; name: string; slug: string }
      }>
    },
    action: string
  ): { tenantId: string; role: string; tenant: { id: string; name: string; slug: string } } {
    if (user.memberships.length === 0) {
      this.logWarn(action, { actorEmail: user.email, actorUserId: user.id })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
    const first = user.memberships[0]
    if (!first) {
      this.logWarn(action, { userId: user.id, email: user.email })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
    return first
  }

  private async verifyToken(
    token: string,
    expectedType: string,
    action: string,
    errorKey: string
  ): Promise<JwtPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
        clockTolerance: 30,
      }) as JwtPayload & { tokenType?: string }
      if (decoded.tokenType !== expectedType) throw new Error(`Not a ${expectedType} token`)

      if (decoded.jti) {
        const revoked = await this.tokenBlacklistService.isBlacklisted(decoded.jti)
        if (revoked) {
          throw new BusinessException(401, 'Token has been revoked', 'errors.auth.tokenRevoked')
        }
      }
      return decoded
    } catch (error) {
      if (error instanceof BusinessException) throw error
      this.logWarn(action, { error: error instanceof Error ? error.message : 'Unknown error' })
      throw new BusinessException(401, `Invalid or expired ${expectedType} token`, errorKey)
    }
  }

  private async blacklistTokenIfPresent(payload: JwtPayload): Promise<void> {
    if (payload.jti && payload.exp) {
      await this.tokenBlacklistService.blacklist(payload.jti, computeRemainingTtl(payload.exp))
    }
  }

  /* ---------------------------------------------------------------- */
  /* PRIVATE: Logging                                                  */
  /* ---------------------------------------------------------------- */

  private logSuccess(action: string, extra?: Record<string, unknown>): void {
    this.appLogger.info(`Auth ${action}`, {
      feature: AppLogFeature.AUTH,
      action,
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: action,
      ...extra,
    })
  }

  private logWarn(action: string, extra?: Record<string, unknown>): void {
    this.appLogger.warn(`Auth ${action} failed`, {
      feature: AppLogFeature.AUTH,
      action,
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: action,
      ...extra,
    })
  }

  private logDenied(action: string, extra?: Record<string, unknown>): void {
    this.appLogger.warn(`Auth ${action} denied`, {
      feature: AppLogFeature.AUTH,
      action,
      outcome: AppLogOutcome.DENIED,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: action,
      ...extra,
    })
  }

  private logError(action: string, extra?: Record<string, unknown>): void {
    this.appLogger.error(`Auth ${action} error`, {
      feature: AppLogFeature.AUTH,
      action,
      outcome: AppLogOutcome.FAILURE,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: action,
      stackTrace: extra?.['error'] instanceof Error ? (extra['error'] as Error).stack : undefined,
      ...extra,
    })
  }
}
