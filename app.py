import os
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Dict, Any, List
import requests
import logging
from anthropic import Anthropic
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class NewsAuthError(Exception):
    pass

load_dotenv()

OUTPUT_DIR = "output"

RUN_STARTED = datetime.now()
RUN_ID = RUN_STARTED.strftime("run_%Y-%m-%d_%H-%M-%S")
RUN_DIR = os.path.join(OUTPUT_DIR, RUN_ID)
os.makedirs(RUN_DIR, exist_ok=True)

logging.basicConfig(
    filename=os.path.join(RUN_DIR, "agent_runtime.log"),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

logger = logging.getLogger(__name__)
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(console_handler)

logger.info("=== Starting News Discovery Agent ===")
logger.info(f"Run output directory: {RUN_DIR}")


NEWS_API_KEY = os.getenv("NEWSAPI_KEY", "").strip()
NEWS_BASE_URL = "https://newsapi.org/v2/everything"
DAILY_QUOTA = int(os.getenv("DAILY_QUOTA", "50"))
ROOT_KEYWORD = os.getenv("ROOT_KEYWORD")
PAGE_SIZE = int(os.getenv("PAGE_SIZE", "100"))

GNEWS_API_KEY = os.getenv("GNEWS_API_KEY", "").strip()
GNEWS_BASE_URL = os.getenv("GNEWS_BASE_URL", "https://gnews.io/api/v4").strip()
GNEWS_LANG = os.getenv("GNEWS_LANG", "en").strip()
GNEWS_COUNTRY = os.getenv("GNEWS_COUNTRY", "us").strip()
GNEWS_MAX = int(os.getenv("GNEWS_MAX", "100"))
GNEWS_TIMEOUT = int(os.getenv("GNEWS_TIMEOUT", "15"))

anthropic_client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5")


def build_session() -> requests.Session:
    retry = Retry(
        total=3,
        read=3,
        connect=3,
        backoff_factor=0.7,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session = requests.Session()
    session.headers.update({"User-Agent": "AnthropicNewsBot/1.0"})
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


http_session = build_session()


def redact_keys(message: str) -> str:
    for secret in (NEWS_API_KEY, GNEWS_API_KEY):
        if secret:
            message = message.replace(secret, "***")
    return message


def build_provider_order() -> List[str]:
    order = []
    if GNEWS_API_KEY:
        order.append("gnews")
    if NEWS_API_KEY:
        order.append("newsapi")
    return order


active_providers = build_provider_order()

logger.info(f"Loaded config: ROOT_KEYWORD={ROOT_KEYWORD}, PAGE_SIZE={PAGE_SIZE}, DAILY_QUOTA={DAILY_QUOTA}")
logger.info(f"Anthropic model: {ANTHROPIC_MODEL}")
logger.info(f"News providers (in order): {active_providers or 'none configured'}")


def newsapi_search(keyword: str) -> Dict[str, Any]:
    logger.info(f"Searching NewsAPI for: {keyword}")

    params = {
        "q": keyword,
        "apiKey": NEWS_API_KEY,
        "language": "en",
        "pageSize": PAGE_SIZE,
        "page": 1,
        "sortBy": "publishedAt",
    }

    try:
        resp = http_session.get(NEWS_BASE_URL, params=params, timeout=15)
    except Exception as e:
        logger.error(redact_keys(f"NewsAPI request failed for '{keyword}': {e}"))
        return {"keyword": keyword, "error": str(e), "articles": []}

    if resp.status_code in (401, 403):
        raise NewsAuthError(f"NewsAPI rejected the API key (HTTP {resp.status_code})")

    if resp.status_code != 200:
        logger.error(f"NewsAPI returned HTTP {resp.status_code} for keyword '{keyword}'")
        return {"keyword": keyword, "error": f"HTTP {resp.status_code}", "articles": []}

    try:
        js = resp.json()
    except ValueError:
        logger.error(f"NewsAPI returned invalid JSON for keyword '{keyword}'")
        return {"keyword": keyword, "error": "invalid JSON", "articles": []}

    articles = js.get("articles") or []
    logger.info(f"NewsAPI returned {len(articles)} articles for '{keyword}'")

    normalized = []
    for a in articles:
        normalized.append({
            "title": a.get("title"),
            "source": (a.get("source") or {}).get("name"),
            "author": a.get("author"),
            "description": a.get("description"),
            "content": a.get("content"),
            "url": a.get("url"),
            "publishedAt": a.get("publishedAt"),
        })

    return {
        "keyword": keyword,
        "articles": normalized,
        "count": len(normalized)
    }


def gnews_search(keyword: str) -> Dict[str, Any]:
    logger.info(f"Searching GNews for: {keyword}")

    params = {
        "q": keyword,
        "lang": GNEWS_LANG,
        "country": GNEWS_COUNTRY,
        "max": GNEWS_MAX,
        "page": 1,
        "apikey": GNEWS_API_KEY,
        "expand": "content",
    }

    try:
        resp = http_session.get(
            f"{GNEWS_BASE_URL.rstrip('/')}/search",
            params=params,
            timeout=GNEWS_TIMEOUT,
        )
    except Exception as e:
        logger.error(redact_keys(f"GNews request failed for '{keyword}': {e}"))
        return {"keyword": keyword, "error": str(e), "articles": []}

    if resp.status_code in (401, 403):
        raise NewsAuthError(f"GNews rejected the API key (HTTP {resp.status_code})")

    if resp.status_code != 200:
        logger.error(f"GNews returned HTTP {resp.status_code} for keyword '{keyword}'")
        return {"keyword": keyword, "error": f"HTTP {resp.status_code}", "articles": []}

    try:
        js = resp.json()
    except ValueError:
        logger.error(f"GNews returned invalid JSON for keyword '{keyword}'")
        return {"keyword": keyword, "error": "invalid JSON", "articles": []}

    articles = js.get("articles") or []
    logger.info(f"GNews returned {len(articles)} articles for '{keyword}'")

    normalized = []
    for a in articles:
        normalized.append({
            "title": a.get("title"),
            "source": (a.get("source") or {}).get("name"),
            "author": None,
            "description": a.get("description"),
            "content": a.get("content"),
            "url": a.get("url"),
            "publishedAt": a.get("publishedAt"),
        })

    return {
        "keyword": keyword,
        "articles": normalized,
        "count": len(normalized)
    }


PROVIDER_SEARCHERS = {
    "gnews": gnews_search,
    "newsapi": newsapi_search,
}


def search_news(keyword: str) -> Dict[str, Any]:
    providers = list(active_providers)
    if not providers:
        return {
            "keyword": keyword,
            "error": "no news provider configured",
            "articles": [],
            "providers": [],
        }

    results: Dict[str, Dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=len(providers)) as pool:
        futures = {
            provider: pool.submit(PROVIDER_SEARCHERS[provider], keyword)
            for provider in providers
        }
        for provider, future in futures.items():
            try:
                results[provider] = future.result()
            except NewsAuthError as e:
                logger.error(
                    f"{provider} authentication failed, disabling it for this run: {e}"
                )
                if provider in active_providers:
                    active_providers.remove(provider)
            except Exception as e:
                logger.error(redact_keys(f"{provider} search crashed for '{keyword}': {e}"))

    merged: List[Dict[str, Any]] = []
    seen_urls: set[str] = set()
    providers_ok: List[str] = []
    errors: List[str] = []

    for provider in providers:
        result = results.get(provider)
        if result is None:
            continue
        if result.get("error"):
            errors.append(f"{provider}: {result['error']}")
            continue
        providers_ok.append(provider)
        for article in result.get("articles") or []:
            url = (article.get("url") or "").strip()
            if url in seen_urls:
                continue
            if url:
                seen_urls.add(url)
            article["provider"] = provider
            merged.append(article)

    if not providers_ok:
        joined = "; ".join(errors) or "no provider returned a usable response"
        logger.error(f"No provider returned a usable response for '{keyword}' ({joined})")
        return {"keyword": keyword, "error": joined, "articles": [], "providers": []}

    if errors:
        logger.warning(f"Partial provider failure for '{keyword}': {'; '.join(errors)}")

    logger.info(
        f"Merged {len(merged)} unique articles for '{keyword}' from {', '.join(providers_ok)}"
    )
    return {
        "keyword": keyword,
        "articles": merged,
        "count": len(merged),
        "providers": providers_ok,
    }


MAX_ARTICLES_FOR_CLAUDE = 5000

CLAUDE_DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "is_hot": {"type": "boolean"},
        "reason": {"type": "string"},
        "related_keywords": {"type": "array", "items": {"type": "string"}},
        "super_hot_articles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "reason": {"type": "string"},
                },
                "required": ["index", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_hot", "reason", "related_keywords", "super_hot_articles"],
    "additionalProperties": False,
}


def _articles_for_prompt(articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "index": i,
            "title": a.get("title"),
            "source": a.get("source"),
            "description": a.get("description"),
        }
        for i, a in enumerate(articles[:MAX_ARTICLES_FOR_CLAUDE])
    ]


