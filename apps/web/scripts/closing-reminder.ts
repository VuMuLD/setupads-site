// Wrapper chạy vòng nhắc chốt đơn 9h/16h/21h.
// Dùng: npx tsx scripts/closing-reminder.ts [--live] [--slot 9|16|21] [--force]
// Mặc định CHẠY KHÔ (chỉ liệt kê khách đủ điều kiện, không gửi, không ghi DB).
// --live mới gửi thật (và chỉ trong khung slot:00-slot:30 giờ Sài Gòn, trừ khi --force).
import { readFileSync, existsSync } from "fs";
import { join } from "path";

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function parseSlot(): number {
  const idx = process.argv.indexOf("--slot");
  if (idx >= 0) {
    const s = Number(process.argv[idx + 1]);
    if (s === 9 || s === 16 || s === 21) return s;
    throw new Error(`--slot phải là 9, 16 hoặc 21 (nhận: ${process.argv[idx + 1]})`);
  }
  // Không truyền --slot: suy ra từ giờ Sài Gòn hiện tại
  const h = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  if (h < 12) return 9;
  if (h < 19) return 16;
  return 21;
}

async function main() {
  loadEnvLocal();
  const live = process.argv.includes("--live");
  const force = process.argv.includes("--force");
  const slot = parseSlot();
  const { runClosingReminder } = await import("../lib/jobs/closing-reminder");
  const { prisma } = await import("../lib/prisma");
  try {
    const result = await runClosingReminder({ dryRun: !live, slot, force });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[closing-reminder] FAILED:", err);
  process.exit(1);
});
