import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface';
import { UserRole } from '../../common/interfaces/authenticated-request.interface';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exchangeCode(
    code: string,
    _redirectUri: string,
  ): Promise<{ accessToken: string; user: JwtPayload }> {
    // In production, this would exchange the authorization code with the OIDC provider
    // For now, return a mock response based on the code
    this.logger.debug(`Exchanging code: ${code.slice(0, 8)}...`);

    const mockUser: JwtPayload = {
      sub: 'mock-user-001',
      email: 'analyst@auraspear.io',
      tenantId: 'aura-finance',
      role: UserRole.SOC_ANALYST_L2,
    };

    return {
      accessToken: `mock-jwt-${Date.now()}`,
      user: mockUser,
    };
  }

  async refreshToken(
    _refreshToken: string,
  ): Promise<{ accessToken: string }> {
    // In production, validate refresh token and issue new access token
    return { accessToken: `mock-jwt-refreshed-${Date.now()}` };
  }

  async findOrCreateUser(
    tenantId: string,
    oidcSub: string,
    email: string,
    name: string,
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
      });
      return { id: user.id, role: user.role as UserRole };
    } catch (error) {
      this.logger.error('Failed to upsert user', error);
      throw new UnauthorizedException('Unable to provision user');
    }
  }
}
