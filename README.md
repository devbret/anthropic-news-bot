# Anthropic News Bot

Command-line news-discovery agent which crawls news topics and uses Claude to decide what is worth surfacing.

## Application Overview

Starting from a root keyword, the application searches `NewsAPI` for recent English-language articles, sends a compact indexed batch to Claude which returns a schema-constrained JSON verdict, then enqueues the suggested keywords and repeats until it hits the daily search quota.

When the run finishes this program writes three timestamped outputs, each in both JSON and TXT form, containing a full run log, deduplicated timeline of the super-hot stories and timeline of every article seen, while logging progress to both the console and `agent_runtime.log`.
