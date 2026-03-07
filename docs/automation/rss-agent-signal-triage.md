# RSS agent signal triage

Use this when running self-improvement loops to quickly separate high-signal agent/AI updates from hype.

## Command

```bash
node scripts/rss-agent-signal-triage.mjs
```

JSON output (for piping into other automations):

```bash
node scripts/rss-agent-signal-triage.mjs --json
```

## What it does

- Pulls and merges these feeds:
  - `https://shir-man.com/api/rss`
  - `https://shir-man.com/api/rss?sort=day`
  - `https://shir-man.com/api/rss?sort=week`
  - `https://shir-man.com/api/rss?sort=month`
- Deduplicates by URL
- Scores items by category:
  - AI/agent engineering signals
  - macroeconomic signals
  - geopolitics/policy signals
- Adds source quality weighting:
  - trusted domains boost score
  - hype/low-substance social spikes get penalty
- Produces:
  - ranked high-signal candidates (with category + sub-scores)
  - likely noise
  - short-horizon scenario hints + monitor indicators
  - optional machine-readable JSON output

## Why this exists

Self-improvement cron loops can waste time on noisy trends. This script keeps loops practical by prioritizing items that are more likely to yield concrete code/doc improvements.