def ask_claude_for_next_keywords(keyword: str, articles: List[Dict[str, Any]]) -> Dict[str, Any]:
    logger.info(f"Sending {len(articles)} articles to Claude for keyword '{keyword}'")

    fallback = {
        "is_hot": False,
        "reason": "",
        "related_keywords": [],
        "super_hot_articles": [],
    }

    if not articles:
        return {**fallback, "reason": "No articles to analyze."}

    compact = _articles_for_prompt(articles)
    shown = len(compact)

    prompt = (
        "You are a news-discovery agent analyzing a batch of articles from NewsAPI.\n\n"
        f'ROOT SEARCH: "{keyword}"\n\n'
        f'ARTICLES (the zero-based "index" field identifies each article; {shown} shown):\n'
        f"{json.dumps(compact, indent=2)}\n\n"
        "TASK:\n"
        "1. Analyze whether this keyword is producing new, interesting, or emerging stories.\n"
        "2. Suggest 0-3 related keywords worth searching next, only if they look hot or "
        "emerging. Keep each 1-3 words.\n"
        "3. Identify 0-5 stories from THIS batch that are especially time-sensitive, central "
        "to the trend, or high-impact relative to the others.\n"
        f'   Reference each by its zero-based "index" (0 to {shown - 1}), with a short reason.'
    )

    try:
        response = anthropic_client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
            extra_body={
                "output_config": {
                    "format": {"type": "json_schema", "schema": CLAUDE_DECISION_SCHEMA}
                }
            },
        )
    except Exception as e:
        logger.error(f"Claude API call failed for '{keyword}': {e}")
        return {**fallback, "reason": f"Claude error: {e}"}

    if response.stop_reason not in ("end_turn", "stop_sequence"):
        logger.warning(f"Claude stopped early for '{keyword}': stop_reason={response.stop_reason}")
        return {**fallback, "reason": f"Claude stopped early: {response.stop_reason}"}

    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        logger.error(f"Could not parse structured output for '{keyword}': {e}")
        return {**fallback, "reason": f"Invalid JSON from Claude: {e}"}

    logger.info(f"Claude decision for '{keyword}': {parsed}")
    return parsed


