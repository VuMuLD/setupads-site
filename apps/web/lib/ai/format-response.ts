const TYPE_LABELS: Record<string, string> = {
  INCREASE_BUDGET: "Tăng ngân sách",
  DECREASE_BUDGET: "Giảm ngân sách",
  PAUSE_CAMPAIGN: "Tạm dừng campaign",
  RESUME_CAMPAIGN: "Chạy lại campaign",
  CHANGE_TARGETING: "Điều chỉnh targeting",
  DUPLICATE_CAMPAIGN: "Nhân bản campaign",
  OPTIMIZE_CREATIVE: "Tối ưu creative",
};

const TYPE_COLORS: Record<string, string> = {
  INCREASE_BUDGET: "bg-green-100 text-green-800 border-green-200",
  DECREASE_BUDGET: "bg-amber-100 text-amber-800 border-amber-200",
  PAUSE_CAMPAIGN: "bg-red-100 text-red-800 border-red-200",
  RESUME_CAMPAIGN: "bg-blue-100 text-blue-800 border-blue-200",
  CHANGE_TARGETING: "bg-purple-100 text-purple-800 border-purple-200",
  DUPLICATE_CAMPAIGN: "bg-indigo-100 text-indigo-800 border-indigo-200",
  OPTIMIZE_CREATIVE: "bg-cyan-100 text-cyan-800 border-cyan-200",
};

export function getRecommendationLabel(type: string): string {
  return TYPE_LABELS[type] || type.replace(/_/g, " ");
}

export function getRecommendationColor(type: string): string {
  return TYPE_COLORS[type] || "bg-slate-100 text-slate-800 border-slate-200";
}

export interface ParsedSection {
  title: string;
  body: string;
}

/** Tách phần phân tích (bỏ JSON array ở cuối) */
export function parseAnalysisSections(text: string): ParsedSection[] {
  let clean = text.trim();
  const jsonStart = clean.search(/\[\s*\{/);
  if (jsonStart > 0) {
    clean = clean.slice(0, jsonStart).trim();
  }

  const sections: ParsedSection[] = [];
  const parts = clean.split(/(?=^##\s)/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^##\s+(.+)\n([\s\S]*)$/);
    if (match) {
      sections.push({ title: match[1].trim(), body: match[2].trim() });
    } else if (!sections.length) {
      sections.push({ title: "Phân tích", body: trimmed });
    } else {
      sections[sections.length - 1].body += `\n\n${trimmed}`;
    }
  }

  if (!sections.length && clean) {
    sections.push({ title: "Phân tích", body: clean });
  }

  return sections;
}

export function formatInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "• $1")
    .replace(/^\d+\.\s(.+)$/gm, "→ $1");
}
