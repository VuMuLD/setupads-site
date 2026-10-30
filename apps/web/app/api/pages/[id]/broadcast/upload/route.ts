import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { getUploadedFiles } from "@/lib/uploads/form-data-file";
import { saveMultipleUploads } from "@/lib/uploads/page-uploads";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { id: pageId } = await params;

  const page = await prisma.page.findFirst({
    where: { id: pageId, facebookAccount: { userId: session!.user.id } },
  });
  if (!page) {
    return NextResponse.json({ error: "Page không tồn tại" }, { status: 404 });
  }

  try {
    const form = await request.formData();
    const files = getUploadedFiles(form, "images");
    if (files.length === 0) {
      return NextResponse.json({ error: "Chọn ít nhất 1 ảnh" }, { status: 400 });
    }

    const urls = await saveMultipleUploads(pageId, "broadcast", files);
    return NextResponse.json({ urls });
  } catch (err) {
    console.error("[broadcast upload]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không thể tải ảnh" },
      { status: 500 }
    );
  }
}
