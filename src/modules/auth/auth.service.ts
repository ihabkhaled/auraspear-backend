import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import * as jwt from 'jsonwebtoken'
import { TokenBlacklistService } from './token-blacklist.service'
import { AppLogFeature, AppLogOutcome, AppLogSourceType } from '../../common/enums'
import { BusinessException } from '../../common/exceptions/business.exception'
import { MembershipStatus, UserRole } from '../../common/interfaces/authenticated-request.interface'
import { AppLoggerService } from '../../common/services/app-logger.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

interface TenantMembershipInfo {
  id: string
  name: string
  slug: string
  role: UserRole
}

// Pre-computed bcrypt hash used for constant-time comparison when user doesn't exist.
// Prevents timing-based email enumeration (bcrypt ~500ms vs immediate rejection ~1ms).
const DUMMY_BCRYPT_HASH = '$2a$12$LJ3m4ys3Lp0Yf5YzF0OOjO5KbK6Fz6j4z5Y5Z5Y5Z5Y5Z5Y5Z5Y5u'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private readonly jwtSecret: string
  private readonly accessExpiry: jwt.SignOptions['expiresIn']
  private readonly refreshExpiry: jwt.SignOptions['expiresIn']

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly appLogger: AppLoggerService
  ) {
    const secret = this.configService.get<string>('JWT_SECRET')
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be set and at least 32 characters long')
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
    password: string
  ): Promise<{
    accessToken: string
    refreshToken: string
    user: JwtPayload
    tenants: TenantMembershipInfo[]
  }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { status: MembershipStatus.ACTIVE },
          include: { tenant: true },
        },
      },
    })

    // Always run bcrypt.compare to prevent timing-based email enumeration.
    // If user doesn't exist or has no password, compare against a dummy hash
    // so the response time is constant (~500ms) regardless of user existence.
    const hashToCompare = user?.passwordHash ?? DUMMY_BCRYPT_HASH
    const valid = await bcrypt.compare(password, hashToCompare)

    if (!user?.passwordHash || !valid) {
      this.appLogger.warn('Login failed: invalid credentials', {
        feature: AppLogFeature.AUTH,
        action: 'login',
        outcome: AppLogOutcome.FAILURE,
        actorEmail: email,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'login',
      })
      throw new BusinessException(
        401,
        'Invalid email or password',
        'errors.auth.invalidCredentials'
      )
    }

    if (user.memberships.length === 0) {
      this.appLogger.warn('Login failed: no active memberships', {
        feature: AppLogFeature.AUTH,
        action: 'login',
        outcome: AppLogOutcome.FAILURE,
        actorEmail: email,
        actorUserId: user.id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'login',
      })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const firstMembership = user.memberships[0]
    if (!firstMembership) {
      this.appLogger.warn('Login failed: no first membership found', {
        feature: AppLogFeature.AUTH,
        action: 'login',
        className: 'AuthService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { userId: user.id, email: user.email },
      })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: firstMembership.tenantId,
      tenantSlug: firstMembership.tenant.slug,
      role: firstMembership.role as UserRole,
    }

    const accessToken = this.signAccessToken(payload)
    const refreshToken = this.signRefreshToken(payload)

    const tenants: TenantMembershipInfo[] = user.memberships.map(m => ({
      id: m.tenant.id,
      name: m.tenant.name,
      slug: m.tenant.slug,
      role: m.role as UserRole,
    }))

    this.appLogger.info('Login succeeded', {
      feature: AppLogFeature.AUTH,
      action: 'login',
      outcome: AppLogOutcome.SUCCESS,
      actorEmail: user.email,
      actorUserId: user.id,
      tenantId: firstMembership.tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: 'login',
    })

    return { accessToken, refreshToken, user: payload, tenants }
  }

  signAccessToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, jti: _jti, ...clean } = payload
    return jwt.sign({ ...clean, jti: randomUUID(), tokenType: 'access' }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.accessExpiry,
    })
  }

  signRefreshToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, jti: _jti, ...clean } = payload
    return jwt.sign({ ...clean, jti: randomUUID(), tokenType: 'refresh' }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.refreshExpiry,
    })
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload & {
        tokenType?: string
      }
      if (decoded.tokenType !== 'access') {
        throw new Error('Not an access token')
      }

      if (decoded.jti) {
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

      this.appLogger.debug('Access token verification failed', {
        feature: AppLogFeature.AUTH,
        action: 'verifyAccessToken',
        outcome: AppLogOutcome.FAILURE,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'verifyAccessToken',
      })

      throw new BusinessException(
        401,
        'Invalid or expired access token',
        'errors.auth.invalidAccessToken'
      )
    }
  }

  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload & {
        tokenType?: string
      }
      if (decoded.tokenType !== 'refresh') {
        throw new Error('Not a refresh token')
      }

      if (decoded.jti) {
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
      this.appLogger.warn('Refresh token verification failed', {
        feature: AppLogFeature.AUTH,
        action: 'verifyRefreshToken',
        className: 'AuthService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw new BusinessException(
        401,
        'Invalid or expired refresh token',
        'errors.auth.invalidRefreshToken'
      )
    }
  }

  async refreshTokens(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await this.verifyRefreshToken(refreshToken)

    // Blacklist the old refresh token JTI to prevent replay attacks
    if (payload.jti && payload.exp) {
      const now = Math.floor(Date.now() / 1000)
      const remainingTtl = Math.max(payload.exp - now, 0)
      await this.tokenBlacklistService.blacklist(payload.jti, remainingTtl)
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          where: { tenantId: payload.tenantId, status: MembershipStatus.ACTIVE },
          include: { tenant: true },
        },
      },
    })

    if (!user) {
      this.appLogger.warn('Token refresh failed: user no longer exists', {
        feature: AppLogFeature.AUTH,
        action: 'refreshTokens',
        outcome: AppLogOutcome.FAILURE,
        actorUserId: payload.sub,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'refreshTokens',
      })
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }

    const membership = user.memberships[0]
    if (!membership) {
      this.appLogger.warn('Token refresh failed: no active membership', {
        feature: AppLogFeature.AUTH,
        action: 'refreshTokens',
        outcome: AppLogOutcome.FAILURE,
        actorEmail: user.email,
        actorUserId: user.id,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'refreshTokens',
      })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    const newPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
      role: membership.role as UserRole,
    }

    // Preserve impersonation claims across token refresh
    if (payload.isImpersonated === true) {
      newPayload.isImpersonated = true
      newPayload.impersonatorSub = payload.impersonatorSub
      newPayload.impersonatorEmail = payload.impersonatorEmail
    }

    this.appLogger.info('Token refresh succeeded', {
      feature: AppLogFeature.AUTH,
      action: 'refreshTokens',
      outcome: AppLogOutcome.SUCCESS,
      actorEmail: user.email,
      actorUserId: user.id,
      tenantId: membership.tenantId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: 'refreshTokens',
    })

    return {
      accessToken: this.signAccessToken(newPayload),
      refreshToken: this.signRefreshToken(newPayload),
    }
  }

  /**
   * Blacklist both access and refresh tokens so they cannot be reused.
   * Each token is stored in Redis with a TTL equal to its remaining lifetime.
   */
  async logout(
    accessJti: string,
    refreshJti: string,
    accessExp: number,
    refreshExp: number
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const accessTtl = Math.max(accessExp - now, 0)
    const refreshTtl = Math.max(refreshExp - now, 0)

    await Promise.all([
      this.tokenBlacklistService.blacklist(accessJti, accessTtl),
      this.tokenBlacklistService.blacklist(refreshJti, refreshTtl),
    ])

    this.appLogger.info('User logged out', {
      feature: AppLogFeature.AUTH,
      action: 'logout',
      outcome: AppLogOutcome.SUCCESS,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: 'logout',
    })
  }

  async validateUserActive(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: MembershipStatus.ACTIVE },
          select: { id: true },
          take: 1,
        },
      },
    })

    if (!user) {
      this.appLogger.warn('User validation failed: user no longer exists', {
        feature: AppLogFeature.AUTH,
        action: 'validateUserActive',
        outcome: AppLogOutcome.FAILURE,
        actorUserId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'validateUserActive',
      })
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }

    if (user.memberships.length === 0) {
      this.appLogger.warn('User validation failed: no active memberships', {
        feature: AppLogFeature.AUTH,
        action: 'validateUserActive',
        outcome: AppLogOutcome.FAILURE,
        actorUserId: userId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'validateUserActive',
      })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
  }

  /** Check if a user has an active membership for the given tenant. */
  async validateMembershipActive(userId: string, tenantId: string): Promise<void> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })

    if (membership?.status !== MembershipStatus.ACTIVE) {
      this.appLogger.warn('Membership validation failed: not active', {
        feature: AppLogFeature.AUTH,
        action: 'validateMembershipActive',
        outcome: AppLogOutcome.DENIED,
        actorUserId: userId,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'validateMembershipActive',
      })
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
  }

  async getUserTenants(userId: string): Promise<TenantMembershipInfo[]> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      include: { tenant: true },
    })

    this.appLogger.info('User tenants retrieved', {
      feature: AppLogFeature.AUTH,
      action: 'getUserTenants',
      outcome: AppLogOutcome.SUCCESS,
      actorUserId: userId,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: 'getUserTenants',
      metadata: { tenantCount: memberships.length },
    })

    return memberships.map(m => ({
      id: m.tenant.id,
      name: m.tenant.name,
      slug: m.tenant.slug,
      role: m.role as UserRole,
    }))
  }

  /**
   * End an impersonation session by restoring the original admin's tokens.
   * Blacklists the current impersonation tokens and issues fresh admin tokens.
   */
  async endImpersonation(
    caller: JwtPayload
  ): Promise<{ accessToken: string; refreshToken: string; user: JwtPayload }> {
    if (caller.isImpersonated !== true || !caller.impersonatorSub) {
      this.appLogger.warn('End impersonation failed: not currently impersonating', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'endImpersonation',
        className: 'AuthService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.DENIED,
        metadata: { userId: caller.sub, email: caller.email },
      })
      throw new BusinessException(
        400,
        'Not currently impersonating',
        'errors.impersonation.notImpersonating'
      )
    }

    // Blacklist the current impersonation access token
    if (caller.jti && caller.exp) {
      const now = Math.floor(Date.now() / 1000)
      const remainingTtl = Math.max(caller.exp - now, 0)
      await this.tokenBlacklistService.blacklist(caller.jti, remainingTtl)
    }

    // Look up the original admin user
    const admin = await this.prisma.user.findUnique({
      where: { id: caller.impersonatorSub },
      include: {
        memberships: {
          where: { status: MembershipStatus.ACTIVE },
          include: { tenant: true },
        },
      },
    })

    if (!admin) {
      this.appLogger.warn('End impersonation failed: original admin user no longer exists', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'endImpersonation',
        className: 'AuthService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { impersonatorSub: caller.impersonatorSub },
      })
      throw new BusinessException(
        401,
        'Original admin user no longer exists',
        'errors.auth.userNotFound'
      )
    }

    if (admin.memberships.length === 0) {
      this.appLogger.warn('End impersonation failed: admin has no active memberships', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'endImpersonation',
        className: 'AuthService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { adminId: admin.id, adminEmail: admin.email },
      })
      throw new BusinessException(
        401,
        'Admin account is no longer active',
        'errors.auth.accountInactive'
      )
    }

    const firstMembership = admin.memberships[0]
    if (!firstMembership) {
      this.appLogger.warn('End impersonation failed: admin first membership not found', {
        feature: AppLogFeature.IMPERSONATION,
        action: 'endImpersonation',
        className: 'AuthService',
        sourceType: AppLogSourceType.SERVICE,
        outcome: AppLogOutcome.FAILURE,
        metadata: { adminId: admin.id, adminEmail: admin.email },
      })
      throw new BusinessException(
        401,
        'Admin account is no longer active',
        'errors.auth.accountInactive'
      )
    }

    const adminPayload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      tenantId: firstMembership.tenantId,
      tenantSlug: firstMembership.tenant.slug,
      role: firstMembership.role as UserRole,
    }

    this.appLogger.info('Impersonation ended', {
      feature: AppLogFeature.IMPERSONATION,
      action: 'endImpersonation',
      outcome: AppLogOutcome.SUCCESS,
      actorEmail: admin.email,
      actorUserId: admin.id,
      sourceType: AppLogSourceType.SERVICE,
      className: 'AuthService',
      functionName: 'endImpersonation',
      metadata: { impersonatedEmail: caller.email, impersonatedUserId: caller.sub },
    })

    return {
      accessToken: this.signAccessToken(adminPayload),
      refreshToken: this.signRefreshToken(adminPayload),
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
      // Upsert global user
      const user = await this.prisma.user.upsert({
        where: { oidcSub },
        update: { email, name },
        create: {
          oidcSub,
          email,
          name,
        },
      })

      // Upsert tenant membership
      const membership = await this.prisma.tenantMembership.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId } },
        update: {},
        create: {
          userId: user.id,
          tenantId,
          role: UserRole.SOC_ANALYST_L1,
        },
      })

      this.appLogger.info('User found or created via OIDC', {
        feature: AppLogFeature.AUTH,
        action: 'findOrCreateUser',
        outcome: AppLogOutcome.SUCCESS,
        actorUserId: user.id,
        actorEmail: email,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'findOrCreateUser',
        metadata: { role: membership.role },
      })

      return { id: user.id, role: membership.role as UserRole }
    } catch (error) {
      this.logger.error('Failed to upsert user', error)

      this.appLogger.error('Failed to find or create user via OIDC', {
        feature: AppLogFeature.AUTH,
        action: 'findOrCreateUser',
        outcome: AppLogOutcome.FAILURE,
        actorEmail: email,
        tenantId,
        sourceType: AppLogSourceType.SERVICE,
        className: 'AuthService',
        functionName: 'findOrCreateUser',
        stackTrace: error instanceof Error ? error.stack : undefined,
      })

      throw new BusinessException(401, 'Unable to provision user', 'errors.auth.provisionFailed')
    }
  }
}
