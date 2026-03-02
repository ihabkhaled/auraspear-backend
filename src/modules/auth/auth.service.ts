import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'
import * as jwt from 'jsonwebtoken'
import { BusinessException } from '../../common/exceptions/business.exception'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { PrismaService } from '../../prisma/prisma.service'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

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
    this.jwtSecret = this.configService.get<string>('JWT_SECRET', '')
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
  ): Promise<{ accessToken: string; refreshToken: string; user: JwtPayload }> {
    const tenantUser = await this.prisma.tenantUser.findFirst({
      where: { email },
      include: { tenant: true },
    })

    if (!tenantUser?.passwordHash) {
      throw new BusinessException(
        401,
        'Invalid email or password',
        'errors.auth.invalidCredentials'
      )
    }

    const valid = await bcrypt.compare(password, tenantUser.passwordHash)
    if (!valid) {
      throw new BusinessException(
        401,
        'Invalid email or password',
        'errors.auth.invalidCredentials'
      )
    }

    if (tenantUser.status !== 'active') {
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    await this.prisma.tenantUser.update({
      where: { id: tenantUser.id },
      data: { lastLoginAt: new Date() },
    })

    const payload: JwtPayload = {
      sub: tenantUser.id,
      email: tenantUser.email,
      tenantId: tenantUser.tenantId,
      tenantSlug: tenantUser.tenant.slug,
      role: tenantUser.role as UserRole,
    }

    const accessToken = this.signAccessToken(payload)
    const refreshToken = this.signRefreshToken(payload)

    return { accessToken, refreshToken, user: payload }
  }

  signAccessToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, ...clean } = payload
    return jwt.sign(clean, this.jwtSecret, { expiresIn: this.accessExpiry })
  }

  signRefreshToken(payload: JwtPayload): string {
    const { iat: _iat, exp: _exp, ...clean } = payload
    return jwt.sign(clean, this.jwtSecret, { expiresIn: this.refreshExpiry })
  }

  verifyAccessToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as JwtPayload
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
      return jwt.verify(token, this.jwtSecret) as JwtPayload
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

    const user = await this.prisma.tenantUser.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    })

    if (!user) {
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }

    if (user.status !== 'active') {
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }

    const newPayload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      role: user.role as UserRole,
    }

    return {
      accessToken: this.signAccessToken(newPayload),
      refreshToken: this.signRefreshToken(newPayload),
    }
  }

  async validateUserActive(userId: string): Promise<void> {
    const user = await this.prisma.tenantUser.findUnique({
      where: { id: userId },
      select: { status: true },
    })

    if (!user) {
      throw new BusinessException(401, 'User no longer exists', 'errors.auth.userNotFound')
    }

    if (user.status !== 'active') {
      throw new BusinessException(401, 'User account is not active', 'errors.auth.accountInactive')
    }
  }

  async findOrCreateUser(
    tenantId: string,
    oidcSub: string,
    email: string,
    name: string
  ): Promise<{ id: string; role: UserRole }> {
    try {
      const user = await this.prisma.tenantUser.upsert({
        where: { tenantId_oidcSub: { tenantId, oidcSub } },
        update: { email, name },
        create: {
          tenantId,
          oidcSub,
          email,
          name,
          role: UserRole.SOC_ANALYST_L1,
        },
      })
      return { id: user.id, role: user.role as UserRole }
    } catch (error) {
      this.logger.error('Failed to upsert user', error)
      throw new BusinessException(401, 'Unable to provision user', 'errors.auth.provisionFailed')
    }
  }
}
