def get_analysis_prompt(summary: str, language: str = "vi") -> str:
    lang = "tiếng Việt" if language == "vi" else "English"
    return f"""Bạn là chuyên gia tối ưu quảng cáo Facebook (10+ năm kinh nghiệm) cho thị trường Việt Nam.

DỮ LIỆU (30 ngày gần nhất):
{summary}

QUY TẮC ĐỀ XUẤT (bắt buộc):
- ROAS ≥ 2.0 và spend > 100,000 VND → cân nhắc INCREASE_BUDGET (+10% đến +20%), confidence 0.75–0.9
- ROAS < 1.0 và spend > 200,000 VND → DECREASE_BUDGET (-15% đến -30%) hoặc PAUSE_CAMPAIGN, confidence 0.8+
- CTR < 0.8% và impressions > 5,000 → OPTIMIZE_CREATIVE, confidence 0.7+
- Spend > 0 nhưng conversions = 0 → PAUSE_CAMPAIGN + kiểm tra pixel/landing, confidence 0.85+
- CPC > 8,000 VND và clicks > 30 → CHANGE_TARGETING hoặc giảm bid, confidence 0.7+
- Chỉ đề xuất khi có bằng chứng từ số liệu; không đoán mò
- Tối đa 5 đề xuất, ưu tiên tác động cao nhất trước
- campaignId phải khớp id trong dữ liệu JSON

TRẢ LỜI BẰNG {lang}, theo đúng cấu trúc markdown sau (KHÔNG bỏ tiêu đề ##):

## Tóm tắt nhanh
2–4 câu: tổng chi tiêu, ROAS trung bình, campaign đang chạy/tạm dừng, điểm nổi bật.

## Hiệu suất theo campaign
Liệt kê từng campaign quan trọng: tên, chi tiêu, ROAS, CTR, CPC, conversions — kèm đánh giá Ngắn (Tốt / Trung bình / Kém).

## Hiệu suất theo quảng cáo (ads)
Nếu có dữ liệu ads trong JSON: so sánh từng ad — tên, campaign, chi tiêu, CTR, CPC, conversions, creative (title/body). Chỉ rõ ad nào nên tắt, duplicate, hoặc đổi creative.

## Vấn đề cần xử lý ngay
Bullet các rủi ro: lãng phí budget, creative yếu, không có conversion, v.v.

## Đề xuất ưu tiên
Đánh số 1, 2, 3... mỗi mục gồm: Hành động | Campaign | Lý do | Ước tính tiết kiệm/tăng trưởng.

## Kế hoạch 24–48h
3 bước cụ thể user nên làm trên Facebook Ads Manager.

Sau phần markdown trên, trên dòng riêng, trả về ĐÚNG 1 JSON array (không markdown fence):
[
  {{
    "campaignId": "id_từ_dữ_liệu",
    "type": "PAUSE_CAMPAIGN|INCREASE_BUDGET|DECREASE_BUDGET|CHANGE_TARGETING|OPTIMIZE_CREATIVE|RESUME_CAMPAIGN",
    "confidence": 0.75,
    "reasoningVi": "Lý do ngắn gọn có số liệu",
    "suggestedAction": {{"newBudget": 500000}} hoặc {{"action": "pause"}}
  }}
]"""


def get_weekly_prompt(summary: str, language: str = "vi") -> str:
    lang = "tiếng Việt" if language == "vi" else "English"
    return f"""Bạn là chuyên gia chiến lược quảng cáo Facebook.

DỮ LIỆU TUẦN (30 ngày):
{summary}

Trả lời bằng {lang}, cấu trúc:

## Xu hướng tuần
So sánh đầu tuần vs cuối tuần: spend, ROAS, conversions.

## Campaign scale / pause
Campaign nào nên scale, pause, hoặc test lại.

## Phân bổ budget tuần tới
Gợi ý % budget cho từng nhóm campaign.

## Dự báo KPI
ROAS, CPA, conversions kỳ vọng nếu áp dụng đề xuất.

## Rủi ro cần theo dõi
2–3 điểm.

Cuối cùng trả về JSON array đề xuất (cùng format như phân tích ngày, tối đa 5 mục)."""


