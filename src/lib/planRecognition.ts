export type PlanRecognitionReport = {
  pages: PlanRecognitionPage[];
  relevantPages: FoundationRelevantPage[];
  dimensions: DimensionCandidate[];
  keywordSnippets: KeywordSnippet[];
  preferredText: string;
};

export type PlanRecognitionPage = {
  pageNumber: number;
  dimensionCount: number;
  keywordHits: string[];
  preview: string;
  text: string;
};

export type FoundationRelevantPage = {
  pageNumber: number;
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  dimensionCount: number;
  keywordHits: string[];
  preview: string;
};

type DimensionCandidate = {
  value: string;
  count: number;
  pages: number[];
};

type KeywordSnippet = {
  keyword: string;
  pageNumber: number;
  snippet: string;
};

const IMPORTANT_KEYWORDS = [
  "rebar",
  "stem",
  "footing",
  "foundation",
  "pier",
  "sonotube",
  "vertical",
  "horizontal",
  "v-s",
  "v-e",
  "#4",
  "anchor",
  "sill",
  "grade",
  "vent",
];

const NEGATIVE_KEYWORDS = [
  "stair",
  "stairs",
  "handrail",
  "handrails",
  "decking",
  "exterior elevation",
  "front view",
  "rear view",
  "left view",
  "right view",
];

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDimension(value: string) {
  return value.replace(/\s+/g, "").replace("−", "-");
}

function extractDimensions(text: string) {
  const dimensionPattern = /\d+'(?:\s*-\s*\d+(?:\s+\d+\/\d+)?")?|\d+(?:\.\d+)?"/g;
  return text.match(dimensionPattern)?.map(normalizeDimension) || [];
}

function splitPages(text: string) {
  const matches = Array.from(text.matchAll(/--- PAGE (\d+) ---\n([\s\S]*?)(?=\n\n--- PAGE \d+ ---|$)/g));

  if (matches.length === 0) {
    return [{ pageNumber: 1, text }];
  }

  return matches.map((match) => ({
    pageNumber: Number(match[1]),
    text: match[2] || "",
  }));
}

function findKeywordSnippets(pageText: string, pageNumber: number): KeywordSnippet[] {
  const normalized = normalizeSpaces(pageText);
  const lower = normalized.toLowerCase();
  const snippets: KeywordSnippet[] = [];

  for (const keyword of IMPORTANT_KEYWORDS) {
    const index = lower.indexOf(keyword.toLowerCase());
    if (index < 0) continue;

    const start = Math.max(0, index - 90);
    const end = Math.min(normalized.length, index + 180);
    snippets.push({
      keyword,
      pageNumber,
      snippet: normalized.slice(start, end),
    });
  }

  return snippets;
}

function scoreFoundationPage(pageText: string, dimensions: string[], keywordHits: string[]) {
  const text = normalizeSpaces(pageText).toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  const positiveRules: Array<[RegExp, number, string]> = [
    [/foundation/i, 7, "foundation keyword"],
    [/stem\s*wall/i, 8, "stem wall keyword"],
    [/footing/i, 6, "footing keyword"],
    [/#\s*4|#4/i, 4, "#4 rebar callout"],
    [/rebar/i, 5, "rebar keyword"],
    [/v[-\s]?s\b|v[-\s]?e\b/i, 5, "V-S/V-E keyword"],
    [/sonotube|pier/i, 4, "pier/sonotube keyword"],
    [/anchor|sill|grade|vent/i, 2, "foundation-detail keyword"],
  ];

  for (const [pattern, points, reason] of positiveRules) {
    if (pattern.test(text)) {
      score += points;
      reasons.push(reason);
    }
  }

  const importantDims = ["52'-0\"", "52'", "13'-4\"", "28\"", "18\"", "6\"", "1'-2\"", "12\""];
  const dimHits = importantDims.filter((dim) => dimensions.includes(dim));
  if (dimHits.length) {
    score += Math.min(dimHits.length * 2, 10);
    reasons.push(`important dimensions: ${dimHits.join(", ")}`);
  }

  if (keywordHits.length >= 3) {
    score += 3;
    reasons.push("multiple foundation keywords");
  }

  const negativeHits = NEGATIVE_KEYWORDS.filter((word) => text.includes(word));
  if (negativeHits.length) {
    score -= Math.min(negativeHits.length * 4, 12);
    reasons.push(`noise keywords: ${negativeHits.join(", ")}`);
  }

  const confidence = score >= 14 ? "high" : score >= 7 ? "medium" : "low";

  return {
    score,
    confidence,
    reason: reasons.length ? reasons.join("; ") : "few foundation clues found",
  };
}

export function analyzePlanText(text: string): PlanRecognitionReport {
  const pagesRaw = splitPages(text);
  const dimensionMap = new Map<string, { count: number; pages: Set<number> }>();
  const keywordSnippets: KeywordSnippet[] = [];

  const pages = pagesRaw.map((page) => {
    const dimensions = extractDimensions(page.text);
    const snippets = findKeywordSnippets(page.text, page.pageNumber);
    keywordSnippets.push(...snippets);

    for (const dimension of dimensions) {
      const existing = dimensionMap.get(dimension) || { count: 0, pages: new Set<number>() };
      existing.count += 1;
      existing.pages.add(page.pageNumber);
      dimensionMap.set(dimension, existing);
    }

    return {
      pageNumber: page.pageNumber,
      dimensionCount: dimensions.length,
      keywordHits: snippets.map((snippet) => snippet.keyword),
      preview: normalizeSpaces(page.text).slice(0, 350),
      text: page.text,
    };
  });

  const relevantPages = pages
    .map((page) => {
      const dimensions = extractDimensions(page.text);
      const score = scoreFoundationPage(page.text, dimensions, page.keywordHits);
      return {
        pageNumber: page.pageNumber,
        score: score.score,
        confidence: score.confidence,
        reason: score.reason,
        dimensionCount: page.dimensionCount,
        keywordHits: page.keywordHits,
        preview: page.preview,
      };
    })
    .filter((page) => page.score > 0)
    .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);

  const preferredPageNumbers = new Set(
    relevantPages
      .filter((page) => page.confidence === "high" || page.confidence === "medium")
      .slice(0, 6)
      .map((page) => page.pageNumber)
  );

  const preferredText = preferredPageNumbers.size
    ? pages
        .filter((page) => preferredPageNumbers.has(page.pageNumber))
        .map((page) => `--- PAGE ${page.pageNumber} ---\n${page.text}`)
        .join("\n\n")
    : text;

  const dimensions = Array.from(dimensionMap.entries())
    .map(([value, details]) => ({
      value,
      count: details.count,
      pages: Array.from(details.pages).sort((a, b) => a - b),
    }))
    .sort((a, b) => {
      const importantA = /52|13'-4|28|18|6|12|24/.test(a.value) ? 1 : 0;
      const importantB = /52|13'-4|28|18|6|12|24/.test(b.value) ? 1 : 0;
      if (importantA !== importantB) return importantB - importantA;
      return b.count - a.count;
    });

  return { pages, relevantPages, dimensions, keywordSnippets, preferredText };
}
