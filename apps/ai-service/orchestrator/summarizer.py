import json

MAX_TOKENS = 4000
APPROX_CHARS_PER_TOKEN = 4


class DataSummarizer:
    def summarize(
        self,
        campaigns: list,
        account_insights: list,
        ads: list | None = None,
        selection: dict | None = None,
    ) -> str:
        ads = ads or []
        selection = selection or {}
        summary = {
            "selection": selection,
            "total_campaigns": len(campaigns),
            "total_ads": len(ads),
            "account_metrics": self._summarize_account(account_insights),
            "campaigns": [],
            "ads": [],
        }

        for campaign in campaigns[:20]:
            insights = campaign.get("insights", [])
            total_spend = sum(i.get("spend", 0) for i in insights)
            total_clicks = sum(i.get("clicks", 0) for i in insights)
            total_impressions = sum(i.get("impressions", 0) for i in insights)
            total_conversions = sum(i.get("conversions", 0) for i in insights)

            avg_roas = (
                sum(i.get("roas", 0) for i in insights) / len(insights)
                if insights else 0
            )

            summary["campaigns"].append({
                "id": campaign.get("id"),
                "name": campaign.get("name"),
                "status": campaign.get("status"),
                "objective": campaign.get("objective"),
                "daily_budget": campaign.get("dailyBudget"),
                "metrics": {
                    "spend": round(total_spend, 2),
                    "clicks": total_clicks,
                    "impressions": total_impressions,
                    "conversions": total_conversions,
                    "roas": round(avg_roas, 2),
                    "cpc": round(total_spend / total_clicks, 2) if total_clicks else 0,
                    "ctr": round(total_clicks / total_impressions, 4) if total_impressions else 0,
                },
            })

        for ad in ads[:25]:
            metrics = ad.get("metrics", {})
            creative = ad.get("creative", {})
            summary["ads"].append({
                "id": ad.get("id"),
                "name": ad.get("name"),
                "status": ad.get("status"),
                "campaign_id": ad.get("campaignId"),
                "campaign_name": ad.get("campaignName"),
                "ad_set_name": ad.get("adSetName"),
                "creative_title": creative.get("title"),
                "creative_body": creative.get("body"),
                "cta": creative.get("cta"),
                "metrics": metrics,
            })

        text = json.dumps(summary, ensure_ascii=False, indent=2)
        max_chars = MAX_TOKENS * APPROX_CHARS_PER_TOKEN

        if len(text) > max_chars:
            summary["campaigns"] = summary["campaigns"][:10]
            summary["ads"] = summary["ads"][:15]
            text = json.dumps(summary, ensure_ascii=False, indent=2)

        return text

    def _summarize_account(self, insights: list) -> dict:
        if not insights:
            return {}

        total_spend = sum(i.get("spend", 0) for i in insights)
        total_clicks = sum(i.get("clicks", 0) for i in insights)
        total_impressions = sum(i.get("impressions", 0) for i in insights)

        return {
            "total_spend": round(total_spend, 2),
            "total_clicks": total_clicks,
            "total_impressions": total_impressions,
            "total_conversions": sum(i.get("conversions", 0) for i in insights),
            "avg_cpc": round(total_spend / total_clicks, 2) if total_clicks else 0,
            "avg_ctr": round(total_clicks / total_impressions, 4) if total_impressions else 0,
            "avg_roas": round(
                sum(i.get("roas", 0) for i in insights) / len(insights), 2
            ) if insights else 0,
            "days": len(insights),
        }
