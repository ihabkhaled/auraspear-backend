import { z } from 'zod';

export const AiInvestigateSchema = z.object({
  alertId: z.string().min(1, 'Alert ID is required'),
  alertData: z.record(z.string(), z.unknown()).optional(),
});

export type AiInvestigateDto = z.infer<typeof AiInvestigateSchema>;
