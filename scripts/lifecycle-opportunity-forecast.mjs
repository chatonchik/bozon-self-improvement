#!/usr/bin/env node
/**
 * Lifecycle helper: convert RSS signals into scenario + opportunity map.
 * Meta-improvement: evidence gate + source-quality-aware scoring.
 */

const FEEDS = [
  { url: "https://shir-man.com/api/rss", bucket: "trending" },
  { url: "https://shir-man.com/api/rss?sort=day", bucket: "day" },
  { url: "https://shir-man.com/api/rss?sort=week", bucket: "week" },
  { url: "https://shir-man.com/api/rss?sort=month", bucket: "month" },
];

const DOMAIN_TRUST = {
  "openai.com": 0.95,
  "anthropic.com": 0.95,
  "federalreserve.gov": 1.0,
  "ecb.europa.eu": 1.0,
  "acm.org": 0.9,
  "github.com": 0.85,
  "huggingface.co": 0.8,
  "news.ycombinator.com": 0.7,
  "lesswrong.com": 0.75,
  "lobste.rs": 0.7,
  "reddit.com": 0.45,
  "twitter.com": 0.45,
  "x.com": 0.45,
};

const THEMES = [
  {
    id: "agent_security",
    label: "Безопасность агентных систем",
    keywords: ["prompt injection", "security", "compromised", "sandbox", "agent compromise"],
    opportunities: [
      {
        idea: "Усилить untrusted-content firewall и тесты инъекций",
        risk: "низкий",
        horizon: "1-4 недели",
        invalidation: "Если нет новых подтвержденных кейсов/инцидентов 30+ дней подряд.",
      },
    ],
  },
  {
    id: "model_productivity",
    label: "Модельные релизы и рост продуктивности",
    keywords: ["gpt", "claude", "release", "reasoning", "context", "coding", "agent"],
    opportunities: [
      {
        idea: "Держать мульти-модельный маршрут с бенчмарком цена/качество",
        risk: "средний",
        horizon: "1-3 месяца",
        invalidation: "Если новая модель не дает >10% выигрыша по времени/стоимости на задачах Кеши.",
      },
    ],
  },
  {
    id: "macro_jobs",
    label: "Макро и рынок труда",
    keywords: ["economy", "jobs", "labor", "inflation", "federal reserve", "ecb"],
    opportunities: [
      {
        idea: "Держать защитный кэш и не повышать риск портфеля при слабых данных по занятости",
        risk: "средний",
        horizon: "1-3 месяца",
        invalidation: "Если 2 подряд релиза макроданных улучшаются (занятость/инфляция).",
      },
    ],
  },
  {
    id: "geopolitics_ai_policy",
    label: "Геополитика и AI policy",
    keywords: ["department of war", "federal", "classified", "sanctions", "geopolit", "trump"],
    opportunities: [
      {
        idea: "Снижать зависимость от одного провайдера/региона; готовить резервные маршруты",
        risk: "средний",
        horizon: "3-12 месяцев",
        invalidation: "Если регуляторный фон стабилизируется и ограничений не появляется 1 квартал.",
      },
    ],
  },
];

function getNumericArg(name, fallback) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split("=")[1]);
  return Number.isFinite(value) ? value : fallback;
}

const MIN_HITS = getNumericArg("min-hits", 2);

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

function sourceWeight(domain) {
  if (!domain) return 0.55;
  for (const [known, weight] of Object.entries(DOMAIN_TRUST)) {
    if (domain === known || domain.endsWith(`.${known}`)) return weight;
  }
  return 0.65;
}

