// Wrapper chạy vòng mời lại 21:00. Dùng: npx tsx scripts/repitch-21h.ts [--live] [--force]
// Mặc định CHẠY KHÔ (chỉ liệt kê khách đủ điều kiện, không gửi, không ghi DB).
// --live mới gửi thật (và chỉ trong khung 21:00-21:30 giờ Sài Gòn, trừ khi --force).
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

async function main() {
  loadEnvLocal();
  const live = process.argv.includes("--live");
  const force = process.argv.includes("--force");
  const { runDailyRepitch } = await import("../lib/jobs/daily-repitch");
  const { prisma } = await import("../lib/prisma");
  try {
    const result = await runDailyRepitch({ dryRun: !live, force });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[repitch-21h] FAILED:", err);
  process.exit(1);
});
