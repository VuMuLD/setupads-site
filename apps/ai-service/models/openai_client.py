from openai import AsyncOpenAI


class OpenAIClient:
    def __init__(self, api_key: str):
        self.client = AsyncOpenAI(api_key=api_key) if api_key else None

    async def generate(self, prompt: str) -> str:
        if not self.client:
            return "OpenAI API key chưa được cấu hình."
        try:
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "Bạn là chuyên gia tối ưu quảng cáo Facebook. Trả lời bằng tiếng Việt."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=2000,
                temperature=0.3,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            return f"Lỗi OpenAI: {str(e)}"
