import { NextRequest, NextResponse } from "next/server";
import {
  runLearningBackfill,
  runLearningHarvest,
} from "@/lib/jobs/learning-harvest";

/**
 * Kích hoạt thu hoạch học tập thủ công (nội bộ).
 * Bảo vệ bằng header x-internal-token khớp LEARNING_HARVEST_TOKEN trong .env.local.
 * - Không body: thu hoạch 24h cho mọi Page (như job mỗi tối).
 * - Body { pageId, days? }: học ngược lịch sử tin nhắn cũ của riêng Page đó.
 */
export async function POST(request: NextRequest) {
  const token = process.env.LEARNING_HARVEST_TOKEN;
  if (!token || request.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    pageId?: string;
    days?: number;
  } | null;
  if (body?.pageId) {
    const result = await runLearningBackfill(
      body.pageId,
      Math.min(Math.max(body.days ?? 90, 1), 365)
    );
    return NextResponse.json(result);
  }
  const result = await runLearningHarvest();
  return NextResponse.json(result);
}
