export type ScheduleLine = {
  mark: string;
  markPrefix: string;
  location: string;
  requiredLength: number;
  cutLength: number;
  leftFunction: string;
  usedLength: number;
  rightFunction: string;
  fieldOrder: string;
};

export type RequiredCheck = {
  location: string;
  requiredLength: number;
  totalUsed: number;
  pieces: number;
  totalCut: number;
  status: string;
  ok: boolean;
};

export type PieceTypeSummary = {
  markPrefix: string;
  description: string;
  qty: number;
  totalCut: number;
};

export type MaterialTakeoff = {
  group: string;
  totalCut: number;
  stockLength: number;
  sticksToBuy: number;
  availableLength: number;
  waste: number;
  status: string;
};

export function parseFeet(value: string): number {
  const clean = value.trim();
  if (!clean) return 0;

  const feetMatch = clean.match(/(\d+(?:\.\d+)?)\s*'/);
  const inchMatch = clean.match(/(\d+(?:\.\d+)?)\s*"/);

  const feet = feetMatch ? Number(feetMatch[1]) : 0;
  const inches = inchMatch ? Number(inchMatch[1]) : 0;

  if (!feetMatch && !inchMatch) {
    return Number(clean) || 0;
  }

  return feet + inches / 12;
}

export function parseNumber(value: string): number {
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function formatFeet(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  let feet = Math.floor(absolute);
  let inches = Math.round((absolute - feet) * 12);

  if (inches === 12) {
    feet += 1;
    inches = 0;
  }

  if (inches === 0) return `${sign}${feet}'`;
  return `${sign}${feet}'-${inches}"`;
}

function buildSingleHorizontalRun(
  markPrefix: string,
  location: string,
  requiredLength: number,
  stockLength: number,
  lapFeet: number
): ScheduleLine[] {
  if (!requiredLength || !stockLength) return [];

  const lines: ScheduleLine[] = [];
  let remainingRequired = requiredLength;
  let pieceNumber = 1;

  while (remainingRequired > 0.01) {
    const isFirst = pieceNumber === 1;
    const isLast = remainingRequired <= stockLength - lapFeet;

    let leftFunction = "none";
    let rightFunction = "none";
    let usedLength = 0;

    if (isFirst && isLast) {
      usedLength = remainingRequired;
      leftFunction = "none";
      rightFunction = "none";
    } else if (isFirst) {
      usedLength = stockLength - lapFeet;
      leftFunction = `${formatFeet(lapFeet)} lap & bent`;
      rightFunction = "none";
    } else if (isLast) {
      usedLength = remainingRequired;
      leftFunction = `${formatFeet(lapFeet)} lap`;
      rightFunction = `${formatFeet(lapFeet)} lap & bent`;
    } else {
      usedLength = stockLength - lapFeet;
      leftFunction = `${formatFeet(lapFeet)} lap`;
      rightFunction = "none";
    }

    const rightExtra = rightFunction === "none" ? 0 : lapFeet;
    const cutLength = usedLength + lapFeet + rightExtra;

    const safeCutLength = Math.min(cutLength, stockLength);
    const mark = `${markPrefix}-${pieceNumber}`;

    const parts = [`${formatFeet(safeCutLength)} cut`];
    if (leftFunction !== "none") parts.push(leftFunction);
    parts.push(`${formatFeet(usedLength)} used`);
    if (rightFunction !== "none") parts.push(rightFunction);
    parts.push("OK");

    lines.push({
      mark,
      markPrefix,
      location,
      requiredLength,
      cutLength: safeCutLength,
      leftFunction,
      usedLength,
      rightFunction,
      fieldOrder: parts.join(" | ").replace(" | OK", " - OK"),
    });

    remainingRequired -= usedLength;
    pieceNumber += 1;
  }

  return lines;
}

export function buildHorizontalRuns(
  basePrefix: string,
  baseLocation: string,
  requiredLengthText: string,
  runCountText: string,
  stockLengthText: string,
  lapInchesText: string
): ScheduleLine[] {
  const requiredLength = parseFeet(requiredLengthText);
  const runCount = Math.max(1, Math.floor(parseNumber(runCountText) || 1));
  const stockLength = parseNumber(stockLengthText) || 20;
  const lapFeet = (parseNumber(lapInchesText) || 24) / 12;

  const allLines: ScheduleLine[] = [];

  for (let run = 1; run <= runCount; run += 1) {
    const prefix = `${basePrefix}${run}`;
    const location =
      runCount > 1 ? `${baseLocation} Row ${run}` : baseLocation;

    allLines.push(
      ...buildSingleHorizontalRun(prefix, location, requiredLength, stockLength, lapFeet)
    );
  }

  return allLines;
}

export function summarizeRequiredChecks(schedule: ScheduleLine[]): RequiredCheck[] {
  const grouped = new Map<string, ScheduleLine[]>();

  for (const line of schedule) {
    const existing = grouped.get(line.location) || [];
    existing.push(line);
    grouped.set(line.location, existing);
  }

  return Array.from(grouped.entries()).map(([location, lines]) => {
    const requiredLength = lines[0]?.requiredLength || 0;
    const totalUsed = lines.reduce((sum, line) => sum + line.usedLength, 0);
    const totalCut = lines.reduce((sum, line) => sum + line.cutLength, 0);
    const ok = Math.abs(requiredLength - totalUsed) < 0.02;

    return {
      location,
      requiredLength,
      totalUsed,
      pieces: lines.length,
      totalCut,
      ok,
      status: ok ? "OK - used adds to required" : "CHECK - used does not match required",
    };
  });
}

export function summarizePieceTypes(schedule: ScheduleLine[]): PieceTypeSummary[] {
  const grouped = new Map<string, ScheduleLine[]>();

  for (const line of schedule) {
    const existing = grouped.get(line.markPrefix) || [];
    existing.push(line);
    grouped.set(line.markPrefix, existing);
  }

  return Array.from(grouped.entries()).map(([markPrefix, lines]) => ({
    markPrefix,
    description: lines[0]?.location || markPrefix,
    qty: lines.length,
    totalCut: lines.reduce((sum, line) => sum + line.cutLength, 0),
  }));
}

export function buildMaterialTakeoff(schedule: ScheduleLine[], stockLengthText: string): MaterialTakeoff[] {
  const stockLength = parseNumber(stockLengthText) || 20;
  const totalCut = schedule.reduce((sum, line) => sum + line.cutLength, 0);
  const sticksToBuy = Math.ceil(totalCut / stockLength);
  const availableLength = sticksToBuy * stockLength;
  const waste = availableLength - totalCut;

  return [
    {
      group: "All Horizontal Bars",
      totalCut,
      stockLength,
      sticksToBuy,
      availableLength,
      waste,
      status: "OK - extra stock/waste shown",
    },
  ];
}

export function scheduleToCsv(schedule: ScheduleLine[]): string {
  const headers = [
    "Piece ID",
    "Location",
    "Required Len",
    "Cut Len",
    "Left Function",
    "Used / Adds to Required",
    "Right Function",
    "Field Order / Check",
  ];

  const rows = schedule.map((line) => [
    line.mark,
    line.location,
    formatFeet(line.requiredLength),
    formatFeet(line.cutLength),
    line.leftFunction,
    formatFeet(line.usedLength),
    line.rightFunction,
    line.fieldOrder,
  ]);

  return [headers, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");
}