def get_chat_prompt(
    message: str,
    context: dict,
    history: list,
    language: str = "vi",
) -> str:
    context_str = ""
    if context:
        import json
        context_str = f"\n\nDỮ LIỆU TÀI KHOẢN:\n{json.dumps(context, ensure_ascii=False, indent=2)[:4000]}"

    history_str = ""
    if history:
        history_str = "\n\nLỊCH SỬ CHAT:\n"
        for msg in reversed(history[-6:]):
            role = "Khách" if msg.get("role") == "user" else "Advisor"
            history_str += f"{role}: {msg.get('content', '')[:300]}\n"

    lang = "tiếng Việt" if language == "vi" else "English"
    return f"""Bạn là AI Advisor chuyên Facebook Ads tại setupads.site.
Trả lời {lang}, rõ ràng, có bullet khi cần, trích số liệu từ context nếu có.
Cấu trúc gợi ý: **Kết luận ngắn** → **Phân tích** → **Hành động cụ thể** (2–4 bước).
Nếu context có mảng "ads", ưu tiên phân tích từng quảng cáo đã chọn (creative, CTR, spend).
Không bịa số liệu không có trong context.
{context_str}{history_str}

CÂU HỎI: {message}"""


def get_message_advice_prompt(
    page_name: str,
    tone: str,
    customer_message: str,
    conversation_history: list,
    products: list,
    customer_photos: list | None = None,
    language: str = "vi",
    consulting_stage: str = "discovery",
    stage_guidance: str = "",
    consulting_plan: str = "",
    customer_profile: dict | None = None,
    customer_orders: list | None = None,
    page_learnings: list | None = None,
) -> str:
    import json

    lang = "tiếng Việt" if language == "vi" else "English"
    history_str = ""
    for msg in conversation_history[-12:]:
        role = "Khách" if msg.get("role") == "customer" else "Page"
        history_str += f"{role}: {msg.get('text', '')}\n"

    products_str = json.dumps(products, ensure_ascii=False, indent=2) if products else "[]"
    photos_str = json.dumps(customer_photos or [], ensure_ascii=False, indent=2)

    stage_block = stage_guidance or "Tư vấn tự nhiên theo ngữ cảnh hội thoại."
    plan_block = consulting_plan or "Chào hỏi → tìm hiểu nhu cầu → gợi ý SP → xử lý lo ngại → chốt đơn."

    profile = customer_profile or {}
    memory_block = ""
    if profile:
        memory_block = f"""
BỘ NHỚ KHÁCH HÀNG (dùng để cá nhân hóa — đừng hỏi lại thông tin đã có):
- Tên: {profile.get('name') or 'chưa rõ'}
- Khách quen: {'Có' if profile.get('isReturning') else 'Khách mới'}
- Đã mua: {profile.get('totalOrders', 0)} đơn
- SĐT đã lưu: {profile.get('phone') or 'chưa có'}
- Địa chỉ đã lưu: {profile.get('address') or 'chưa có'}
- Sở thích/size: {json.dumps(profile.get('preferences') or {}, ensure_ascii=False)}
- Tóm tắt AI: {profile.get('memorySummary') or 'chưa có'}
"""

    orders_block = ""
    if customer_orders:
        orders_block = f"\nĐƠN HÀNG TRƯỚC:\n{json.dumps(customer_orders, ensure_ascii=False, indent=2)}\n"

    learnings_block = ""
    if page_learnings:
        tips = []
        for item in page_learnings[:6]:
            tip = item.get("insight", "")
            if item.get("effectiveReply"):
                tip += f" (mẫu trả lời hiệu quả: {item.get('effectiveReply')[:120]})"
            tips.append(f"- {tip}")
        learnings_block = "\nKINH NGHIỆM TỪ KHÁCH TRƯỚC (áp dụng nếu phù hợp):\n" + "\n".join(tips)

    return f"""Bạn là nhân viên tư vấn bán hàng qua Messenger của Facebook Page "{page_name}".
Bạn am hiểu tâm lý khách Việt: thân thiện, không ép mua, biết hỏi đúng lúc để dẫn khách đến chốt đơn.

PHONG CÁCH: {tone}
NGÔN NGỮ: {lang}
GIAI ĐOẠN TƯ VẤN HIỆN TẠI: {consulting_stage}

HƯỚNG DẪN GIAI ĐOẠN:
{stage_block}

KẾ HOẠCH TƯ VẤN (luồng chuẩn):
{plan_block}
{memory_block}{orders_block}{learnings_block}

NGUYÊN TẮC TÂM LÝ (bắt buộc):
- Khách quen → nhắc đơn cũ / ưu đãi khách cũ, không hỏi lại SĐT/địa chỉ nếu đã có
- Áp dụng kinh nghiệm từ khách trước khi phù hợp — không copy máy móc
- Mỗi tin nhắn nên có ít nhất 1 câu HỎI để giữ hội thoại (trừ giai đoạn closing/purchased)
- Giai đoạn đầu: hỏi nhu cầu trước khi báo giá (size, màu, dùng cho ai, ngân sách)
- Trả lời đúng câu hỏi khách TRƯỚC, rồi mới gợi ý thêm
- Dùng câu mở: "Dạ không biết anh/chị đang tìm...", "Em hỏi thêm chút ạ..."
- Khi khách do dự: đồng cảm → giải thích ngắn → ảnh feedback khách thật
- Khi khách sắp mua: hướng dẫn COD/ship, hỏi SĐT + địa chỉ giao hàng đầy đủ (số nhà, đường, phường/quận, tỉnh/TP)
- Giai đoạn closing: BẮT BUỘC thu đủ 3 thông tin trước khi chốt — (1) hàng hóa/sản phẩm cụ thể, (2) SĐT, (3) địa chỉ giao. Thiếu mục nào thì hỏi tự nhiên mục đó trước
- Không spam, không gửi quá nhiều thông tin một lúc

QUY TẮC VIẾT:
- Viết như chat Messenger thật: ngắn, dễ hiểu (1–3 câu, tối đa ~120 từ)
- Xưng "em/mình", gọi "anh/chị/bạn" — lịch sự, không ép mua
- Không markdown, không bullet, tối đa 1 emoji
- Chỉ dùng sản phẩm/ảnh có trong danh sách — không bịa giá, không bịa SP

SẢN PHẨM (có thể nhiều ảnh/imageUrls mỗi sản phẩm):
{products_str}

ẢNH KHÁCH ĐÃ MUA (social proof — dùng khi khách do dự, hỏi chất lượng, muốn xem feedback):
{photos_str}

LỊCH SỬ HỘI THOẠI:
{history_str or "(mới)"}

TIN NHẮN MỚI CỦA KHÁCH:
{customer_message}

NHIỆM VỤ:
1. Viết 1 tin trả lời theo đúng GIAI ĐOẠN và KẾ HOẠCH tư vấn ở trên
2. Giai đoạn greeting/discovery → ưu tiên HỎI khách, chưa ép chốt
3. Giai đoạn recommendation → nêu giá rõ, gửi ảnh SP (sendImages)
4. Giai đoạn objection → đồng cảm + sendCustomerPhotos nếu có
5. Giai đoạn closing → hướng dẫn đặt hàng; hỏi thiếu: hàng hóa cụ thể, size/màu, SĐT, địa chỉ giao đầy đủ
6. sendImages: id sản phẩm (0–3 SP, hệ thống gửi tất cả ảnh của SP)
7. sendCustomerPhotos: id ảnh khách đã mua (0–2 ảnh)

Trả về ĐÚNG JSON (không markdown fence):
{{
  "reply": "nội dung tin nhắn trả lời",
  "nextStage": "greeting|discovery|recommendation|objection|closing|follow_up|purchased",
  "recommendedProducts": [
    {{"id": "product_id", "reason": "lý do ngắn"}}
  ],
  "sendImages": ["product_id"],
  "sendCustomerPhotos": ["photo_id"]
}}"""


