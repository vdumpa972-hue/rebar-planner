export type ScheduleLine = {
  mark: string;
  markPrefix: string;
  location: string;
  requiredLength: string;
  cutLength: string;
  leftFunction: string;
  usedLength: string;
  rightFunction: string;
  fieldOrder: string;
};

export type ScheduleSummaryLine = {
  location: string;
  requiredLength: string;
  totalUsed: string;
  pieces: number;
  totalCut: string;
  status: string;
};

export type PieceTypeSummary = {
  markPrefix: string;
  description: string;
  qty: number;
  totalCut: string;
};

export type MaterialTakeoffLine = {
  group: string;
  totalCut: string;
  stockLength: string;
  sticksToBuy: number;
  availableLength: string;
  waste: string;
  status: string;
};

function roundToNearestSixteenth(value: number) {
  return Math.round(value * 16) / 16;
}

export function parseFeet(value: string) {
  const clean = value.trim();
  if (!clean) return 0;

  const feetMatch = clean.match(/(\d+(?:\.\d+)?)\s*'/);
  const inchesMatch = clean.match(/(\d+(?:\.\d+)?)\s*"/);
  const feet = feetMatch ? Number(feetMatch[1]) : 0;
  const inches = inchesMatch ? Number(inchesMatch[1]) : 0;

  if (!feetMatch && !inchesMatch) {
    return Number(clean) || 0;
  }

  return feet + inches / 12;
}

export function formatFeet(value: number) {
  const rounded = roundToNearestSixteenth(value);
  const feet = Math.floor(rounded);
  const inchesTotal = roundToNearestSixteenth((rounded - feet) * 12);
  const wholeInches = Math.floor(inchesTotal);
  const fraction = roundToNearestSixteenth(inchesTotal - wholeInches);

  const fractionMap: Record<string, string> = {
    "0.0625": "1/16",
    "0.125": "1/8",
    "0.1875": "3/16",
    "0.25": "1/4",
    "0.3125": "5/16",
    "0.375": "3/8",
    "0.4375": "7/16",
    "0.5": "1/2",
    "0.5625": "9/16",
    "0.625": "5/8",
    "0.6875": "11/16",
    "0.75": "3/4",
    "0.8125": "13/16",
    "0.875": "7/8",
    "0.9375": "15/16",
  };

  if (wholeInches === 0 && fraction === 0) return `${feet}'`;

  const fractionText = fractionMap[String(fraction)] || "";
  const inchText = fractionText
    ? `${wholeInches ? `${wholeInches} ` : ""}${fractionText}`
    : `${wholeInches}`;

  return `${feet}'-${inchText}"`;
}

function sumFeet(values: string[]) {
  return values.reduce((total, value) => total + parseFeet(value), 0);
}

function makeLine(args: {
  mark: string;
  markPrefix: string;
  location: string;
  requiredLengthFeet: number;
  cutFeet: number;
  leftFunction: string;
  usedFeet: number;
  rightFunction: string;
}) {
  const requiredLength = formatFeet(args.requiredLengthFeet);
  const cutLength = formatFeet(args.cutFeet);
  const usedLength = formatFeet(args.usedFeet);

  const functions = [
    `${cutLength} cut`,
    args.leftFunction !== "none" ? args.leftFunction : "",
    `${usedLength} used`,
    args.rightFunction !== "none" ? args.rightFunction : "",
  ].filter(Boolean);

  return {
    mark: args.mark,
    markPrefix: args.markPrefix,
    location: args.location,
    requiredLength,
    cutLength,
    leftFunction: args.leftFunction,
    usedLength,
    rightFunction: args.rightFunction,
    fieldOrder: `${functions.join(" | ")} - OK`,
  };
}

export function buildWallLines(args: {
  markPrefix: string;
  location: string;
  wallLengthText: string;
  stockLengthFeet: number;
  lapFeet: number;
  lapAndBentOnFirstLeft?: boolean;
  lapAndBentOnLastRight?: boolean;
}) {
  const wallLength = parseFeet(args.wallLengthText);
  const stockLength = args.stockLengthFeet || 20;
  const lapFeet = args.lapFeet;

  if (!wallLength || !stockLength) return [];

  const lines: ScheduleLine[] = [];
  let remainingUsed = wallLength;
  let pieceNumber = 1;

  while (remainingUsed > 0.01) {
    const isFirst = pieceNumber === 1;
    const usedThisPiece = Math.min(remainingUsed, stockLength - lapFeet);
    const isLast = remainingUsed - usedThisPiece <= 0.01;

    const leftFunction = isFirst && args.lapAndBentOnFirstLeft
      ? `${formatFeet(lapFeet)} lap & bent`
      : isFirst
        ? "none"
        : `${formatFeet(lapFeet)} lap`;

    const rightFunction = isLast && args.lapAndBentOnLastRight
      ? `${formatFeet(lapFeet)} lap & bent`
      : "none";

    const extraLeft = leftFunction === "none" ? 0 : lapFeet;
    const extraRight = rightFunction === "none" ? 0 : lapFeet;
    const cutFeet = usedThisPiece + extraLeft + extraRight;

    lines.push(makeLine({
      mark: `${args.markPrefix}-${pieceNumber}`,
      markPrefix: args.markPrefix,
      location: args.location,
      requiredLengthFeet: wallLength,
      cutFeet,
      leftFunction,
      usedFeet: usedThisPiece,
      rightFunction,
    }));

    remainingUsed -= usedThisPiece;
    pieceNumber += 1;
  }

  return lines;
}

export function buildSchedule(args: {
  sideWallLength: string;
  endWallLength: string;
  stockLengthFeet: number;
  horizontalLapInches: number;
}) {
  const lapFeet = args.horizontalLapInches / 12;

  return [
    ...buildWallLines({
      markPrefix: "SW-H",
      location: "Side Wall Horizontal",
      wallLengthText: args.sideWallLength,
      stockLengthFeet: args.stockLengthFeet,
      lapFeet,
      lapAndBentOnFirstLeft: true,
      lapAndBentOnLastRight: true,
    }),
    ...buildWallLines({
      markPrefix: "EW-H",
      location: "End Wall Horizontal",
      wallLengthText: args.endWallLength,
      stockLengthFeet: args.stockLengthFeet,
      lapFeet,
      lapAndBentOnFirstLeft: true,
      lapAndBentOnLastRight: true,
    }),
  ];
}

export function buildScheduleSummary(schedule: ScheduleLine[]) {
  const byLocation = new Map<string, ScheduleLine[]>();

  schedule.forEach((line) => {
    const current = byLocation.get(line.location) || [];
    current.push(line);
    byLocation.set(line.location, current);
  });

  return Array.from(byLocation.entries()).map(([location, lines]) => {
    const requiredLength = lines[0]?.requiredLength || "0'";
    const totalUsedFeet = sumFeet(lines.map((line) => line.usedLength));
    const totalCutFeet = sumFeet(lines.map((line) => line.cutLength));
    const requiredFeet = parseFeet(requiredLength);
    const isOk = Math.abs(totalUsedFeet - requiredFeet) < 0.02;

    return {
      location,
      requiredLength,
      totalUsed: formatFeet(totalUsedFeet),
      pieces: lines.length,
      totalCut: formatFeet(totalCutFeet),
      status: isOk ? "OK - used adds to required" : "CHECK - used does not match required",
    } satisfies ScheduleSummaryLine;
  });
}

export function buildPieceTypeSummary(schedule: ScheduleLine[]) {
  const byPrefix = new Map<string, ScheduleLine[]>();

  schedule.forEach((line) => {
    const current = byPrefix.get(line.markPrefix) || [];
    current.push(line);
    byPrefix.set(line.markPrefix, current);
  });

  return Array.from(byPrefix.entries()).map(([markPrefix, lines]) => {
    const totalCutFeet = sumFeet(lines.map((line) => line.cutLength));

    return {
      markPrefix,
      description: lines[0]?.location || markPrefix,
      qty: lines.length,
      totalCut: formatFeet(totalCutFeet),
    } satisfies PieceTypeSummary;
  });
}


export function buildMaterialTakeoff(schedule: ScheduleLine[], stockLengthFeet: number) {
  if (schedule.length === 0) return [];

  const totalCutFeet = sumFeet(schedule.map((line) => line.cutLength));
  const sticksToBuy = Math.ceil(totalCutFeet / stockLengthFeet);
  const availableFeet = sticksToBuy * stockLengthFeet;
  const wasteFeet = Math.max(availableFeet - totalCutFeet, 0);

  const overall: MaterialTakeoffLine = {
    group: "All Horizontal Bars",
    totalCut: formatFeet(totalCutFeet),
    stockLength: formatFeet(stockLengthFeet),
    sticksToBuy,
    availableLength: formatFeet(availableFeet),
    waste: formatFeet(wasteFeet),
    status: wasteFeet < 0.02 ? "Perfect use" : "OK - extra stock/waste shown",
  };

  return [overall];
}

export function scheduleToCsv(schedule: ScheduleLine[]) {
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
    line.requiredLength,
    line.cutLength,
    line.leftFunction,
    line.usedLength,
    line.rightFunction,
    line.fieldOrder,
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}
