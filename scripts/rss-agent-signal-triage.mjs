#!/usr/bin/env node
/**
 * Lightweight RSS triage for self-improvement loops.
 * Focus: extract actionable agent-engineering signals and filter hype/noise.
 */

const FEEDS = [
  "https://shir-man.com/api/rss",
  "https://shir-man.com/api/rss?sort=day",
  "https://shir-man.com/api/rss?sort=week",
  "https://shir-man.com/api/rss?sort=month",
];

const TRUSTED_DOMAINS = [
  "openai.com",
  "anthropic.com",
  "github.com",
  "docs.openclaw.ai",
  "arxiv.org",
  "huggingface.co",
  "lesswrong.com",
];

const ACTION_KEYWORDS = [
  "agent",
  "tool",
  "workflow",
  "eval",
  "benchmark",
  "security",
  "prompt injection",
  "mcp",
  "sdk",
  "api",
  "release",
  "model",
  "reasoning",
  "inference",
  "latency",
  "cost",
];

function decodeHtml(s = "") {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeHtml(m?.[1] ?? "");
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function scoreItem(item) {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  const kw = ACTION_KEYWORDS.filter((k) => hay.includes(k)).length;
  const trusted = TRUSTED_DOMAINS.some((d) => item.domain === d || item.domain.endsWith(`.${d}`));

  // Penalize obvious hype-only sources when no actionable keywords.
  const hypePenalty = /reddit|twitter|x\.com/.test(item.domain) && kw < 2 ? 2 : 0;
  return kw + (trusted ? 2 : 0) - hypePenalty;
}

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { "user-agent": "openclaw-rss-triage/1.0" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const xml = await res.text();

  const items = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []) {
    const link = extractTag(block, "link");
    items.push({
      title: extractTag(block, "title"),
      link,
      description: extractTag(block, "description") || extractTag(block, "content:encoded"),
      domain: hostname(link),
      source: extractTag(block, "sm:source"),
      sort: extractTag(xml, "sm:sort") || "unknown",
    });
  }
  return items;
}

async function main() {
  const all = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const dedup = new Map();
  for (const item of all) {
    const key = item.link || `${item.title}:${item.domain}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }

  const ranked = [...dedup.values()]
    .map((it) => ({ ...it, score: scoreItem(it) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const high = ranked.filter((x) => x.score >= 4).slice(0, 6);
  const noise = ranked
    .filter((x) => x.score <= 2)
    .slice(0, 4)
    .map((x) => `- ${x.title} (${x.domain || "unknown"})`);

  console.log(`# AI/Agent signal triage (${new Date().toISOString()})`);
  console.log();
  console.log(`Analyzed feeds: ${FEEDS.length}, unique items: ${dedup.size}`);
  console.log();
  console.log("## High-signal candidates");
  for (const it of high) {
    console.log(`- [score:${it.score}] ${it.title} (${it.domain})`);
    console.log(`  ${it.link}`);
  }
  console.log();
  console.log("## Likely noise / low-actionability");
  if (noise.length === 0) {
    console.log("- None detected in current window.");
  } else {
    console.log(noise.join("\n"));
  }
  console.log();
  console.log("## Suggested immediate actions");
  console.log("- Turn top 1-2 high-signal items into concrete repo tasks with owner + ETA.");
  console.log("- Ignore low-actionability hype unless independently corroborated.");
}

main().catch((err) => {
  console.error("rss-agent-signal-triage failed:", err.message);
  process.exit(1);
});
