// Update the pinned LUẬT CÂU ĐẦU TIÊN tip on all 3 Pages with the exact
// first-reply sentence (user 16/11). Run from apps/web with tsx.
// ai_consulting_insights is a Prisma Json field: read as array, save array.
import fs from "fs";

const NEW_TIP =
  "LUẬT CÂU ĐẦU TIÊN (chủ shop chốt 8/11, sửa câu 16/11): Page chỉ bán DUY NHẤT Bộ Nồi Đức Engelberg 6 Món Inox 304 — tư vấn thẳng bộ này, TUYỆT ĐỐI không hỏi khách đang tìm hay quan tâm sản phẩm gì. Câu trả lời đầu tiên dùng đúng câu này, nguyên văn, không sửa chữ nào: 'Dạ bộ nồi Đức 6 món cao cấp giá 699.000đ, được kiểm tra hàng trước khi nhận và miễn phí ship anh/chị nhé 🍳' — dòng 2 là câu hỏi tư vấn đúng mẫu: 'anh/chị dùng bếp ga hay bếp từ để em tư vấn tốt nhất cho mình ạ' — TUYỆT ĐỐI không hỏi chốt mua ở tin đầu. Luôn gọi sản phẩm là 'bộ nồi Đức 6 món cao cấp', KHÔNG gọi tắt 'bộ nồi inox 304'. PHONG CÁCH (chủ shop chốt 8/11): chỉ gọi khách là anh hoặc chị (chưa rõ thì dùng anh/chị), TUYỆT ĐỐI không nhắc tên khách trong câu trả lời; câu thật ngắn, đúng trọng tâm, mỗi ý viết 1 dòng riêng cho dễ nhìn; giọng tự nhiên như người thật chat.";

async function main() {
  const envText = fs.readFileSync(".env.local", "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
  const { prisma } = await import("../lib/prisma");
  const pages = await prisma.page.findMany({
    select: { id: true, name: true, aiConsultingInsights: true },
  });
  for (const page of pages) {
    const insights = (Array.isArray(page.aiConsultingInsights) ? page.aiConsultingInsights : []) as Array<{
      stage?: string;
      tip?: string;
      pinned?: boolean;
    }>;
    const idx = insights.findIndex(
      (x) => x.pinned && typeof x.tip === "string" && x.tip.startsWith("LUẬT CÂU ĐẦU TIÊN")
    );
    if (idx >= 0) {
      insights[idx] = { ...insights[idx], tip: NEW_TIP };
      console.log(`${page.name}: updated pinned first-reply tip`);
    } else {
      insights.unshift({ stage: "greeting", tip: NEW_TIP, pinned: true });
      console.log(`${page.name}: added pinned first-reply tip (none found)`);
    }
    await prisma.page.update({
      where: { id: page.id },
      data: { aiConsultingInsights: insights },
    });
  }
  await prisma.$disconnect();
  console.log("DONE");
}

main();
