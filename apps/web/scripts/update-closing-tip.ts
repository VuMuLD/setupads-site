// Cap nhat pinned tip closing tren ca 3 Page Engelberg: them CAU CHOT 12/11.
// Chi sua dung tip pinned stage=closing; cac tip khac giu nguyen.
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

const PAGE_IDS = [
  "cmrafc8zk0003ltbhnkeunvaw", // Bếp Việt
  "cmrafc9fv000hltbhj2eb57ou", // Thế Giới Đồ Gia Dụng
  "cmvvmzz5v00i7ltq9b1sjkyw6", // Siêu Thị Gia Dụng
];

const NEW_TIP =
  "LÊN ĐƠN: chỉ chốt đơn khi đã ĐỦ số điện thoại VÀ địa chỉ giao hàng thật của khách. " +
  "CÂU CHỐT (chủ shop chốt 12/11): khi khách đã tỏ ý muốn mua mà còn thiếu thông tin, hỏi đúng câu này, nguyên văn, không sửa chữ nào: " +
  "'👉 Anh/Chị cho em xin Tên + SĐT + Địa chỉ, em lên đơn cho mình ạ'. " +
  "Thiếu một trong hai (SĐT/địa chỉ) thì chưa lên đơn, chưa gửi phiếu xác nhận. " +
  "PHONG CÁCH (chủ shop chốt 8/11): chỉ gọi khách là anh hoặc chị (chưa rõ thì dùng anh/chị), TUYỆT ĐỐI không nhắc tên khách trong câu trả lời; " +
  "câu thật ngắn, đúng trọng tâm, mỗi ý viết 1 dòng riêng cho dễ nhìn; giọng tự nhiên như người thật chat. " +
  "Khi khách đã đủ SĐT + địa chỉ thì lên đơn và gửi phiếu ngay, TUYỆT ĐỐI không hỏi thêm bất cứ câu nào khác.";

async function main() {
  loadEnvLocal();
  const { prisma } = await import("../lib/prisma");
  try {
    for (const id of PAGE_IDS) {
      const page = await prisma.page.findUnique({ where: { id } });
      if (!page) throw new Error(`Khong thay Page ${id}`);
      // Prisma Json type: da parse san thanh array, khong JSON.parse lai
      const tips = (page.aiConsultingInsights as any[]) || [];
      const idx = tips.findIndex(
        (t: any) => t.stage === "closing" && t.pinned === true
      );
      if (idx < 0) throw new Error(`Khong thay pinned closing tip: ${page.name}`);
      const old = tips[idx].tip as string;
      if (old === NEW_TIP) {
        console.log(`${page.name}: da co CAU CHOT, khong doi`);
        continue;
      }
      if (!old.startsWith("LÊN ĐƠN:")) {
        throw new Error(`Pinned closing tip la: ${page.name} (khong dung mau)`);
      }
      tips[idx].tip = NEW_TIP;
      await prisma.page.update({
        where: { id },
        data: { aiConsultingInsights: tips },
      });
      console.log(`${page.name}: cap nhat pinned closing tip OK`);
    }
    // Kiem chung lai
    for (const id of PAGE_IDS) {
      const page = await prisma.page.findUnique({ where: { id } });
      const tips = (page!.aiConsultingInsights as any[]) || [];
      const tip = tips.find(
        (t: any) => t.stage === "closing" && t.pinned === true
      );
      console.log(
        `${page!.name}: verify ${tip && tip.tip.includes("CÂU CHỐT") && tip.tip.includes("👉 Anh/Chị cho em xin Tên + SĐT + Địa chỉ") ? "PASS" : "FAIL"}`
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
