export interface TenantRecord {
  id: string
  name: string
  slug: string
  createdAt: Date
}

export interface UserRecord {
  id: string
  email: string
  name: string
  role: string
  createdAt: Date
}
