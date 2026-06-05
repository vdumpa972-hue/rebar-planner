type DetectedValue = {
  key: string;
  value: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function findDimensions(text: string) {
  const normalized = normalizeText(text);
  const dimensionPattern = /\d+'(?:\s*-\s*\d+(?:\s+\d+\/\d+)?")?|\d+(?:\.\d+)?"/g;
  return unique(normalized.match(dimensionPattern) || []);
}

function cleanDim(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function containsDimension(dimensions: string[], target: string) {
  const wanted = cleanDim(target);
  return dimensions.some((dimension) => cleanDim(dimension) === wanted);
}

function findFirstMatchingDimension(dimensions: string[], targets: string[]) {
  for (const target of targets) {
    if (containsDimension(dimensions, target)) return target;
  }
  return "";
}

function findCountNear(text: string, words: string[]) {
  const normalized = normalizeText(text).toLowerCase();
  for (const word of words) {
    const index = normalized.indexOf(word.toLowerCase());
    if (index >= 0) {
      const window = normalized.slice(Math.max(0, index - 120), index + 160);
      const qtyMatch = window.match(/(?:qty|quantity|count|no\.?|#)\s*[:=]?\s*(\d+)/i);
      if (qtyMatch) return qtyMatch[1];
    }
  }
  return "";
}

function feetInchesToInches(value: string) {
  const clean = value.trim();
  const feetMatch = clean.match(/(\d+(?:\.\d+)?)\s*'/);
  const inchMatch = clean.match(/(\d+(?:\.\d+)?)\s*"/);
  const feet = feetMatch ? Number(feetMatch[1]) : 0;
  const inches = inchMatch ? Number(inchMatch[1]) : 0;
  return feet * 12 + inches;
}

function formatInches(totalInches: number) {
  const sign = totalInches < 0 ? "-" : "";
  const abs = Math.abs(totalInches);
  const feet = Math.floor(abs / 12);
  const inches = Math.round(abs - feet * 12);
  if (feet > 0 && inches > 0) return `${sign}${feet}'-${inches}"`;
  if (feet > 0) return `${sign}${feet}'`;
  return `${sign}${inches}"`;
}

function addValue(values: DetectedValue[], key: string, value: string, confidence: DetectedValue["confidence"], reason: string) {
  const existingIndex = values.findIndex((item) => item.key === key);
  const next = { key, value, confidence, reason };
  if (existingIndex >= 0) values[existingIndex] = next;
  else values.push(next);
}

export function extractDetectedValuesFromPlanText(text: string): {
  detectedValues: DetectedValue[];
  dimensionsFound: string[];
  notes: string[];
} {
  const normalized = normalizeText(text).toLowerCase();
  const dimensionsFound = findDimensions(text);
  const values: DetectedValue[] = [];
  const notes: string[] = [];

  // Important fix: your PDF text reports the long wall as 52'-0", not only 52'.
  const sideWallRaw = findFirstMatchingDimension(dimensionsFound, ["52'-0\"", "52'", "52' - 0\""]);
  if (sideWallRaw) {
    const sideWallInches = feetInchesToInches(sideWallRaw);
    const sideWall = formatInches(sideWallInches);
    addValue(values, "sideWallLength", sideWall, "medium", "Matched long-side wall dimension in PDF text, including 52'-0 in format.");
    addValue(values, "sideBaseOuterLength", formatInches(sideWallInches + 3), "low", "Calculated from side wall + 3 in for outer base bar; confirm from plan.");
    addValue(values, "sideBaseMiddleLength", formatInches(sideWallInches - 3), "low", "Calculated from side wall - 3 in for middle base bar; confirm from plan.");
    addValue(values, "sideBaseInnerLength", formatInches(sideWallInches - 9), "low", "Calculated from side wall - 9 in for inner base bar; confirm from plan.");
  }

  const endWall = findFirstMatchingDimension(dimensionsFound, ["13'-4\"", "13' - 4\""]);
  if (endWall) {
    addValue(values, "endWallLength", "13'-4\"", "medium", "Matched end-wall dimension in plan text.");
  }

  if (containsDimension(dimensionsFound, "18\"")) {
    addValue(values, "footingDepth", "18\"", "medium", "18 in dimension found; used as default footing depth for vertical bars.");
    addValue(values, "footingSize", "18\" x 18\"", "low", "18 in dimension found; confirm full footing callout.");
  }

  if (containsDimension(dimensionsFound, "6\"")) {
    addValue(values, "wallThickness", "6\"", "medium", "6 in dimension found; used as wall thickness/default embed clue.");
    addValue(values, "belowGradeEmbed", "6\"", "low", "6 in dimension found; confirm below-grade embed.");
  }

  if (containsDimension(dimensionsFound, "28\"")) {
    addValue(values, "pierDiameter", "28\"", "medium", "28 in dimension found; likely pier diameter.");
  }

  if (normalized.includes("1'-2\"") || normalized.includes("1' - 2\"") || containsDimension(dimensionsFound, "1'-2\"")) {
    addValue(values, "endAboveGrade", "12.5\"", "low", "Plan shows 1'-2 in to beam; minus 1.5 in sill plate = 12.5 in concrete above grade.");
    addValue(values, "endTotalHeight", "18.5\"", "low", "12.5 in above grade + 6 in below grade.");
  }

  // Current project defaults. These are intentionally low-confidence and user-editable.
  addValue(values, "sideAboveGrade", "19\"", "low", "Default from current ADU logic: 22 in target minus two 1.5 in sill plates.");
  addValue(values, "sideTotalHeight", "25\"", "low", "19 in above grade + 6 in below grade.");
  addValue(values, "sideVerticalBottomClearance", "3\"", "low", "Default bottom clearance; confirm from plan.");
  addValue(values, "sideVerticalTopClearance", "8\"", "low", "Default side top clearance for vent area; confirm from plan.");
  addValue(values, "endVerticalBottomClearance", "3\"", "low", "Default bottom clearance; confirm from plan.");
  addValue(values, "endVerticalTopClearance", "3\"", "low", "Default end wall top clearance; confirm from plan.");
  addValue(values, "baseShortVerticalCutLength", "12\"", "low", "Default small base vertical length; confirm from plan.");

  // Quantity defaults for the current ADU workflow. These are low confidence and user-editable.
  // The PDF text gives many dimensions, but these counts are often shown graphically or in tables
  // that text extraction does not reliably expose.
  addValue(values, "sideVerticalQty", "52", "low", "Default side vertical bar count from current ADU schedule; confirm against plan spacing/count.");
  addValue(values, "endVerticalQty", "16", "low", "Default end vertical bar count from current ADU schedule; confirm against plan spacing/count.");
  addValue(values, "baseShortVerticalQty", "24", "low", "Default small 12 in base vertical count; confirm against plan.");
  addValue(values, "ptSillPlates", "1 plate @ 1.5\" for end wall; 2 plates @ 1.5\" each for side wall", "low", "Default sill plate assumption from current ADU detail; confirm before final schedule.");

  const pierCount = findCountNear(text, ["pier", "piers"]);
  if (pierCount) {
    addValue(values, "pierCount", pierCount, "medium", "Found count near pier text.");
  } else {
    addValue(values, "pierCount", "14", "low", "Default pier count from current ADU schedule; PDF text did not expose a clear count.");
  }

  const rebarHints: string[] = [];
  if (normalized.includes("#4")) rebarHints.push("#4");
  if (normalized.includes("v-s") || normalized.includes("vs")) rebarHints.push("V-S");
  if (normalized.includes("v-e") || normalized.includes("ve")) rebarHints.push("V-E");
  if (normalized.includes("pier")) rebarHints.push("pier cages");
  if (rebarHints.length) {
    addValue(values, "rebarCallouts", unique(rebarHints).join(", "), "medium", "Found rebar keywords in PDF text.");
  }

  notes.push(`PDF text dimensions found: ${dimensionsFound.slice(0, 80).join(", ") || "none"}`);
  notes.push("This is text extraction only, not OCR yet. If the PDF is scanned/image-only, use manual fields for now.");

  return { detectedValues: values, dimensionsFound, notes };
}
