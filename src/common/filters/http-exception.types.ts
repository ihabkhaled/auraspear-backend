export interface ErrorResponse {
  statusCode: number
  message: string | string[]
  messageKey: string
  errors?: string[]
  error: string
  timestamp: string
  path: string
}