SEP = "=" * 80
SUB = "-" * 80


def _txt_path(filename: str) -> str:
    return os.path.splitext(filename)[0] + ".txt"


def format_timeline_txt(stories: List[Dict[str, Any]], heading: str) -> str:
    lines: List[str] = [heading, f"Total stories: {len(stories)}", SEP, ""]

    if not stories:
        lines.append("(no stories)")
        return "\n".join(lines) + "\n"

    for i, s in enumerate(stories, start=1):
        title = s.get("title") or "(untitled)"
        source = s.get("source") or "Unknown source"
        timestamp = s.get("timestamp") or "unknown time"
        url = s.get("url") or ""
        story = (s.get("story") or "").strip()

        lines.append(f"[{i}] {title}")
        lines.append(f"    Source:    {source}")
        lines.append(f"    Published: {timestamp}")
        if url:
            lines.append(f"    URL:       {url}")
        if story:
            lines.append("")
            lines.append(f"    {story}")
        lines.append("")
        lines.append(SUB)
        lines.append("")

    return "\n".join(lines) + "\n"


def format_log_txt(log: Dict[str, Any]) -> str:
    ts = log.get("timestamp")
    try:
        ts_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "unknown"
    except (TypeError, ValueError, OSError):
        ts_str = str(ts)

    searches = log.get("searches", []) or []
    super_hot = log.get("super_hot_articles", []) or []

    lines: List[str] = [
        "NEWS DISCOVERY AGENT - RUN LOG",
        SEP,
        f"Root keyword:             {log.get('root_keyword')}",
        f"Run time:                 {ts_str}",
        f"Quota used:               {log.get('quota_used')}",
        f"Total searches:           {len(searches)}",
        f"Total super-hot articles: {len(super_hot)}",
        SEP,
        "",
    ]

    for n, search in enumerate(searches, start=1):
        keyword = search.get("keyword")
        article_count = search.get("article_count", 0)
        decision = search.get("claude_decision", {}) or {}
        articles = search.get("articles", []) or []
        batch_hot = search.get("super_hot_articles", []) or []
        related = decision.get("related_keywords", []) or []

        lines.append(f'SEARCH {n}: "{keyword}"  ({article_count} articles)')
        lines.append(SUB)
        lines.append("Claude decision:")
        lines.append(f"    is_hot: {decision.get('is_hot')}")
        lines.append(f"    reason: {decision.get('reason', '')}")
        lines.append(f"    related_keywords: {', '.join(related) if related else '(none)'}")
        lines.append("")

        lines.append("Articles:")
        if not articles:
            lines.append("    (none)")
        for idx, a in enumerate(articles):
            title = a.get("title") or "(untitled)"
            source = a.get("source") or "Unknown"
            published = a.get("publishedAt") or "unknown time"
            url = a.get("url") or ""
            desc = (a.get("description") or "").strip()
            lines.append(f"    [{idx}] {title}")
            lines.append(f"         Source: {source} | Published: {published}")
            if url:
                lines.append(f"         URL: {url}")
            if desc:
                lines.append(f"         {desc}")
        lines.append("")

        if batch_hot:
            lines.append("Super-hot from this search:")
            for art in batch_hot:
                title = art.get("title") or "(untitled)"
                rank = art.get("super_hot_rank")
                reason = art.get("super_hot_reason", "")
                lines.append(f"    - {title} (rank {rank})")
                if reason:
                    lines.append(f"      {reason}")
            lines.append("")

        lines.append(SEP)
        lines.append("")

    lines.append("SUPER-HOT ARTICLES (all searches)")
    lines.append(SEP)
    if not super_hot:
        lines.append("(none)")
    for art in super_hot:
        title = art.get("title") or "(untitled)"
        source = art.get("source") or "Unknown"
        keyword = art.get("source_keyword") or ""
        reason = art.get("super_hot_reason", "")
        url = art.get("url") or ""
        published = art.get("publishedAt") or "unknown time"
        lines.append("")
        lines.append(f"* {title}")
        lines.append(f"    Source:       {source}")
        lines.append(f"    From keyword: {keyword}")
        lines.append(f"    Published:    {published}")
        if url:
            lines.append(f"    URL:          {url}")
        if reason:
            lines.append(f"    Why hot:      {reason}")

    return "\n".join(lines) + "\n"


