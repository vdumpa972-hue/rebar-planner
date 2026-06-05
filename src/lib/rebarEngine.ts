export type RebarScheduleLine = {
  mark: string;
  location: string;
  requiredLength: string;
  cutLength: string;
  leftFunction: string;
  usedLength: string;
  rightFunction: string;
  fieldOrder: string;
  usedFeet: number;
  requiredFeet: number;
};

export type RebarScheduleSummary = {
  location: string;
  requiredLength: string;
  totalUsed: string;
  pieceCount: number;
  totalCut: string;
  status: string;
};

export type RebarScheduleResult = {
  lines: RebarScheduleLine[];
  summaries: RebarScheduleSummary[];
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
  const rounded = Math.round(value * 16) / 16;
  let feet = Math.floor(rounded);
  let inchesDecimal = (rounded - feet) * 12;
  let inches = Math.round(inchesDecimal * 16) / 16;

  if (inches >= 12) {
    feet += 1;
    inches -= 12;
  }

  if (Math.abs(inches) < 0.001) return `${feet}'`;

  const wholeInches = Math.floor(inches);
  const fraction = inches - wholeInches;
  const sixteenths = Math.round(fraction * 16);

  if (sixteenths === 0) return `${feet}'-${wholeInches}"`;

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  const numerator = sixteenths / divisor;
  const denominator = 16 / divisor;

  if (wholeInches === 0) return `${feet}'-${numerator}/${denominator}"`;
  return `${feet}'-${wholeInches} ${numerator}/${denominator}"`;
}

function makeFieldOrder(
  cutLength: string,
  leftFunction: string,
  usedLength: string,
  rightFunction: string
) {
  const parts = [`${cutLength} cut`];
  if (leftFunction && leftFunction !== "none") parts.push(leftFunction);
  parts.push(`${usedLength} used`);
  if (rightFunction && rightFunction !== "none") parts.push(rightFunction);
  return `${parts.join(" | ")} - OK`;
}

function buildStraightWallLines(args: {
  markPrefix: string;
  location: string;
  requiredLengthText: string;
  stockLengthFeet: number;
  lapFeet: number;
  firstLeftFunction: string;
  lastRightFunction: string;
}): RebarScheduleLine[] {
  const requiredFeet = parseFeet(args.requiredLengthText);
  if (!requiredFeet || !args.stockLengthFeet) return [];

  const lines: RebarScheduleLine[] = [];
  let remainingUsed = requiredFeet;
  let pieceNumber = 1;

  while (remainingUsed > 0.01) {
    const isFirst = pieceNumber === 1;

    const leftFunction = isFirst ? args.firstLeftFunction : `${formatFeet(args.lapFeet)} lap`;
    const leftAllowance = leftFunction === "none" ? 0 : args.lapFeet;

    const canFinishWithRight = remainingUsed + leftAllowance + args.lapFeet <= args.stockLengthFeet;
    const isLast = canFinishWithRight;

    const rightFunction = isLast ? args.lastRightFunction : "none";
    const rightAllowance = rightFunction === "none" ? 0 : args.lapFeet;

    const maxUsedInThisPiece = args.stockLengthFeet - leftAllowance - rightAllowance;
    const usedFeet = isLast ? remainingUsed : Math.min(remainingUsed, maxUsedInThisPiece);
    const cutFeet = usedFeet + leftAllowance + rightAllowance;

    const cutLength = formatFeet(cutFeet);
    const usedLength = formatFeet(usedFeet);

    lines.push({
      mark: `${args.markPrefix}-${pieceNumber}`,
      location: args.location,
      requiredLength: formatFeet(requiredFeet),
      cutLength,
      leftFunction,
      usedLength,
      rightFunction,
      fieldOrder: makeFieldOrder(cutLength, leftFunction, usedLength, rightFunction),
      usedFeet,
      requiredFeet,
    });

    remainingUsed -= usedFeet;
    pieceNumber += 1;
  }

  return lines;
}

function buildEndWallLine(args: {
  markPrefix: string;
  location: string;
  requiredLengthText: string;
  lapFeet: number;
}): RebarScheduleLine[] {
  const requiredFeet = parseFeet(args.requiredLengthText);
  if (!requiredFeet) return [];

  const cutFeet = requiredFeet + args.lapFeet + args.lapFeet;
  const cutLength = formatFeet(cutFeet);
  const usedLength = formatFeet(requiredFeet);
  const lap = `${formatFeet(args.lapFeet)} lap & bent`;

  return [
    {
      mark: `${args.markPrefix}-1`,
      location: args.location,
      requiredLength: formatFeet(requiredFeet),
      cutLength,
      leftFunction: lap,
      usedLength,
      rightFunction: lap,
      fieldOrder: makeFieldOrder(cutLength, lap, usedLength, lap),
      usedFeet: requiredFeet,
      requiredFeet,
    },
  ];
}

function buildSummaries(lines: RebarScheduleLine[]): RebarScheduleSummary[] {
  const groups = new Map<string, RebarScheduleLine[]>();

  for (const line of lines) {
    const existing = groups.get(line.location) || [];
    existing.push(line);
    groups.set(line.location, existing);
  }

  return [...groups.entries()].map(([location, group]) => {
    const requiredFeet = group[0]?.requiredFeet || 0;
    const totalUsedFeet = group.reduce((sum, line) => sum + line.usedFeet, 0);
    const totalCutFeet = group.reduce((sum, line) => sum + parseFeet(line.cutLength), 0);
    const difference = Math.abs(requiredFeet - totalUsedFeet);

    return {
      location,
      requiredLength: formatFeet(requiredFeet),
      totalUsed: formatFeet(totalUsedFeet),
      pieceCount: group.length,
      totalCut: formatFeet(totalCutFeet),
      status: difference < 0.02 ? "OK - used adds to required" : `CHECK - off by ${formatFeet(difference)}`,
    };
  });
}

export function generateRebarSchedule(args: {
  sideWallLength: string;
  endWallLength: string;
  stickLengthFeet: number;
  lapInches: number;
}): RebarScheduleResult {
  const lapFeet = args.lapInches / 12;
  const stockLengthFeet = args.stickLengthFeet || 20;

  const sideWallLines = buildStraightWallLines({
    markPrefix: "SW-H",
    location: "Side Wall Horizontal",
    requiredLengthText: args.sideWallLength,
    stockLengthFeet,
    lapFeet,
    firstLeftFunction: `${formatFeet(lapFeet)} lap & bent`,
    lastRightFunction: `${formatFeet(lapFeet)} lap & bent`,
  });

  const endWallLines = buildEndWallLine({
    markPrefix: "EW-H",
    location: "End Wall Horizontal",
    requiredLengthText: args.endWallLength,
    lapFeet,
  });

  const lines = [...sideWallLines, ...endWallLines];

  return {
    lines,
    summaries: buildSummaries(lines),
  };
}
