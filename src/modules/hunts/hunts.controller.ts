import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { HuntsService } from './hunts.service';
import { RunHuntDto, RunHuntSchema } from './dto/run-hunt.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload, UserRole } from '../../common/interfaces/authenticated-request.interface';

@Controller('hunts')
@UseGuards(AuthGuard, TenantGuard)
export class HuntsController {
  constructor(private readonly huntsService: HuntsService) {}

  /**
   * POST /hunts/run
   * Start a new threat hunt. Requires THREAT_HUNTER or SOC_ANALYST_L2+.
   */
  @Post('run')
  @UseGuards(RolesGuard)
  @Roles(UserRole.THREAT_HUNTER, UserRole.SOC_ANALYST_L2)
  @UsePipes(new ZodValidationPipe(RunHuntSchema))
  async runHunt(
    @Body() dto: RunHuntDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.huntsService.runHunt(dto, user);
  }

  /**
   * GET /hunts/runs
   * List all hunt runs for the current tenant.
   */
  @Get('runs')
  async listRuns(@TenantId() tenantId: string) {
    return this.huntsService.listHuntRuns(tenantId);
  }

  /**
   * GET /hunts/runs/:id
   * Get detailed hunt run results including events.
   */
  @Get('runs/:id')
  async getRunDetails(
    @Param('id') id: string,
    @TenantId() tenantId: string,
  ) {
    return this.huntsService.getHuntRun(id, tenantId);
  }
}