def save_log(log_data: Dict[str, Any], filename: str):
    logger.info(f"Saving log file: {filename}")
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(log_data, f, indent=2)

    txt_filename = _txt_path(filename)
    logger.info(f"Saving log text file: {txt_filename}")
    with open(txt_filename, "w", encoding="utf-8") as f:
        f.write(format_log_txt(log_data))

def save_super_hot_timeline(stories: List[Dict[str, Any]], filename: str):
    logger.info(f"Saving super hot timeline file: {filename}")
    payload = {"stories": stories}
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    txt_filename = _txt_path(filename)
    logger.info(f"Saving super hot timeline text file: {txt_filename}")
    with open(txt_filename, "w", encoding="utf-8") as f:
        f.write(format_timeline_txt(stories, "SUPER HOT NEWS TIMELINE"))

def save_all_stories_timeline(stories: List[Dict[str, Any]], filename: str):
    logger.info(f"Saving all stories timeline file: {filename}")
    payload = {"stories": stories}
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    txt_filename = _txt_path(filename)
    logger.info(f"Saving all stories timeline text file: {txt_filename}")
    with open(txt_filename, "w", encoding="utf-8") as f:
        f.write(format_timeline_txt(stories, "ALL STORIES TIMELINE"))


def save_run_manifest(log: Dict[str, Any], super_hot_count: int, all_stories_count: int) -> str:
    manifest = {
        "run_id": RUN_ID,
        "root_keyword": log.get("root_keyword"),
        "started_at": log.get("timestamp"),
        "started_at_iso": RUN_STARTED.isoformat(timespec="seconds"),
        "finished_at": time.time(),
        "finished_at_iso": datetime.now().isoformat(timespec="seconds"),
        "quota_used": log.get("quota_used"),
        "search_count": len(log.get("searches", [])),
        "keywords_searched": [s.get("keyword") for s in log.get("searches", [])],
        "providers_used": sorted(
            {p for s in log.get("searches", []) for p in s.get("providers", [])}
        ),
        "super_hot_count": super_hot_count,
        "all_stories_count": all_stories_count,
        "files": {
            "log": "news_agent_log.json",
            "super_hot": "news_super_hot.json",
            "all_stories": "news_all_stories.json",
        },
    }

    manifest_filename = os.path.join(RUN_DIR, "manifest.json")
    logger.info(f"Saving run manifest: {manifest_filename}")
    with open(manifest_filename, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    return manifest_filename


def rebuild_runs_index() -> str:
    runs: List[Dict[str, Any]] = []

    for entry in sorted(os.listdir(OUTPUT_DIR)):
        manifest_path = os.path.join(OUTPUT_DIR, entry, "manifest.json")
        if not entry.startswith("run_") or not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                runs.append(json.load(f))
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"Skipping unreadable manifest {manifest_path}: {e}")

    runs.sort(key=lambda r: r.get("started_at") or 0)

    index_filename = os.path.join(OUTPUT_DIR, "index.json")
    logger.info(f"Rebuilding runs index ({len(runs)} runs): {index_filename}")
    with open(index_filename, "w", encoding="utf-8") as f:
        json.dump({"runs": runs}, f, indent=2)

    return index_filename


