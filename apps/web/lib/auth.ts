import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/token-encryption";

// @ts-ignore - NextAuth v5 ESM default export type resolution
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export async function getFacebookAccessToken(userId: string): Promise<string | null> {
  const fbAccount = await prisma.facebookAccount.findFirst({
    where: { userId, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!fbAccount) return null;

  if (fbAccount.expiresAt && fbAccount.expiresAt < new Date()) {
    return null;
  }

  return decrypt(fbAccount.accessTokenEncrypted);
}

export async function getSelectedAdAccount(userId: string) {
  const fbAccount = await prisma.facebookAccount.findFirst({
    where: { userId, isActive: true },
    include: {
      adAccounts: {
        where: { isSelected: true, isActive: true },
        take: 1,
      },
    },
  });

  return fbAccount?.adAccounts[0] ?? null;
}

export async function getSelectedPage(userId: string) {
  const fbAccount = await prisma.facebookAccount.findFirst({
    where: { userId, isActive: true },
    include: {
      pages: {
        where: { isSelected: true, isActive: true },
        take: 1,
      },
    },
  });

  return fbAccount?.pages[0] ?? null;
}

export async function getPageAccessToken(userId: string, pageId: string): Promise<string | null> {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      isActive: true,
      facebookAccount: { userId, isActive: true },
    },
  });

  if (!page?.accessTokenEncrypted) return null;
  return decrypt(page.accessTokenEncrypted);
}

export async function getUserPages(userId: string) {
  const fbAccount = await prisma.facebookAccount.findFirst({
    where: { userId, isActive: true },
    include: {
      pages: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        include: {
          _count: { select: { conversations: true, products: true } },
        },
      },
    },
  });

  return fbAccount?.pages ?? [];
}
