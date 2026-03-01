import { PrismaClient, UserRole, ConnectorType, AuthType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const TENANTS = [
  { id: randomUUID(), name: 'Aura Finance', slug: 'aura-finance' },
  { id: randomUUID(), name: 'Aura Health', slug: 'aura-health' },
  { id: randomUUID(), name: 'Aura Enterprise', slug: 'aura-enterprise' },
];

async function main(): Promise<void> {
  console.warn('Seeding database...');

  for (const tenant of TENANTS) {
    await prisma.tenant.upsert({
      where: { slug: tenant.slug },
      update: {},
      create: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
    });

    // Create demo users for each tenant
    const users = [
      {
        oidcSub: `admin-${tenant.slug}`,
        email: `admin@${tenant.slug}.io`,
        name: 'Admin User',
        role: UserRole.TENANT_ADMIN,
      },
      {
        oidcSub: `analyst-l2-${tenant.slug}`,
        email: `analyst.l2@${tenant.slug}.io`,
        name: 'Senior Analyst',
        role: UserRole.SOC_ANALYST_L2,
      },
      {
        oidcSub: `analyst-l1-${tenant.slug}`,
        email: `analyst.l1@${tenant.slug}.io`,
        name: 'Junior Analyst',
        role: UserRole.SOC_ANALYST_L1,
      },
      {
        oidcSub: `hunter-${tenant.slug}`,
        email: `hunter@${tenant.slug}.io`,
        name: 'Threat Hunter',
        role: UserRole.THREAT_HUNTER,
      },
      {
        oidcSub: `exec-${tenant.slug}`,
        email: `exec@${tenant.slug}.io`,
        name: 'Executive',
        role: UserRole.EXECUTIVE_READONLY,
      },
    ];

    for (const user of users) {
      await prisma.tenantUser.upsert({
        where: {
          tenantId_oidcSub: { tenantId: tenant.id, oidcSub: user.oidcSub },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          oidcSub: user.oidcSub,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    }

    // Create default connector configs (encrypted_config is placeholder in seed)
    const connectors: Array<{
      type: ConnectorType;
      name: string;
      authType: AuthType;
      enabled: boolean;
    }> = [
      { type: ConnectorType.wazuh, name: 'Wazuh Manager', authType: AuthType.basic, enabled: true },
      { type: ConnectorType.graylog, name: 'Graylog SIEM', authType: AuthType.token, enabled: true },
      {
        type: ConnectorType.velociraptor,
        name: 'Velociraptor EDR',
        authType: AuthType.api_key,
        enabled: false,
      },
      { type: ConnectorType.grafana, name: 'Grafana', authType: AuthType.api_key, enabled: true },
      { type: ConnectorType.influxdb, name: 'InfluxDB', authType: AuthType.token, enabled: true },
      { type: ConnectorType.misp, name: 'MISP Threat Intel', authType: AuthType.api_key, enabled: true },
      { type: ConnectorType.shuffle, name: 'Shuffle SOAR', authType: AuthType.api_key, enabled: false },
      { type: ConnectorType.bedrock, name: 'AWS Bedrock AI', authType: AuthType.iam, enabled: true },
    ];

    for (const connector of connectors) {
      await prisma.connectorConfig.upsert({
        where: {
          tenantId_type: { tenantId: tenant.id, type: connector.type },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          type: connector.type,
          name: connector.name,
          authType: connector.authType,
          enabled: connector.enabled,
          encryptedConfig: JSON.stringify({ placeholder: true }),
        },
      });
    }
  }

  console.warn('Seed completed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
