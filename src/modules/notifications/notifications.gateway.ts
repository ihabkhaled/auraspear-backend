import { Logger } from '@nestjs/common'
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { AuthService } from '../auth/auth.service'
import type { NotificationResponse } from './notifications.types'

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

  constructor(private readonly authService: AuthService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth as Record<string, string>)['token'] ??
        client.handshake.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        client.disconnect()
        return
      }

      const payload = await this.authService.verifyAccessToken(token)

      // Store user info on socket
      client.data['user'] = payload
      client.data['tenantId'] = payload.tenantId

      // Join user-specific room: tenant:userId
      const room = `${payload.tenantId}:${payload.sub}`
      void client.join(room)

      this.logger.log(`Client connected: ${payload.email} (room: ${room})`)
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
}
