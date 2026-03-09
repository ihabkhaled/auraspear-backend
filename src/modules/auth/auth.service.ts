import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import * as jwt from 'jsonwebtoken'
import { BusinessException } from '../../common/exceptions/business.exception'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { PrismaService } from '../../prisma/prisma.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

interface TenantMembershipInfo {
  id: string
  name: string
  slug: string
  role: UserRole
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  private readonly jwtSecret: string
  private readonly accessExpiry: jwt.SignOptions['expiresIn']
  private readonly refreshExpiry: jwt.SignOptions['expiresIn']

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
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
          where: { status: 'active' },
          include: { tenant: true },
        },
      },
    })

    if (!user?.passwordHash) {
      throw new BusinessException(
        401,
        'Invalid email or password',
        'errors.auth.invalidCredentials'
      )
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      throw new BusinessException(
        401,
        'Invalid email or password',
        'errors.auth.invalidCredentials'
      )
    }

    if (user.memberships.length === 0) {
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const firstMembership = user.memberships[0]
    if (!firstMembership) {
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

    return { accessToken, refreshToken, user: payload, tenants }
  }

  signAccessToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, ...clean } = payload
    return jwt.sign({ ...clean, tokenType: 'access' }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.accessExpiry,
    })
  }

  signRefreshToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, ...clean } = payload
    return jwt.sign({ ...clean, tokenType: 'refresh' }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.refreshExpiry,
    })
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload & {
        tokenType?: string
      }
      if (decoded.tokenType !== 'access') {
        throw new Error('Not an access token')
      }
      return decoded
    } catch {
      throw new BusinessException(
        401,
        'Invalid or expired access token',
        'errors.auth.invalidAccessToken'
      )
    }
  }

  verifyRefreshToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload & {
        tokenType?: string
      }
      if (decoded.tokenType !== 'refresh') {
        throw new Error('Not a refresh token')
      }
      return decoded
    } catch {
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
    const payload = this.verifyRefreshToken(refreshToken)

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          where: { tenantId: payload.tenantId, status: 'active' },
          include: { tenant: true },
        },
      },
    })

    if (!user) {
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }

    const membership = user.memberships[0]
    if (!membership) {
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    const newPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: membership.tenantId,
      tenantSlug: membership.tenant.slug,
      role: membership.role as UserRole,
    }

    return {
      accessToken: this.signAccessToken(newPayload),
      refreshToken: this.signRefreshToken(newPayload),
    }
  }

  async validateUserActive(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'active' },
          select: { id: true },
          take: 1,
        },
      },
    })

    if (!user) {
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }

    if (user.memberships.length === 0) {
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
  }

  /** Check if a user has an active membership for the given tenant. */
  async validateMembershipActive(userId: string, tenantId: string): Promise<void> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    })

    if (membership?.status !== 'active') {
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
  }

  async getUserTenants(userId: string): Promise<TenantMembershipInfo[]> {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { userId, status: 'active' },
      include: { tenant: true },
    })

    return memberships.map(m => ({
      id: m.tenant.id,
      name: m.tenant.name,
      slug: m.tenant.slug,
      role: m.role as UserRole,
    }))
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

      return { id: user.id, role: membership.role as UserRole }
    } catch (error) {
      this.logger.error('Failed to upsert user', error)
      throw new BusinessException(401, 'Unable to provision user', 'errors.auth.provisionFailed')
    }
  }
}
