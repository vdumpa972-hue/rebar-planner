export type Confidence = "High" | "Medium" | "Low";
export type ReviewStatus = "Collected" | "Reviewed" | "Approved" | "Rejected";

export type CropRef = {
  id: string;
  label: string;
  elementType: string;
  pageNumber: number;
  sourceNote: string;
  confidence: Confidence;
  imageDataUrl?: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  createdAtIso: string;
};

export type SourceIds = string[];

export type FootingWallItemTypeV2 = "Footing" | "Wall" | "Pier";

export type FoundationRowV2 = {
  id: string;
  segment: string;
  length: string;
  turn: string;
  sourceIds: SourceIds;
};

export type FootingWallRowV2 = {
  id: string;
  itemType: FootingWallItemTypeV2;
  segment: string;
  length: string;
  turn: string;
  bentLength: string;
  descriptionText: string;
  rebarSize: string;
  note: string;

  // Pier-specific fields
  diameter: string;
  horizontalCircleCount: string;
  numVerticalBars: string;
  verticalBent: "" | "Yes" | "No";
  verticalBentLength: string;

  // Legacy fields kept so old records do not crash when opened.
  numContinuous: string;
  numTransverse: string;
  continuousSpacing: string;
  transverseSpacing: string;
  horizontalSpacing: string;
  horizontalNote: string;
  numPiers: string;
  numHorizontalBars: string;
  x: string;
  y: string;
  xSpaceFromRebar: string;
  ySpaceFromRebar: string;
  miscText: string;

  sourceIds: SourceIds;
};

export type PierRowV2 = {
  id: string;
  pierName: string;
  numPiers: string;
  diameter: string;
  length: string;
  numHorizontalBars: string;
  numVerticalBars: string;
  centerX: string;
  centerY: string;
  sourceIds: SourceIds;
};

export type VentRowV2 = {
  id: string;
  ventName: string;
  x: string;
  y: string;
  xSpaceFromRebar: string;
  ySpaceFromRebar: string;
  sourceIds: SourceIds;
};

export type CrawlSpaceRowV2 = {
  id: string;
  itemName: string;
  height: string;
  width: string;
  location: string;
  notes: string;
  sourceIds: SourceIds;
};

export type MiscRowV2 = {
  id: string;
  label: string;
  freeText: string;
  sourceIds: SourceIds;
};

// Older v1 shape kept optional so old saved documents still load without breaking.
export type FoundationSegment = {
  id: string;
  segmentName: string;
  lengthText: string;
  turnAngle: string;
  sourceNote: string;
  confidence: Confidence;
  sourceIds?: string[];
  cropId?: string;
};

export type PierItem = {
  id: string;
  pierName: string;
  diameter: string;
  height: string;
  centerX: string;
  centerY: string;
  rebarSpec: string;
  typical: boolean;
  sourceNote: string;
  confidence: Confidence;
  sourceIds?: string[];
  cropId?: string;
};

export type RebarItem = {
  id: string;
  section: "Footing" | "Stem Wall" | "Pier" | "General";
  itemName: string;
  layer: string;
  barSize: string;
  count: string;
  spacing: string;
  lap: string;
  cover: string;
  bendType: string;
  typical: boolean;
  sourceNote: string;
  confidence: Confidence;
  sourceIds?: string[];
  cropId?: string;
};

export type ParameterTemplateSource = "collector" | "planner" | "shared";

export type TrainingRecord = {
  id?: string;
  schemaVersion?: number;
  parameterSchemaVersion?: number;
  parameterTemplateId?: string;
  parameterTemplateSource?: ParameterTemplateSource;
  projectName: string;
  pdfFileName: string;
  pdfDriveFileId?: string;
  pdfDriveWebViewLink?: string;
  pageNumber: string;
  collectorName: string;
  userName?: string;
  reviewerName: string;
  approverName: string;
  foundationType: string;
  referenceDimension: string;
  referenceSourceNote: string;
  status: ReviewStatus;
  notes: string;
  crops: CropRef[];

  // Shared global parameter fields
  stickLength: string;
  defaultOverlap: string;
  defaultVerticalToBase: string;
  foundationRebarSize: string;
  pierRebarSize: string;

  // Legacy global field names kept for old records.
  foundationCornerOverlap: string;
  foundationVerticalHorizontalOverlap: string;

  // Simplified v2 data
  foundationV2: FoundationRowV2[];
  footingWallsV2: FootingWallRowV2[];
  crawlSpacesV2: CrawlSpaceRowV2[];
  miscV2: MiscRowV2[];

  // Legacy / older v2 fields kept optional
  piersV2?: PierRowV2[];
  ventsV2?: VentRowV2[];
  foundationSegments?: FoundationSegment[];
  piers?: PierItem[];
  rebarItems?: RebarItem[];
  createdByUid?: string;
  createdByEmail?: string;
  createdAtIso?: string;
  updatedAtIso?: string;
};

