import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RefreshTokenFamilyStatus, RefreshTokenRotationStatus } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import * as jwt from 'jsonwebtoken'
import { createDefaultAuthSessionContext } from './auth-session.utilities'
import { DUMMY_BCRYPT_HASH, JWT_CLOCK_TOLERANCE_SECONDS } from './auth.constants'
import { RefreshTokenFamilyRevocationReason } from './auth.enums'
import { AuthRepository } from './auth.repository'
import {
  buildPayloadFromMembership,
  buildExpiryDateFromSeconds,
  computeRemainingTtl,
  computeRemainingTtlFromDate,
  hashTokenIdentifier,
  mapMembershipsToTenantInfos,
  parseExpiryToSeconds,
  preserveImpersonationClaims,
} from './auth.utilities'
import { TokenBlacklistService } from './token-blacklist.service'
import {
  AppLogFeature,
  AppLogOutcome,
  AppLogSourceType,
  TokenType,
  UserSessionStatus,
} from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { MembershipStatus, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { RoleSettingsService } from '../role-settings/role-settings.service'
import type {
  AuthSessionContext,
  AuthorizedTenantContext,
  IssuedAccessToken,
  IssuedRefreshToken,
  IssuedSessionTokens,
  MembershipWithTenant,
  RefreshRotationWithFamily,
  SessionRevocationTarget,
  TenantMembershipInfo,
  UserWithMemberships,
} from './auth.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

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

  async login(
    email: string,
    password: string,
    sessionContext?: AuthSessionContext
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
    const session = await this.issueSession(
      user.id,
      firstMembership.tenantId,
      payload,
      sessionContext
    )

    this.logSuccess('login', {
      actorEmail: user.email,
      actorUserId: user.id,
      tenantId: firstMembership.tenantId,
    })

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: payload,
      permissions,
      tenants: mapMembershipsToTenantInfos(user.memberships),
    }
  }

  async getPermissions(tenantId: string, role: string): Promise<string[]> {
    return this.roleSettingsService.getUserPermissions(tenantId, role)
  }

  async issueSession(
    userId: string,
    tenantId: string,
    payload: JwtPayload,
    sessionContext?: AuthSessionContext
  ): Promise<IssuedSessionTokens> {
    const issuedRefresh = this.issueRefreshToken(payload)
    const issuedAccess = this.issueAccessTokenBundle({
      ...payload,
      family: issuedRefresh.family,
    })
    await this.createRefreshSession(
      userId,
      tenantId,
      issuedRefresh,
      issuedAccess,
      sessionContext ?? createDefaultAuthSessionContext()
    )

    return {
      accessToken: issuedAccess.accessToken,
      refreshToken: issuedRefresh.refreshToken,
    }
  }

  signAccessToken(payload: JwtPayload): string {
    return this.issueAccessTokenBundle(payload).accessToken
  }

  signRefreshToken(payload: JwtPayload, family?: string, generation?: number): string {
    return this.issueRefreshToken(payload, family, generation).refreshToken
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    return this.verifyToken(
      token,
      TokenType.ACCESS,
      'verifyAccessToken',
      'errors.auth.invalidAccessToken',
      true
    )
  }

  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    return this.verifyToken(
      token,
      TokenType.REFRESH,
      'verifyRefreshToken',
      'errors.auth.invalidRefreshToken',
      true
    )
  }

  async refreshTokens(
    refreshToken: string,
    requestedTenantId?: string,
    sessionContext?: AuthSessionContext
  ): Promise<IssuedSessionTokens> {
    const payload = await this.verifyRefreshToken(refreshToken)
    const rotation = await this.getRefreshRotationOrThrow(payload)
    await this.assertRefreshRotationCurrent(payload, rotation)

    const user = await this.authRepository.findUserByIdWithAllActiveMemberships(
      payload.sub,
      MembershipStatus.ACTIVE
    )
    if (!user) {
      this.logWarn('refreshTokens', { actorUserId: payload.sub })
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }
    if (user.memberships.length === 0) {
      this.logWarn('refreshTokens', { actorUserId: payload.sub })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    const membership = this.resolveRefreshMembership(user, payload, requestedTenantId)
    const nextPayload = buildPayloadFromMembership(user, membership)
    preserveImpersonationClaims(nextPayload, payload)

    const issuedRefresh = this.issueRefreshToken(
      nextPayload,
      rotation.family.id,
      rotation.generation + 1
    )
    const issuedAccess = this.issueAccessTokenBundle({
      ...nextPayload,
      family: rotation.family.id,
    })
    const rotateResult = await this.authRepository.rotateRefreshTokenFamily({
      familyId: rotation.family.id,
      expectedGeneration: rotation.generation,
      previousRotationId: rotation.id,
      nextJtiHash: hashTokenIdentifier(issuedRefresh.jti),
      nextExpiresAt: issuedRefresh.expiresAt,
      nextGeneration: issuedRefresh.generation,
      rotatedAt: new Date(),
      tenantId: membership.tenantId,
      currentAccessJti: issuedAccess.jti,
      currentAccessExpiresAt: issuedAccess.expiresAt,
      context: sessionContext ?? createDefaultAuthSessionContext(),
    })

    if (rotateResult.familyAdvanceCount === 0 || rotateResult.newRotation === null) {
      await this.handleRefreshReplay(rotation)
    }

    await this.blacklistTokenIfPresent(payload)

    this.logSuccess('refreshTokens', {
      actorEmail: user.email,
      actorUserId: user.id,
      tenantId: membership.tenantId,
      metadata: {
        requestedTenantId: requestedTenantId ?? membership.tenantId,
        family: rotation.family.id,
        generation: issuedRefresh.generation,
      },
    })

    return {
      accessToken: issuedAccess.accessToken,
      refreshToken: issuedRefresh.refreshToken,
    }
  }

  async logout(
    accessJti: string,
    refreshJti: string,
    accessExp: number,
    refreshExp: number,
    family?: string,
    actorUserId?: string
  ): Promise<void> {
    const blacklistTasks: Promise<void>[] = [
      this.tokenBlacklistService.blacklist(accessJti, computeRemainingTtl(accessExp)),
      this.tokenBlacklistService.blacklist(refreshJti, computeRemainingTtl(refreshExp)),
    ]

    if (family) {
      blacklistTasks.push(
        this.authRepository.revokeRefreshTokenFamily(
          family,
          RefreshTokenFamilyRevocationReason.LOGOUT,
          new Date(),
          undefined,
          actorUserId
        )
      )
    }

    await Promise.all(blacklistTasks)
    this.logSuccess('logout', { metadata: { family } })
  }

  async performLogout(accessUser: JwtPayload | undefined, refreshToken: string): Promise<void> {
    if (!accessUser?.jti || !accessUser?.exp) {
      throw new BusinessException(
        401,
        'Access token missing required claims',
        'errors.auth.invalidAccessToken'
      )
    }

    const refreshPayload = await this.verifyRefreshToken(refreshToken)
    if (!refreshPayload.jti || !refreshPayload.exp) {
      throw new BusinessException(
        401,
        'Refresh token missing required claims',
        'errors.auth.invalidRefreshToken'
      )
    }

    if (refreshPayload.sub !== accessUser.sub) {
      throw new BusinessException(
        403,
        'Refresh token does not belong to this user',
        'errors.auth.tokenMismatch'
      )
    }

    await this.logout(
      accessUser.jti,
      refreshPayload.jti,
      accessUser.exp,
      refreshPayload.exp,
      typeof refreshPayload.family === 'string' ? refreshPayload.family : undefined,
      accessUser.sub
    )
  }

  resolveRefreshToken(cookieToken: string | undefined, bodyToken: string | undefined): string {
    const refreshToken = bodyToken ?? cookieToken

    if (!refreshToken) {
      throw new BusinessException(
        400,
        'Refresh token is required',
        'errors.auth.refreshTokenRequired'
      )
    }

    return refreshToken
  }

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

  async resolveAuthorizedTenantContext(
    payload: JwtPayload,
    requestedTenantId?: string
  ): Promise<AuthorizedTenantContext> {
    const memberships = await this.authRepository.findActiveMembershipsWithTenant(
      payload.sub,
      MembershipStatus.ACTIVE
    )

    if (memberships.length === 0) {
      this.logDenied('resolveAuthorizedTenantContext', {
        actorUserId: payload.sub,
        requestedTenantId,
      })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    const targetTenantId = requestedTenantId ?? payload.tenantId
    const targetMembership = memberships.find(item => item.tenantId === targetTenantId)

    if (targetMembership) {
      return {
        tenantId: targetMembership.tenantId,
        tenantSlug: targetMembership.tenant.slug,
        role: targetMembership.role as UserRole,
      }
    }

    const isGlobalAdmin = memberships.some(item => item.role === UserRole.GLOBAL_ADMIN)
    if (!isGlobalAdmin) {
      this.logDenied('resolveAuthorizedTenantContext', {
        actorUserId: payload.sub,
        requestedTenantId: targetTenantId,
      })
      throw new BusinessException(403, 'No access to this tenant', 'errors.auth.noTenantAccess')
    }

    const tenant = await this.authRepository.findTenantById(targetTenantId)
    if (!tenant) {
      this.logDenied('resolveAuthorizedTenantContext', {
        actorUserId: payload.sub,
        requestedTenantId: targetTenantId,
      })
      throw new BusinessException(400, 'Invalid tenant ID', 'errors.tenants.notFound')
    }

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      role: UserRole.GLOBAL_ADMIN,
    }
  }

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

  async endImpersonation(
    caller: JwtPayload,
    sessionContext?: AuthSessionContext
  ): Promise<{ accessToken: string; refreshToken: string; user: JwtPayload }> {
    if (caller.isImpersonated !== true || !caller.impersonatorSub) {
      this.logDenied('endImpersonation', { actorUserId: caller.sub, actorEmail: caller.email })
      throw new BusinessException(
        400,
        'Not currently impersonating',
        'errors.impersonation.notImpersonating'
      )
    }

    await this.blacklistTokenIfPresent(caller)

    if (caller.family) {
      await this.authRepository.revokeRefreshTokenFamily(
        caller.family,
        RefreshTokenFamilyRevocationReason.IMPERSONATION_ENDED,
        new Date(),
        undefined,
        caller.impersonatorSub
      )
    }

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
    const session = await this.issueSession(
      admin.id,
      firstMembership.tenantId,
      adminPayload,
      sessionContext
    )

    this.logSuccess('endImpersonation', {
      actorEmail: admin.email,
      actorUserId: admin.id,
      metadata: { impersonatedUserId: caller.sub, impersonatedEmail: caller.email },
    })

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      user: adminPayload,
    }
  }

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

  private issueAccessTokenBundle(payload: JwtPayload): IssuedAccessToken {
    const { iat: _iat, exp: _exp, jti: _jti, generation: _generation, ...clean } = payload

    const tokenJti = randomUUID()

    return {
      accessToken: jwt.sign(
        { ...clean, jti: tokenJti, tokenType: TokenType.ACCESS },
        this.jwtSecret,
        {
          algorithm: 'HS256',
          expiresIn: this.accessExpiry,
        }
      ),
      jti: tokenJti,
      expiresAt: buildExpiryDateFromSeconds(parseExpiryToSeconds(String(this.accessExpiry))),
    }
  }

  private issueRefreshToken(
    payload: JwtPayload,
    family?: string,
    generation?: number
  ): IssuedRefreshToken {
    const tokenFamily = family ?? randomUUID()
    const tokenGeneration = generation ?? 0
    const tokenJti = randomUUID()
    const {
      iat: _iat,
      exp: _exp,
      jti: _jti,
      family: _family,
      generation: _generation,
      ...clean
    } = payload

    return {
      refreshToken: jwt.sign(
        {
          ...clean,
          jti: tokenJti,
          tokenType: TokenType.REFRESH,
          family: tokenFamily,
          generation: tokenGeneration,
        },
        this.jwtSecret,
        {
          algorithm: 'HS256',
          expiresIn: this.refreshExpiry,
        }
      ),
      family: tokenFamily,
      generation: tokenGeneration,
      jti: tokenJti,
      expiresAt: buildExpiryDateFromSeconds(parseExpiryToSeconds(String(this.refreshExpiry))),
    }
  }

  private async createRefreshSession(
    userId: string,
    tenantId: string,
    refreshToken: IssuedRefreshToken,
    accessToken: IssuedAccessToken,
    sessionContext: AuthSessionContext
  ): Promise<void> {
    const issuedAt = new Date()

    await this.authRepository.createRefreshTokenFamily({
      id: refreshToken.family,
      userId,
      tenantId,
      currentGeneration: refreshToken.generation,
      expiresAt: refreshToken.expiresAt,
    })
    await this.authRepository.createRefreshTokenRotation({
      familyId: refreshToken.family,
      generation: refreshToken.generation,
      jtiHash: hashTokenIdentifier(refreshToken.jti),
      expiresAt: refreshToken.expiresAt,
    })
    await this.authRepository.createUserSession({
      familyId: refreshToken.family,
      userId,
      tenantId,
      lastLoginAt: issuedAt,
      currentAccessJti: accessToken.jti,
      currentAccessExpiresAt: accessToken.expiresAt,
      context: sessionContext,
    })
  }

  async touchSessionActivity(
    payload: JwtPayload,
    tenantId: string,
    sessionContext: AuthSessionContext
  ): Promise<void> {
    if (typeof payload.family !== 'string') {
      return
    }

    const updatedCount = await this.authRepository.touchUserSession({
      familyId: payload.family,
      tenantId,
      touchedAt: new Date(),
      currentAccessJti: payload.jti,
      currentAccessExpiresAt: payload.exp === undefined ? undefined : new Date(payload.exp * 1000),
      context: sessionContext,
    })

    if (updatedCount > 0) {
      return
    }

    const session = await this.authRepository.findUserSessionByFamilyId(payload.family)
    if (!session) {
      return
    }

    if (session.status !== UserSessionStatus.ACTIVE) {
      throw new BusinessException(401, 'Session has been revoked', 'errors.auth.sessionRevoked')
    }
  }

  async revokeSessionTargets(
    targets: SessionRevocationTarget[],
    reason: RefreshTokenFamilyRevocationReason,
    revokedByUserId?: string
  ): Promise<number> {
    if (targets.length === 0) {
      return 0
    }

    const tasks: Promise<void>[] = []

    for (const target of targets) {
      if (target.currentAccessJti && target.currentAccessExpiresAt) {
        tasks.push(
          this.tokenBlacklistService.blacklist(
            target.currentAccessJti,
            computeRemainingTtlFromDate(target.currentAccessExpiresAt)
          )
        )
      }

      tasks.push(
        this.authRepository.revokeRefreshTokenFamily(
          target.familyId,
          reason,
          new Date(),
          undefined,
          revokedByUserId
        )
      )
    }

    await Promise.all(tasks)

    return targets.length
  }

  private async getRefreshRotationOrThrow(payload: JwtPayload): Promise<RefreshRotationWithFamily> {
    if (
      !payload.jti ||
      typeof payload.family !== 'string' ||
      typeof payload.generation !== 'number'
    ) {
      throw new BusinessException(
        401,
        'Refresh token missing rotation claims',
        'errors.auth.invalidRefreshToken'
      )
    }

    const rotation = await this.authRepository.findRefreshTokenRotationByHash(
      hashTokenIdentifier(payload.jti)
    )
    if (rotation?.family.id !== payload.family) {
      this.logWarn('getRefreshRotationOrThrow', {
        actorUserId: payload.sub,
        metadata: { family: payload.family },
      })
      throw new BusinessException(
        401,
        'Refresh token rotation record not found',
        'errors.auth.invalidRefreshToken'
      )
    }

    return rotation
  }

  private async assertRefreshRotationCurrent(
    payload: JwtPayload,
    rotation: RefreshRotationWithFamily
  ): Promise<void> {
    const now = new Date()

    if (payload.generation !== rotation.generation) {
      throw new BusinessException(
        401,
        'Refresh token generation mismatch',
        'errors.auth.invalidRefreshToken'
      )
    }

    if (rotation.family.status === RefreshTokenFamilyStatus.revoked) {
      throw new BusinessException(
        401,
        'Refresh token family has been revoked',
        'errors.auth.tokenReplayDetected'
      )
    }

    if (
      rotation.family.status === RefreshTokenFamilyStatus.expired ||
      rotation.expiresAt <= now ||
      rotation.family.expiresAt <= now
    ) {
      void this.authRepository.expireRefreshTokenFamily(rotation.family.id)
      throw new BusinessException(
        401,
        'Refresh token session expired',
        'errors.auth.invalidRefreshToken'
      )
    }

    if (
      rotation.status !== RefreshTokenRotationStatus.active ||
      rotation.generation !== rotation.family.currentGeneration
    ) {
      await this.handleRefreshReplay(rotation)
    }
  }

  private resolveRefreshMembership(
    user: UserWithMemberships,
    payload: JwtPayload,
    requestedTenantId?: string
  ): MembershipWithTenant {
    const targetTenantId = requestedTenantId ?? payload.tenantId
    const membership = user.memberships.find(item => item.tenantId === targetTenantId)

    if (!membership) {
      this.logDenied('resolveRefreshMembership', {
        actorUserId: user.id,
        requestedTenantId: targetTenantId,
      })
      throw new BusinessException(403, 'No access to this tenant', 'errors.auth.noTenantAccess')
    }

    return membership
  }

  private async handleRefreshReplay(rotation: RefreshRotationWithFamily): Promise<never> {
    await this.authRepository.revokeRefreshTokenFamily(
      rotation.family.id,
      RefreshTokenFamilyRevocationReason.REPLAY_DETECTED,
      new Date(),
      rotation.id
    )

    this.logDenied('refreshTokens', {
      actorUserId: rotation.family.userId,
      tenantId: rotation.family.tenantId,
      metadata: { family: rotation.family.id, generation: rotation.generation },
    })

    throw new BusinessException(
      401,
      'Refresh token replay detected',
      'errors.auth.tokenReplayDetected'
    )
  }

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
      this.logWarn(action, { actorEmail: user.email, actorUserId: user.id })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    return first
  }

  private async verifyToken(
    token: string,
    expectedType: string,
    action: string,
    errorKey: string,
    checkBlacklist: boolean
  ): Promise<JwtPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
        clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS,
      }) as JwtPayload & { tokenType?: string }

      if (decoded.tokenType !== expectedType) {
        throw new Error(`Not a ${expectedType} token`)
      }

      if (checkBlacklist && decoded.jti) {
        const revoked = await this.tokenBlacklistService.isBlacklisted(decoded.jti)
        if (revoked) {
          throw new BusinessException(401, 'Token has been revoked', 'errors.auth.tokenRevoked')
        }
      }

      return decoded
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error
      }

      this.logWarn(action, { error: error instanceof Error ? error.message : 'Unknown error' })
      throw new BusinessException(401, `Invalid or expired ${expectedType} token`, errorKey)
    }
  }

  private async blacklistTokenIfPresent(payload: JwtPayload): Promise<void> {
    if (payload.jti && payload.exp) {
      await this.tokenBlacklistService.blacklist(payload.jti, computeRemainingTtl(payload.exp))
    }
  }

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
