/** Fields needed from User when listing members — excludes passwordHash and oidcSub */
export const USER_MEMBER_SELECT = {
  select: {
    id: true,
    email: true,
    name: true,
    mfaEnabled: true,
    isProtected: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
  },
} as const
