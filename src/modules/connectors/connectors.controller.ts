import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ConnectorsService } from './connectors.service'
import {
  CreateConnectorSchema,
  type CreateConnectorDto,
  UpdateConnectorSchema,
  type UpdateConnectorDto,
} from './dto/connector.dto'
import { ToggleConnectorSchema, type ToggleConnectorDto } from './dto/toggle-connector.dto'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe'
import type { ConnectorResponse, ConnectorTestResult } from './connectors.types'

@ApiTags('connectors')
@ApiBearerAuth()
@Controller('connectors')
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  @Get()
  async list(@TenantId() tenantId: string): Promise<ConnectorResponse[]> {
    return this.connectorsService.findAll(tenantId)
  }

  @Get(':type')
  async getByType(
    @TenantId() tenantId: string,
    @Param('type') type: string
  ): Promise<ConnectorResponse> {
    return this.connectorsService.findByType(tenantId, type)
  }

  @Post()
  @Roles(UserRole.TENANT_ADMIN)
  async create(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(CreateConnectorSchema)) dto: CreateConnectorDto
  ): Promise<ConnectorResponse> {
    return this.connectorsService.create(tenantId, dto)
  }

  @Patch(':type')
  @Roles(UserRole.TENANT_ADMIN)
  async update(
    @TenantId() tenantId: string,
    @Param('type') type: string,
    @Body(new ZodValidationPipe(UpdateConnectorSchema)) dto: UpdateConnectorDto
  ): Promise<ConnectorResponse> {
    return this.connectorsService.update(tenantId, type, dto)
  }

  @Delete(':type')
  @Roles(UserRole.TENANT_ADMIN)
  async remove(
    @TenantId() tenantId: string,
    @Param('type') type: string
  ): Promise<{ deleted: boolean }> {
    return this.connectorsService.remove(tenantId, type)
  }

  @Post(':type/test')
  @Roles(UserRole.TENANT_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async test(
    @TenantId() tenantId: string,
    @Param('type') type: string
  ): Promise<ConnectorTestResult> {
    return this.connectorsService.testConnection(tenantId, type)
  }

  @Post(':type/toggle')
  @Roles(UserRole.TENANT_ADMIN)
  async toggle(
    @TenantId() tenantId: string,
    @Param('type') type: string,
    @Body(new ZodValidationPipe(ToggleConnectorSchema)) dto: ToggleConnectorDto
  ): Promise<{ type: string; enabled: boolean }> {
    return this.connectorsService.toggle(tenantId, type, dto.enabled)
  }
}