def get_learn_from_conversation_prompt(
    page_name: str,
    participant_name: str,
    outcome: str,
    consulting_stage: str,
    conversation_history: list,
    extracted_order: dict,
    past_order_count: int = 0,
    language: str = "vi",
) -> str:
    import json

    lang = "tiếng Việt" if language == "vi" else "English"
    history_str = ""
    for msg in conversation_history[-20:]:
        role = "Khách" if msg.get("role") == "customer" else "Page"
        ai = " [AI]" if msg.get("aiSuggested") else ""
        history_str += f"{role}{ai}: {msg.get('text', '')}\n"

    order_str = json.dumps(extracted_order or {}, ensure_ascii=False)

    return f"""Bạn phân tích hội thoại tư vấn bán hàng Messenger của Page "{page_name}" để RÚT KINH NGHIỆM cho lần sau.

NGÔN NGỮ: {lang}
KHÁCH: {participant_name or 'Khách'}
KẾT QUẢ: {outcome}
GIAI ĐOẠN: {consulting_stage}
SỐ ĐƠN TRƯỚC: {past_order_count}
THÔNG TIN ĐƠN TRÍCH XUẤT: {order_str}

HỘI THOẠI:
{history_str or "(trống)"}

NHIỆM VỤ:
1. Tóm tắt ngắn khách này (sở thích, size, ngân sách, tính cách, điểm cần lưu ý) → customerSummary
2. Rút 1-3 insight cụ thể (category: objection|closing|discovery|product_pitch|success_pattern) — câu trả lời Page nào hiệu quả
3. 1-2 pageTips — mẹo chung cho shop từ case này
4. preferences — size, color, budget, productInterests (mảng), notes

Trả về ĐÚNG JSON:
{{
  "customerSummary": "tóm tắt 2-4 câu",
  "insights": [
    {{
      "category": "success_pattern",
      "insight": "bài học ngắn",
      "effectiveReply": "mẫu câu trả lời hiệu quả",
      "stage": "{consulting_stage}",
      "outcome": "{outcome}"
    }}
  ],
  "pageTips": [{{"stage": "{consulting_stage}", "tip": "mẹo cho shop"}}],
  "preferences": {{"size": "", "color": "", "budget": "", "productInterests": [], "notes": ""}}
}}"""


