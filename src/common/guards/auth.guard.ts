import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { JwtPayload, AuthenticatedRequest } from '../interfaces/authenticated-request.interface';
import { UserRole } from '../interfaces/authenticated-request.interface';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly client: jwksClient.JwksClient;
  private readonly audience: string;
  private readonly issuer: string;
  private readonly isDev: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {
    this.isDev = this.configService.get('NODE_ENV') !== 'production';
    this.audience = this.configService.get('OIDC_AUDIENCE', 'api://auraspear-soc');
    this.issuer = this.configService.get('OIDC_ISSUER_URL', '');

    this.client = jwksClient({
      jwksUri: this.configService.get(
        'OIDC_JWKS_URI',
        'https://login.microsoftonline.com/common/discovery/v2.0/keys',
      ),
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      // In dev mode, inject a mock user for testing without OIDC
      if (this.isDev && !authHeader) {
        request.user = this.getDevUser(request);
        return true;
      }
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);

    try {
      const decoded = await this.verifyToken(token);
      request.user = decoded;
      return true;
    } catch (error) {
      this.logger.warn(`JWT verification failed: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async verifyToken(token: string): Promise<JwtPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        (header, callback) => {
          this.client.getSigningKey(header.kid, (error, key) => {
            if (error) {
              callback(error);
              return;
            }
            callback(null, key?.getPublicKey());
          });
        },
        {
          audience: this.audience,
          issuer: this.issuer || undefined,
          algorithms: ['RS256'],
        },
        (error, decoded) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(decoded as JwtPayload);
        },
      );
    });
  }

  private getDevUser(request: AuthenticatedRequest): JwtPayload {
    // Allow dev headers to override role/tenant for testing
    const tenantId =
      (request.headers['x-tenant-id'] as string | undefined) ?? 'dev-tenant-001';
    const role =
      ((request.headers['x-role'] as string | undefined) as UserRole | undefined) ??
      UserRole.TENANT_ADMIN;

    return {
      sub: 'dev-user-001',
      email: 'dev@auraspear.local',
      tenantId,
      role,
    };
  }
}
