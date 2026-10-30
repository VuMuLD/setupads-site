import os

import google.generativeai as genai

DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


class GeminiClient:
    def __init__(self, api_key: str, model_name: str | None = None):
        self.api_key = api_key
        self.model_name = model_name or DEFAULT_GEMINI_MODEL
        self.model = None
        if api_key:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(self.model_name)

    async def generate(self, prompt: str) -> str:
        if not self.model:
            return "Gemini API key chưa được cấu hình."
        try:
            response = await self.model.generate_content_async(prompt)
            return response.text
        except Exception as e:
            return f"Lỗi Gemini: {str(e)}"
