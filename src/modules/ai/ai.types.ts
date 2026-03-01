export interface AiTokenUsage {
  input: number
  output: number
}

export interface AiResponse {
  result: string
  reasoning: string[]
  confidence: number
  model: string
  tokensUsed: AiTokenUsage
}
