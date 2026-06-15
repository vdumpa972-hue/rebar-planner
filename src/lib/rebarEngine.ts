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
  stockSource?: string;
  wasteFit?: string;
};

export type SummaryLine = {
  prefix: string;
  description: string;
  qty: number;
  requiredLength: string;
  totalUsed: string;
  status: string;
};

export type WasteFit = {
  mark: string;
  location: string;
  cutLength: string;
  cutFeet: number;
  qtyFit: number;
  totalFitLength: string;
};

export type WastePiece = {
  id: string;
  sourceStickId: string;
  size: string;
  length: string;
  lengthFeet: number;
  possibleFits: WasteFit[];
};

export type MaterialTakeoff = {
  totalCut: string;
  stockLength: string;
  sticksToBuy: number;
  availableLength: string;
  waste: string;
  wastePieceCount: number;
  maxWastePiece: string;
  wastePieces: WastePiece[];
  cutCount: number;
  bendCount: number;
  bentPieceCount: number;
  straightPieceCount: number;
  straightStockStickCount: number;
  cutOrBentStockStickCount: number;
};

export type RebarResult = {
  schedule: ScheduleLine[];
  summary: SummaryLine[];
  materialTakeoff: MaterialTakeoff;
  validationWarnings?: string[];
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

function getScheduleRebarSize(line: ScheduleLine): string {
  const text = `${line.mark} ${line.prefix} ${line.location}`;
  const match = text.match(/#\s*(\d{1,2})/);
  return match ? `#${match[1]}` : "UNSPECIFIED";
}

function getMaterialTakeoff(schedule: ScheduleLine[], stockFeet: number): MaterialTakeoff {
  const cutLines = schedule.filter((line) => line.cutFeet > 0);
  const totalCutFeet = cutLines.reduce((sum, line) => sum + line.cutFeet * line.qty, 0);
  const cutCount = cutLines.reduce((sum, line) => sum + line.qty, 0);

  const bendCount = cutLines.reduce((sum, line) => {
    const functions = `${line.leftFunction} ${line.rightFunction}`.toLowerCase();
    const bendMatches = functions.match(/bent|bend/g) || [];
    return sum + bendMatches.length * line.qty;
  }, 0);

  const bentPieceCount = cutLines.reduce((sum, line) => {
    const functions = `${line.leftFunction} ${line.rightFunction}`.toLowerCase();
    return sum + (functions.includes("bent") || functions.includes("bend") ? line.qty : 0);
  }, 0);
  const straightPieceCount = Math.max(cutCount - bentPieceCount, 0);

  type StockPiece = {
    cutFeet: number;
    bent: boolean;
    size: string;
    line: ScheduleLine;
    pieceIndex: number;
  };

  type StockStick = {
    id: string;
    usedFeet: number;
    pieces: StockPiece[];
  };

  const pieces: StockPiece[] = [];
  cutLines.forEach((line) => {
    const functions = `${line.leftFunction} ${line.rightFunction}`.toLowerCase();
    const bent = functions.includes("bent") || functions.includes("bend");
    const qty = Math.max(Number(line.qty) || 1, 1);
    const size = getScheduleRebarSize(line);
    for (let index = 0; index < qty; index += 1) {
      pieces.push({ cutFeet: line.cutFeet, bent, size, line, pieceIndex: index + 1 });
    }
    line.stockSource = "";
    line.wasteFit = "";
  });

  // ORIGINAL STOCK PASS: one single first-fit-decreasing pass.
  // This does NOT run a second optimization pass and does NOT consume waste pieces.
  const stockSticks: StockStick[] = [];
  pieces
    .filter((piece) => piece.cutFeet > 0)
    .sort((a, b) => b.cutFeet - a.cutFeet)
    .forEach((piece) => {
      const fit = piece.cutFeet <= stockFeet + 0.0001
        ? stockSticks.find((stick) => stockFeet - stick.usedFeet + 0.0001 >= piece.cutFeet)
        : undefined;
      if (fit) {
        fit.pieces.push(piece);
        fit.usedFeet += piece.cutFeet;
      } else {
        const nextId = `STK-${String(stockSticks.length + 1).padStart(3, "0")}`;
        stockSticks.push({ id: nextId, usedFeet: piece.cutFeet, pieces: [piece] });
      }
    });

  const lineSources = new Map<string, Set<string>>();
  stockSticks.forEach((stick) => {
    stick.pieces.forEach((piece) => {
      const key = piece.line.mark;
      if (!lineSources.has(key)) lineSources.set(key, new Set<string>());
      lineSources.get(key)?.add(stick.id);
    });
  });
  cutLines.forEach((line) => {
    const sources = Array.from(lineSources.get(line.mark) || []);
    line.stockSource = sources.length ? sources.join(", ") : "New stock";
  });

  const sticksToBuy = stockSticks.length;
  const straightStockStickCount = stockSticks.reduce((sum, stick) => {
    const isOneFullStraightPiece =
      stick.pieces.length === 1 &&
      !stick.pieces[0].bent &&
      Math.abs(stick.pieces[0].cutFeet - stockFeet) < 0.01;

    return sum + (isOneFullStraightPiece ? 1 : 0);
  }, 0);
  const cutOrBentStockStickCount = Math.max(sticksToBuy - straightStockStickCount, 0);

  const candidatePieces = cutLines
    .filter((line) => line.cutFeet > 0)
    .map((line) => ({
      mark: line.mark,
      location: line.location,
      cutLength: line.cutLength,
      cutFeet: line.cutFeet,
      qty: Math.max(Number(line.qty) || 1, 1),
      size: getScheduleRebarSize(line),
    }));

  const candidateQtyRemaining = new Map<string, number>();
  candidatePieces.forEach((piece) => {
    candidateQtyRemaining.set(piece.mark, piece.qty);
  });

  const wastePieces: WastePiece[] = stockSticks
    .flatMap((stick, index): WastePiece[] => {
      const leftoverFeet = Math.max(stockFeet - stick.usedFeet, 0);
      if (leftoverFeet <= 0.0001) return [];
      const sizes = Array.from(new Set(stick.pieces.map((piece) => piece.size))).sort().join("/") || "MIXED";
      return [{
        id: `WASTE-${String(index + 1).padStart(3, "0")}`,
        sourceStickId: stick.id,
        size: sizes,
        length: formatFeet(leftoverFeet),
        lengthFeet: leftoverFeet,
        possibleFits: [],
      }];
    })
    .sort((a, b) => b.lengthFeet - a.lengthFeet);

  // PHASE 2 ANALYSIS ONLY:
  // Build a suggested reuse plan from waste pieces without changing the original stock pass.
  // Qty rows are expanded logically by keeping remaining quantity per schedule mark.
  // Example: a 14' leftover can suggest 14 x 1' traverse pieces instead of just saying it can fit one row.
  wastePieces.forEach((waste) => {
    let remainingWasteFeet = waste.lengthFeet;
    const wasteSizes = waste.size.split("/");
    const fits: WasteFit[] = [];

    candidatePieces
      .filter((piece) => {
        const sameSize = waste.size === "MIXED" || piece.size === waste.size || wasteSizes.includes(piece.size);
        return sameSize && piece.cutFeet > 0 && piece.cutFeet <= remainingWasteFeet + 0.0001;
      })
      .sort((a, b) => a.cutFeet - b.cutFeet || a.mark.localeCompare(b.mark))
      .forEach((piece) => {
        const remainingQty = candidateQtyRemaining.get(piece.mark) || 0;
        if (remainingQty <= 0 || piece.cutFeet <= 0 || piece.cutFeet > remainingWasteFeet + 0.0001) return;

        const qtyFit = Math.min(remainingQty, Math.floor((remainingWasteFeet + 0.0001) / piece.cutFeet));
        if (qtyFit <= 0) return;

        fits.push({
          mark: piece.mark,
          location: piece.location,
          cutLength: piece.cutLength,
          cutFeet: piece.cutFeet,
          qtyFit,
          totalFitLength: formatFeet(qtyFit * piece.cutFeet),
        });

        candidateQtyRemaining.set(piece.mark, remainingQty - qtyFit);
        remainingWasteFeet = Math.max(remainingWasteFeet - qtyFit * piece.cutFeet, 0);
      });

    waste.possibleFits = fits.slice(0, 12);
  });

  const lineWastePlans = new Map<string, string[]>();
  wastePieces.forEach((waste) => {
    waste.possibleFits.forEach((fit) => {
      if (!lineWastePlans.has(fit.mark)) lineWastePlans.set(fit.mark, []);
      lineWastePlans.get(fit.mark)?.push(`${fit.qtyFit}x from ${waste.id}/${waste.sourceStickId} (${waste.length} waste)`);
    });
  });
  cutLines.forEach((line) => {
    const plans = lineWastePlans.get(line.mark) || [];
    line.wasteFit = plans.length ? plans.join("; ") : "";
  });

  const wasteFeet = wastePieces.reduce((sum, piece) => sum + piece.lengthFeet, 0);
  const maxWastePieceFeet = wastePieces.reduce((max, piece) => Math.max(max, piece.lengthFeet), 0);
  const availableFeet = sticksToBuy * stockFeet;

  return {
    totalCut: formatFeet(totalCutFeet),
    stockLength: formatFeet(stockFeet),
    sticksToBuy,
    availableLength: formatFeet(availableFeet),
    waste: formatFeet(wasteFeet),
    wastePieceCount: wastePieces.length,
    maxWastePiece: formatFeet(maxWastePieceFeet),
    wastePieces,
    cutCount,
    bendCount,
    bentPieceCount,
    straightPieceCount,
    straightStockStickCount,
    cutOrBentStockStickCount,
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
    validationWarnings: collectScheduleValidationWarnings(schedule, stockFeet),
  };
}


type ManualRebarRowInput = {
  itemType?: string;
  segment?: string;
  length?: string;
  count?: string;
  number?: string;
  spacingBetween?: string;
  rebarSize?: string;
  duplicateTimes?: string;
  calcLength?: string;
  side1Bent?: string;
  side1BentLength?: string;
  side2Bent?: string;
  side2BentLength?: string;
  traverseNumber?: string;
  traverseSpacing?: string;
  traverseLength?: string;
  verticalBent?: string;
  verticalBentLength?: string;
  verticalSpacingAdjacent?: string;
  diameter?: string;
  clearanceTop?: string;
  clearanceBottom?: string;
  clearanceSides?: string;
  horizontalCircleCount?: string;
  numVerticalBars?: string;
  spacing?: string;
  note?: string;
};

function parseCountValue(value?: string, fallback = 0): number {
  const clean = (value || "").trim().toLowerCase();
  if (!clean || clean === "n/a" || clean === "na") return fallback;
  const n = Number(clean.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isNA(value?: string): boolean {
  const clean = (value || "").trim().toLowerCase();
  return clean === "n/a" || clean === "na";
}

function isBlankOrNA(value?: string): boolean {
  const clean = (value || "").trim().toLowerCase();
  return !clean || clean === "n/a" || clean === "na";
}

function isYes(value?: string): boolean {
  return (value || "").trim().toLowerCase() === "yes";
}

function countBySpacing(clearRunFeet: number, spacingFeet: number): number {
  if (!clearRunFeet || clearRunFeet <= 0 || !spacingFeet || spacingFeet <= 0) return 0;
  // Bars/ties at both ends: 0, spacing, 2*spacing... until the run is covered.
  // This intentionally uses floor + 1 so a 52' run at 18" spacing gives 42 pieces, not a doubled value.
  return Math.floor(clearRunFeet / spacingFeet) + 1;
}

function makeSpacingNote(clearRunFeet: number, spacingFeet: number, label: string): string {
  if (!clearRunFeet || !spacingFeet) return "";
  return `${label} calculated from ${formatFeet(clearRunFeet)} clear run / ${formatFeet(spacingFeet)} spacing + 1`;
}

function getClearanceFeet(value?: string): number {
  return isBlankOrNA(value) ? 0 : parseFeet(value || "");
}

function normalizedManualType(row: ManualRebarRowInput): string {
  return (row.itemType || "Misc").trim().toLowerCase();
}

function isPierRow(row: ManualRebarRowInput): boolean {
  return normalizedManualType(row) === "pier";
}

function totalBaseBottomRunFeet(rows: ManualRebarRowInput[]): number {
  return rows
    .filter((row) => (row.itemType || "").trim() === "Base/Bottom rebar")
    .reduce((sum, row) => {
      const lenFeet = parseFeet(row.length || "");
      const dup = parseCountValue(row.duplicateTimes, 2);
      return sum + lenFeet * dup;
    }, 0);
}

function firstPierLikeRow(rows: ManualRebarRowInput[]): ManualRebarRowInput | undefined {
  return rows.find((row) => isPierRow(row));
}

function inferVerticalStraightFeet(row: ManualRebarRowInput, allRows: ManualRebarRowInput[]): { feet: number; note: string } {
  const enteredFeet = parseFeet(row.length || "");
  const pier = firstPierLikeRow(allRows);
  const topClearance = parseFeet(row.clearanceTop || pier?.clearanceTop || "");
  const bottomClearance = parseFeet(row.clearanceBottom || pier?.clearanceBottom || "");
  if (enteredFeet > 0) {
    const clearanced = Math.max(enteredFeet - topClearance - bottomClearance, 0);
    if ((topClearance > 0 || bottomClearance > 0) && clearanced > 0) {
      return { feet: clearanced, note: `, straight len ${formatFeet(enteredFeet)} minus top/bottom clearance ${formatFeet(topClearance + bottomClearance)}` };
    }
    return { feet: enteredFeet, note: "" };
  }
  const pierHeight = parseFeet(pier?.length || "");
  if (pierHeight > 0) {
    const clearanced = Math.max(pierHeight - topClearance - bottomClearance, 0);
    if (clearanced > 0) {
      return { feet: clearanced, note: `, straight len inferred from pier length ${formatFeet(pierHeight)} minus top/bottom clearance ${formatFeet(topClearance + bottomClearance)}` };
    }
  }
  return { feet: 0, note: "" };
}

function manualEndExtra(row: ManualRebarRowInput, side: 1 | 2, fallbackFeet: number): number {
  const bent = side === 1 ? row.side1Bent : row.side2Bent;
  const rawLen = side === 1 ? row.side1BentLength : row.side2BentLength;
  if ((bent || "").toLowerCase() !== "yes") return 0;
  return parseFeet(rawLen || "") || fallbackFeet;
}

function buildManualContinuousRun(params: {
  markBase: string;
  prefix: string;
  location: string;
  straightFeet: number;
  stockFeet: number;
  overlapFeet: number;
  leftBendFeet: number;
  rightBendFeet: number;
}): ScheduleLine[] {
  const { markBase, prefix, location, straightFeet, stockFeet, overlapFeet, leftBendFeet, rightBendFeet } = params;
  if (!straightFeet || straightFeet <= 0 || !stockFeet || stockFeet <= 0) return [];

  const pieces: { used: number; leftExtra: number; rightExtra: number; leftText: string; rightText: string }[] = [];
  let remaining = straightFeet;
  let index = 0;

  while (remaining > 0.01 && index < 100) {
    const isFirst = index === 0;
    const leftExtra = isFirst ? leftBendFeet : overlapFeet;
    const leftText = isFirst
      ? leftBendFeet > 0 ? `${formatFeet(leftBendFeet)} bent return` : "start"
      : `${formatFeet(overlapFeet)} lap splice`;

    const fitsAsLastCapacity = stockFeet - leftExtra - rightBendFeet;
    const canFinish = remaining <= fitsAsLastCapacity + 0.01;
    const rightExtra = canFinish ? rightBendFeet : 0;
    const rightText = canFinish
      ? rightBendFeet > 0 ? `${formatFeet(rightBendFeet)} bent return` : "end"
      : "continue to next stick";
    const capacity = Math.max(stockFeet - leftExtra - rightExtra, 0);
    const used = Math.min(remaining, capacity);

    if (used <= 0.01) {
      pieces.push({ used: 0, leftExtra, rightExtra, leftText, rightText: "CHECK: bend/lap longer than stock" });
      break;
    }

    pieces.push({ used, leftExtra, rightExtra, leftText, rightText });
    remaining -= used;
    index += 1;
  }

  const totalCutFeet = pieces.reduce((sum, piece) => sum + piece.leftExtra + piece.used + piece.rightExtra, 0);
  const totalStraightFeet = pieces.reduce((sum, piece) => sum + piece.used, 0);

  return pieces.map((piece, pieceIndex) => {
    const cutFeet = piece.leftExtra + piece.used + piece.rightExtra;
    const overStock = cutFeet > stockFeet + 0.01;
    return {
      mark: `${markBase}-${pieceIndex + 1}`,
      prefix,
      location: `${location}; adjusted straight run ${formatFeet(straightFeet)}${Math.abs(totalStraightFeet - straightFeet) > 0.05 ? " CHECK straight" : ""}`,
      requiredLength: `${formatFeet(totalCutFeet)} total cut incl. bends/laps`,
      cutLength: formatFeet(cutFeet),
      leftFunction: piece.leftText,
      usedLength: formatFeet(piece.used),
      rightFunction: piece.rightText,
      fieldOrder: `${formatFeet(cutFeet)} cut = ${piece.leftText} | ${formatFeet(piece.used)} straight run | ${piece.rightText}${overStock ? " - CHECK: over stick length" : " - OK"}`,
      totalUsedFeet: cutFeet,
      cutFeet,
      qty: 1,
    };
  });
}

function buildManualSimplePieces(params: {
  mark: string;
  prefix: string;
  location: string;
  qty: number;
  cutFeet: number;
  leftFunction: string;
  rightFunction: string;
}): ScheduleLine[] {
  const { mark, prefix, location, qty, cutFeet, leftFunction, rightFunction } = params;
  if (!qty || qty <= 0 || !cutFeet || cutFeet <= 0) return [];
  return [{
    mark,
    prefix,
    location,
    requiredLength: `${formatFeet(cutFeet)} each`,
    cutLength: formatFeet(cutFeet),
    leftFunction,
    usedLength: formatFeet(cutFeet),
    rightFunction,
    fieldOrder: `${formatFeet(cutFeet)} cut each = ${leftFunction} | ${formatFeet(cutFeet)} used | ${rightFunction} - OK`,
    totalUsedFeet: cutFeet,
    cutFeet,
    qty,
  }];
}

function buildManualCheckLine(params: {
  mark: string;
  prefix: string;
  location: string;
  qty: number;
  message: string;
}): ScheduleLine[] {
  const { mark, prefix, location, qty, message } = params;
  return [{
    mark,
    prefix,
    location,
    requiredLength: "missing / needs input",
    cutLength: "CHECK",
    leftFunction: "missing input",
    usedLength: "0",
    rightFunction: "check row",
    fieldOrder: message,
    totalUsedFeet: 0,
    cutFeet: 0,
    qty: qty > 0 ? qty : 1,
  }];
}


function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings.map((warning) => warning.trim()).filter(Boolean)));
}

function collectManualValidationWarnings(params: {
  rows: ManualRebarRowInput[];
  stockFeet: number;
  defaultOverlapFeet: number;
  defaultBendFeet: number;
}): string[] {
  const warnings: string[] = [];
  if (!params.rows.length) warnings.push("No rebar input rows found.");
  if (!params.stockFeet || params.stockFeet <= 0) warnings.push("Stock stick length is missing or invalid.");
  if (!params.defaultOverlapFeet || params.defaultOverlapFeet <= 0) warnings.push("Default overlap/lap length is missing or invalid.");

  const baseRunFeet = totalBaseBottomRunFeet(params.rows);

  params.rows.forEach((row, index) => {
    const label = row.segment || row.itemType || `Row ${index + 1}`;
    const type = normalizedManualType(row);
    const rebarSize = (row.rebarSize || "").trim();
    if (!rebarSize) warnings.push(`${label}: rebar size is missing.`);

    if (type === "base/bottom rebar") {
      const runFeet = parseFeet(row.length || "");
      const count = parseCountValue(row.number, 0);
      if (!runFeet) warnings.push(`${label}: bottom/base run length is missing.`);
      if (!count) warnings.push(`${label}: longitudinal bar count is missing.`);
      if (isYes(row.side1Bent) && !parseFeet(row.side1BentLength || "")) warnings.push(`${label}: side 1 is bent but bent overlap len is missing; default will be used.`);
      if (isYes(row.side2Bent) && !parseFeet(row.side2BentLength || "")) warnings.push(`${label}: side 2 is bent but bent overlap len is missing; default will be used.`);
      if (isBlankOrNA(row.traverseNumber) && !parseFeet(row.traverseSpacing || "")) warnings.push(`${label}: traverse count is N/A but traverse spacing is missing.`);
      if ((parseCountValue(row.traverseNumber, 0) || parseFeet(row.traverseSpacing || "")) && !parseFeet(row.traverseLength || "")) warnings.push(`${label}: traverse pieces requested but traverse piece len is missing.`);
    }

    if (type === "horiz continues longtidues") {
      if (!parseFeet(row.length || "")) warnings.push(`${label}: horizontal continuous run length is missing.`);
      if (!parseCountValue(row.number, 0)) warnings.push(`${label}: horizontal continuous count is missing.`);
    }

    if (type === "vertical rebar") {
      const enteredQty = parseCountValue(row.count, 0);
      const spacingFeet = parseFeet(row.verticalSpacingAdjacent || "");
      const runFeet = parseFeet(row.calcLength || "") || baseRunFeet;
      const inferred = inferVerticalStraightFeet(row, params.rows);
      if (!enteredQty && (!runFeet || !spacingFeet)) warnings.push(`${label}: vertical count is N/A; enter Calculate len/total run and spacing to calculate quantity.`);
      if (!inferred.feet) warnings.push(`${label}: vertical bar straight len could not be calculated.`);
    }

    if (type === "pier") {
      const pierCount = parseCountValue(row.duplicateTimes, parseCountValue(row.count, 0));
      const diameterFeet = parseFeet(row.diameter || "");
      const heightFeet = parseFeet(row.length || "");
      const sideClearanceFeet = getClearanceFeet(row.clearanceSides);
      const topClearanceFeet = getClearanceFeet(row.clearanceTop);
      const bottomClearanceFeet = getClearanceFeet(row.clearanceBottom);
      const clearHeightFeet = Math.max(heightFeet - topClearanceFeet - bottomClearanceFeet, 0);
      const enteredHoopCount = parseCountValue(row.horizontalCircleCount, 0);
      const hoopSpacingFeet = parseFeet(row.spacing || "");
      if (!pierCount) warnings.push(`${label}: number of piers is missing.`);
      if (!diameterFeet) warnings.push(`${label}: pier diameter is missing.`);
      if (!heightFeet) warnings.push(`${label}: pier length/height is missing.`);
      if (!sideClearanceFeet) warnings.push(`${label}: side spacing/clearance is missing; H-circle diameter may be wrong.`);
      if (!enteredHoopCount && (!clearHeightFeet || !hoopSpacingFeet)) warnings.push(`${label}: Number of H-Circles is N/A; enter top/bottom spacing and H-circle spacing to calculate count.`);
      if (!parseCountValue(row.numVerticalBars, 0)) warnings.push(`${label}: vertical bars count is missing.`);
    }
  });

  return uniqueWarnings(warnings);
}

function collectScheduleValidationWarnings(schedule: ScheduleLine[], stockFeet: number): string[] {
  const warnings: string[] = [];
  schedule.forEach((line) => {
    const fieldText = `${line.cutLength} ${line.fieldOrder}`.toLowerCase();
    if (fieldText.includes("check")) warnings.push(`${line.mark}: ${line.fieldOrder}`);
    if (line.cutFeet > stockFeet + 0.01) warnings.push(`${line.mark}: cut length ${formatFeet(line.cutFeet)} is longer than stock stick ${formatFeet(stockFeet)}.`);
    if (line.cutFeet <= 0 && !line.cutLength.toLowerCase().includes("check")) warnings.push(`${line.mark}: no cut length calculated.`);
  });
  return uniqueWarnings(warnings);
}

export function generateManualRebarSchedule(params: {
  rows: ManualRebarRowInput[];
  stockLength: string;
  defaultOverlap: string;
  defaultVerticalToBase: string;
  defaultFoundationRebarSize: string;
  defaultPierRebarSize: string;
}): RebarResult {
  const stockFeet = parseFeet(params.stockLength) || 20;
  const overlapFeet = parseFeet(params.defaultOverlap) || 2;
  const defaultBendFeet = parseFeet(params.defaultVerticalToBase) || 0.5;
  const inputValidationWarnings = collectManualValidationWarnings({
    rows: params.rows,
    stockFeet,
    defaultOverlapFeet: overlapFeet,
    defaultBendFeet,
  });
  const schedule: ScheduleLine[] = [];
  const baseBottomTotalRunFeet = totalBaseBottomRunFeet(params.rows);

  for (const [rowIndex, row] of params.rows.entries()) {
    const segment = (row.segment || `ROW_${rowIndex + 1}`).replace(/\s+/g, "_").toUpperCase();
    const type = (row.itemType || "Misc").trim();
    const normalizedType = normalizedManualType(row);
    const isBaseBottom = normalizedType === "base/bottom rebar";
    const isHorizontalContinuous = normalizedType === "horiz continues longtidues";
    const isPier = normalizedType === "pier";
    const rebarSize = row.rebarSize || (isPier ? params.defaultPierRebarSize : params.defaultFoundationRebarSize);

    if (isBaseBottom || isHorizontalContinuous) {
      const barCount = parseCountValue(row.number, 1);
      const duplicateTimes = parseCountValue(row.duplicateTimes, isBaseBottom ? 2 : 1);
      const baseStraightFeet = parseFeet(row.length || "");
      const spacingFeet = parseFeet(row.spacingBetween || "");
      const sideClearanceFeet = isBaseBottom ? getClearanceFeet(row.clearanceSides) : 0;
      const clearStraightBaseFeet = isBaseBottom
        ? Math.max(baseStraightFeet - sideClearanceFeet * 2, 0)
        : baseStraightFeet;
      const leftBendFeet = manualEndExtra(row, 1, overlapFeet);
      const rightBendFeet = manualEndExtra(row, 2, overlapFeet);

      for (let duplicateIndex = 0; duplicateIndex < duplicateTimes; duplicateIndex += 1) {
        const duplicateLabel = duplicateTimes > 1 ? `side ${duplicateIndex + 1} of ${duplicateTimes}` : "single side";
        for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
          const offsetFeet = spacingFeet * barIndex;
          const locationAdjustment = isBaseBottom
            ? (leftBendFeet > 0 ? offsetFeet : 0) + (rightBendFeet > 0 ? offsetFeet : 0)
            : 0;
          const straightFeet = Math.max(clearStraightBaseFeet - locationAdjustment, 0);
          const positionName = barCount === 1 ? "single" : barIndex === 0 ? "outer" : barIndex === barCount - 1 ? "inner" : `middle ${barIndex}`;
          const clearanceNote = isBaseBottom && sideClearanceFeet > 0
            ? `, straight run ${formatFeet(baseStraightFeet)} minus 2 x side clearance ${formatFeet(sideClearanceFeet)} = ${formatFeet(clearStraightBaseFeet)}`
            : "";
          schedule.push(...buildManualContinuousRun({
            markBase: `${segment}_D${duplicateIndex + 1}_CONT_${barIndex + 1}`,
            prefix: `${segment}_D${duplicateIndex + 1}_CONT_${barIndex + 1}`,
            location: `${row.segment || segment} ${duplicateLabel} ${positionName} ${rebarSize} continuous bar${spacingFeet ? `, offset ${formatFeet(offsetFeet)} from outside` : ""}${clearanceNote}`,
            straightFeet,
            stockFeet,
            overlapFeet,
            leftBendFeet,
            rightBendFeet,
          }));
        }

        const enteredTraverseQty = parseCountValue(row.traverseNumber, 0);
        const traverseSpacingFeet = parseFeet(row.traverseSpacing || "");
        const calculatedTraverseQty = !enteredTraverseQty && isBaseBottom && baseStraightFeet > 0 && traverseSpacingFeet > 0
          ? countBySpacing(baseStraightFeet, traverseSpacingFeet)
          : 0;
        const traverseQty = enteredTraverseQty || calculatedTraverseQty;
        const traverseFeet = parseFeet(row.traverseLength || "");
        schedule.push(...buildManualSimplePieces({
          mark: `${segment}_D${duplicateIndex + 1}_TRAVERSE`,
          prefix: `${segment}_D${duplicateIndex + 1}_TRAVERSE`,
          location: `${row.segment || segment} ${duplicateLabel} traverse bars ${rebarSize}${row.traverseSpacing ? ` @ ${row.traverseSpacing}` : ""}${calculatedTraverseQty ? ` (${makeSpacingNote(baseStraightFeet, traverseSpacingFeet, "qty")}; Number is N/A)` : ""}`,
          qty: traverseQty,
          cutFeet: traverseFeet,
          leftFunction: "straight traverse start",
          rightFunction: "straight traverse end",
        }));
      }
      continue;
    }

    if (normalizedType === "vertical rebar") {
      const duplicateTimes = parseCountValue(row.duplicateTimes, 1);
      const spacingFeet = parseFeet(row.verticalSpacingAdjacent || "");
      const enteredQty = parseCountValue(row.count, 0);
      const runFeet = parseFeet(row.calcLength || "") || baseBottomTotalRunFeet;
      const calculatedQty = !enteredQty && isBlankOrNA(row.count) && runFeet > 0 && spacingFeet > 0
        ? countBySpacing(runFeet, spacingFeet)
        : 0;
      const qty = enteredQty ? enteredQty * duplicateTimes : calculatedQty;
      const inferredVertical = inferVerticalStraightFeet(row, params.rows);
      const straightFeet = inferredVertical.feet;
      const side1BendFeet = (row.side1Bent || "").toLowerCase() === "yes" ? (parseFeet(row.side1BentLength || "") || defaultBendFeet) : 0;
      const side2BendFeet = (row.side2Bent || "").toLowerCase() === "yes" ? (parseFeet(row.side2BentLength || "") || defaultBendFeet) : 0;
      const verticalLocation = `${row.segment || segment} vertical/L bars ${rebarSize}${row.verticalSpacingAdjacent ? ` @ ${row.verticalSpacingAdjacent}` : ""}${calculatedQty ? `, ${makeSpacingNote(runFeet, spacingFeet, "qty")}` : ""}${enteredQty && duplicateTimes > 1 ? `, duplicated ${duplicateTimes} sides` : ""}${inferredVertical.note}`;
      if (!qty || !straightFeet) {
        schedule.push(...buildManualCheckLine({
          mark: `${segment}_VERT_CHECK`,
          prefix: `${segment}_VERT`,
          location: verticalLocation,
          qty: qty || duplicateTimes,
          message: `CHECK vertical/L bars: ${!qty ? "enter Count or use N/A with Calculate len/spacing" : ""}${!qty && !straightFeet ? "; " : ""}${!straightFeet ? "enter Bar straight len or pier Length with top/bottom clearances" : ""}.`,
        }));
      } else {
        schedule.push(...buildManualSimplePieces({
          mark: `${segment}_VERT`,
          prefix: `${segment}_VERT`,
          location: verticalLocation,
          qty,
          cutFeet: straightFeet + side1BendFeet + side2BendFeet,
          leftFunction: side1BendFeet > 0 ? `${formatFeet(side1BendFeet)} side 1 bent` : "side 1 straight",
          rightFunction: side2BendFeet > 0 ? `${formatFeet(side2BendFeet)} side 2 bent` : "side 2 straight",
        }));
      }
      continue;
    }

    if (isPier) {
      const pierCount = parseCountValue(row.duplicateTimes, parseCountValue(row.count, 1));
      const diameterFeet = parseFeet(row.diameter || "");
      const heightFeet = parseFeet(row.length || "");
      const topClearanceFeet = getClearanceFeet(row.clearanceTop);
      const bottomClearanceFeet = getClearanceFeet(row.clearanceBottom);
      const sideClearanceFeet = getClearanceFeet(row.clearanceSides);
      const clearHeightFeet = heightFeet > 0 ? Math.max(heightFeet - topClearanceFeet - bottomClearanceFeet, 0) : 0;

      const enteredHoopCount = parseCountValue(row.horizontalCircleCount, 0);
      const hoopSpacingFeet = parseFeet(row.spacing || "");
      const calculatedHoopCount = !enteredHoopCount && isBlankOrNA(row.horizontalCircleCount) && clearHeightFeet > 0 && hoopSpacingFeet > 0
        ? countBySpacing(clearHeightFeet, hoopSpacingFeet)
        : 0;
      const hoopCount = enteredHoopCount || calculatedHoopCount;

      const verticalCount = parseCountValue(row.numVerticalBars, 0);
      const verticalBendFeet = (row.verticalBent || "").toLowerCase() === "yes" ? (parseFeet(row.verticalBentLength || "") || defaultBendFeet) : 0;
      const hoopDiameterFeet = diameterFeet > 0 ? Math.max(diameterFeet - sideClearanceFeet * 2, 0) : 0;
      const hoopOverlapFeet = 2 / 12;
      const hoopCutFeet = hoopDiameterFeet > 0 ? Math.PI * hoopDiameterFeet + hoopOverlapFeet : 0;

      const hoopLocation = `${row.segment || segment} pier H-circles/hoops ${rebarSize}: qty ${hoopCount || "CHECK"} per pier x ${pierCount || "CHECK"} piers; hoop diameter = pier diameter ${row.diameter || "missing"}${sideClearanceFeet ? ` - 2 x side spacing ${row.clearanceSides}` : ""} = ${hoopDiameterFeet ? formatFeet(hoopDiameterFeet) : "CHECK"}; circle cut = circumference plus 2" overlap${row.spacing ? `; vertical spacing ${row.spacing}` : ""}${calculatedHoopCount ? `; ${makeSpacingNote(clearHeightFeet, hoopSpacingFeet, "H-circle qty")}` : ""}`;
      if (!pierCount || !hoopCount || !hoopCutFeet) {
        schedule.push(...buildManualCheckLine({
          mark: `${segment}_PIER_HCIRC_CHECK`,
          prefix: `${segment}_PIER_HCIRC`,
          location: hoopLocation,
          qty: Math.max((pierCount || 1) * (hoopCount || 1), 1),
          message: `CHECK pier H-circles: enter Number of piers, Diameter, side clearance, and Number of H-Circles or N/A with Length + top/bottom clearance + spacing.`,
        }));
      } else {
        schedule.push(...buildManualSimplePieces({
          mark: `${segment}_PIER_HCIRC`,
          prefix: `${segment}_PIER_HCIRC`,
          location: hoopLocation,
          qty: pierCount * hoopCount,
          cutFeet: hoopCutFeet,
          leftFunction: `circle dia ${formatFeet(hoopDiameterFeet)}`,
          rightFunction: `${formatFeet(hoopOverlapFeet)} hoop overlap`,
        }));
      }

      const pierVertLocation = `${row.segment || segment} pier vertical L bars ${rebarSize}: ${verticalCount || "CHECK"} vertical bars per pier x ${pierCount || "CHECK"} piers; straight = pier len ${row.length || "missing"}${heightFeet ? ` - top/bottom clearance ${formatFeet(topClearanceFeet + bottomClearanceFeet)} = ${formatFeet(clearHeightFeet)}` : ""}${verticalBendFeet ? ` + ${formatFeet(verticalBendFeet)} bent` : ""}`;
      if (!pierCount || !verticalCount || !clearHeightFeet) {
        schedule.push(...buildManualCheckLine({
          mark: `${segment}_PIER_VERT_CHECK`,
          prefix: `${segment}_PIER_VERT`,
          location: pierVertLocation,
          qty: Math.max((pierCount || 1) * (verticalCount || 1), 1),
          message: `CHECK pier verticals: enter Number of piers, Length, top/bottom clearances, and Vertical bars count.`,
        }));
      } else {
        schedule.push(...buildManualSimplePieces({
          mark: `${segment}_PIER_VERT`,
          prefix: `${segment}_PIER_VERT`,
          location: pierVertLocation,
          qty: pierCount * verticalCount,
          cutFeet: clearHeightFeet + verticalBendFeet,
          leftFunction: verticalBendFeet > 0 ? `${formatFeet(verticalBendFeet)} bottom bent` : "bottom straight",
          rightFunction: `straight ${formatFeet(clearHeightFeet)} after clearances`,
        }));
      }
      continue;
    }

    const qty = parseCountValue(row.count, parseCountValue(row.number, 0));
    const cutFeet = parseFeet(row.length || "");
    schedule.push(...buildManualSimplePieces({
      mark: `${segment}_MISC`,
      prefix: `${segment}_MISC`,
      location: `${row.segment || segment} misc ${rebarSize}`,
      qty,
      cutFeet,
      leftFunction: "start",
      rightFunction: "end",
    }));
  }

  const validationWarnings = uniqueWarnings([
    ...inputValidationWarnings,
    ...collectScheduleValidationWarnings(schedule, stockFeet),
  ]);

  return {
    schedule,
    summary: summarize(schedule),
    materialTakeoff: getMaterialTakeoff(schedule, stockFeet),
    validationWarnings,
  };
}
