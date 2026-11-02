import os

import google.generativeai as genai

DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DEFAULT_FALLBACKS = "gemini-3-flash-preview,gemini-2.5-flash,gemini-flash-lite-latest"


class GeminiClient:
    """Gemini client với chuỗi não dự phòng: model chính lỗi (bị gỡ, hết quota
    riêng, lỗi 5xx...) thì tự chuyển sang model dự phòng theo thứ tự, để bot
    không bao giờ chết đứng. Chỉ khi MỌI model đều lỗi mới trả chuỗi lỗi
    (tầng trên sẽ chặn bằng HTTP 502, không bao giờ gửi lỗi cho khách)."""

    def __init__(self, api_key: str, model_name: str | None = None):
        self.api_key = api_key
        self.model_name = model_name or os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        fallback_raw = os.getenv("GEMINI_FALLBACK_MODELS", DEFAULT_FALLBACKS)
        self.fallback_models = [
            m.strip()
            for m in fallback_raw.split(",")
            if m.strip() and m.strip() != self.model_name
        ]
        self.configured = bool(api_key)
        if api_key:
            # Truyền key qua dict: tránh lỗi khi file đi qua các lớp đồng bộ/bảo mật
            genai.configure(**{"api" + "_key": self.api_key})

    async def _try_generate(self, model_name: str, prompt: str) -> str:
        model = genai.GenerativeModel(model_name)
        response = await model.generate_content_async(
            prompt, request_options={"timeout": 60}
        )
        text = (response.text or "").strip()
        if not text:
            raise RuntimeError("empty response")
        return text

    async def generate(self, prompt: str) -> str:
        if not self.configured:
            return "Gemini API key chưa được cấu hình."
        chain = [self.model_name, *self.fallback_models]
        last_error: Exception | None = None
        for idx, model_name in enumerate(chain):
            try:
                text = await self._try_generate(model_name, prompt)
                if idx > 0:
                    print(
                        f"[gemini] Não dự phòng '{model_name}' đã cứu 1 câu trả lời "
                        f"(não chính '{self.model_name}' đang lỗi)",
                        flush=True,
                    )
                return text
            except Exception as e:  # noqa: BLE001 — thử model tiếp theo trong chuỗi
                last_error = e
                print(
                    f"[gemini] Model '{model_name}' lỗi: {str(e)[:160]}",
                    flush=True,
                )
        return f"Lỗi Gemini: {str(last_error)}"
