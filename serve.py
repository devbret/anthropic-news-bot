import json
import os
import posixpath
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

ROOT = os.path.dirname(os.path.abspath(__file__))
ANALYSIS_MODEL = os.getenv("ANALYSIS_MODEL", "claude-opus-4-8")
MAX_BODY_BYTES = 20 * 1024 * 1024
STREAM_SENTINEL = "\x1e"

ALLOWED_FILES = {"/", "/index.html", "/main.css", "/main.js"}
ALLOWED_PREFIXES = ("/vendor/", "/output/")

ADAPTIVE_THINKING_MODELS = (
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-mythos-5",
)

anthropic_client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = (
    "You are a sharp news analyst. You are given the 'super-hot' stories that "
    "an automated news-discovery agent flagged as especially time-sensitive or "
    "high-impact, along with the agent's stated reason for flagging each one "
    "and context about the discovery runs they came from.\n\n"
    "Write a compare/contrast analysis of these stories as a set. Structure it "
    "in markdown with '##' section headings, and keep it concrete - refer to "
    "stories by their titles. Cover:\n"
    "1. Common threads - the clusters or narratives these stories form, and "
    "which stories belong to each.\n"
    "2. Contrasts and tensions - where stories disagree, compete, or pull in "
    "different directions.\n"
    "3. How the story developed over time, using the publish timestamps.\n"
    "4. What is driving the heat - why these stories are surfacing now.\n"
    "5. Outliers - anything that does not fit the clusters, and whether it "
    "looks like noise or an early signal.\n"
    "6. What to watch next - concrete follow-up questions or keywords.\n\n"
    "If the set is small or one-note, say so plainly rather than padding the "
    "analysis. Do not invent facts beyond the provided text; if an excerpt is "
    "too thin to support a claim, note the uncertainty."
)

def build_user_prompt(payload):
    stories = payload.get("stories") or []
    runs = payload.get("runs") or []

    lines = [
        "Here are the super-hot stories currently in view in the dashboard, "
        "as JSON. `agent_reason` is why the discovery agent flagged the story "
        "(may be missing), `keyword` is the search that surfaced it, and "
        "`excerpt` is the available story text (often truncated).",
        "",
        "DISCOVERY RUNS:",
        json.dumps(runs, indent=2),
        "",
        f"SUPER-HOT STORIES ({len(stories)}):",
        json.dumps(stories, indent=2),
    ]
    return "\n".join(lines)

class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _path_allowed(self):
        path = posixpath.normpath(unquote(urlsplit(self.path).path)) or "/"
        if path in ALLOWED_FILES:
            return True
        if any(part.startswith(".") for part in path.split("/") if part):
            return False
        return path.startswith(ALLOWED_PREFIXES)

    def do_GET(self):
        if not self._path_allowed():
            self.send_error(404, "Not found")
            return
        super().do_GET()

    def do_HEAD(self):
        if not self._path_allowed():
            self.send_error(404, "Not found")
            return
        super().do_HEAD()

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/analyze":
            self._send_json(404, {"error": "Unknown endpoint"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                self._send_json(400, {"error": "Missing or oversized request body"})
                return
            payload = json.loads(self.rfile.read(length))
            stories = payload.get("stories") if isinstance(payload, dict) else None
            if not isinstance(stories, list) or not stories:
                self._send_json(
                    400, {"error": "stories must be a non-empty list"}
                )
                return
            if not isinstance(payload.get("runs") or [], list):
                payload["runs"] = []
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        if not os.environ.get("ANTHROPIC_API_KEY"):
            self._send_json(500, {"error": "ANTHROPIC_API_KEY is not set in .env"})
            return

        request_kwargs = {
            "model": ANALYSIS_MODEL,
            "max_tokens": 8000,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": build_user_prompt(payload)}],
        }
        if ANALYSIS_MODEL.startswith(ADAPTIVE_THINKING_MODELS):
            request_kwargs["thinking"] = {"type": "adaptive"}

        try:
            stream_ctx = anthropic_client.messages.stream(**request_kwargs)
            stream = stream_ctx.__enter__()
        except Exception as exc:
            self._send_json(502, {"error": f"Claude request failed: {exc}"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Analysis-Model", ANALYSIS_MODEL)
        self.end_headers()
        try:
            for text in stream.text_stream:
                self.wfile.write(text.encode("utf-8"))
                self.wfile.flush()
            final = stream.get_final_message()
            trailer = STREAM_SENTINEL + json.dumps(
                {"stop_reason": final.stop_reason}
            )
            self.wfile.write(trailer.encode("utf-8"))
        except BrokenPipeError:
            pass
        except Exception as exc:
            try:
                message = f"\n\n[Analysis interrupted: {exc}]"
                self.wfile.write(message.encode("utf-8"))
            except OSError:
                pass
        finally:
            stream_ctx.__exit__(None, None, None)

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("Warning: ANTHROPIC_API_KEY is not set - the dashboard will work, "
              "but the Claude analysis button will fail until you add it to .env.")
    server = ThreadingHTTPServer(("127.0.0.1", port), DashboardHandler)
    print(f"Dashboard: http://localhost:{port}/  (analysis model: {ANALYSIS_MODEL})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
