import { NestFactory } from '@nestjs/core'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { GlobalExceptionFilter } from './common/filters/http-exception.filter'
import type { Express } from 'express'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  // Structured logging
  app.useLogger(app.get(Logger))

  // Trust proxy (Vercel, load balancers) — ensures correct client IP for rate limiting/logging
  const expressApp = app.getHttpAdapter().getInstance() as Express
  expressApp.set('trust proxy', true)

  // Security headers
  app.use(helmet())

  // CORS
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) ?? [
    'http://localhost:3000',
  ]
  app.enableCors({ origin: corsOrigins, credentials: true })

  // Global prefix (exclude root route)
  app.setGlobalPrefix('api/v1', { exclude: ['/'] })

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter())

  // Swagger
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AuraSpear SOC BFF')
      .setDescription('Multi-tenant SIEM Backend-for-Frontend API')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication')
      .addTag('tenants', 'Tenant management')
      .addTag('connectors', 'Connector CRUD & testing')
      .addTag('alerts', 'Alert search & investigation')
      .addTag('dashboards', 'Dashboard data')
      .addTag('hunts', 'Threat hunting')
      .addTag('cases', 'Case management')
      .addTag('intel', 'Threat intelligence')
      .addTag('ai', 'AI/Bedrock endpoints')
      .addTag('health', 'Health checks')
      .build()

    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup('api/docs', app, document)
  }

  const port = process.env.PORT ?? 4000
  await app.listen(port)
}

void bootstrap()
