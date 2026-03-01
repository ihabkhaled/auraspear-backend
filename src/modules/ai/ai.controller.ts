import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { AiHuntDto, AiHuntSchema } from './dto/ai-hunt.dto';
import { AiInvestigateDto, AiInvestigateSchema } from './dto/ai-investigate.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtPayload } from '../../common/interfaces/authenticated-request.interface';

@Controller('ai')
@UseGuards(AuthGuard, TenantGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * POST /ai/hunt
   * AI-assisted threat hunting. Requires tenant to have
   * a Bedrock connector with aiEnabled=true.
   */
  @Post('hunt')
  @UsePipes(new ZodValidationPipe(AiHuntSchema))
  async aiHunt(
    @Body() dto: AiHuntDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.aiService.aiHunt(dto, user);
  }

  /**
   * POST /ai/investigate
   * AI-powered investigation of a specific alert. Requires tenant
   * to have a Bedrock connector with aiEnabled=true.
   */
  @Post('investigate')
  @UsePipes(new ZodValidationPipe(AiInvestigateSchema))
  async aiInvestigate(
    @Body() dto: AiInvestigateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.aiService.aiInvestigate(dto, user);
  }

  /**
   * POST /ai/explain
   * Explainable AI output -- break down a security finding or concept
   * into analyst-friendly language. Requires tenant to have a Bedrock
   * connector with aiEnabled=true.
   */
  @Post('explain')
  async aiExplain(
    @Body() body: { prompt: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.aiService.aiExplain(body, user);
  }
}
