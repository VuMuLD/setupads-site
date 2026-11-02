import os
import json
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from models.gemini_client import GeminiClient
from models.openai_client import OpenAIClient
from models.claude_client import ClaudeClient
from orchestrator.consensus import ConsensusEngine
from orchestrator.summarizer import DataSummarizer
from prompts.templates import (
    get_analysis_prompt,
    get_chat_prompt,
    get_weekly_prompt,
    get_message_advice_prompt,
    get_post_prompt,
    get_old_customer_message_prompt,
    get_learn_from_conversation_prompt,
)

load_dotenv()

app = FastAPI(title="FB Ads AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://setupads.site",
        "https://www.setupads.site",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

gemini = GeminiClient(os.getenv("GOOGLE_AI_API_KEY", ""))
openai_client = OpenAIClient(os.getenv("OPENAI_API_KEY", ""))
claude = ClaudeClient(os.getenv("ANTHROPIC_API_KEY", ""))
consensus_engine = ConsensusEngine(gemini, openai_client, claude)
summarizer = DataSummarizer()


class AnalyzeRequest(BaseModel):
    type: str = "daily"
    campaigns: list = []
    accountInsights: list = []
    ads: list = []
    selection: dict = {}
    language: str = "vi"


class ChatRequest(BaseModel):
    message: str
    model: str = "gemini"
    context: dict = {}
    language: str = "vi"
    history: list = []


class WritePostRequest(BaseModel):
    pageName: str
    product: dict = {}
    angle: str = "gioi_thieu"
    language: str = "vi"


class MessageAdviceRequest(BaseModel):
    pageName: str = "Page"
    tone: str = "thân thiện"
    customerMessage: str
    conversationHistory: list = []
    products: list = []
    customerPhotos: list = []
    language: str = "vi"
    consultingStage: str = "discovery"
    stageGuidance: str = ""
    consultingPlan: str = ""
    customerProfile: dict = {}
    customerOrders: list = []
    pageLearnings: list = []


class LearnFromConversationRequest(BaseModel):
    pageName: str = "Page"
    participantName: str = ""
    outcome: str = "progressed"
    consultingStage: str = "discovery"
    conversationHistory: list = []
    extractedOrder: dict = {}
    pastOrderCount: int = 0
    language: str = "vi"


class OldCustomerMessageRequest(BaseModel):
    pageName: str = "Page"
    programType: str = "old_customer_promo"
    products: list = []
    language: str = "vi"


@app.get("/health")
async def health():
    return {"status": "ok", "models": {
        "gemini": bool(os.getenv("GOOGLE_AI_API_KEY")),
        "openai": bool(os.getenv("OPENAI_API_KEY")),
        "claude": bool(os.getenv("ANTHROPIC_API_KEY")),
    }}


@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    summary = summarizer.summarize(
        request.campaigns,
        request.accountInsights,
        request.ads,
        request.selection,
    )

    if request.type == "weekly":
        prompt = get_weekly_prompt(summary, request.language)
    else:
        prompt = get_analysis_prompt(summary, request.language)

    if request.type == "weekly":
        result = await consensus_engine.analyze(prompt, model="consensus")
    else:
        result = await consensus_engine.analyze(prompt, model="gemini")

    recommendations = parse_recommendations(result.get("response", ""), request.campaigns)

    return {
        "analysis": result.get("response", ""),
        "recommendations": recommendations,
        "model": result.get("model", "gemini"),
        "consensusData": result.get("consensus_data"),
    }


@app.post("/chat")
async def chat(request: ChatRequest):
    prompt = get_chat_prompt(
        request.message,
        request.context,
        request.history,
        request.language,
    )

    result = await consensus_engine.analyze(prompt, model=request.model)

    return {
        "response": result.get("response", "Không thể tạo phản hồi."),
        "model": result.get("model", request.model),
    }


@app.post("/message-advice")
async def message_advice(request: MessageAdviceRequest):
    prompt = get_message_advice_prompt(
        request.pageName,
        request.tone,
        request.customerMessage,
        request.conversationHistory,
        request.products,
        request.customerPhotos,
        request.language,
        request.consultingStage,
        request.stageGuidance,
        request.consultingPlan,
        request.customerProfile,
        request.customerOrders,
        request.pageLearnings,
    )
    result = await consensus_engine.analyze(prompt, model="gemini")
    raw = result.get("response", "")
    head = raw.lstrip()[:80]
    if head.startswith("Lỗi ") or "chưa được cấu hình" in head or "API key" in head:
        raise HTTPException(status_code=502, detail=f"AI provider error: {raw[:200]}")
    parsed = parse_message_advice(raw)
    return {
        "reply": parsed.get("reply", raw[:500]),
        "nextStage": parsed.get("nextStage", request.consultingStage),
        "recommendedProducts": parsed.get("recommendedProducts", []),
        "sendImages": parsed.get("sendImages", []),
        "sendCustomerPhotos": parsed.get("sendCustomerPhotos", []),
        "model": result.get("model", "gemini"),
    }


@app.post("/write-post")
async def write_post(request: WritePostRequest):
    prompt = get_post_prompt(
        request.pageName,
        request.product,
        request.angle,
        request.language,
    )
    result = await consensus_engine.analyze(prompt, model="gemini")
    raw = (result.get("response", "") or "").strip()
    head = raw[:80]
    if raw.startswith("Lỗi ") or "chưa được cấu hình" in head or "API key" in head:
        raise HTTPException(status_code=502, detail=f"AI provider error: {raw[:200]}")
    return {"content": raw, "model": result.get("model", "gemini")}


@app.post("/learn-from-conversation")
async def learn_from_conversation(request: LearnFromConversationRequest):
    prompt = get_learn_from_conversation_prompt(
        request.pageName,
        request.participantName,
        request.outcome,
        request.consultingStage,
        request.conversationHistory,
        request.extractedOrder,
        request.pastOrderCount,
        request.language,
    )
    result = await consensus_engine.analyze(prompt, model="gemini")
    raw = result.get("response", "")
    parsed = parse_learn_from_conversation(raw)
    return {
        **parsed,
        "model": result.get("model", "gemini"),
    }


def parse_learn_from_conversation(response: str) -> dict:
    start = response.find("{")
    end = response.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            data = json.loads(response[start:end])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return {"customerSummary": "", "insights": [], "pageTips": [], "preferences": {}}


@app.post("/old-customer-message")
async def old_customer_message(request: OldCustomerMessageRequest):
    prompt = get_old_customer_message_prompt(
        request.pageName,
        request.programType,
        request.products,
        request.language,
    )
    result = await consensus_engine.analyze(prompt, model="gemini")
    raw = result.get("response", "")
    parsed = parse_old_customer_message(raw)
    return {
        "text": parsed.get("text", raw[:1500]),
        "name": parsed.get("name", "Tin nhắn khách cũ"),
        "model": result.get("model", "gemini"),
    }


def parse_old_customer_message(response: str) -> dict:
    start = response.find("{")
    end = response.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            data = json.loads(response[start:end])
            if isinstance(data, dict) and data.get("text"):
                return data
        except json.JSONDecodeError:
            pass
    return {"text": response.strip()[:1500], "name": "Tin nhắn khách cũ"}


def parse_message_advice(response: str) -> dict:
    start = response.find("{")
    end = response.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            data = json.loads(response[start:end])
            if isinstance(data, dict) and data.get("reply"):
                return data
        except json.JSONDecodeError:
            pass
    return {"reply": response.strip()[:1000], "recommendedProducts": [], "sendImages": [], "sendCustomerPhotos": []}


def parse_recommendations(response: str, campaigns: list) -> list:
    valid_types = {
        "PAUSE_CAMPAIGN",
        "RESUME_CAMPAIGN",
        "INCREASE_BUDGET",
        "DECREASE_BUDGET",
        "CHANGE_TARGETING",
        "DUPLICATE_CAMPAIGN",
        "OPTIMIZE_CREATIVE",
    }
    campaign_ids = {c.get("id") for c in campaigns if c.get("id")}
    campaign_map = {c.get("id"): c for c in campaigns}

    # Try JSON array extraction
    for start_char in ("[",):
        start = response.find(start_char)
        if start < 0:
            continue
        depth = 0
        end = -1
        for i in range(start, len(response)):
            if response[i] == "[":
                depth += 1
            elif response[i] == "]":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        if end > start:
            try:
                parsed = json.loads(response[start:end])
                if isinstance(parsed, list) and parsed:
                    cleaned = []
                    for item in parsed:
                        if not isinstance(item, dict):
                            continue
                        rec_type = item.get("type", "")
                        if rec_type not in valid_types:
                            continue
                        conf = float(item.get("confidence", 0.6))
                        if conf < 0.55:
                            continue
                        cid = item.get("campaignId")
                        if cid and cid not in campaign_ids:
                            continue
                        campaign = campaign_map.get(cid, {})
                        action = item.get("suggestedAction") or {}
                        if rec_type in ("INCREASE_BUDGET", "DECREASE_BUDGET"):
                            current = campaign.get("dailyBudget") or campaign.get("daily_budget") or 0
                            if current and "newBudget" not in action:
                                mult = 1.15 if rec_type == "INCREASE_BUDGET" else 0.85
                                action = {"newBudget": round(current * mult)}
                        cleaned.append({
                            "campaignId": cid,
                            "type": rec_type,
                            "confidence": min(conf, 0.95),
                            "reasoningVi": item.get("reasoningVi", "")[:500],
                            "suggestedAction": action,
                        })
                    if cleaned:
                        return cleaned[:5]
            except (json.JSONDecodeError, ValueError, TypeError):
                pass

    # Fallback keyword parsing
    recommendations = []
    lines = response.split("\n")
    for line in lines:
        line_lower = line.lower()
        if any(kw in line_lower for kw in ["pause", "tạm dừng", "dừng campaign"]):
            for cid, campaign in campaign_map.items():
                if campaign.get("name", "").lower() in line_lower:
                    recommendations.append({
                        "campaignId": cid,
                        "type": "PAUSE_CAMPAIGN",
                        "confidence": 0.72,
                        "reasoningVi": line.strip()[:500],
                        "suggestedAction": {"action": "pause"},
                    })
        elif any(kw in line_lower for kw in ["tăng budget", "tăng ngân sách", "increase budget"]):
            for cid, campaign in campaign_map.items():
                if campaign.get("name", "").lower() in line_lower:
                    current = campaign.get("dailyBudget") or campaign.get("daily_budget") or 0
                    recommendations.append({
                        "campaignId": cid,
                        "type": "INCREASE_BUDGET",
                        "confidence": 0.7,
                        "reasoningVi": line.strip()[:500],
                        "suggestedAction": {"newBudget": round(current * 1.15) if current else None},
                    })

    return recommendations[:5]
