import { NotificationsGateway } from '../../src/modules/notifications/notifications.gateway'

const mockAuthService = {
  verifyAccessToken: jest.fn(),
}

function createMockSocket(overrides: Record<string, unknown> = {}) {
  return {
    handshake: {
      auth: { token: 'valid-jwt-token' },
      headers: {},
    },
    data: {} as Record<string, unknown>,
    join: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  }
}

function createMockServer() {
  const emitFunction = jest.fn()
  return {
    to: jest.fn().mockReturnValue({ emit: emitFunction }),
    _emitFn: emitFunction,
  }
}

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway
  let mockServer: ReturnType<typeof createMockServer>

  beforeEach(() => {
    jest.clearAllMocks()
    gateway = new NotificationsGateway(mockAuthService as never)
    mockServer = createMockServer()
    // Inject mock server
    ;(gateway as unknown as { server: unknown }).server = mockServer
  })

  describe('handleConnection', () => {
    it('should authenticate client, store user data, and join room', async () => {
      const payload = {
        sub: 'user-001',
        email: 'analyst@test.com',
        tenantId: 'tenant-001',
      }
      mockAuthService.verifyAccessToken.mockResolvedValue(payload)

      const socket = createMockSocket()
      await gateway.handleConnection(socket as never)

      expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith('valid-jwt-token')
      expect(socket.data['user']).toEqual(payload)
      expect(socket.data['tenantId']).toBe('tenant-001')
      expect(socket.join).toHaveBeenCalledWith('tenant-001:user-001')
      expect(socket.disconnect).not.toHaveBeenCalled()
    })

    it('should disconnect client when no token provided', async () => {
      const socket = createMockSocket({
        handshake: { auth: {}, headers: {} },
      })

      await gateway.handleConnection(socket as never)

      expect(socket.disconnect).toHaveBeenCalled()
      expect(mockAuthService.verifyAccessToken).not.toHaveBeenCalled()
    })

    it('should use Authorization header as fallback', async () => {
      const payload = {
        sub: 'user-002',
        email: 'user@test.com',
        tenantId: 'tenant-002',
      }
      mockAuthService.verifyAccessToken.mockResolvedValue(payload)

      const socket = createMockSocket({
        handshake: {
          auth: {},
          headers: { authorization: 'Bearer header-token' },
        },
      })

      await gateway.handleConnection(socket as never)

      expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith('header-token')
      expect(socket.join).toHaveBeenCalledWith('tenant-002:user-002')
    })

    it('should disconnect client when token verification fails', async () => {
      mockAuthService.verifyAccessToken.mockRejectedValue(new Error('Invalid token'))

      const socket = createMockSocket()
      await gateway.handleConnection(socket as never)

      expect(socket.disconnect).toHaveBeenCalled()
    })

    it('should prefer auth token over Authorization header', async () => {
      const payload = {
        sub: 'user-001',
        email: 'user@test.com',
        tenantId: 'tenant-001',
      }
      mockAuthService.verifyAccessToken.mockResolvedValue(payload)

      const socket = createMockSocket({
        handshake: {
          auth: { token: 'auth-token' },
          headers: { authorization: 'Bearer header-token' },
        },
      })

      await gateway.handleConnection(socket as never)

      expect(mockAuthService.verifyAccessToken).toHaveBeenCalledWith('auth-token')
    })
  })

  describe('handleDisconnect', () => {
    it('should log disconnect for authenticated user', () => {
      const socket = createMockSocket()
      socket.data['user'] = { email: 'analyst@test.com' }

      // Should not throw
      gateway.handleDisconnect(socket as never)
    })

    it('should handle disconnect for unauthenticated socket', () => {
      const socket = createMockSocket()

      // Should not throw
      gateway.handleDisconnect(socket as never)
    })
  })

  describe('emitToUser', () => {
    it('should emit notification event to user room', () => {
      const notification = {
        id: 'n1',
        type: 'mention',
        message: 'You were mentioned',
      }

      gateway.emitToUser('tenant-001', 'user-001', notification as never)

      expect(mockServer.to).toHaveBeenCalledWith('tenant-001:user-001')
      expect(mockServer._emitFn).toHaveBeenCalledWith('notification', notification)
    })
  })

  describe('emitUnreadCount', () => {
    it('should emit unread count to user room', () => {
      gateway.emitUnreadCount('tenant-001', 'user-001', 5)

      expect(mockServer.to).toHaveBeenCalledWith('tenant-001:user-001')
      expect(mockServer._emitFn).toHaveBeenCalledWith('unread-count', { count: 5 })
    })

    it('should emit zero count', () => {
      gateway.emitUnreadCount('tenant-001', 'user-001', 0)

      expect(mockServer._emitFn).toHaveBeenCalledWith('unread-count', { count: 0 })
    })
  })
})