export const confidenceOptions: Confidence[] = ["High", "Medium", "Low"];
export const statusOptions: ReviewStatus[] = ["Collected", "Reviewed", "Approved", "Rejected"];
export const footingWallItemTypesV2: FootingWallItemTypeV2[] = ["Footing", "Wall", "Pier"];

export function newFoundationRowV2(n: number): FoundationRowV2 {
  return { id: crypto.randomUUID(), segment: `S${n}`, length: "", turn: n === 1 ? "0" : "90", sourceIds: [] };
}

export function newFootingWallRowV2(itemType: FootingWallItemTypeV2 = "Footing", n = 1): FootingWallRowV2 {
  return {
    id: crypto.randomUUID(),
    itemType,
    segment: `${itemType}${n}`,
    length: "",
    turn: itemType === "Footing" ? "0" : "",
    bentLength: "",
    descriptionText: "",
    rebarSize: "",
    note: "",
    diameter: "",
    horizontalCircleCount: "",
    numVerticalBars: "",
    verticalBent: "",
    verticalBentLength: "",
    numContinuous: "",
    numTransverse: "",
    continuousSpacing: "",
    transverseSpacing: "",
    horizontalSpacing: "",
    horizontalNote: "",
    numPiers: "",
    numHorizontalBars: "",
    x: "",
    y: "",
    xSpaceFromRebar: "",
    ySpaceFromRebar: "",
    miscText: "",
    sourceIds: [],
  };
}

export function newPierRowV2(n: number): PierRowV2 {
  return { id: crypto.randomUUID(), pierName: `P${n}`, numPiers: "", diameter: "", length: "", numHorizontalBars: "", numVerticalBars: "", centerX: "", centerY: "", sourceIds: [] };
}

export function newVentRowV2(n: number): VentRowV2 {
  return { id: crypto.randomUUID(), ventName: `V${n}`, x: "", y: "", xSpaceFromRebar: "", ySpaceFromRebar: "", sourceIds: [] };
}

export function newCrawlSpaceRowV2(n: number): CrawlSpaceRowV2 {
  return { id: crypto.randomUUID(), itemName: `Crawl ${n}`, height: "", width: "", location: "", notes: "", sourceIds: [] };
}

export function newMiscRowV2(n: number): MiscRowV2 {
  return { id: crypto.randomUUID(), label: `Misc ${n}`, freeText: "", sourceIds: [] };
}

// Legacy constructors retained for older imports / old records.
export function newSegment(n: number): FoundationSegment {
  return { id: crypto.randomUUID(), segmentName: `S${n}`, lengthText: "", turnAngle: "90", sourceNote: "", confidence: "High", sourceIds: ["TEXT"] };
}

export function newPier(n: number): PierItem {
  return { id: crypto.randomUUID(), pierName: `P${n}`, diameter: "", height: "", centerX: "", centerY: "", rebarSpec: "", typical: true, sourceNote: "", confidence: "High", sourceIds: ["TEXT"] };
}

export function newRebar(section: RebarItem["section"] = "Footing"): RebarItem {
  return { id: crypto.randomUUID(), section, itemName: "", layer: "", barSize: "", count: "", spacing: "", lap: "", cover: "", bendType: "", typical: true, sourceNote: "", confidence: "High", sourceIds: ["TEXT"] };
}

export function emptyTrainingRecord(): TrainingRecord {
  return {
    schemaVersion: 2,
    parameterSchemaVersion: 1,
    parameterTemplateSource: "shared",
    projectName: "",
    pdfFileName: "",
    pageNumber: "",
    collectorName: "",
    reviewerName: "",
    approverName: "",
    foundationType: "Stem wall + footing",
    referenceDimension: "",
    referenceSourceNote: "",
    status: "Collected",
    notes: "",
    crops: [],
    stickLength: "20'",
    defaultOverlap: "24\"",
    defaultVerticalToBase: "6\"",
    foundationRebarSize: "#4",
    pierRebarSize: "#4",
    foundationCornerOverlap: "24\"",
    foundationVerticalHorizontalOverlap: "6\"",
    foundationV2: [newFoundationRowV2(1), newFoundationRowV2(2), newFoundationRowV2(3), newFoundationRowV2(4)],
    footingWallsV2: [newFootingWallRowV2("Footing", 1)],
    crawlSpacesV2: [],
    miscV2: [],
    piersV2: [],
    ventsV2: [],
    foundationSegments: [],
    piers: [],
    rebarItems: [],
  };
}
