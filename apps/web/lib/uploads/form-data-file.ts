export interface UploadedFile {
  name: string;
  size: number;
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Node 18 không có global File — dùng duck-type thay vì instanceof */
export function isUploadedFile(value: unknown): value is UploadedFile {
  if (!value || typeof value !== "object") return false;
  const file = value as UploadedFile;
  return (
    typeof file.arrayBuffer === "function" &&
    typeof file.size === "number" &&
    file.size > 0
  );
}

export function getUploadedFiles(form: FormData, field: string): UploadedFile[] {
  const files: UploadedFile[] = [];
  for (const entry of form.getAll(field)) {
    if (isUploadedFile(entry)) files.push(entry);
  }
  return files;
}
