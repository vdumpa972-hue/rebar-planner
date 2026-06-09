export type DetectedValueSourceKind = "pdf-text" | "calculated" | "default";

export type DetectedValue = {
  key: string;
  value: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  sourceKind: DetectedValueSourceKind;
};

export type ExtractionMode = "live" | "simulation";

type ExtractOptions = {
  mode?: ExtractionMode;
};

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function findDimensions(text: string) {
  const normalized = normalizeText(text);
  const dimensionPattern =
    /\d+'(?:\s*-\s*\d+(?:\s+\d+\/\d+)?")?|\d+(?:\.\d+)?"/g;
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
      const qtyMatch = window.match(
        /(?:qty|quantity|count|no\.?|#)\s*[:=]?\s*(\d+)/i,
      );
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

function addValue(
  values: DetectedValue[],
  key: string,
  value: string,
  confidence: DetectedValue["confidence"],
  reason: string,
  sourceKind: DetectedValueSourceKind,
) {
  const existingIndex = values.findIndex((item) => item.key === key);
  const next = { key, value, confidence, reason, sourceKind };
  if (existingIndex >= 0) values[existingIndex] = next;
  else values.push(next);
}

function addSimulationDefaults(values: DetectedValue[]) {
  addValue(
    values,
    "sideAboveGrade",
    '19"',
    "low",
    "SIMULATION ONLY: default from current ADU logic; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "sideTotalHeight",
    '25"',
    "low",
    "SIMULATION ONLY: 19 in above grade + 6 in below grade; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "sideVerticalBottomClearance",
    '3"',
    "low",
    "SIMULATION ONLY: default bottom clearance; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "sideVerticalTopClearance",
    '8"',
    "low",
    "SIMULATION ONLY: default side wall top clearance; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "endVerticalBottomClearance",
    '3"',
    "low",
    "SIMULATION ONLY: default bottom clearance; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "endVerticalTopClearance",
    '3"',
    "low",
    "SIMULATION ONLY: default end wall top clearance; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "baseShortVerticalCutLength",
    '12"',
    "low",
    "SIMULATION ONLY: default small base vertical length; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "sideVerticalQty",
    "52",
    "low",
    "SIMULATION ONLY: default side wall vertical bar count; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "endVerticalQty",
    "16",
    "low",
    "SIMULATION ONLY: default end wall vertical bar count; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "baseShortVerticalQty",
    "24",
    "low",
    "SIMULATION ONLY: default small base vertical count; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "ptSillPlates",
    '1 plate @ 1.5" for end wall; 2 plates @ 1.5" each for side wall',
    "low",
    "SIMULATION ONLY: current ADU sill plate assumption; not read from PDF.",
    "default",
  );
  addValue(
    values,
    "pierCount",
    "14",
    "low",
    "SIMULATION ONLY: default pier count; not read from PDF text or image.",
    "default",
  );
}

export function extractDetectedValuesFromPlanText(
  text: string,
  options: ExtractOptions = {},
): {
  detectedValues: DetectedValue[];
  dimensionsFound: string[];
  notes: string[];
} {
  const mode = options.mode || "live";
  const normalized = normalizeText(text).toLowerCase();
  const dimensionsFound = findDimensions(text);
  const values: DetectedValue[] = [];
  const notes: string[] = [];

  const sideWallRaw = findFirstMatchingDimension(dimensionsFound, [
    "52'-0\"",
    "52'",
    "52' - 0\"",
  ]);
  if (sideWallRaw) {
    const sideWallInches = feetInchesToInches(sideWallRaw);
    const sideWall = formatInches(sideWallInches);
    addValue(
      values,
      "sideWallLength",
      sideWall,
      "medium",
      "Matched long-side wall dimension in PDF text.",
      "pdf-text",
    );
    addValue(
      values,
      "sideBaseOuterLength",
      formatInches(sideWallInches + 3),
      "low",
      "Calculated from PDF/user side wall length + 3 in. Formula value, not directly read from PDF.",
      "calculated",
    );
    addValue(
      values,
      "sideBaseMiddleLength",
      formatInches(sideWallInches - 3),
      "low",
      "Calculated from PDF/user side wall length - 3 in. Formula value, not directly read from PDF.",
      "calculated",
    );
    addValue(
      values,
      "sideBaseInnerLength",
      formatInches(sideWallInches - 9),
      "low",
      "Calculated from PDF/user side wall length - 9 in. Formula value, not directly read from PDF.",
      "calculated",
    );
  }

  const endWall = findFirstMatchingDimension(dimensionsFound, [
    "13'-4\"",
    "13' - 4\"",
  ]);
  if (endWall) {
    addValue(
      values,
      "endWallLength",
      "13'-4\"",
      "medium",
      "Matched end-wall dimension in PDF text.",
      "pdf-text",
    );
  }

  if (containsDimension(dimensionsFound, '18"')) {
    addValue(
      values,
      "footingDepth",
      '18"',
      "medium",
      "18 in dimension found in PDF text.",
      "pdf-text",
    );
    addValue(
      values,
      "footingSize",
      '18" x 18"',
      "low",
      "Inferred from repeated 18 in PDF text. Confirm full footing callout description; this is not a drawing takeoff.",
      "pdf-text",
    );
  }

  if (containsDimension(dimensionsFound, '6"')) {
    addValue(
      values,
      "wallThickness",
      '6"',
      "medium",
      "6 in dimension found in PDF text.",
      "pdf-text",
    );
    addValue(
      values,
      "belowGradeEmbed",
      '6"',
      "low",
      "6 in dimension found in PDF text; confirm it is below-grade embed before fabrication.",
      "pdf-text",
    );
  }

  if (containsDimension(dimensionsFound, '28"')) {
    addValue(
      values,
      "pierDiameter",
      '28"',
      "medium",
      "28 in dimension found in PDF text near pier callout descriptions.",
      "pdf-text",
    );
  }

  if (
    normalized.includes("1'-2\"") ||
    normalized.includes("1' - 2\"") ||
    containsDimension(dimensionsFound, "1'-2\"")
  ) {
    addValue(
      values,
      "endAboveGrade",
      '12.5"',
      "low",
      "Calculated from PDF text clue 1'-2 minus 1.5 in sill plate. Formula value, not directly read from PDF as concrete height.",
      "calculated",
    );
    addValue(
      values,
      "endTotalHeight",
      '18.5"',
      "low",
      "Calculated from end wall above-grade plus 6 in embed. Formula value, not directly read from PDF.",
      "calculated",
    );
  }

  const pierCount = findCountNear(text, ["pier", "piers"]);
  if (pierCount) {
    addValue(
      values,
      "pierCount",
      pierCount,
      "medium",
      "Found explicit count near pier text in PDF text layer.",
      "pdf-text",
    );
  } else if (mode === "simulation") {
    // In live mode, no pier count is returned unless it is read from PDF text or supplied by user.
  }

  const rebarHints: string[] = [];
  if (normalized.includes("#4")) rebarHints.push("#4");
  if (normalized.includes("v-s") || normalized.includes("vs"))
    rebarHints.push("V-S");
  if (normalized.includes("v-e") || normalized.includes("ve"))
    rebarHints.push("V-E");
  if (normalized.includes("pier")) rebarHints.push("pier cages");
  if (rebarHints.length) {
    addValue(
      values,
      "rebarCallouts",
      unique(rebarHints).join(", "),
      "medium",
      "Found rebar keywords in PDF text.",
      "pdf-text",
    );
  }

  if (mode === "simulation") {
    addSimulationDefaults(values);
    notes.push(
      "Simulation Mode: canned/default values are allowed and marked Default. These are not PDF values.",
    );
  } else {
    notes.push(
      "Live Mode: no canned/default values were added. Missing values must come from PDF text, PDF image analysis, or user input.",
    );
    notes.push(
      "PDF image analysis is not implemented in this build, so drawing-only items such as pier symbol count remain Missing unless found in text or entered by user.",
    );
  }

  notes.push(
    `PDF text dimensions found: ${dimensionsFound.slice(0, 80).join(", ") || "none"}`,
  );
  notes.push(
    "Current extractor reads the PDF text layer only. It does not perform OCR or drawing/symbol recognition yet.",
  );

  return { detectedValues: values, dimensionsFound, notes };
}
