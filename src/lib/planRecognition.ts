export type PlanRecognitionReport = {
  pages: PlanRecognitionPage[];
  dimensions: DimensionCandidate[];
  keywordSnippets: KeywordSnippet[];
};

type PlanRecognitionPage = {
  pageNumber: number;
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
    };
  });

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

  return { pages, dimensions, keywordSnippets };
}