def _normalize_keyword(kw: str) -> str:
    return " ".join(kw.split()).lower()


def run_daily_news_agent(root_keyword: str, quota: int = DAILY_QUOTA):
    logger.info(f"Starting agent run with root keyword: {root_keyword}")

    search_queue = [_normalize_keyword(root_keyword)]
    visited: set[str] = set()

    log: Dict[str, Any] = {
        "root_keyword": root_keyword,
        "searches": [],
        "timestamp": time.time(),
        "quota_used": 0,
        "super_hot_articles": [] 
    }

    while search_queue and log["quota_used"] < quota:
        keyword = search_queue.pop(0)
        logger.info(f"Processing keyword: {keyword}")

        if keyword in visited:
            logger.info(f"Skipping '{keyword}' (already visited)")
            continue
        visited.add(keyword)

        result = search_news(keyword)
        articles = result.get("articles", [])
        logger.info(f"Retrieved {len(articles)} articles for '{keyword}'")

        if result.get("error") and not active_providers:
            logger.error("All news providers failed. Ending the run early with what was collected.")
            break

        decision = ask_claude_for_next_keywords(keyword, articles)

        super_hot_specs = decision.get("super_hot_articles", []) or []
        batch_super_hot: List[Dict[str, Any]] = []

        for idx, spec in enumerate(super_hot_specs):
            art_index = spec.get("index")
            reason = spec.get("reason", "")

            if not isinstance(art_index, int):
                logger.warning(f"Super-hot spec has non-int index for '{keyword}': {spec}")
                continue

            if art_index < 0 or art_index >= len(articles):
                logger.warning(
                    f"Super-hot index out of range for '{keyword}': {art_index} (len={len(articles)})"
                )
                continue

            base_article = articles[art_index].copy()

            enriched = {
                **base_article,
                "source_keyword": keyword,
                "super_hot_reason": reason,
                "super_hot_rank": idx,
            }

            batch_super_hot.append(enriched)
            log["super_hot_articles"].append(enriched)

        log_entry = {
            "keyword": keyword,
            "providers": result.get("providers", []),
            "article_count": len(articles),
            "articles": articles,
            "claude_decision": decision,
            "super_hot_articles": batch_super_hot,
        }
        log["searches"].append(log_entry)
        log["quota_used"] += 1

        logger.info(f"Quota used: {log['quota_used']}/{quota}")

        next_keywords = decision.get("related_keywords", [])
        logger.info(f"Claude suggests next keywords: {next_keywords}")

        for kw in next_keywords:
            norm = _normalize_keyword(kw)
            if norm and norm not in visited and norm not in search_queue:
                logger.info(f"Adding '{norm}' to search queue")
                search_queue.append(norm)

        if len(search_queue) > 100:
            logger.warning("Search queue grew too large. Stopping early.")
            break

    log_filename = os.path.join(RUN_DIR, "news_agent_log.json")
    save_log(log, log_filename)
    logger.info(f"=== Agent run complete. Log saved to {log_filename} ===")

    seen_urls: set[str] = set()
    timeline_stories: List[Dict[str, Any]] = []

    for art in log.get("super_hot_articles", []):
        url = art.get("url")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)

        timeline_stories.append(
            {
                "title": art.get("title"),
                "source": art.get("source"),
                "story": art.get("content") or art.get("description") or "",
                "timestamp": art.get("publishedAt"),
                "url": url,
            }
        )

    super_hot_filename = os.path.join(RUN_DIR, "news_super_hot.json")
    save_super_hot_timeline(timeline_stories, super_hot_filename)
    logger.info(f"Super hot timeline saved to {super_hot_filename}")

    all_seen_urls: set[str] = set()
    all_timeline_stories: List[Dict[str, Any]] = []

    for search in log.get("searches", []):
        for art in search.get("articles", []):
            url = art.get("url")
            if not url or url in all_seen_urls:
                continue
            all_seen_urls.add(url)

            all_timeline_stories.append(
                {
                    "title": art.get("title"),
                    "source": art.get("source"),
                    "story": art.get("content") or art.get("description") or "",
                    "timestamp": art.get("publishedAt"),
                    "url": url,
                }
            )

    all_stories_filename = os.path.join(RUN_DIR, "news_all_stories.json")
    save_all_stories_timeline(all_timeline_stories, all_stories_filename)
    logger.info(f"All stories timeline saved to {all_stories_filename}")

    save_run_manifest(log, len(timeline_stories), len(all_timeline_stories))
    rebuild_runs_index()

    logger.info(
        f"=== Agent run complete. Run folder: {RUN_DIR} "
        f"(log={log_filename}, super_hot={super_hot_filename}, all_stories={all_stories_filename}) ==="
    )

    return log_filename, super_hot_filename, all_stories_filename


if __name__ == "__main__":
    logger.info("=== Executing agent script ===")

    if not ROOT_KEYWORD:
        logger.error("ROOT_KEYWORD is missing. Please set it in your .env file.")
        raise SystemExit(1)

    if not active_providers:
        logger.error("No news provider is configured. Set GNEWS_API_KEY or NEWSAPI_KEY in your .env file.")
        raise SystemExit(1)

    if not os.getenv("ANTHROPIC_API_KEY"):
        logger.error("ANTHROPIC_API_KEY is missing. Please set it in your .env file.")
        raise SystemExit(1)

    try:
        logger.info(f"Starting daily agent run with root keyword: '{ROOT_KEYWORD}'")
        log_file, super_hot_file, all_stories_file = run_daily_news_agent(ROOT_KEYWORD, DAILY_QUOTA)
        logger.info(
            f"Agent run complete. "
            f"log={log_file}, super_hot={super_hot_file}, all_stories={all_stories_file}"
        )
    except Exception as e:
        logger.exception(f"Agent encountered an unhandled error: {e}")
        raise
