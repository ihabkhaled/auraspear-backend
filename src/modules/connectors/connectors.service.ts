import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { encrypt, decrypt } from '../../common/utils/encryption.util';
import { maskSecrets } from '../../common/utils/mask.util';
import type { CreateConnectorDto, UpdateConnectorDto } from './dto/connector.dto';
import { WazuhService } from './services/wazuh.service';
import { OpenSearchService } from './services/opensearch.service';
import { MispService } from './services/misp.service';
import { ShuffleService } from './services/shuffle.service';
import { BedrockService } from './services/bedrock.service';

interface ConnectorResponse {
  type: string;
  name: string;
  enabled: boolean;
  authType: string;
  config: Record<string, unknown>;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastError: string | null;
}

interface TestResult {
  type: string;
  ok: boolean;
  latencyMs: number;
  details: string;
  testedAt: string;
}

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);
  private readonly encryptionKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly wazuhService: WazuhService,
    private readonly openSearchService: OpenSearchService,
    private readonly mispService: MispService,
    private readonly shuffleService: ShuffleService,
    private readonly bedrockService: BedrockService,
  ) {
    this.encryptionKey = this.configService.get<string>(
      'CONFIG_ENCRYPTION_KEY',
      'a'.repeat(64),
    );
  }

  async findAll(tenantId: string): Promise<ConnectorResponse[]> {
    try {
      const configs = await this.prisma.connectorConfig.findMany({
        where: { tenantId },
        orderBy: { type: 'asc' },
      });

      return configs.map((c) => ({
        type: c.type,
        name: c.name,
        enabled: c.enabled,
        authType: c.authType,
        config: maskSecrets(this.decryptConfig(c.encryptedConfig)),
        lastTestAt: c.lastTestAt,
        lastTestOk: c.lastTestOk,
        lastError: c.lastError,
      }));
    } catch {
      this.logger.warn('Prisma unavailable, returning empty list');
      return [];
    }
  }

  async findByType(tenantId: string, type: string): Promise<ConnectorResponse> {
    const config = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    });

    if (!config) throw new NotFoundException(`Connector '${type}' not found`);

    return {
      type: config.type,
      name: config.name,
      enabled: config.enabled,
      authType: config.authType,
      config: maskSecrets(this.decryptConfig(config.encryptedConfig)),
      lastTestAt: config.lastTestAt,
      lastTestOk: config.lastTestOk,
      lastError: config.lastError,
    };
  }

  async create(tenantId: string, dto: CreateConnectorDto): Promise<ConnectorResponse> {
    const encryptedConfig = encrypt(JSON.stringify(dto.config), this.encryptionKey);

    const config = await this.prisma.connectorConfig.create({
      data: {
        tenantId,
        type: dto.type as never,
        name: dto.name,
        enabled: dto.enabled,
        authType: dto.authType as never,
        encryptedConfig,
      },
    });

    return {
      type: config.type,
      name: config.name,
      enabled: config.enabled,
      authType: config.authType,
      config: maskSecrets(dto.config as Record<string, unknown>),
      lastTestAt: null,
      lastTestOk: null,
      lastError: null,
    };
  }

  async update(
    tenantId: string,
    type: string,
    dto: UpdateConnectorDto,
  ): Promise<ConnectorResponse> {
    const existing = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    });

    if (!existing) throw new NotFoundException(`Connector '${type}' not found`);

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
    if (dto.authType !== undefined) updateData.authType = dto.authType;
    if (dto.config !== undefined) {
      updateData.encryptedConfig = encrypt(JSON.stringify(dto.config), this.encryptionKey);
    }

    const updated = await this.prisma.connectorConfig.update({
      where: { tenantId_type: { tenantId, type: type as never } },
      data: updateData,
    });

    return {
      type: updated.type,
      name: updated.name,
      enabled: updated.enabled,
      authType: updated.authType,
      config: maskSecrets(this.decryptConfig(updated.encryptedConfig)),
      lastTestAt: updated.lastTestAt,
      lastTestOk: updated.lastTestOk,
      lastError: updated.lastError,
    };
  }

  async remove(tenantId: string, type: string): Promise<{ deleted: boolean }> {
    await this.prisma.connectorConfig.delete({
      where: { tenantId_type: { tenantId, type: type as never } },
    });
    return { deleted: true };
  }

  async toggle(
    tenantId: string,
    type: string,
    enabled: boolean,
  ): Promise<{ type: string; enabled: boolean }> {
    await this.prisma.connectorConfig.update({
      where: { tenantId_type: { tenantId, type: type as never } },
      data: { enabled },
    });
    return { type, enabled };
  }

  async testConnection(tenantId: string, type: string): Promise<TestResult> {
    const config = await this.prisma.connectorConfig.findUnique({
      where: { tenantId_type: { tenantId, type: type as never } },
    });

    if (!config) throw new NotFoundException(`Connector '${type}' not found`);

    const decryptedConfig = this.decryptConfig(config.encryptedConfig);
    const start = Date.now();

    let ok = false;
    let details = '';

    try {
      switch (type) {
        case 'wazuh': {
          const result = await this.wazuhService.testConnection(decryptedConfig);
          ok = result.ok;
          details = result.details;
          break;
        }
        case 'graylog':
        case 'velociraptor':
        case 'grafana':
        case 'influxdb': {
          const result = await this.openSearchService.testConnection(type, decryptedConfig);
          ok = result.ok;
          details = result.details;
          break;
        }
        case 'misp': {
          const result = await this.mispService.testConnection(decryptedConfig);
          ok = result.ok;
          details = result.details;
          break;
        }
        case 'shuffle': {
          const result = await this.shuffleService.testConnection(decryptedConfig);
          ok = result.ok;
          details = result.details;
          break;
        }
        case 'bedrock': {
          const result = await this.bedrockService.testConnection(decryptedConfig);
          ok = result.ok;
          details = result.details;
          break;
        }
        default:
          details = `Unknown connector type: ${type}`;
      }
    } catch (error) {
      details = error instanceof Error ? error.message : 'Connection test failed';
    }

    const latencyMs = Date.now() - start;
    const testedAt = new Date();

    await this.prisma.connectorConfig.update({
      where: { tenantId_type: { tenantId, type: type as never } },
      data: {
        lastTestAt: testedAt,
        lastTestOk: ok,
        lastError: ok ? null : details,
      },
    });

    return { type, ok, latencyMs, details, testedAt: testedAt.toISOString() };
  }

  private decryptConfig(encryptedConfig: string): Record<string, unknown> {
    try {
      const raw = JSON.parse(encryptedConfig) as Record<string, unknown>;
      if ('placeholder' in raw) return raw;
      return raw;
    } catch {
      // Try decrypting
    }

    try {
      const decrypted = decrypt(encryptedConfig, this.encryptionKey);
      return JSON.parse(decrypted) as Record<string, unknown>;
    } catch {
      this.logger.warn('Failed to decrypt connector config, returning empty');
      return {};
    }
  }
}