def get_old_customer_message_prompt(
    page_name: str,
    program_type: str,
    products: list,
    language: str = "vi",
) -> str:
    import json

    lang = "tiếng Việt" if language == "vi" else "English"
    products_str = json.dumps(products, ensure_ascii=False, indent=2) if products else "[]"

    program_hints = {
        "old_customer_promo": "Chương trình tri ân khách cũ — ưu đãi khi đặt lại, freeship, tư vấn miễn phí",
        "new_arrival": "Thông báo hàng mới về — mời khách cũ xem mẫu mới phù hợp gu",
        "reorder": "Nhắc khách đặt lại — hỏi thăm, mời đặt thêm sản phẩm đã mua",
    }
    program_hint = program_hints.get(program_type, program_hints["old_customer_promo"])

    return f"""Bạn viết tin nhắn Messenger gửi cho KHÁCH CŨ (đã từng mua hàng) của Page "{page_name}".

LOẠI CHƯƠNG TRÌNH: {program_hint}
NGÔN NGỮ: {lang}

SẢN PHẨM CỦA SHOP:
{products_str}

QUY TẮC VIẾT (bắt buộc):
- Viết {lang}, thân thiện, dễ hiểu, đúng trọng tâm
- Xưng "em", gọi "{{name}}" (hệ thống sẽ thay bằng tên khách)
- Dùng xuống dòng hợp lý: mỗi ý một đoạn, cách nhau 1 dòng trống
- Có thể dùng bullet "•" cho ưu đãi (tối đa 3–4 dòng)
- Không markdown (**), không hashtag
- Tối đa 1 emoji, đặt ở đầu hoặc cuối
- Độ dài: 4–8 dòng, ~80–150 từ
- Kết bằng câu hỏi mở để khách dễ trả lời
- Không bịa giá/sản phẩm không có trong danh sách

CẤU TRÚC GỢI Ý:
1. Chào + nhắc khách đã ủng hộ
2. Thông tin chương trình / sản phẩm
3. Lợi ích ngắn (bullet nếu cần)
4. Câu hỏi mời tư vấn / đặt hàng

Trả về ĐÚNG JSON (không markdown fence):
{{
  "name": "tên ngắn cho mẫu tin này",
  "text": "nội dung tin nhắn với {{name}} và {{pageName}} làm placeholder"
}}"""