async function fetchFeed({ url, bucket }) {
  const res = await fetch(url, { headers: { "user-agent": "openclaw-lifecycle-forecast/1.2" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const xml = await res.text();

  return (xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []).map((block) => {
    const link = extractTag(block, "link");
    const title = extractTag(block, "title");
    const description = extractTag(block, "description") || extractTag(block, "content:encoded");
    const domain = hostname(link);
    return {
      bucket,
      link,
      title,
      description,
      domain,
      trust: sourceWeight(domain),
      text: `${title} ${description}`.toLowerCase(),
    };
  });
}

function bucketWeight(bucket) {
  if (bucket === "day") return 1.0;
  if (bucket === "week") return 0.8;
  if (bucket === "month") return 0.6;
  return 0.7;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function scoreTheme(items, theme) {
  const byBucket = new Set();
  let hits = 0;
  let weighted = 0;
  let trustedHits = 0;
  let lowTrustHits = 0;

  for (const it of items) {
    const hit = theme.keywords.some((kw) => it.text.includes(kw));
    if (!hit) continue;
    hits += 1;
    weighted += bucketWeight(it.bucket) * it.trust;
    byBucket.add(it.bucket);
    if (it.trust >= 0.85) trustedHits += 1;
    if (it.trust < 0.6) lowTrustHits += 1;
  }

  const recurrence = byBucket.size / 4; // 0..1 across trending/day/week/month
  const qualityRatio = hits ? trustedHits / hits : 0;
  const lowTrustPenalty = hits ? lowTrustHits / hits : 0;
  const evidenceFactor = clamp(hits / Math.max(MIN_HITS, 1), 0.35, 1);

  const raw = weighted * 0.65 + recurrence * 3.5 + qualityRatio * 1.8 - lowTrustPenalty * 1.2;
  const probability = clamp((0.2 + raw / 10) * evidenceFactor, 0.15, 0.85);

  return {
    hits,
    recurrence,
    trustedHits,
    lowTrustHits,
    qualityRatio: Number(qualityRatio.toFixed(2)),
    evidenceFactor: Number(evidenceFactor.toFixed(2)),
    probability: Number(probability.toFixed(2)),
    buckets: [...byBucket],
  };
}

function horizonForTheme(themeId) {
  if (themeId === "agent_security") return "краткосрок (1-4 недели)";
  if (themeId === "model_productivity") return "среднесрок (1-3 месяца)";
  if (themeId === "macro_jobs") return "среднесрок (1-3 месяца)";
  return "долгосрок (3-12 месяцев)";
}

function confidenceLabel(recurrence, qualityRatio, evidenceFactor) {
  if (evidenceFactor < 0.75) return "средняя/низкая";
  if (recurrence >= 0.5 && qualityRatio >= 0.5) return "высокая";
  if (recurrence >= 0.5 || qualityRatio >= 0.45) return "средняя/высокая";
  return "средняя";
}

async function main() {
  const items = (await Promise.all(FEEDS.map(fetchFeed))).flat();

  const scenarios = THEMES.map((theme) => {
    const s = scoreTheme(items, theme);
    return {
      theme: theme.label,
      horizon: horizonForTheme(theme.id),
      probability: s.probability,
      confidence: confidenceLabel(s.recurrence, s.qualityRatio, s.evidenceFactor),
      drivers: [
        `Совпадение по ключевым сигналам: ${s.hits}`,
        `Покрытие горизонтов (recurrence): ${s.buckets.join(", ") || "нет"}`,
        `Доля надежных источников: ${(s.qualityRatio * 100).toFixed(0)}%`,
        `Коэффициент достаточности данных: ${s.evidenceFactor}`,
      ],
      risks: [
        `Сигналов из низконадежных источников: ${s.lowTrustHits}`,
        "Часть трендового фида может быть шумной/хайповой",
        "Сигналы не являются финансовой рекомендацией",
      ],
      indicators: theme.keywords.slice(0, 3),
      opportunities: theme.opportunities,
    };
  }).sort((a, b) => b.probability - a.probability);

  console.log(`# Lifecycle opportunity forecast (${new Date().toISOString()})`);
  console.log();
  console.log(`Items analyzed: ${items.length}`);
  console.log(`Meta-improvement: evidence gate enabled (min-hits=${MIN_HITS}) + source-quality weighting.`);
  console.log();
  console.log(JSON.stringify({ scenarios }, null, 2));
}

main().catch((err) => {
  console.error("lifecycle-opportunity-forecast failed:", err.message);
  process.exit(1);
});
