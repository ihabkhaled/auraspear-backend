import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 2000

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry(1)
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }

  private async connectWithRetry(attempt: number): Promise<void> {
    try {
      await this.$connect()
      this.logger.log('Database connection established')
    } catch (error: unknown) {
      if (attempt >= MAX_RETRIES) {
        this.logger.error(`Failed to connect after ${MAX_RETRIES} attempts`)
        throw error
      }
      const delay = BASE_DELAY_MS * attempt
      this.logger.warn(
        `Database connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms`
      )
      await new Promise<void>(resolve => {
        setTimeout(resolve, delay)
      })
      await this.connectWithRetry(attempt + 1)
    }
  }
}
