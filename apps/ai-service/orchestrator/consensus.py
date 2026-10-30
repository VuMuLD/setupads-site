import asyncio
import json
from collections import Counter


class ConsensusEngine:
    WEIGHTS = {
        "gemini": 0.3,
        "gpt4o": 0.35,
        "claude": 0.35,
    }

    def __init__(self, gemini, openai_client, claude):
        self.gemini = gemini
        self.openai = openai_client
        self.claude = claude

    async def analyze(self, prompt: str, model: str = "gemini") -> dict:
        if model == "consensus":
            return await self._consensus_analyze(prompt)
        elif model == "gpt4o":
            response = await self.openai.generate(prompt)
            return {"response": response, "model": "gpt4o"}
        elif model == "claude":
            response = await self.claude.generate(prompt)
            return {"response": response, "model": "claude"}
        else:
            response = await self.gemini.generate(prompt)
            return {"response": response, "model": "gemini"}

    async def _consensus_analyze(self, prompt: str) -> dict:
        results = await asyncio.gather(
            self.gemini.generate(prompt),
            self.openai.generate(prompt),
            self.claude.generate(prompt),
            return_exceptions=True,
        )

        model_names = ["gemini", "gpt4o", "claude"]
        votes = []
        valid_responses = []

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                continue
            if result and not result.startswith("Lỗi"):
                valid_responses.append(result)
                votes.append({
                    "model": model_names[i],
                    "response": result,
                    "weight": self.WEIGHTS[model_names[i]],
                })

        if not valid_responses:
            return {
                "response": "Tất cả AI models đều thất bại. Kiểm tra API keys.",
                "model": "consensus",
            }

        if len(valid_responses) == 1:
            return {
                "response": valid_responses[0],
                "model": "consensus",
                "consensus_data": {"votes": votes, "agreement": 1.0},
            }

        best_response = self._select_best_response(valid_responses)
        agreement = len(valid_responses) / 3

        return {
            "response": best_response,
            "model": "consensus",
            "consensus_data": {
                "votes": [{"model": v["model"], "weight": v["weight"]} for v in votes],
                "agreement": agreement,
                "models_used": len(valid_responses),
            },
        }

    def _select_best_response(self, responses: list) -> str:
        action_keywords = {
            "pause": ["pause", "tạm dừng", "dừng"],
            "increase": ["tăng", "increase"],
            "decrease": ["giảm", "decrease"],
        }

        action_votes = Counter()
        for response in responses:
            response_lower = response.lower()
            for action, keywords in action_keywords.items():
                if any(kw in response_lower for kw in keywords):
                    action_votes[action] += 1

        longest = max(responses, key=len)
        return longest
