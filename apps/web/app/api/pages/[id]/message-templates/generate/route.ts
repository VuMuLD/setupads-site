import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;
  const body = await request.json().catch(() => ({}));
  const programType = String(body.programType || "old_customer_promo");

  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId: session!.user.id } },
  });
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  const products = await prisma.pageProduct.findMany({
    where: { pageId, isActive: true },
    take: 10,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  try {
    const response = await fetch(`${AI_SERVICE_URL}/old-customer-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pageName: page.name,
        programType,
        products: products.map((p) => ({
          name: p.name,
          price: p.price,
          currency: p.currency,
          description: p.description,
        })),
        language: "vi",
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json({
      text: data.text,
      name: data.name || "Tin nhắn khách cũ (AI)",
      model: data.model,
    });
  } catch (err) {
    console.error("[generate template]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tạo được nội dung AI" },
      { status: 500 }
    );
  }
}
