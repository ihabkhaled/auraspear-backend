import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { CreateTenantDto, UpdateTenantDto, AddUserDto } from './dto/tenant.dto'
import type { UserRole } from '../../common/interfaces/authenticated-request.interface'

export interface TenantRecord {
  id: string
  name: string
  slug: string
  createdAt: Date
}

export interface UserRecord {
  id: string
  email: string
  name: string
  role: string
  createdAt: Date
}

// Mock data fallback
const MOCK_TENANTS: TenantRecord[] = [
  { id: 'tid-001', name: 'Aura Finance', slug: 'aura-finance', createdAt: new Date('2024-01-15') },
  { id: 'tid-002', name: 'Aura Health', slug: 'aura-health', createdAt: new Date('2024-02-01') },
  {
    id: 'tid-003',
    name: 'Aura Enterprise',
    slug: 'aura-enterprise',
    createdAt: new Date('2024-03-10'),
  },
]

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<TenantRecord[]> {
    try {
      return await this.prisma.tenant.findMany({ orderBy: { name: 'asc' } })
    } catch {
      this.logger.warn('Prisma unavailable, returning mock tenants')
      return MOCK_TENANTS
    }
  }

  async findById(id: string): Promise<TenantRecord> {
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id } })
      if (!tenant) throw new NotFoundException('Tenant not found')
      return tenant
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      const mock = MOCK_TENANTS.find(t => t.id === id || t.slug === id)
      if (!mock) throw new NotFoundException('Tenant not found')
      return mock
    }
  }

  async create(dto: CreateTenantDto): Promise<TenantRecord> {
    try {
      return await this.prisma.tenant.create({
        data: { name: dto.name, slug: dto.slug },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('Unique constraint')) {
        throw new ConflictException('Tenant slug already exists')
      }
      throw error
    }
  }

  async update(id: string, dto: UpdateTenantDto): Promise<TenantRecord> {
    return this.prisma.tenant.update({ where: { id }, data: dto })
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    await this.prisma.tenant.delete({ where: { id } })
    return { deleted: true }
  }

  async findUsers(tenantId: string): Promise<UserRecord[]> {
    try {
      const users = await this.prisma.tenantUser.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
      })
      return users.map(
        (u: { id: string; email: string; name: string; role: string; createdAt: Date }) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt,
        })
      )
    } catch {
      return []
    }
  }

  async addUser(tenantId: string, dto: AddUserDto): Promise<UserRecord> {
    const user = await this.prisma.tenantUser.create({
      data: {
        tenantId,
        oidcSub: dto.oidcSub,
        email: dto.email,
        name: dto.name,
        role: dto.role as UserRole,
      },
    })
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    }
  }

  async updateUserRole(tenantId: string, userId: string, role: string): Promise<UserRecord> {
    const user = await this.prisma.tenantUser.update({
      where: { id: userId },
      data: { role: role as UserRole },
    })
    if (user.tenantId !== tenantId) {
      throw new NotFoundException('User not found in this tenant')
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    }
  }

  async removeUser(tenantId: string, userId: string): Promise<{ deleted: boolean }> {
    const user = await this.prisma.tenantUser.findUnique({ where: { id: userId } })
    if (user?.tenantId !== tenantId) {
      throw new NotFoundException('User not found in this tenant')
    }
    await this.prisma.tenantUser.delete({ where: { id: userId } })
    return { deleted: true }
  }
}
