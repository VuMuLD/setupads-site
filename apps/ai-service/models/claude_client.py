import anthropic


class ClaudeClient:
    def __init__(self, api_key: str):
        self.client = anthropic.AsyncAnthropic(api_key=api_key) if api_key else None

    async def generate(self, prompt: str) -> str:
        if not self.client:
            return "Anthropic API key chưa được cấu hình."
        try:
            response = await self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=2000,
                system="Bạn là chuyên gia tối ưu quảng cáo Facebook. Trả lời bằng tiếng Việt.",
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text
        except Exception as e:
            return f"Lỗi Claude: {str(e)}"
