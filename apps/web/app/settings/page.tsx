import { Suspense } from "react";
import SettingsPage from "./settings-content";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Đang tải...</div>}>
      <SettingsPage />
    </Suspense>
  );
}
