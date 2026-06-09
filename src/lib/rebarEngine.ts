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
  cutCount: number;
  bendCount: number;
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

function functionNeedsOverlap(functionText: string): boolean {
  const clean = functionText.toLowerCase();
  return clean.includes("overlap") || clean.includes("lap");
}

function buildHorizontalRun(params: {
  markBase: string;
  prefix: string;
  location: string;
  requiredFeet: number;
  stockFeet: number;
  overlapFeet: number;
  leftEnd: string;
  rightEnd: string;
}): ScheduleLine[] {
  const { markBase, prefix, location, requiredFeet, stockFeet, overlapFeet, leftEnd, rightEnd } = params;
  if (!requiredFeet || !stockFeet) return [];

  const leftStartExtra = functionNeedsOverlap(leftEnd) ? overlapFeet : 0;
  const spliceExtra = overlapFeet;
  const rightEndExtra = functionNeedsOverlap(rightEnd) ? overlapFeet : 0;

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

    const leftFunction = isFirst ? leftEnd : `${formatFeet(overlapFeet)} overlap`;
    const rightFunction = isLast ? rightEnd : "none";
    const leftExtra = functionNeedsOverlap(leftFunction) ? overlapFeet : 0;
    const rightExtra = functionNeedsOverlap(rightFunction) ? overlapFeet : 0;
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
  const leftFunction = `${formatFeet(bottomBendFeet)} bottom bent overlap`;
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


function buildPierInfoGroup(params: {
  hasPiers: boolean;
  pierCount: number;
  pierDiameter: string;
  pierHeight: string;
}): ScheduleLine[] {
  const { hasPiers, pierCount, pierDiameter, pierHeight } = params;
  if (!hasPiers || !pierCount || pierCount <= 0) return [];

  const required = `${pierDiameter || "PIER_DIA missing"} dia x ${pierHeight || "PIER_HEIGHT missing"} high each`;
  const baseLocation = `PIER cage (${pierDiameter || "PIER_DIA missing"} dia, ${pierHeight || "PIER_HEIGHT missing"} high)`;

  const makeInfo = (mark: string, location: string, qty: number, note: string): ScheduleLine => ({
    mark,
    prefix: mark,
    location,
    requiredLength: required,
    cutLength: "field detail",
    leftFunction: "verify from pier footing detail",
    usedLength: `${qty} pieces`,
    rightFunction: "user confirm",
    fieldOrder: `${mark}: ${note}. Pier count confirmed by user: ${pierCount}. Diameter: ${pierDiameter || "not entered"}. Height: ${pierHeight || "not entered"}.`,
    totalUsedFeet: 0,
    cutFeet: 0,
    qty,
  });

  return [
    makeInfo("PIER_DIA", `${baseLocation} diameter`, pierCount, "Pier diameter value used for cage/sonotube planning"),
    makeInfo("PIER_HEIGHT", `${baseLocation} height`, pierCount, "Pier height/cage height value used for cage planning"),
    makeInfo("PR_HORZ_CIRC_HOOP_1_BOTTOM", `${baseLocation} bottom circular hoop`, pierCount, "Bottom horizontal circular hoop; length to be calculated from diameter/clear cover in pier module"),
    makeInfo("PR_HORZ_CIRC_HOOP_2", `${baseLocation} circular hoop #2`, pierCount, "Intermediate horizontal circular hoop; spacing from #3 @ 8 in OC ties note must be confirmed"),
    makeInfo("PR_HORZ_CIRC_HOOP_3", `${baseLocation} circular hoop #3`, pierCount, "Intermediate horizontal circular hoop; spacing from #3 @ 8 in OC ties note must be confirmed"),
    makeInfo("PR_HORZ_CIRC_HOOP_4_TOP", `${baseLocation} top circular hoop`, pierCount, "Top horizontal circular hoop; length to be calculated from diameter/clear cover in pier module"),
    makeInfo("PR_VERT_L_BARS_1", `${baseLocation} vertical L bars group 1`, pierCount * 2, "First pair of #4 vertical L bars; plan note says 6-#4 VERT REBARS"),
    makeInfo("PR_VERT_L_BARS_2", `${baseLocation} vertical L bars group 2`, pierCount * 2, "Second pair of #4 vertical L bars; plan note says 6-#4 VERT REBARS"),
    makeInfo("PR_VERT_L_BARS_3", `${baseLocation} vertical L bars group 3`, pierCount * 2, "Third pair of #4 vertical L bars; plan note says 6-#4 VERT REBARS"),
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
    if (prefix === "PC" || prefix.startsWith("PIER_") || prefix.startsWith("PR_")) {
      return {
        prefix,
        description,
        qty: totalQty,
        requiredLength,
        totalUsed: `${totalQty} piers`,
        status: "Info only - confirm pier cage steel before fabrication",
      };
    }
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
  const cutLines = schedule.filter((line) => line.cutFeet > 0);
  const totalCutFeet = cutLines.reduce((sum, line) => sum + line.cutFeet * line.qty, 0);
  const cutCount = cutLines.reduce((sum, line) => sum + line.qty, 0);
  const bendCount = cutLines.reduce((sum, line) => {
    const functions = `${line.leftFunction} ${line.rightFunction}`.toLowerCase();
    const bendsPerPiece = functions.includes("bent") ? 1 : 0;
    return sum + bendsPerPiece * line.qty;
  }, 0);
  const sticksToBuy = totalCutFeet > 0 ? Math.ceil(totalCutFeet / stockFeet) : 0;
  const availableFeet = sticksToBuy * stockFeet;
  const wasteFeet = Math.max(availableFeet - totalCutFeet, 0);

  return {
    totalCut: formatFeet(totalCutFeet),
    stockLength: formatFeet(stockFeet),
    sticksToBuy,
    availableLength: formatFeet(availableFeet),
    waste: formatFeet(wasteFeet),
    cutCount,
    bendCount,
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
  endBaseOuterLength?: string;
  endBaseMiddleLength?: string;
  endBaseInnerLength?: string;
  stockLengthFeet: number;
  horizontalOverlapInches: number;
  verticalBentOverlapInches: number;
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
  hasPiers?: boolean;
  pierCount?: string;
  pierDiameter?: string;
  pierHeight?: string;
}): RebarResult {
  const sideFeet = parseFeet(params.sideWallLength);
  const sideBaseOuterFeet = parseFeet(params.sideBaseOuterLength || "") || sideFeet;
  const sideBaseMiddleFeet = parseFeet(params.sideBaseMiddleLength || "") || sideFeet;
  const sideBaseInnerFeet = parseFeet(params.sideBaseInnerLength || "") || sideFeet;
  const endFeet = parseFeet(params.endWallLength);
  const endBaseOuterFeet = parseFeet(params.endBaseOuterLength || "") || endFeet;
  const endBaseMiddleFeet = parseFeet(params.endBaseMiddleLength || "") || endFeet;
  const endBaseInnerFeet = parseFeet(params.endBaseInnerLength || "") || endFeet;
  const stockFeet = params.stockLengthFeet || 20;
  const overlapFeet = (params.horizontalOverlapInches || 24) / 12;
  const verticalBentOverlapFeet = (params.verticalBentOverlapInches || 6) / 12;
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
  const pierCount = Number(params.pierCount || 0);
  const pierDiameter = params.pierDiameter || "";
  const pierHeight = params.pierHeight || "";
  const hasPiers = Boolean(
    params.hasPiers &&
      pierCount > 0 &&
      pierDiameter.trim() &&
      pierHeight.trim()
  );

  const schedule: ScheduleLine[] = [];

  const sideBasePositions = [
    { mark: "SW_HORZ_CONT-BAR_Base-OUTER", label: "Base Outer", requiredFeet: sideBaseOuterFeet },
    { mark: "SW_HORZ_CONT-BAR_Base-MIDDLE", label: "Base Middle", requiredFeet: sideBaseMiddleFeet },
    { mark: "SW_HORZ_CONT-BAR_Base-INNER", label: "Base Inner", requiredFeet: sideBaseInnerFeet },
  ];

  for (const position of sideBasePositions) {
    schedule.push(
      ...buildHorizontalRun({
        markBase: position.mark,
        prefix: position.mark,
        location: `SIDE-WALL ${position.label} horizontal continuous bar`,
        requiredFeet: position.requiredFeet,
        stockFeet,
        overlapFeet,
        leftEnd: `${formatFeet(overlapFeet)} overlap & bent`,
        rightEnd: `${formatFeet(overlapFeet)} overlap & bent`,
      })
    );
  }

  const sideWallPositions = [
    { mark: "SW_HORZ_CONT_BAR-BOTTOM_1", label: "Bottom #1" },
    { mark: "SW_HORZ_CONT_BAR-2", label: "Middle #2" },
    { mark: "SW_HORZ_CONT_BAR-TOP_3", label: "Top #3" },
    { mark: "SW_HORZ_L_BAR", label: "L bar / corner return" },
  ];

  for (const position of sideWallPositions) {
    schedule.push(
      ...buildHorizontalRun({
        markBase: position.mark,
        prefix: position.mark,
        location: `SIDE-WALL ${position.label} horizontal bar`,
        requiredFeet: sideFeet,
        stockFeet,
        overlapFeet,
        leftEnd: `${formatFeet(overlapFeet)} overlap & bent`,
        rightEnd: `${formatFeet(overlapFeet)} overlap & bent`,
      })
    );
  }

  const endBasePositions = [
    { mark: "EW_HORZ_CONT-BAR_Base-OUTER", label: "Base Outer", requiredFeet: endBaseOuterFeet },
    { mark: "EW_HORZ_CONT-BAR_Base-MIDDLE", label: "Base Middle", requiredFeet: endBaseMiddleFeet },
    { mark: "EW_HORZ_CONT-BAR_Base-INNER", label: "Base Inner", requiredFeet: endBaseInnerFeet },
  ];

  for (const position of endBasePositions) {
    schedule.push(
      ...buildHorizontalRun({
        markBase: position.mark,
        prefix: position.mark,
        location: `END-WALL ${position.label} horizontal continuous bar`,
        requiredFeet: position.requiredFeet,
        stockFeet,
        overlapFeet,
        leftEnd: `${formatFeet(overlapFeet)} overlap & bent`,
        rightEnd: `${formatFeet(overlapFeet)} overlap & bent`,
      })
    );
  }

  const endWallPositions = [
    { mark: "EW_HORZ_CONT_BAR-BOTTOM_1", label: "Bottom #1" },
    { mark: "EW_HORZ_CONT_BAR-2", label: "Middle #2" },
    { mark: "EW_HORZ_CONT_BAR-TOP_3", label: "Top #3" },
    { mark: "EW_HORZ_L_BAR", label: "L bar / corner return" },
  ];

  for (const position of endWallPositions) {
    schedule.push(
      ...buildHorizontalRun({
        markBase: position.mark,
        prefix: position.mark,
        location: `END-WALL ${position.label} horizontal bar`,
        requiredFeet: endFeet,
        stockFeet,
        overlapFeet,
        leftEnd: `${formatFeet(overlapFeet)} overlap & bent`,
        rightEnd: `${formatFeet(overlapFeet)} overlap & bent`,
      })
    );
  }

  schedule.push(
    ...buildVerticalGroup({
      mark: "SW_VERT_L_BAR",
      prefix: "SW_VERT_L_BAR",
      location: "SIDE-WALL vertical L bars",
      qty: sideVerticalQty,
      usedFeet: sideVerticalUsedFeet,
      bottomBendFeet: verticalBentOverlapFeet,
      totalConcreteFeet: sideTotalConcreteFeet,
      bottomClearanceFeet: sideVerticalBottomClearanceFeet,
      topClearanceFeet: sideVerticalTopClearanceFeet,
    })
  );

  schedule.push(
    ...buildVerticalGroup({
      mark: "EW_VERT_L_BAR",
      prefix: "EW_VERT_L_BAR",
      location: "END-WALL vertical L bars",
      qty: endVerticalQty,
      usedFeet: endVerticalUsedFeet,
      bottomBendFeet: verticalBentOverlapFeet,
      totalConcreteFeet: endTotalConcreteFeet,
      bottomClearanceFeet: endVerticalBottomClearanceFeet,
      topClearanceFeet: endVerticalTopClearanceFeet,
    })
  );

  schedule.push(
    ...buildSmallBaseVerticalGroup({
      mark: "FOOTING_TIE_BAR",
      prefix: "FOOTING_TIE_BAR",
      location: "FOOTING_TIE_BAR connectors between footing steel and stem wall steel",
      qty: baseShortVerticalQty,
      cutFeet: baseShortVerticalCutFeet,
    })
  );

  schedule.push(
    ...buildPierInfoGroup({
      hasPiers,
      pierCount,
      pierDiameter,
      pierHeight,
    })
  );

  return {
    schedule,
    summary: summarize(schedule),
    materialTakeoff: getMaterialTakeoff(schedule, stockFeet),
  };
}
