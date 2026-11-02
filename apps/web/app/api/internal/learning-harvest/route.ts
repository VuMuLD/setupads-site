import { NextRequest, NextResponse } from "next/server";
import { runLearningHarvest } from "@/lib/jobs/learning-harvest";

/**
 * Kích hoạt thu hoạch học tập thủ công (nội bộ).
 * Bảo vệ bằng header x-internal-token khớp LEARNING_HARVEST_TOKEN trong .env.local.
 */
export async function POST(request: NextRequest) {
  const token = process.env.LEARNING_HARVEST_TOKEN;
  if (!token || request.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runLearningHarvest();
  return NextResponse.json(result);
}
