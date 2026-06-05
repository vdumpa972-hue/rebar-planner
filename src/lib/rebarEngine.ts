export type ScheduleLine = {
  mark: string;
  prefix: string;
  location: string;
  requiredLength: string;
  cutLength: string;
  leftFunction: string;
  usedLength: string;
  rightFunction: string;
  fieldOrder: string;
  totalUsedFeet: number;
  cutFeet: number;
  qty: number;
};

export type SummaryLine = {
  prefix: string;
  description: string;
  qty: number;
  requiredLength: string;
  totalUsed: string;
  status: string;
};

export type MaterialTakeoff = {
  totalCut: string;
  stockLength: string;
  sticksToBuy: number;
  availableLength: string;
  waste: string;
};

export type RebarResult = {
  schedule: ScheduleLine[];
  summary: SummaryLine[];
  materialTakeoff: MaterialTakeoff;
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

export function formatFeet(value: number): string {
  const rounded = Math.round(value * 12) / 12;
  const feet = Math.floor(rounded);
  const inches = Math.round((rounded - feet) * 12);

  if (feet === 0 && inches > 0) return `${inches}"`;
  if (inches === 0) return `${feet}'`;
  return `${feet}'-${inches}"`;
}

function functionNeedsLap(functionText: string): boolean {
  return functionText.toLowerCase().includes("lap");
}

function buildHorizontalRun(params: {
  markBase: string;
  prefix: string;
  location: string;
  requiredFeet: number;
  stockFeet: number;
  lapFeet: number;
  leftEnd: string;
  rightEnd: string;
}): ScheduleLine[] {
  const { markBase, prefix, location, requiredFeet, stockFeet, lapFeet, leftEnd, rightEnd } = params;
  if (!requiredFeet || !stockFeet) return [];

  const leftStartExtra = functionNeedsLap(leftEnd) ? lapFeet : 0;
  const spliceExtra = lapFeet;
  const rightEndExtra = functionNeedsLap(rightEnd) ? lapFeet : 0;

  const firstMaxUsed = stockFeet - leftStartExtra;
  const middleMaxUsed = stockFeet - spliceExtra;
  const lastMaxUsed = stockFeet - spliceExtra - rightEndExtra;

  // Minimum pieces needed so the required length is satisfied without any piece
  // having a cut length longer than the stock length.
  let pieceCount = 1;
  if (requiredFeet > stockFeet - leftStartExtra - rightEndExtra + 0.01) {
    pieceCount = 2;
    while (
      firstMaxUsed + Math.max(pieceCount - 2, 0) * middleMaxUsed + lastMaxUsed <
      requiredFeet - 0.01
    ) {
      pieceCount += 1;
    }
  }

  const usedValues: number[] = [];

  if (pieceCount === 1) {
    usedValues.push(requiredFeet);
  } else {
    // Keep the first and last pieces readable and practical, then distribute
    // the remaining required length across middle pieces. This avoids the bad
    // 2'-3" connector / 3" used case.
    usedValues.push(Math.min(firstMaxUsed, requiredFeet));

    const middleCount = pieceCount - 2;
    const lastUsed = Math.min(lastMaxUsed, requiredFeet - usedValues[0]);
    const middleTotal = requiredFeet - usedValues[0] - lastUsed;

    if (middleCount > 0) {
      const middleTotalInches = Math.round(middleTotal * 12);
      const baseInches = Math.floor(middleTotalInches / middleCount);
      const remainderInches = middleTotalInches - baseInches * middleCount;

      for (let i = 0; i < middleCount; i += 1) {
        const inches = baseInches + (i < remainderInches ? 1 : 0);
        usedValues.push(inches / 12);
      }
    }

    usedValues.push(lastUsed);
  }

  return usedValues.map((usedFeet, index) => {
    const pieceNumber = index + 1;
    const isFirst = index === 0;
    const isLast = index === usedValues.length - 1;

    const leftFunction = isFirst ? leftEnd : `${formatFeet(lapFeet)} lap`;
    const rightFunction = isLast ? rightEnd : "none";
    const leftExtra = functionNeedsLap(leftFunction) ? lapFeet : 0;
    const rightExtra = functionNeedsLap(rightFunction) ? lapFeet : 0;
    const cutFeet = leftExtra + usedFeet + rightExtra;
    const overStock = cutFeet > stockFeet + 0.01;

    return {
      mark: `${markBase}-${pieceNumber}`,
      prefix,
      location,
      requiredLength: formatFeet(requiredFeet),
      cutLength: formatFeet(cutFeet),
      leftFunction,
      usedLength: formatFeet(usedFeet),
      rightFunction,
      fieldOrder:
        rightFunction === "none"
          ? `${formatFeet(cutFeet)} cut = ${leftFunction} | ${formatFeet(usedFeet)} used${overStock ? " - CHECK: over stock length" : " - OK"}`
          : `${formatFeet(cutFeet)} cut = ${leftFunction} | ${formatFeet(usedFeet)} used | ${rightFunction}${overStock ? " - CHECK: over stock length" : " - OK"}`,
      totalUsedFeet: usedFeet,
      cutFeet,
      qty: 1,
    };
  });
}

function buildVerticalGroup(params: {
  mark: string;
  prefix: string;
  location: string;
  qty: number;
  usedFeet: number;
  bottomBendFeet: number;
  totalConcreteFeet?: number;
  bottomClearanceFeet?: number;
  topClearanceFeet?: number;
}): ScheduleLine[] {
  const {
    mark,
    prefix,
    location,
    qty,
    usedFeet,
    bottomBendFeet,
    totalConcreteFeet = 0,
    bottomClearanceFeet = 0,
    topClearanceFeet = 0,
  } = params;

  if (!qty || qty <= 0 || !usedFeet) return [];

  const cutFeet = usedFeet + bottomBendFeet;
  const leftFunction = `${formatFeet(bottomBendFeet)} bottom bent lap`;
  const rightFunction = topClearanceFeet > 0 ? `${formatFeet(topClearanceFeet)} top clear` : "top";
  const clearanceNote =
    totalConcreteFeet > 0
      ? ` (${formatFeet(totalConcreteFeet)} concrete height - ${formatFeet(bottomClearanceFeet)} bottom clear - ${formatFeet(topClearanceFeet)} top clear)`
      : "";

  return [
    {
      mark,
      prefix,
      location,
      requiredLength: `${formatFeet(usedFeet)} each`,
      cutLength: formatFeet(cutFeet),
      leftFunction,
      usedLength: formatFeet(usedFeet),
      rightFunction,
      fieldOrder: `${formatFeet(cutFeet)} cut each = ${leftFunction} | ${formatFeet(usedFeet)} vertical used${clearanceNote} | ${rightFunction} - OK`,
      totalUsedFeet: usedFeet,
      cutFeet,
      qty,
    },
  ];
}

function buildSmallBaseVerticalGroup(params: {
  mark: string;
  prefix: string;
  location: string;
  qty: number;
  cutFeet: number;
}): ScheduleLine[] {
  const { mark, prefix, location, qty, cutFeet } = params;
  if (!qty || qty <= 0 || !cutFeet) return [];

  return [
    {
      mark,
      prefix,
      location,
      requiredLength: `${formatFeet(cutFeet)} each`,
      cutLength: formatFeet(cutFeet),
      leftFunction: "base vertical",
      usedLength: formatFeet(cutFeet),
      rightFunction: "end",
      fieldOrder: `${formatFeet(cutFeet)} cut each = ${formatFeet(cutFeet)} base vertical used - OK`,
      totalUsedFeet: cutFeet,
      cutFeet,
      qty,
    },
  ];
}

function summarize(schedule: ScheduleLine[]): SummaryLine[] {
  const groups = new Map<string, ScheduleLine[]>();

  for (const line of schedule) {
    const key = `${line.prefix}__${line.location}__${line.requiredLength}`;
    const current = groups.get(key) || [];
    current.push(line);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([key, lines]) => {
    const [prefix, description, requiredLength] = key.split("__");
    const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
    const totalUsedFeet = lines.reduce((sum, line) => sum + line.totalUsedFeet * line.qty, 0);
    const requiredPerUnitFeet = parseFeet(requiredLength);
    const requiredCompareFeet = requiredLength.includes("each")
      ? requiredPerUnitFeet * totalQty
      : requiredPerUnitFeet;
    const ok = Math.abs(totalUsedFeet - requiredCompareFeet) < 0.05;

    return {
      prefix,
      description,
      qty: totalQty,
      requiredLength,
      totalUsed: formatFeet(totalUsedFeet),
      status: ok ? "OK" : "Check",
    };
  });
}

function getMaterialTakeoff(schedule: ScheduleLine[], stockFeet: number): MaterialTakeoff {
  const totalCutFeet = schedule.reduce((sum, line) => sum + line.cutFeet * line.qty, 0);
  const sticksToBuy = totalCutFeet > 0 ? Math.ceil(totalCutFeet / stockFeet) : 0;
  const availableFeet = sticksToBuy * stockFeet;
  const wasteFeet = Math.max(availableFeet - totalCutFeet, 0);

  return {
    totalCut: formatFeet(totalCutFeet),
    stockLength: formatFeet(stockFeet),
    sticksToBuy,
    availableLength: formatFeet(availableFeet),
    waste: formatFeet(wasteFeet),
  };
}

function calcVerticalUsedFeet(params: {
  overrideUsedHeight?: string;
  stemTotalHeight?: string;
  footingDepth?: string;
  bottomClearance?: string;
  topClearance?: string;
  fallback: string;
}): number {
  const override = parseFeet(params.overrideUsedHeight || "");
  if (override > 0) return override;

  const stem = parseFeet(params.stemTotalHeight || "");
  const footing = parseFeet(params.footingDepth || "");
  const bottom = parseFeet(params.bottomClearance || "");
  const top = parseFeet(params.topClearance || "");

  const calculated = stem + footing - bottom - top;
  if (calculated > 0) return calculated;

  return parseFeet(params.fallback);
}

export function generateRebarSchedule(params: {
  sideWallLength: string;
  sideBaseOuterLength?: string;
  sideBaseMiddleLength?: string;
  sideBaseInnerLength?: string;
  endWallLength: string;
  stockLengthFeet: number;
  horizontalLapInches: number;
  verticalBentLapInches: number;
  sideVerticalQty?: string;
  endVerticalQty?: string;
  sideVerticalUsedHeight?: string;
  endVerticalUsedHeight?: string;
  sideTotalHeight?: string;
  endTotalHeight?: string;
  footingDepth?: string;
  sideVerticalBottomClearance?: string;
  sideVerticalTopClearance?: string;
  endVerticalBottomClearance?: string;
  endVerticalTopClearance?: string;
  baseShortVerticalQty?: string;
  baseShortVerticalCutLength?: string;
}): RebarResult {
  const sideFeet = parseFeet(params.sideWallLength);
  const sideBaseOuterFeet = parseFeet(params.sideBaseOuterLength || "") || sideFeet;
  const sideBaseMiddleFeet = parseFeet(params.sideBaseMiddleLength || "") || sideFeet;
  const sideBaseInnerFeet = parseFeet(params.sideBaseInnerLength || "") || sideFeet;
  const endFeet = parseFeet(params.endWallLength);
  const stockFeet = params.stockLengthFeet || 20;
  const lapFeet = (params.horizontalLapInches || 24) / 12;
  const verticalBentLapFeet = (params.verticalBentLapInches || 6) / 12;
  const sideVerticalQty = Number(params.sideVerticalQty || 0);
  const endVerticalQty = Number(params.endVerticalQty || 0);
  const footingDepthFeet = parseFeet(params.footingDepth || "18\"");
  const sideVerticalBottomClearanceFeet = parseFeet(params.sideVerticalBottomClearance || "3\"");
  const sideVerticalTopClearanceFeet = parseFeet(params.sideVerticalTopClearance || "8\"");
  const endVerticalBottomClearanceFeet = parseFeet(params.endVerticalBottomClearance || "3\"");
  const endVerticalTopClearanceFeet = parseFeet(params.endVerticalTopClearance || "3\"");
  const sideTotalConcreteFeet = parseFeet(params.sideTotalHeight || "") + footingDepthFeet;
  const endTotalConcreteFeet = parseFeet(params.endTotalHeight || "") + footingDepthFeet;
  const sideVerticalUsedFeet = calcVerticalUsedFeet({
    overrideUsedHeight: params.sideVerticalUsedHeight,
    stemTotalHeight: params.sideTotalHeight,
    footingDepth: params.footingDepth || "18\"",
    bottomClearance: params.sideVerticalBottomClearance || "3\"",
    topClearance: params.sideVerticalTopClearance || "8\"",
    fallback: "32\"",
  });
  const endVerticalUsedFeet = calcVerticalUsedFeet({
    overrideUsedHeight: params.endVerticalUsedHeight,
    stemTotalHeight: params.endTotalHeight,
    footingDepth: params.footingDepth || "18\"",
    bottomClearance: params.endVerticalBottomClearance || "3\"",
    topClearance: params.endVerticalTopClearance || "3\"",
    fallback: "30.5\"",
  });
  const baseShortVerticalQty = Number(params.baseShortVerticalQty || 0);
  const baseShortVerticalCutFeet = parseFeet(params.baseShortVerticalCutLength || "") || parseFeet("12\"");

  const schedule: ScheduleLine[] = [];

  const sideBasePositions = [
    { code: "O", label: "Outer", requiredFeet: sideBaseOuterFeet },
    { code: "M", label: "Middle", requiredFeet: sideBaseMiddleFeet },
    { code: "I", label: "Inner", requiredFeet: sideBaseInnerFeet },
  ];

  for (const position of sideBasePositions) {
    schedule.push(
      ...buildHorizontalRun({
        markBase: `SW-H-BASE-${position.code}`,
        prefix: `SW-H-BASE-${position.code}`,
        location: `Side Wall Horizontal Base ${position.label}`,
        requiredFeet: position.requiredFeet,
        stockFeet,
        lapFeet,
        leftEnd: `${formatFeet(lapFeet)} lap & bent`,
        rightEnd: `${formatFeet(lapFeet)} lap & bent`,
      })
    );
  }

  const sideWallPositions = [
    { code: "B", label: "Bottom" },
    { code: "M", label: "Middle" },
    { code: "T", label: "Top" },
  ];

  for (const position of sideWallPositions) {
    schedule.push(
      ...buildHorizontalRun({
        markBase: `SW-H-WALL-${position.code}`,
        prefix: `SW-H-WALL-${position.code}`,
        location: `Side Wall Horizontal Stem ${position.label}`,
        requiredFeet: sideFeet,
        stockFeet,
        lapFeet,
        leftEnd: `${formatFeet(lapFeet)} lap & bent`,
        rightEnd: `${formatFeet(lapFeet)} lap & bent`,
      })
    );
  }

  const endWallPositions = [
    { code: "B", label: "Bottom" },
    { code: "T", label: "Top" },
  ];

  for (const position of endWallPositions) {
    schedule.push(
      ...buildHorizontalRun({
        markBase: `EW-H-WALL-${position.code}`,
        prefix: `EW-H-WALL-${position.code}`,
        location: `End Wall Horizontal Stem ${position.label}`,
        requiredFeet: endFeet,
        stockFeet,
        lapFeet,
        leftEnd: `${formatFeet(lapFeet)} lap & bent`,
        rightEnd: `${formatFeet(lapFeet)} lap & bent`,
      })
    );
  }

  schedule.push(
    ...buildVerticalGroup({
      mark: "V-S",
      prefix: "V-S",
      location: "Side Wall Vertical Bars",
      qty: sideVerticalQty,
      usedFeet: sideVerticalUsedFeet,
      bottomBendFeet: verticalBentLapFeet,
      totalConcreteFeet: sideTotalConcreteFeet,
      bottomClearanceFeet: sideVerticalBottomClearanceFeet,
      topClearanceFeet: sideVerticalTopClearanceFeet,
    })
  );

  schedule.push(
    ...buildVerticalGroup({
      mark: "V-E",
      prefix: "V-E",
      location: "End Wall Vertical Bars",
      qty: endVerticalQty,
      usedFeet: endVerticalUsedFeet,
      bottomBendFeet: verticalBentLapFeet,
      totalConcreteFeet: endTotalConcreteFeet,
      bottomClearanceFeet: endVerticalBottomClearanceFeet,
      topClearanceFeet: endVerticalTopClearanceFeet,
    })
  );

  schedule.push(
    ...buildSmallBaseVerticalGroup({
      mark: "BV-12",
      prefix: "BV-12",
      location: "Small 12 in Base Verticals",
      qty: baseShortVerticalQty,
      cutFeet: baseShortVerticalCutFeet,
    })
  );

  return {
    schedule,
    summary: summarize(schedule),
    materialTakeoff: getMaterialTakeoff(schedule, stockFeet),
  };
}
