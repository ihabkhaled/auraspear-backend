import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { AppController } from './app.controller'
import { AuthGuard } from './common/guards/auth.guard'
import { RolesGuard } from './common/guards/roles.guard'
import { TenantGuard } from './common/guards/tenant.guard'
import { AuditInterceptor } from './common/interceptors/audit.interceptor'
import { validateEnvironment } from './config/env.validation'
import { AiModule } from './modules/ai/ai.module'
import { AlertsModule } from './modules/alerts/alerts.module'
import { AppLogsModule } from './modules/app-logs/app-logs.module'
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module'
import { AuthModule } from './modules/auth/auth.module'
import { CaseCyclesModule } from './modules/case-cycles/case-cycles.module'
import { CasesModule } from './modules/cases/cases.module'
import { ConnectorSyncModule } from './modules/connector-sync/connector-sync.module'
import { ConnectorWorkspacesModule } from './modules/connector-workspaces/connector-workspaces.module'
import { ConnectorsModule } from './modules/connectors/connectors.module'
import { DashboardsModule } from './modules/dashboards/dashboards.module'
import { HealthModule } from './modules/health/health.module'
import { HuntsModule } from './modules/hunts/hunts.module'
import { IntelModule } from './modules/intel/intel.module'
import { TenantsModule } from './modules/tenants/tenants.module'
import { UsersModule } from './modules/users/users.module'
import { PrismaModule } from './prisma/prisma.module'

@Module({
  controllers: [AppController],
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // Structured logging
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
        level: process.env.LOG_LEVEL ?? 'info',
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.confirmPassword',
        ],
      },
    }),

    // Database
    PrismaModule,

    // Feature modules
    AuthModule,
    TenantsModule,
    ConnectorsModule,
    ConnectorWorkspacesModule,
    ConnectorSyncModule,
    AlertsModule,
    AppLogsModule,
    AuditLogsModule,
    DashboardsModule,
    HuntsModule,
    CaseCyclesModule,
    CasesModule,
    IntelModule,
    AiModule,
    HealthModule,
    UsersModule,
  ],
  providers: [
    // Global guards (order matters: auth → tenant → roles)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },

    // Global interceptors
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
