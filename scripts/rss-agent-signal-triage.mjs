#!/usr/bin/env node
/**
 * Lightweight RSS triage for self-improvement loops.
 * Focus: extract actionable AI/agent, macro, and geopolitics signals and filter hype/noise.
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
  "federalreserve.gov",
  "bls.gov",
  "ecb.europa.eu",
  "imf.org",
  "reuters.com",
  "ft.com",
];

const CATEGORIES = {
  ai: [
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
  ],
  macro: [
    "inflation",
    "cpi",
    "payroll",
    "employment",
    "fed",
    "ecb",
    "rates",
    "yield",
    "recession",
    "gdp",
    "housing",
  ],
  geopolitics: [
    "sanction",
    "war",
    "defense",
    "department of war",
    "classified",
    "china",
    "iran",
    "israel",
    "tariff",
    "security policy",
  ],
};

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

function scoreByCategory(text, keywords) {
  return keywords.reduce((acc, keyword) => acc + (text.includes(keyword) ? 1 : 0), 0);
}

function topicSignature(item) {
  return `${item.title} ${item.description}`
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 8)
    .join(" ");
}

function scoreItem(item, corroborationCount = 1) {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  const aiScore = scoreByCategory(hay, CATEGORIES.ai);
  const macroScore = scoreByCategory(hay, CATEGORIES.macro);
  const geoScore = scoreByCategory(hay, CATEGORIES.geopolitics);

  const trusted = TRUSTED_DOMAINS.some((d) => item.domain === d || item.domain.endsWith(`.${d}`));
  const hypePenalty = /reddit|twitter|x\.com/.test(item.domain) && aiScore + macroScore + geoScore < 2 ? 2 : 0;
  const corroborationBoost = Math.min(2, Math.max(0, corroborationCount - 1));
  const singleSourcePenalty = !trusted && corroborationCount < 2 ? 1 : 0;
  const evidenceScore = (trusted ? 2 : 0) + corroborationBoost - singleSourcePenalty;

  const total = aiScore + macroScore + geoScore + evidenceScore - hypePenalty;

  return {
    total,
    aiScore,
    macroScore,
    geoScore,
    trusted,
    hypePenalty,
    corroborationCount,
    evidenceScore,
    dominantCategory:
      aiScore >= macroScore && aiScore >= geoScore
        ? "ai"
        : macroScore >= geoScore
          ? "macro"
          : "geopolitics",
  };
}

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { "user-agent": "openclaw-rss-triage/1.1" } });
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

function summarizeScenarios(topItems) {
  const byCat = { ai: 0, macro: 0, geopolitics: 0 };
  for (const item of topItems) byCat[item.dominantCategory]++;

  const total = Math.max(1, topItems.length);
  const domainCounts = new Map();
  for (const item of topItems) {
    const d = item.domain || "unknown";
    domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
  }
  const topDomainShare = Number(
    ((Math.max(0, ...[...domainCounts.values()]) / Math.max(1, topItems.length)) || 0).toFixed(2),
  );

  return {
    shortHorizonBias: {
      ai: Number((byCat.ai / total).toFixed(2)),
      macro: Number((byCat.macro / total).toFixed(2)),
      geopolitics: Number((byCat.geopolitics / total).toFixed(2)),
    },
    sourceDiversity: {
      uniqueDomains: domainCounts.size,
      topDomainShare,
    },
    monitor: [
      "Подтвержденные инциденты prompt-injection/agent compromise",
      "Сигналы инфляции/ставок (CPI, решения ФРС/ЕЦБ)",
      "Геополитические эскалации с влиянием на сырье/риск-аппетит",
    ],
  };
}

function capPerDomain(items, maxPerDomain = 2) {
  const counts = new Map();
  const out = [];
  for (const item of items) {
    const d = item.domain || "unknown";
    const n = counts.get(d) || 0;
    if (n >= maxPerDomain) continue;
    counts.set(d, n + 1);
    out.push(item);
  }
  return out;
}

async function main() {
  const asJson = process.argv.includes("--json");
  const all = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const dedup = new Map();
  for (const item of all) {
    const key = item.link || `${item.title}:${item.domain}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }

  const topicDomainMap = new Map();
  for (const item of dedup.values()) {
    const sig = topicSignature(item);
    if (!sig) continue;
    if (!topicDomainMap.has(sig)) topicDomainMap.set(sig, new Set());
    topicDomainMap.get(sig).add(item.domain || "unknown");
  }

  const ranked = [...dedup.values()]
    .map((it) => {
      const sig = topicSignature(it);
      const corroborationCount = topicDomainMap.get(sig)?.size || 1;
      return { ...it, ...scoreItem(it, corroborationCount) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  const highRaw = ranked.filter((x) => x.total >= 4 && (x.trusted || x.corroborationCount >= 2));
  const high = capPerDomain(highRaw, 2).slice(0, 8);
  const noise = ranked.filter((x) => x.total <= 2).slice(0, 6);
  const scenarioHints = summarizeScenarios(high);

  const result = {
    generatedAt: new Date().toISOString(),
    feeds: FEEDS,
    uniqueItems: dedup.size,
    highSignal: high.map((x) => ({
      title: x.title,
      link: x.link,
      domain: x.domain,
      totalScore: x.total,
      category: x.dominantCategory,
      aiScore: x.aiScore,
      macroScore: x.macroScore,
      geoScore: x.geoScore,
      trusted: x.trusted,
      corroborationCount: x.corroborationCount,
      evidenceScore: x.evidenceScore,
    })),
    lowSignal: noise.map((x) => ({
      title: x.title,
      domain: x.domain,
      totalScore: x.total,
    })),
    scenarioHints,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`# AI/Agent+Macro triage (${result.generatedAt})`);
  console.log();
  console.log(`Analyzed feeds: ${FEEDS.length}, unique items: ${dedup.size}`);
  console.log();
  console.log("## High-signal candidates");
  for (const it of result.highSignal) {
    console.log(
      `- [score:${it.totalScore}] [${it.category}] [evidence:${it.evidenceScore}] [corroboration:${it.corroborationCount}] ${it.title} (${it.domain})`,
    );
    console.log(`  ${it.link}`);
  }
  console.log();
  console.log("## Likely noise / low-actionability");
  if (result.lowSignal.length === 0) {
    console.log("- None detected in current window.");
  } else {
    for (const it of result.lowSignal) {
      console.log(`- [score:${it.totalScore}] ${it.title} (${it.domain || "unknown"})`);
    }
  }
  console.log();
  console.log("## Scenario hints (short horizon)");
  console.log(`- AI share: ${result.scenarioHints.shortHorizonBias.ai}`);
  console.log(`- Macro share: ${result.scenarioHints.shortHorizonBias.macro}`);
  console.log(`- Geopolitics share: ${result.scenarioHints.shortHorizonBias.geopolitics}`);
  console.log(`- Unique domains in high-signal: ${result.scenarioHints.sourceDiversity.uniqueDomains}`);
  console.log(`- Top-domain share in high-signal: ${result.scenarioHints.sourceDiversity.topDomainShare}`);
  console.log("- Monitor:");
  for (const item of result.scenarioHints.monitor) console.log(`  - ${item}`);
}

main().catch((err) => {
  console.error("rss-agent-signal-triage failed:", err.message);
  process.exit(1);
});
