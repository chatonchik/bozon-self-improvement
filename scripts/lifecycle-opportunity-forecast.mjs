#!/usr/bin/env node
/**
 * Lifecycle helper: convert RSS signals into scenario + opportunity map.
 * Meta-improvement: recurrence-aware scoring (same theme across day/week/month gets higher confidence).
 */

const FEEDS = [
  { url: "https://shir-man.com/api/rss", bucket: "trending" },
  { url: "https://shir-man.com/api/rss?sort=day", bucket: "day" },
  { url: "https://shir-man.com/api/rss?sort=week", bucket: "week" },
  { url: "https://shir-man.com/api/rss?sort=month", bucket: "month" },
];

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

async function fetchFeed({ url, bucket }) {
  const res = await fetch(url, { headers: { "user-agent": "openclaw-lifecycle-forecast/1.0" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const xml = await res.text();

  return (xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []).map((block) => {
    const link = extractTag(block, "link");
    const title = extractTag(block, "title");
    const description = extractTag(block, "description") || extractTag(block, "content:encoded");
    return {
      bucket,
      link,
      title,
      description,
      domain: hostname(link),
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

  for (const it of items) {
    const hit = theme.keywords.some((kw) => it.text.includes(kw));
    if (!hit) continue;
    hits += 1;
    weighted += bucketWeight(it.bucket);
    byBucket.add(it.bucket);
  }

  const recurrence = byBucket.size / 4; // 0..1 across trending/day/week/month
  const raw = weighted * 0.65 + recurrence * 4.0;
  const probability = clamp(0.2 + raw / 10, 0.2, 0.85);

  return {
    hits,
    recurrence,
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

async function main() {
  const items = (await Promise.all(FEEDS.map(fetchFeed))).flat();

  const scenarios = THEMES.map((theme) => {
    const s = scoreTheme(items, theme);
    return {
      theme: theme.label,
      horizon: horizonForTheme(theme.id),
      probability: s.probability,
      confidence: s.recurrence >= 0.5 ? "средняя/высокая" : "средняя",
      drivers: [`Совпадение по ключевым сигналам: ${s.hits}`, `Покрытие горизонтов (recurrence): ${s.buckets.join(", ") || "нет"}`],
      risks: ["Часть источников в трендовом фиде может быть шумной/хайповой", "Сигналы не являются финансовой рекомендацией"],
      indicators: theme.keywords.slice(0, 3),
      opportunities: theme.opportunities,
    };
  }).sort((a, b) => b.probability - a.probability);

  console.log(`# Lifecycle opportunity forecast (${new Date().toISOString()})`);
  console.log();
  console.log(`Items analyzed: ${items.length}`);
  console.log("Meta-improvement: recurrence-aware confidence scoring enabled.");
  console.log();
  console.log(JSON.stringify({ scenarios }, null, 2));
}

main().catch((err) => {
  console.error("lifecycle-opportunity-forecast failed:", err.message);
  process.exit(1);
});
