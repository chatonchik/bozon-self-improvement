# RSS agent signal triage

Use this when running self-improvement loops to quickly separate high-signal agent/AI updates from hype.

## Command

```bash
node scripts/rss-agent-signal-triage.mjs
```

## What it does

- Pulls and merges these feeds:
  - `https://shir-man.com/api/rss`
  - `https://shir-man.com/api/rss?sort=day`
  - `https://shir-man.com/api/rss?sort=week`
  - `https://shir-man.com/api/rss?sort=month`
- Deduplicates by URL
- Scores items by:
  - actionable keywords (agent/tool/workflow/eval/security/etc.)
  - trusted domains
  - hype penalty for low-actionability social spikes
- Prints:
  - high-signal candidates (with links)
  - likely noise
  - two immediate next-action reminders

## Why this exists

Self-improvement cron loops can waste time on noisy trends. This script keeps loops practical by prioritizing items that are more likely to yield concrete code/doc improvements.
