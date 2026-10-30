import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmailNotification } from "./email";
import { sendTelegramNotification } from "./telegram";

interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  channels?: Array<"WEB" | "EMAIL" | "TELEGRAM">;
}

export async function createNotification(input: CreateNotificationInput) {
  const channels = input.channels || ["WEB"];

  for (const channel of channels) {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        channel,
        title: input.title,
        message: input.message,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    if (channel === "EMAIL") {
      const user = await prisma.user.findUnique({ where: { id: input.userId } });
      if (user?.email) {
        await sendEmailNotification(user.email, input.title, input.message);
      }
    }

    if (channel === "TELEGRAM") {
      await sendTelegramNotification(input.title, input.message);
    }
  }
}
