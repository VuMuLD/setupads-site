import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

interface AuditLogInput {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  ipAddress?: string;
}

export async function createAuditLog(input: AuditLogInput) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeData: input.beforeData as Prisma.InputJsonValue | undefined,
      afterData: input.afterData as Prisma.InputJsonValue | undefined,
      ipAddress: input.ipAddress,
    },
  });
}
