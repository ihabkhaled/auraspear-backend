import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { AuditLogsService } from './audit-logs.service'
import { SearchAuditLogsSchema } from './dto/search-audit-logs.dto'
import { Roles } from '../../common/decorators/roles.decorator'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { UserRole } from '../../common/interfaces/authenticated-request.interface'

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Roles(UserRole.TENANT_ADMIN)
  async search(@TenantId() tenantId: string, @Query() rawQuery: Record<string, string>) {
    const query = SearchAuditLogsSchema.parse(rawQuery)
    return this.auditLogsService.search(tenantId, query)
  }
}
