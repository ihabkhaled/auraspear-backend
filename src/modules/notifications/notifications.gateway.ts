import { Logger, Inject, forwardRef } from '@nestjs/common'
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { AuthService } from '../auth/auth.service'
import type { NotificationResponse } from './notifications.types'
import type { JwtPayload } from '../../common/interfaces/authenticated-request.interface'

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map(o => o.trim())
      .filter(o => {
        try {
          const url = new URL(o)
          return url.protocol === 'http:' || url.protocol === 'https:'
        } catch {
          return false
        }
      }),
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server

  private readonly logger = new Logger(NotificationsGateway.name)

  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const handshakeAuth = client.handshake.auth as Record<string, string>
      const token =
        handshakeAuth['token'] ?? client.handshake.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        client.disconnect()
        return
      }

      const payload = await this.authService.verifyAccessToken(token)
      const requestedTenantId = this.readRequestedTenantId(handshakeAuth['tenantId'])
      const authorizedContext = await this.authService.resolveAuthorizedTenantContext(
        payload,
        requestedTenantId
      )
      const currentUser: JwtPayload = {
        ...payload,
        tenantId: authorizedContext.tenantId,
        tenantSlug: authorizedContext.tenantSlug,
        role: authorizedContext.role,
      }

      // Store user info on socket
      client.data['user'] = currentUser
      client.data['tenantId'] = currentUser.tenantId

      // Join user-specific room: tenant:userId
      const room = `${currentUser.tenantId}:${currentUser.sub}`
      void client.join(room)

      this.logger.log(`Client connected: ${currentUser.email} (room: ${room})`)
    } catch {
      client.disconnect()
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data['user'] as { email?: string } | undefined
    if (user?.email) {
      this.logger.log(`Client disconnected: ${user.email}`)
    }
  }

  /**
   * Emit a notification event to a specific user in a tenant.
   */
  emitToUser(tenantId: string, recipientUserId: string, notification: NotificationResponse): void {
    const room = `${tenantId}:${recipientUserId}`
    this.server.to(room).emit('notification', notification)
  }

  /**
   * Emit updated unread count to a specific user.
   */
  emitUnreadCount(tenantId: string, recipientUserId: string, count: number): void {
    const room = `${tenantId}:${recipientUserId}`
    this.server.to(room).emit('unread-count', { count })
  }

  emitPermissionsUpdated(
    tenantId: string,
    recipientUserId: string,
    reason: 'role-updated' | 'role-matrix-updated' | 'membership-status-updated'
  ): void {
    const room = `${tenantId}:${recipientUserId}`
    this.server.to(room).emit('permissions-updated', {
      tenantId,
      reason,
      changedAt: new Date().toISOString(),
    })
  }

  private readRequestedTenantId(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }

    const normalized = value.trim()
    return normalized.length > 0 ? normalized : undefined
  }
}
