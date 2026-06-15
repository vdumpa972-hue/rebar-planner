"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  formatFeet,
  generateRebarSchedule,
  generateManualRebarSchedule,
  parseFeet,
  type MaterialTakeoff,
  type ScheduleLine,
  type SummaryLine,
} from "@/lib/rebarEngine";
import {
  extractDetectedValuesFromPlanText,
  type DetectedValue,
} from "@/lib/planDataExtractor";
import { extractPdfTextFromFile } from "@/lib/planPdfReader";
import {
  analyzePlanText,
  type PlanRecognitionReport,
} from "@/lib/planRecognition";
import { calculatedFieldKeys, fieldHelp, initialFields } from "@/lib/sharedRebarParameters";
import { useAuth } from "@/contexts/AuthContext";
import { db, storage } from "@/lib/firebase";
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

type ExtractedField = {
  key: string;
  label: string;
  value: string;
};

type RebarInfoType = "Base/Bottom rebar" | "Horiz continues longtidues" | "Vertical Rebar" | "Pier" | "Misc";
type ProjectStatus = "Draft" | "Review" | "Ready for Shop" | "Issued" | "Archived";

type PlanCropRef = {
  id: string;
  label: string;
  elementType: RebarInfoType;
  pageNumber: number;
  note: string;
  imageDataUrl?: string;
  storagePath?: string;
  downloadUrl?: string;
  createdAtIso: string;
};

type RebarInfoRow = {
  id: string;
  itemType: RebarInfoType;
  segment: string;
  length: string;
  turn: string;
  bentLength: string;
  diameter: string;
  horizontalCircleCount: string;
  numVerticalBars: string;
  verticalBent: "" | "Yes" | "No";
  verticalBentLength: string;
  cropImage: string; // legacy single-crop field
  cropImages: string[];
  count: string;
  number: string;
  spacingBetween: string;
  spacing: string;
  side1Bent: "" | "Yes" | "No";
  side1TurnAngle: string;
  side1BentLength: string;
  side2Bent: "" | "Yes" | "No";
  side2TurnAngle: string;
  side2BentLength: string;
  traverseNumber: string;
  traverseSpacing: string;
  traverseLength: string;
  clearanceTop: string;
  clearanceBottom: string;
  clearanceSides: string;
  verticalSpacingAdjacent: string;
  rebarSize: string;
  duplicateTimes: string;
  calcLength: string;
  note: string;
};

type RebarGlobalParams = {
  stickLength: string;
  defaultOverlap: string;
  defaultVerticalToBase: string;
  foundationRebarSize: string;
  pierRebarSize: string;
};

type FoundationRebarConfig = {
  baseLongitudinalCount: string;
  baseLongitudinalSpacing: string;
  baseSide1Bent: "" | "Yes" | "No";
  baseSide1TurnAngle: string;
  baseSide1BentLength: string;
  baseSide2Bent: "" | "Yes" | "No";
  baseSide2TurnAngle: string;
  baseSide2BentLength: string;
  baseTraverseLength: string;
  horizontalBarSpacing: string;
  horizontalSide1Bent: "" | "Yes" | "No";
  horizontalSide1TurnAngle: string;
  horizontalSide1BentLength: string;
  horizontalSide2Bent: "" | "Yes" | "No";
  horizontalSide2TurnAngle: string;
  horizontalSide2BentLength: string;
  verticalSide1Bent: "" | "Yes" | "No";
  verticalSide1TurnAngle: string;
  verticalSide1BentLength: string;
  verticalSide2Bent: "" | "Yes" | "No";
  verticalSide2TurnAngle: string;
  verticalSide2BentLength: string;
};

const defaultFoundationRebarConfig: FoundationRebarConfig = {
  baseLongitudinalCount: "3",
  baseLongitudinalSpacing: "",
  baseSide1Bent: "",
  baseSide1TurnAngle: "",
  baseSide1BentLength: "",
  baseSide2Bent: "",
  baseSide2TurnAngle: "",
  baseSide2BentLength: "",
  baseTraverseLength: "",
  horizontalBarSpacing: "",
  horizontalSide1Bent: "",
  horizontalSide1TurnAngle: "",
  horizontalSide1BentLength: "",
  horizontalSide2Bent: "",
  horizontalSide2TurnAngle: "",
  horizontalSide2BentLength: "",
  verticalSide1Bent: "",
  verticalSide1TurnAngle: "",
  verticalSide1BentLength: "",
  verticalSide2Bent: "",
  verticalSide2TurnAngle: "",
  verticalSide2BentLength: "",
};

type SavedGeneratedSchedule = {
  generatedAtIso: string;
  sourceLabel: string;
  schedule: ScheduleLine[];
  summary: SummaryLine[];
  materialTakeoff: MaterialTakeoff;
  reviewedPieceMarks?: string[];
  validationWarnings?: string[];
};

type PlannerWorkspace = {
  projectName: string;
  planFileName: string;
  planFileType: string;
  planFileSize: number;
  planStoragePath?: string;
  planDownloadUrl?: string;
  extractionMode: ExtractionMode;
  horizontalLap: string;
  verticalBentLap: string;
  stickLength: string;
  fields: ExtractedField[];
  fieldSources: Record<string, FieldSource>;
  pierMode: "unknown" | "yes" | "none";
  rebarGlobalParams?: RebarGlobalParams;
  foundationRebarConfig?: FoundationRebarConfig;
  rebarInfoRows?: RebarInfoRow[];
  cropRefs?: PlanCropRef[];
  savedGeneratedSchedule?: SavedGeneratedSchedule | null;
  projectStatus?: ProjectStatus;
  projectNotes?: string;
  projectFavorite?: boolean;
  projectArchived?: boolean;
};

type SavedPlannerProject = {
  id: string;
  projectName: string;
  planFileName: string;
  updatedAtLabel: string;
  cropCount: number;
  rowCount: number;
  projectStatus: ProjectStatus;
  projectNotes: string;
  projectFavorite: boolean;
  projectArchived: boolean;
};

type ExtractionMode = "live" | "simulation";

type FieldSourceKind =
  | "pdf-text"
  | "pdf-image"
  | "calculated"
  | "default"
  | "manual"
  | "missing"
  | "blank";

type FieldSource = {
  kind: FieldSourceKind;
  confidence?: "high" | "medium" | "low";
  reason?: string;
};


type VisualExtractedField = { key: string; value: string; source: string; confidence?: number; evidence?: string; page?: number };
type VisualPlanAnalysis = {
  success: boolean; engine?: string; error?: string; notes?: string[]; sourcePolicy?: string;
  scale?: { px_per_foot: number | null; status: string; confidence?: number; evidence?: string };
  textEvidence?: { dimensions?: { value: string; page?: number; feet?: number | null }[]; keywords?: unknown[]; full_text_preview?: string };
  imageAnalysis?: { page: number; error?: string; image_size?: { width: number; height: number }; circles?: { page: number; x: number; y: number; r: number; classification: string; confidence: number; evidence: string }[]; lines?: unknown[] }[];
  extractedFields?: VisualExtractedField[];
};


type RegionRect = { x: number; y: number; width: number; height: number };

type RegionParam = {
  key: string;
  label: string;
  value: string;
  source: string;
  confidence?: number;
  evidence?: string;
};

type RegionAnalysis = {
  success: boolean;
  error?: string;
  page?: number;
  rect?: Record<string, number>;
  rawText?: string;
  params?: RegionParam[];
  lineCount?: number;
  circleCount?: number;
  notes?: string[];
};

type FieldGroup = {
  title: string;
  description: string;
  keys: string[];
};

const pairedWallRows: Array<{ label: string; sideKey: string; endKey: string }> = [
  { label: "Wall Length", sideKey: "sideWallLength", endKey: "endWallLength" },
  { label: "Above Grade Height", sideKey: "sideAboveGrade", endKey: "endAboveGrade" },
  { label: "Total Concrete Height", sideKey: "sideTotalHeight", endKey: "endTotalHeight" },
  { label: "Vertical Bar Qty", sideKey: "sideVerticalQty", endKey: "endVerticalQty" },
  { label: "Vertical Bottom Clearance", sideKey: "sideVerticalBottomClearance", endKey: "endVerticalBottomClearance" },
  { label: "Vertical Top Clearance", sideKey: "sideVerticalTopClearance", endKey: "endVerticalTopClearance" },
  { label: "Vertical Used Height Override", sideKey: "sideVerticalUsedHeight", endKey: "endVerticalUsedHeight" },
];

const horizontalBarRows: Array<{ label: string; sideKey: string; endKey: string }> = [
  { label: "Base Outer Bar Required Length", sideKey: "sideBaseOuterLength", endKey: "endBaseOuterLength" },
  { label: "Base Middle Bar Required Length", sideKey: "sideBaseMiddleLength", endKey: "endBaseMiddleLength" },
  { label: "Base Inner Bar Required Length", sideKey: "sideBaseInnerLength", endKey: "endBaseInnerLength" },
];

const footingPierFieldKeys = [
  "belowGradeEmbed",
  "wallThickness",
  "footingDepth",
  "footingSize",
  "baseShortVerticalQty",
  "baseShortVerticalCutLength",
  "ptSillPlates",
  "pierCount",
  "pierDiameter",
  "pierHeight",
  "rebarCallouts",
];


type DerivedFieldValue = {
  value: string;
  reason: string;
};

function addInchesToFeetString(value: string, inches: number) {
  const feet = parseFeet(value);
  if (!feet) return "";
  const result = feet + inches / 12;
  if (result <= 0) return "";
  return formatFeet(result);
}

function getDerivedFieldValues(fields: ExtractedField[]): Record<string, DerivedFieldValue> {
  const getValue = (key: string) => fields.find((field) => field.key === key)?.value || "";
  const sideWallLength = getValue("sideWallLength");
  const endWallLength = getValue("endWallLength");
  const derived: Record<string, DerivedFieldValue> = {};

  const sideOuter = addInchesToFeetString(sideWallLength, 3);
  if (sideOuter) {
    derived.sideBaseOuterLength = {
      value: sideOuter,
      reason: "Calculated from Side Wall Length + 3 in.",
    };
  }
  const sideMiddle = addInchesToFeetString(sideWallLength, -3);
  if (sideMiddle) {
    derived.sideBaseMiddleLength = {
      value: sideMiddle,
      reason: "Calculated from Side Wall Length - 3 in.",
    };
  }
  const sideInner = addInchesToFeetString(sideWallLength, -9);
  if (sideInner) {
    derived.sideBaseInnerLength = {
      value: sideInner,
      reason: "Calculated from Side Wall Length - 9 in.",
    };
  }

  const endOuter = addInchesToFeetString(endWallLength, -3);
  if (endOuter) {
    derived.endBaseOuterLength = {
      value: endOuter,
      reason: "Calculated from End Wall Length - 3 in.",
    };
  }
  const endMiddle = addInchesToFeetString(endWallLength, -6);
  if (endMiddle) {
    derived.endBaseMiddleLength = {
      value: endMiddle,
      reason: "Calculated from End Wall Length - 6 in.",
    };
  }
  const endInner = addInchesToFeetString(endWallLength, -9);
  if (endInner) {
    derived.endBaseInnerLength = {
      value: endInner,
      reason: "Calculated from End Wall Length - 9 in.",
    };
  }

  const sideFeet = parseFeet(sideWallLength);
  const endFeet = parseFeet(endWallLength);
  if (sideFeet > 0 && endFeet > 0) {
    derived.baseShortVerticalQty = {
      value: String(Math.ceil(sideFeet * 2 + endFeet * 2)),
      reason: "Calculated at 1 ft separation around footing perimeter: ceil(2 × Side Wall Length + 2 × End Wall Length).",
    };
  }

  return derived;
}

function applyDerivedFieldValues(fields: ExtractedField[]) {
  const derived = getDerivedFieldValues(fields);
  return fields.map((field) =>
    derived[field.key] ? { ...field, value: derived[field.key].value } : field,
  );
}

function applyDerivedFieldSources(sources: Record<string, FieldSource>, fields: ExtractedField[]) {
  const derived = getDerivedFieldValues(fields);
  const next = { ...sources };
  for (const [key, item] of Object.entries(derived)) {
    next[key] = {
      kind: "calculated",
      confidence: "high",
      reason: item.reason,
    };
  }
  return next;
}

function getInitialFieldSources(): Record<string, FieldSource> {
  return Object.fromEntries(
    initialFields.map((field) => [
      field.key,
      { kind: "blank" as FieldSourceKind },
    ]),
  );
}

function getFieldSourceStyle(source: FieldSource) {
  if (source.kind === "pdf-text") {
    return {
      badge: "PDF Text",
      badgeClass: "bg-green-100 text-green-800 border-green-300",
      inputClass: "border-green-300 bg-green-50",
    };
  }
  if (source.kind === "pdf-image") {
    return {
      badge: "PDF Image",
      badgeClass: "bg-purple-100 text-purple-800 border-purple-300",
      inputClass: "border-purple-300 bg-purple-50",
    };
  }
  if (source.kind === "calculated") {
    return {
      badge: "Calc",
      badgeClass: "bg-blue-100 text-blue-800 border-blue-300",
      inputClass: "border-blue-300 bg-blue-50",
    };
  }
  if (source.kind === "default") {
    return {
      badge: "Sim",
      badgeClass: "bg-yellow-100 text-yellow-900 border-yellow-300",
      inputClass: "border-yellow-300 bg-yellow-50",
    };
  }
  if (source.kind === "manual") {
    return {
      badge: "User",
      badgeClass: "bg-gray-100 text-gray-800 border-gray-300",
      inputClass: "border-gray-400 bg-white",
    };
  }
  if (source.kind === "missing") {
    return {
      badge: "Missing",
      badgeClass: "bg-red-100 text-red-800 border-red-300",
      inputClass: "border-red-300 bg-red-50",
    };
  }
  return {
    badge: "Blank",
    badgeClass: "bg-white text-gray-500 border-gray-300",
    inputClass: "border-gray-300 bg-white",
  };
}


const rebarInfoTypes: RebarInfoType[] = ["Base/Bottom rebar", "Horiz continues longtidues", "Vertical Rebar", "Pier", "Misc"];

function rebarSegmentPrefix(itemType: RebarInfoType) {
  if (itemType === "Base/Bottom rebar") return "BaseBottom";
  if (itemType === "Horiz continues longtidues") return "Horiz";
  if (itemType === "Vertical Rebar") return "Vertical";
  if (itemType === "Pier") return "Pier";
  return "Misc";
}

function createRebarInfoRow(itemType: RebarInfoType = "Base/Bottom rebar", index = 1): RebarInfoRow {
  return {
    id: crypto.randomUUID(),
    itemType,
    segment: `${rebarSegmentPrefix(itemType)}${index}`,
    length: "",
    turn: "",
    bentLength: "",
    diameter: "",
    horizontalCircleCount: "",
    numVerticalBars: "",
    verticalBent: "",
    verticalBentLength: "",
    cropImage: "",
    cropImages: [],
    count: itemType === "Vertical Rebar" ? "N/A" : "1",
    number: itemType === "Horiz continues longtidues" ? "1" : itemType === "Base/Bottom rebar" ? "N/A" : "",
    spacingBetween: itemType === "Horiz continues longtidues" ? "0" : "",
    spacing: "",
    side1Bent: "",
    side1TurnAngle: "",
    side1BentLength: "",
    side2Bent: "",
    side2TurnAngle: "",
    side2BentLength: "",
    traverseNumber: itemType === "Base/Bottom rebar" ? "N/A" : "",
    traverseSpacing: "",
    traverseLength: "",
    clearanceTop: itemType === "Base/Bottom rebar" ? `3"` : "",
    clearanceBottom: itemType === "Base/Bottom rebar" ? `3"` : "",
    clearanceSides: itemType === "Base/Bottom rebar" ? `3"` : "",
    verticalSpacingAdjacent: "",
    rebarSize: "",
    duplicateTimes: itemType === "Pier" || itemType === "Misc" ? "1" : "2",
    calcLength: "",
    note: "",
  };
}
function nextRebarSegment(rows: RebarInfoRow[], itemType: RebarInfoType) {
  const count = rows.filter((row) => row.itemType === itemType).length + 1;
  return `${rebarSegmentPrefix(itemType)}${count}`;
}

function makeTooltip(field: ExtractedField, source: FieldSource) {
  const parts = [
    fieldHelp[field.key] || "Confirm this value before fabrication.",
  ];
  if (source.kind !== "blank") {
    parts.push(`Source: ${source.kind}`);
  }
  if (source.confidence) {
    parts.push(`Confidence: ${source.confidence}`);
  }
  if (source.reason) {
    parts.push(source.reason);
  }
  return parts.join("\n");
}

export default function Home() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [authRole, setAuthRole] = useState("user");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState("");
  const [savedProjects, setSavedProjects] = useState<SavedPlannerProject[]>([]);
  const [projectName, setProjectName] = useState("ADU Foundation");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("Draft");
  const [projectNotes, setProjectNotes] = useState("");
  const [projectFavorite, setProjectFavorite] = useState(false);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [planFileName, setPlanFileName] = useState("");
  const [planFileType, setPlanFileType] = useState("");
  const [planFileSize, setPlanFileSize] = useState(0);
  const [planStoragePath, setPlanStoragePath] = useState("");
  const [planDownloadUrl, setPlanDownloadUrl] = useState("");
  const [planPreviewUrl, setPlanPreviewUrl] = useState("");
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [extractionStatus, setExtractionStatus] = useState("");
  const [extractionNotes, setExtractionNotes] = useState<string[]>([]);
  const [extractedTextPreview, setExtractedTextPreview] = useState("");
  const [recognitionReport, setRecognitionReport] =
    useState<PlanRecognitionReport | null>(null);
  const [visualAnalysis, setVisualAnalysis] = useState<VisualPlanAnalysis | null>(null);
  const [visualAnalysisStatus, setVisualAnalysisStatus] = useState("");
  const [useExternalVisualAnalyzer, setUseExternalVisualAnalyzer] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>("live");
  const [horizontalLap, setHorizontalLap] = useState("24");
  const [verticalBentLap, setVerticalBentLap] = useState("6");
  const [stickLength, setStickLength] = useState("20");
  const [rebarGlobalParams, setRebarGlobalParams] = useState<RebarGlobalParams>({
    stickLength: "20'",
    defaultOverlap: '24"',
    defaultVerticalToBase: '6"',
    foundationRebarSize: "#4",
    pierRebarSize: "#4",
  });
  const [foundationRebarConfig, setFoundationRebarConfig] = useState<FoundationRebarConfig>(defaultFoundationRebarConfig);
  const [rebarInfoRows, setRebarInfoRows] = useState<RebarInfoRow[]>(() => [createRebarInfoRow("Base/Bottom rebar", 1)]);
  const [manualComparisonFields, setManualComparisonFields] = useState<ExtractedField[]>(initialFields);
  const [manualComparisonRows, setManualComparisonRows] = useState<RebarInfoRow[]>([]);
  const [manualComparisonGlobals, setManualComparisonGlobals] = useState<RebarGlobalParams | null>(null);
  const [calculatedFields, setCalculatedFields] = useState<ExtractedField[]>([]);
  const [calculatedRows, setCalculatedRows] = useState<RebarInfoRow[]>([]);
  const [calculatedGlobals, setCalculatedGlobals] = useState<RebarGlobalParams | null>(null);
  const [calculatedAt, setCalculatedAt] = useState("");
  const [showParamComparison, setShowParamComparison] = useState(false);
  const [paramViewMode, setParamViewMode] = useState<"manual" | "calculated">("manual");
  const [isExtractingPlan, setIsExtractingPlan] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState("");
  const [fields, setFields] = useState<ExtractedField[]>(initialFields);
  const [fieldSources, setFieldSources] = useState<Record<string, FieldSource>>(
    getInitialFieldSources(),
  );
  const [schedule, setSchedule] = useState<ScheduleLine[]>([]);
  const [summary, setSummary] = useState<SummaryLine[]>([]);
  const [materialTakeoff, setMaterialTakeoff] =
    useState<MaterialTakeoff | null>(null);
  const [engineValidationWarnings, setEngineValidationWarnings] = useState<string[]>([]);
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);
  const [scheduleGenerationStatus, setScheduleGenerationStatus] = useState("");
  const [savedScheduleAt, setSavedScheduleAt] = useState("");
  const [selectedMark, setSelectedMark] = useState("");
  const [selectedPrefix, setSelectedPrefix] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [scheduleTypeFilter, setScheduleTypeFilter] = useState<"all" | "bottom" | "horizontal" | "vertical" | "pier">("all");
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [pierMode, setPierMode] = useState<"unknown" | "yes" | "none">(
    "unknown",
  );
  const [pierDialogOpen, setPierDialogOpen] = useState(false);
  const [pierMessage, setPierMessage] = useState("");
  const regionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const regionBaseImageRef = useRef<ImageData | null>(null);
  const cropToolRef = useRef<HTMLDivElement | null>(null);
  const [regionPageNumber, setRegionPageNumber] = useState("4");
  const [regionRect, setRegionRect] = useState<RegionRect | null>(null);
  const [regionDragStart, setRegionDragStart] = useState<{ x: number; y: number } | null>(null);
  const [regionStatus, setRegionStatus] = useState("");
  const [regionAnalysis, setRegionAnalysis] = useState<RegionAnalysis | null>(null);
  const [regionZoom, setRegionZoom] = useState(1);
  const [cropToolOpen, setCropToolOpen] = useState(false);
  const [cropRefs, setCropRefs] = useState<PlanCropRef[]>([]);
  const [cropElementType, setCropElementType] = useState<RebarInfoType>("Base/Bottom rebar");
  const [cropLabel, setCropLabel] = useState("Footing crop");
  const [cropNote, setCropNote] = useState("");
  const [openCropDropdownRowId, setOpenCropDropdownRowId] = useState("");
  const [plannerView, setPlannerView] = useState<"advanced" | "simple">("simple");
  const [pdfZoom, setPdfZoom] = useState(100);
  const [pdfPanelSize, setPdfPanelSize] = useState<"small" | "medium" | "large">("small");
  const [showPlanPanel, setShowPlanPanel] = useState(false);
  const [showProjectsMenu, setShowProjectsMenu] = useState(false);
  const [showOwnerMenu, setShowOwnerMenu] = useState(false);
  const [showSubscriptionMenu, setShowSubscriptionMenu] = useState(false);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [showProjectLibrary, setShowProjectLibrary] = useState(false);
  const [showWasteReport, setShowWasteReport] = useState(false);
  const [showFoundationMap, setShowFoundationMap] = useState(false);
  const [showShopPlanning, setShowShopPlanning] = useState(false);
  const [showEngineAudit, setShowEngineAudit] = useState(false);
  const [showClientReadiness, setShowClientReadiness] = useState(false);
  const [showProductWorkspace, setShowProductWorkspace] = useState(false);
  const [showSupportCenter, setShowSupportCenter] = useState(false);
  const [showPieceLegend, setShowPieceLegend] = useState(false);
  const [activeDiagramType, setActiveDiagramType] = useState<RebarInfoType>("Base/Bottom rebar");
  const [newEmptyRowIds, setNewEmptyRowIds] = useState<string[]>([]);
  const [reviewedPieceMarks, setReviewedPieceMarks] = useState<string[]>([]);
  const [lengthUnitErrorFields, setLengthUnitErrorFields] = useState<string[]>([]);
  const backupImportInputRef = useRef<HTMLInputElement | null>(null);



  const workspaceDocId = user?.uid || "";
  const isOwner = authRole === "owner" || user?.email?.toLowerCase() === "vdumpa972@gmail.com";

  function getWorkspaceSnapshot(): PlannerWorkspace {
    return {
      projectName,
      planFileName,
      planFileType,
      planFileSize,
      planStoragePath,
      planDownloadUrl,
      extractionMode,
      horizontalLap,
      verticalBentLap,
      stickLength,
      fields,
      fieldSources,
      pierMode,
      rebarGlobalParams,
      foundationRebarConfig,
      rebarInfoRows,
      cropRefs,
      projectStatus,
      projectNotes,
      projectFavorite,
      projectArchived: projectStatus === "Archived",
      savedGeneratedSchedule: schedule.length && materialTakeoff ? {
        generatedAtIso: savedScheduleAt || new Date().toISOString(),
        sourceLabel: showingCalculatedParams && calculatedRows.length > 0 ? "calculated PDF parameters" : "manual parameters",
        schedule,
        summary,
        materialTakeoff,
        reviewedPieceMarks,
        validationWarnings: engineValidationWarnings,
      } : null,
    };
  }

  function applyWorkspaceSnapshot(data: Partial<PlannerWorkspace>) {
    if (typeof data.projectName === "string") setProjectName(data.projectName);
    if (["Draft", "Review", "Ready for Shop", "Issued", "Archived"].includes(String(data.projectStatus || ""))) setProjectStatus(data.projectStatus as ProjectStatus);
    else if (data.projectArchived) setProjectStatus("Archived");
    if (typeof data.projectNotes === "string") setProjectNotes(data.projectNotes);
    if (typeof data.projectFavorite === "boolean") setProjectFavorite(data.projectFavorite);
    if (typeof data.planFileName === "string") setPlanFileName(data.planFileName);
    if (typeof data.planFileType === "string") setPlanFileType(data.planFileType);
    if (typeof data.planFileSize === "number") setPlanFileSize(data.planFileSize);
    if (typeof data.planStoragePath === "string") setPlanStoragePath(data.planStoragePath);
    if (typeof data.planDownloadUrl === "string") {
      setPlanDownloadUrl(data.planDownloadUrl);
      if (data.planDownloadUrl) setPlanPreviewUrl(data.planDownloadUrl);
    }
    if (data.extractionMode === "live" || data.extractionMode === "simulation") setExtractionMode(data.extractionMode);
    if (typeof data.horizontalLap === "string") setHorizontalLap(data.horizontalLap);
    if (typeof data.verticalBentLap === "string") setVerticalBentLap(data.verticalBentLap);
    if (typeof data.stickLength === "string") setStickLength(data.stickLength);
    if (Array.isArray(data.fields)) setFields(applyDerivedFieldValues(data.fields));
    if (data.fieldSources && typeof data.fieldSources === "object") setFieldSources(data.fieldSources);
    if (data.pierMode === "unknown" || data.pierMode === "yes" || data.pierMode === "none") setPierMode(data.pierMode);
    if (data.rebarGlobalParams && typeof data.rebarGlobalParams === "object") {
      setRebarGlobalParams((current) => ({ ...current, ...data.rebarGlobalParams }));
    }
    if (data.foundationRebarConfig && typeof data.foundationRebarConfig === "object") {
      setFoundationRebarConfig((current) => ({ ...current, ...data.foundationRebarConfig }));
    }
    if (Array.isArray(data.rebarInfoRows) && data.rebarInfoRows.length) {
      setRebarInfoRows(data.rebarInfoRows.map((row, index) => ({
        ...createRebarInfoRow((rebarInfoTypes.includes(row.itemType as RebarInfoType) ? row.itemType as RebarInfoType : "Base/Bottom rebar"), index + 1),
        ...row,
        itemType: rebarInfoTypes.includes(row.itemType as RebarInfoType) ? row.itemType as RebarInfoType : "Base/Bottom rebar",
        cropImages: Array.isArray(row.cropImages) ? row.cropImages : (row.cropImage ? [row.cropImage] : []),
        count: (row.count && row.count.trim()) ? row.count : ((row.itemType === "Vertical Rebar") ? "N/A" : "1"),
        number: row.number || ((row.itemType === "Horiz continues longtidues") ? "1" : (row.itemType === "Base/Bottom rebar" ? "N/A" : "")),
        spacingBetween: row.spacingBetween ?? "",
        spacing: row.spacing ?? "",
        side1Bent: row.side1Bent || "",
        side1TurnAngle: row.side1TurnAngle || "",
        side1BentLength: row.side1BentLength || "",
        side2Bent: row.side2Bent || "",
        side2TurnAngle: row.side2TurnAngle || "",
        side2BentLength: row.side2BentLength || "",
        traverseNumber: row.traverseNumber || "",
        traverseSpacing: row.traverseSpacing || "",
        traverseLength: row.traverseLength || "",
        clearanceTop: row.clearanceTop || `3"`,
        clearanceBottom: row.clearanceBottom || `3"`,
        clearanceSides: row.clearanceSides || `3"`,
        verticalSpacingAdjacent: row.verticalSpacingAdjacent || "",
      })));
    }
    if (data.savedGeneratedSchedule && Array.isArray(data.savedGeneratedSchedule.schedule)) {
      setSchedule(data.savedGeneratedSchedule.schedule);
      setSummary(Array.isArray(data.savedGeneratedSchedule.summary) ? data.savedGeneratedSchedule.summary : []);
      setMaterialTakeoff(data.savedGeneratedSchedule.materialTakeoff || null);
      setEngineValidationWarnings(data.savedGeneratedSchedule.validationWarnings || []);
      setSavedScheduleAt(data.savedGeneratedSchedule.generatedAtIso || "");
      setSelectedMark(data.savedGeneratedSchedule.schedule[0]?.mark || "");
      setSelectedPrefix(data.savedGeneratedSchedule.schedule[0]?.prefix || "");
      setReviewedPieceMarks(Array.isArray(data.savedGeneratedSchedule.reviewedPieceMarks) ? data.savedGeneratedSchedule.reviewedPieceMarks : []);
      setScheduleGenerationStatus(`Saved schedule loaded${data.savedGeneratedSchedule.generatedAtIso ? ` from ${new Date(data.savedGeneratedSchedule.generatedAtIso).toLocaleString()}` : ""}. Click Generate Rebar Schedule to recalculate.`);
    } else {
      setSchedule([]);
      setSummary([]);
      setMaterialTakeoff(null);
      setSavedScheduleAt("");
      setReviewedPieceMarks([]);
    }
    if (Array.isArray(data.cropRefs)) {
      setCropRefs(data.cropRefs
        .filter((crop) => crop && typeof crop.id === "string")
        .map((crop) => ({ ...crop, imageDataUrl: crop.imageDataUrl || crop.downloadUrl || "" })));
    }
  }

  async function loadWorkspace() {
    if (!workspaceDocId) return;
    setWorkspaceStatus("Loading workspace...");
    try {
      const snap = await getDoc(doc(db, "plannerWorkspaces", workspaceDocId));
      if (snap.exists()) {
        applyWorkspaceSnapshot(snap.data() as Partial<PlannerWorkspace>);
        setWorkspaceStatus("Workspace loaded from Firestore.");
      } else {
        setWorkspaceStatus("No saved workspace yet.");
      }
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Could not load workspace: ${error.message}` : "Could not load workspace.");
    } finally {
      setWorkspaceLoaded(true);
    }
  }


  function dataUrlToBlob(dataUrl: string): Blob {
    const [header, data] = dataUrl.split(",");
    const mime = header.match(/data:(.*?);base64/)?.[1] || "image/png";
    const binary = atob(data || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function safeFileName(name: string) {
    return (name || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  }

  async function uploadPlanAssets(projectId: string, snapshot: PlannerWorkspace): Promise<PlannerWorkspace> {
    let nextPlanStoragePath = snapshot.planStoragePath || planStoragePath;
    let nextPlanDownloadUrl = snapshot.planDownloadUrl || planDownloadUrl;

    if (planFile) {
      nextPlanStoragePath = `plannerProjects/${projectId}/source/${Date.now()}-${safeFileName(planFile.name)}`;
      const fileRef = storageRef(storage, nextPlanStoragePath);
      await uploadBytes(fileRef, planFile, { contentType: planFile.type || "application/pdf" });
      nextPlanDownloadUrl = await getDownloadURL(fileRef);
      setPlanStoragePath(nextPlanStoragePath);
      setPlanDownloadUrl(nextPlanDownloadUrl);
      setPlanPreviewUrl(nextPlanDownloadUrl);
    }

    const uploadedCrops: PlanCropRef[] = [];
    for (const crop of snapshot.cropRefs || []) {
      let storagePath = crop.storagePath || "";
      let downloadUrl = crop.downloadUrl || "";
      if ((!storagePath || !downloadUrl) && crop.imageDataUrl?.startsWith("data:")) {
        storagePath = `plannerProjects/${projectId}/crops/${crop.id}.png`;
        const cropRef = storageRef(storage, storagePath);
        await uploadBytes(cropRef, dataUrlToBlob(crop.imageDataUrl), { contentType: "image/png" });
        downloadUrl = await getDownloadURL(cropRef);
      }
      uploadedCrops.push({
        ...crop,
        storagePath,
        downloadUrl,
        imageDataUrl: downloadUrl || crop.imageDataUrl || "",
      });
    }
    setCropRefs(uploadedCrops);

    return {
      ...snapshot,
      planStoragePath: nextPlanStoragePath,
      planDownloadUrl: nextPlanDownloadUrl,
      cropRefs: uploadedCrops.map(({ imageDataUrl, ...crop }) => ({ ...crop, imageDataUrl: "" })),
    };
  }

  async function saveWorkspace() {
    if (!user || !workspaceDocId) {
      setWorkspaceStatus("Login required before saving.");
      return;
    }
    setWorkspaceStatus("Saving project files to Storage...");
    try {
      let projectId = currentProjectId || "";
      const cleanProjectName = projectName.trim();
      if (!cleanProjectName) {
        setWorkspaceStatus("Save failed: project name is required.");
        return;
      }
      const existingSnaps = await getDocs(query(collection(db, "plannerProjects"), orderBy("updatedAt", "desc")));
      const sameNameProject = existingSnaps.docs
        .map((projectSnap) => ({ id: projectSnap.id, ...(projectSnap.data() as Partial<PlannerWorkspace> & { ownerUid?: string }) }))
        .find((project) => project.ownerUid === user.uid && (project.projectName || "").trim().toLowerCase() === cleanProjectName.toLowerCase());

      if (!projectId && sameNameProject) {
        projectId = sameNameProject.id;
        setCurrentProjectId(projectId);
        setWorkspaceStatus(`Saving changes to existing project "${cleanProjectName}"...`);
      }

      if (!projectId) {
        projectId = `${user.uid}-${Date.now()}`;
      }

      if (sameNameProject && sameNameProject.id !== projectId) {
        setWorkspaceStatus(`Save blocked: another project already uses the name "${cleanProjectName}". Rename this project or delete the duplicate first.`);
        return;
      }
      const snapshot = await uploadPlanAssets(projectId, { ...getWorkspaceSnapshot(), projectName: cleanProjectName });
      const projectPayload = {
        ...snapshot,
        id: projectId,
        ownerUid: user.uid,
        ownerEmail: user.email || "",
        app: "rebar-planner",
        updatedAt: serverTimestamp(),
        ...(currentProjectId ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(doc(db, "plannerProjects", projectId), projectPayload, { merge: true });
      await setDoc(doc(db, "plannerWorkspaces", workspaceDocId), {
        ...snapshot,
        activeProjectId: projectId,
        ownerUid: user.uid,
        ownerEmail: user.email || "",
        app: "rebar-planner",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });

      setCurrentProjectId(projectId);
      setWorkspaceStatus("Project saved. PDF/crops are in Storage; metadata is in Firestore.");
      await loadSavedProjects(user.uid);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Save failed: ${error.message}` : "Save failed.");
    }
  }

  async function loadSavedProjects(ownerUid = user?.uid || "") {
    if (!ownerUid) return;
    try {
      const snaps = await getDocs(query(collection(db, "plannerProjects"), orderBy("updatedAt", "desc")));
      const rows = snaps.docs
        .map((projectSnap) => ({ id: projectSnap.id, ...(projectSnap.data() as Partial<PlannerWorkspace> & { ownerUid?: string; updatedAt?: { toDate?: () => Date } }) }))
        .filter((project) => project.ownerUid === ownerUid)
        .map((project) => ({
          id: project.id,
          projectName: project.projectName || "Untitled project",
          planFileName: project.planFileName || "No plan file saved",
          updatedAtLabel: project.updatedAt?.toDate ? project.updatedAt.toDate().toLocaleString() : "",
          cropCount: Array.isArray(project.cropRefs) ? project.cropRefs.length : 0,
          rowCount: Array.isArray(project.rebarInfoRows) ? project.rebarInfoRows.length : 0,
          projectStatus: (["Draft", "Review", "Ready for Shop", "Issued", "Archived"].includes(String(project.projectStatus || "")) ? project.projectStatus : (project.projectArchived ? "Archived" : "Draft")) as ProjectStatus,
          projectNotes: project.projectNotes || "",
          projectFavorite: Boolean(project.projectFavorite),
          projectArchived: Boolean(project.projectArchived || project.projectStatus === "Archived"),
        }))
        .filter((project) => showArchivedProjects || !project.projectArchived)
        .sort((a, b) => Number(b.projectFavorite) - Number(a.projectFavorite));
      setSavedProjects(rows);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Could not load project list: ${error.message}` : "Could not load project list.");
    }
  }


  async function deleteProject(projectId: string, name: string) {
    if (!user || !projectId) return;
    const ok = window.confirm(`Delete project "${name}"? This removes the Firestore project record. Storage files may remain as backup.`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "plannerProjects", projectId));
      if (currentProjectId === projectId) {
        startNewProject();
      }
      setWorkspaceStatus(`Project "${name}" deleted.`);
      await loadSavedProjects(user.uid);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Delete failed: ${error.message}` : "Delete failed.");
    }
  }



  function duplicateCurrentProject() {
    const baseName = (projectName || "Untitled project").trim();
    setCurrentProjectId("");
    setProjectName(`Copy of ${baseName}`);
    setProjectStatus("Draft");
    setProjectFavorite(false);
    setWorkspaceStatus("Duplicate created in the editor. Click Save Project to store it as a new project.");
  }


  function appendTemplateRows(template: "rectangle" | "pier" | "wall") {
    const makeRow = (itemType: RebarInfoType, segment: string, overrides: Partial<RebarInfoRow> = {}) => ({
      ...createRebarInfoRow(itemType, Math.max(rebarInfoRows.length + 1, 1)),
      id: crypto.randomUUID(),
      segment,
      rebarSize: itemType === "Pier" ? rebarGlobalParams.pierRebarSize : rebarGlobalParams.foundationRebarSize,
      ...overrides,
    });

    let rowsToAdd: RebarInfoRow[] = [];

    if (template === "rectangle") {
      rowsToAdd = [
        makeRow("Base/Bottom rebar", "SideWall Bottom", {
          length: "52'",
          number: "3",
          spacingBetween: `6"`,
          side1Bent: "Yes",
          side1TurnAngle: "90",
          side1BentLength: `24"`,
          side2Bent: "Yes",
          side2TurnAngle: "90",
          side2BentLength: `24"`,
          traverseNumber: "N/A",
          traverseSpacing: `12"`,
          traverseLength: `52"`,
          duplicateTimes: "2",
          note: "Template row: side-wall base/bottom mat. Times to duplicate = 2 means two similar long sides in a rectangle foundation. Adjust length, bar count, spacing, bends, and traverse bars before generating shop schedule.",
        }),
        makeRow("Base/Bottom rebar", "EndWall Bottom", {
          length: `13'4"`,
          number: "3",
          spacingBetween: `6"`,
          side1Bent: "Yes",
          side1TurnAngle: "90",
          side1BentLength: `24"`,
          side2Bent: "Yes",
          side2TurnAngle: "90",
          side2BentLength: `24"`,
          traverseNumber: "N/A",
          traverseSpacing: `12"`,
          traverseLength: `52"`,
          duplicateTimes: "2",
          note: "Template row: end-wall base/bottom mat. Times to duplicate = 2 means two similar short sides in a rectangle foundation. Inner bars shorten by bar spacing at bent ends/corners.",
        }),
        makeRow("Vertical Rebar", "Vertical L Bars", {
          count: "N/A",
          length: `30"`,
          calcLength: `130'8"`,
          verticalSpacingAdjacent: `18"`,
          verticalBent: "Yes",
          verticalBentLength: rebarGlobalParams.defaultVerticalToBase || `6"`,
          clearanceTop: `3"`,
          clearanceBottom: `3"`,
          duplicateTimes: "1",
          note: "Template row: vertical L bars. Count can stay N/A so the engine calculates quantity from total bottom run length and spacing. Cut length uses clear vertical height plus bent overlap.",
        }),
        makeRow("Pier", "Pier Cage", {
          diameter: `30"`,
          length: `30"`,
          horizontalCircleCount: "N/A",
          numVerticalBars: "6",
          spacing: `8"`,
          verticalBent: "Yes",
          verticalBentLength: rebarGlobalParams.defaultVerticalToBase || `6"`,
          clearanceTop: `3"`,
          clearanceBottom: `3"`,
          clearanceSides: `3"`,
          duplicateTimes: "1",
          note: "Template row: pier cage. H-circle cut = (pier diameter - 2 x side spacing) x pi + 2 in hoop overlap. H-circle count uses clear height = length - top spacing - bottom spacing, then circle spacing.",
        }),
      ];
    }

    if (template === "pier") {
      rowsToAdd = [
        makeRow("Pier", "Pier Cage", {
          diameter: `30"`,
          length: `30"`,
          horizontalCircleCount: "N/A",
          numVerticalBars: "6",
          spacing: `8"`,
          verticalBent: "Yes",
          verticalBentLength: rebarGlobalParams.defaultVerticalToBase || `6"`,
          clearanceTop: `3"`,
          clearanceBottom: `3"`,
          clearanceSides: `3"`,
          duplicateTimes: "1",
          note: "Pier template: set Number of piers, diameter, side spacing, top/bottom spacing, H-circle spacing, vertical bars count, and bent overlap before generating.",
        }),
      ];
    }

    if (template === "wall") {
      rowsToAdd = [
        makeRow("Horiz continues longtidues", "Stem Wall Horizontals", {
          length: "52'",
          number: "3",
          spacingBetween: `12"`,
          side1Bent: "Yes",
          side1TurnAngle: "90",
          side1BentLength: `24"`,
          side2Bent: "Yes",
          side2TurnAngle: "90",
          side2BentLength: `24"`,
          duplicateTimes: "2",
          note: "Wall template: horizontal continuous bars. Adjust length, levels/count, spacing, side duplication, and lap/bend lengths.",
        }),
        makeRow("Vertical Rebar", "Wall Vertical L Bars", {
          count: "N/A",
          length: `30"`,
          calcLength: "52'",
          verticalSpacingAdjacent: `18"`,
          verticalBent: "Yes",
          verticalBentLength: rebarGlobalParams.defaultVerticalToBase || `6"`,
          clearanceTop: `3"`,
          clearanceBottom: `3"`,
          duplicateTimes: "2",
          note: "Wall template: vertical L bars calculated from run length and spacing. Cut length uses clear wall height plus bent overlap.",
        }),
      ];
    }

    if (!rowsToAdd.length) return;
    setRebarInfoRows((current) => [...current, ...rowsToAdd]);
    setNewEmptyRowIds((ids) => [...ids, ...rowsToAdd.map((row) => row.id)]);
    setProjectStatus("Draft");
    setWorkspaceStatus(`Added ${rowsToAdd.length} ${template} template row${rowsToAdd.length === 1 ? "" : "s"}. Review dimensions before generating schedule.`);
    window.setTimeout(() => {
      document.getElementById("rebar-input")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function downloadProjectBackupJson() {
    const payload = {
      app: "rebar-planner",
      backupVersion: 1,
      exportedAtIso: new Date().toISOString(),
      projectName,
      projectStatus,
      projectNotes,
      projectFavorite,
      plan: {
        fileName: planFileName,
        fileType: planFileType,
        fileSize: planFileSize,
        storagePath: planStoragePath,
        downloadUrl: planDownloadUrl,
      },
      rebarGlobalParams,
      rebarInfoRows,
      cropRefs: cropRefs.map((crop) => ({ ...crop, imageDataUrl: crop.imageDataUrl?.startsWith("data:") ? "[embedded image omitted from JSON backup]" : crop.imageDataUrl })),
      savedGeneratedSchedule: schedule.length ? {
        generatedAtIso: savedScheduleAt || new Date().toISOString(),
        schedule,
        summary,
        materialTakeoff,
        reviewedPieceMarks,
        validationWarnings: engineValidationWarnings,
      } : null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(projectName || "rebar-project").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  }


  async function importProjectBackupJson(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<PlannerWorkspace> & {
        app?: string;
        plan?: {
          fileName?: string;
          fileType?: string;
          fileSize?: number;
          storagePath?: string;
          downloadUrl?: string;
        };
      };
      if (data.app !== "rebar-planner") {
        setWorkspaceStatus("Import failed: this JSON file is not a Rebar Planner backup.");
        return;
      }
      const workspaceData: Partial<PlannerWorkspace> = {
        ...data,
        projectName: data.projectName ? `${data.projectName} imported` : "Imported Rebar Project",
        planFileName: data.plan?.fileName || data.planFileName || "",
        planFileType: data.plan?.fileType || data.planFileType || "",
        planFileSize: data.plan?.fileSize || data.planFileSize || 0,
        planStoragePath: data.plan?.storagePath || data.planStoragePath || "",
        planDownloadUrl: data.plan?.downloadUrl || data.planDownloadUrl || "",
      };
      applyWorkspaceSnapshot(workspaceData);
      setCurrentProjectId("");
      setProjectStatus("Draft");
      setWorkspaceStatus("Backup imported as an unsaved draft. Review it, then Save Project to store it.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Import failed: ${error.message}` : "Import failed.");
    } finally {
      if (backupImportInputRef.current) backupImportInputRef.current.value = "";
    }
  }

  function downloadShopPackageHtml() {
    const esc = (value: unknown) => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    const safeProjectName = projectName || "Rebar Project";
    const scheduleRows = scheduleExportRows().map((row) => `
      <tr>${row.map((cell, index) => `<td class="${index <= 4 ? "key" : ""}">${esc(cell)}</td>`).join("")}</tr>`).join("");
    const summaryRows = materialSummaryRows().slice(1).map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join("");
    const warningRows = engineValidationWarnings.length
      ? engineValidationWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")
      : "<li>No validation warnings saved with the current schedule.</li>";
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(safeProjectName)} - Rebar Shop Package</title>
<style>
  body { font-family: Arial, sans-serif; color: #0f172a; margin: 28px; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  .muted { color: #64748b; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
  .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; background: #f8fafc; }
  .label { color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
  .value { font-size: 20px; font-weight: 900; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
  th { background: #1e3a8a; color: white; text-align: left; }
  th, td { border: 1px solid #94a3b8; padding: 7px; vertical-align: top; }
  td.key { background: #fef3c7; font-weight: 800; }
  .summary th { width: 260px; background: #e2e8f0; color: #0f172a; }
  .warnings { border: 1px solid #f59e0b; background: #fffbeb; padding: 12px 16px; border-radius: 12px; }
  @media print { body { margin: 14px; } .no-print { display: none; } }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()" style="float:right;padding:10px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#0f172a;color:white;font-weight:800;">Print</button>
<h1>${esc(safeProjectName)} - Rebar Shop Package</h1>
<div class="muted">Generated ${new Date().toLocaleString()} · PDF: ${esc(planFileName || "No PDF loaded")} · Status: ${esc(projectStatus)}</div>
<div class="grid">
  <div class="card"><div class="label">Sticks to buy</div><div class="value">${esc(materialTakeoff?.sticksToBuy ?? "")}</div></div>
  <div class="card"><div class="label">Total cut</div><div class="value">${esc(materialTakeoff?.totalCut || "")}</div></div>
  <div class="card"><div class="label">Waste</div><div class="value">${esc(materialTakeoff?.waste || "")}</div></div>
  <div class="card"><div class="label">Reviewed</div><div class="value">${esc(reviewedPieceMarks.length)}/${esc(schedule.length)}</div></div>
</div>
<h2>Material Summary</h2>
<table class="summary"><tbody>${summaryRows}</tbody></table>
<h2>Validation Warnings</h2>
<div class="warnings"><ul>${warningRows}</ul></div>
<h2>Cut List</h2>
<table>
<thead><tr>${exportHeader.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>
<tbody>${scheduleRows || `<tr><td colspan="${exportHeader.length}">No schedule generated yet.</td></tr>`}</tbody>
</table>
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(projectName || "rebar-project").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}-shop-package.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function archiveCurrentProject() {
    if (!user || !currentProjectId) {
      setWorkspaceStatus("Load or save a project before archiving.");
      return;
    }
    const ok = window.confirm(`Archive project "${projectName}"? It will be hidden from the normal project list unless archived projects are shown.`);
    if (!ok) return;
    try {
      await setDoc(doc(db, "plannerProjects", currentProjectId), {
        projectStatus: "Archived",
        projectArchived: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setProjectStatus("Archived");
      setWorkspaceStatus(`Project "${projectName}" archived.`);
      await loadSavedProjects(user.uid);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Archive failed: ${error.message}` : "Archive failed.");
    }
  }

  async function restoreProjectFromArchive(projectId: string) {
    if (!user || !projectId) return;
    try {
      await setDoc(doc(db, "plannerProjects", projectId), {
        projectStatus: "Draft",
        projectArchived: false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setWorkspaceStatus("Project restored to Draft.");
      await loadSavedProjects(user.uid);
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Restore failed: ${error.message}` : "Restore failed.");
    }
  }

  async function restorePlanFileFromStorage(data: Partial<PlannerWorkspace>) {
    if (!data.planDownloadUrl) return;
    try {
      const response = await fetch(data.planDownloadUrl);
      if (!response.ok) return;
      const blob = await response.blob();
      const fileName = data.planFileName || "stored-plan.pdf";
      const fileType = data.planFileType || blob.type || "application/pdf";
      const restoredFile = new File([blob], fileName, { type: fileType });
      setPlanFile(restoredFile);
      setPlanFileSize(data.planFileSize || blob.size);
      setPlanFileType(fileType);
      setPlanFileName(fileName);
      setPlanPreviewUrl(data.planDownloadUrl);
    } catch {
      // Preview can still use the download URL even if the File object cannot be rebuilt.
      setPlanPreviewUrl(data.planDownloadUrl);
    }
  }

  async function loadProject(projectId: string) {
    if (!projectId) return;
    setWorkspaceStatus("Loading project...");
    try {
      const snap = await getDoc(doc(db, "plannerProjects", projectId));
      if (!snap.exists()) {
        setWorkspaceStatus("Project not found.");
        return;
      }
      const data = snap.data() as Partial<PlannerWorkspace>;
      applyWorkspaceSnapshot(data);
      await restorePlanFileFromStorage(data);
      setCurrentProjectId(projectId);
      setWorkspaceStatus("Project loaded from Firestore/Storage. You can edit and re-run extraction.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Could not load project: ${error.message}` : "Could not load project.");
    }
  }

  function startNewProject() {
    setCurrentProjectId("");
    setProjectName("ADU Foundation");
    setProjectStatus("Draft");
    setProjectNotes("");
    setProjectFavorite(false);
    setPlanFileName("");
    setPlanFileType("");
    setPlanFileSize(0);
    setPlanStoragePath("");
    setPlanDownloadUrl("");
    setPlanFile(null);
    if (planPreviewUrl) URL.revokeObjectURL(planPreviewUrl);
    setPlanPreviewUrl("");
    setCropRefs([]);
    setRebarInfoRows([createRebarInfoRow("Base/Bottom rebar", 1)]);
    setFields(initialFields);
    setFieldSources(getInitialFieldSources());
    setSchedule([]);
    setSummary([]);
    setMaterialTakeoff(null);
    setSavedScheduleAt("");
    setWorkspaceStatus("New project started. Save when ready.");
  }

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/auth");
      return;
    }
    const currentUser = user;
    let cancelled = false;
    async function loadUserRole() {
      const snap = await getDoc(doc(db, "users", currentUser.uid));
      const role = String(snap.data()?.role || "user").toLowerCase();
      if (!cancelled) setAuthRole(currentUser.email?.toLowerCase() === "vdumpa972@gmail.com" ? "owner" : role);
    }
    loadUserRole().catch(() => setAuthRole("user"));
    if (!workspaceLoaded) loadWorkspace();
    loadSavedProjects(currentUser.uid);
    return () => { cancelled = true; };
  }, [loading, router, user, workspaceLoaded, showArchivedProjects]);

  useEffect(() => {
    if (!isOwner && plannerView === "advanced") {
      setPlannerView("simple");
    }
  }, [isOwner, plannerView]);

  const fileSizeLabel = useMemo(() => {
    if (!planFileSize) return "";
    const mb = planFileSize / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
  }, [planFileSize]);

  const filteredSchedule = useMemo(() => {
    const query = scheduleSearch.trim().toLowerCase();
    return schedule.filter((line) => {
      if (filter !== "ALL" && line.prefix !== filter) return false;
      if (scheduleTypeFilter !== "all" && getScheduleCategory(line) !== scheduleTypeFilter) return false;
      if (!query) return true;
      return [
        line.mark,
        line.prefix,
        line.location,
        line.cutLength,
        line.usedLength,
        line.requiredLength,
        line.leftFunction,
        line.rightFunction,
        line.fieldOrder,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [filter, schedule, scheduleSearch, scheduleTypeFilter]);

  const selectedLine = schedule.find((line) => line.mark === selectedMark);
  const selectedGroupLines = selectedPrefix
    ? schedule.filter((line) => line.prefix === selectedPrefix)
    : selectedLine
      ? schedule.filter((line) => line.prefix === selectedLine.prefix)
      : [];
  const filterOptions = Array.from(
    new Set(schedule.map((line) => line.prefix)),
  );

  function getScheduleCategory(line: ScheduleLine): "bottom" | "horizontal" | "vertical" | "pier" {
    const text = `${line.mark} ${line.prefix} ${line.location} ${line.fieldOrder}`.toUpperCase();
    if (text.includes("PIER") || text.includes("HOOP") || text.includes("HCIRC") || text.includes("CIRCLE")) return "pier";
    if (text.includes("VERT") || text.includes("V-S") || text.includes("V-E") || text.includes("L BAR")) return "vertical";
    if (text.includes("BASE") || text.includes("BOTTOM") || text.includes("TRAVERSE") || text.includes("FOOTING")) return "bottom";
    return "horizontal";
  }

  function getScheduleCategoryLabel(category: string) {
    if (category === "bottom") return "Bottom";
    if (category === "horizontal") return "Horizontal";
    if (category === "vertical") return "Vertical";
    if (category === "pier") return "Pier";
    return "All";
  }

  function getScheduleRebarSizeLabel(line: ScheduleLine): string {
    const text = `${line.mark} ${line.prefix} ${line.location} ${line.fieldOrder}`;
    const match = text.match(/#\s*(\d{1,2})/);
    return match ? `#${match[1]}` : "UNSPEC";
  }


  function getScheduleCategoryRowClass(line: ScheduleLine) {
    const category = getScheduleCategory(line);
    if (category === "bottom") return "border-l-4 border-l-blue-500 bg-blue-50/40";
    if (category === "horizontal") return "border-l-4 border-l-emerald-500 bg-emerald-50/40";
    if (category === "vertical") return "border-l-4 border-l-orange-500 bg-orange-50/40";
    return "border-l-4 border-l-purple-500 bg-purple-50/40";
  }

  function applyDiagramScheduleFilter(type: RebarInfoType) {
    setActiveDiagramType(type);
    if (type === "Base/Bottom rebar") setScheduleTypeFilter("bottom");
    else if (type === "Horiz continues longtidues") setScheduleTypeFilter("horizontal");
    else if (type === "Vertical Rebar") setScheduleTypeFilter("vertical");
    else if (type === "Pier") setScheduleTypeFilter("pier");
    const scheduleSection = document.getElementById("schedule-output");
    if (scheduleSection) scheduleSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }


  function getScheduleGroupTitle(line: ScheduleLine) {
    const text = `${line.prefix} ${line.location}`.toUpperCase();
    if (text.startsWith("SW_") || text.includes("SIDE-WALL") || text.includes("SIDE WALL")) {
      return "Side Wall Rebar";
    }
    if (text.startsWith("EW_") || text.includes("END-WALL") || text.includes("END WALL")) {
      return "End Wall Rebar";
    }
    if (text.startsWith("PR_") || text.startsWith("PIER_") || text.includes("PIER")) {
      return "Pier Rebar";
    }
    if (text.startsWith("FOOTING") || text.includes("FOOTING")) {
      return "Footing Tie Bars";
    }
    return "Other Rebar";
  }

  const groupedFilteredSchedule = useMemo(() => {
    return filteredSchedule.length
      ? [{ title: "All Rebar Pieces", lines: filteredSchedule }]
      : [];
  }, [filteredSchedule]);

  const fabricationBatchList = useMemo(() => {
    const batches = new Map<string, {
      key: string;
      size: string;
      qty: number;
      cutLength: string;
      leftFunction: string;
      usedLength: string;
      rightFunction: string;
      sampleMark: string;
      sampleLocation: string;
      sampleLine: ScheduleLine;
    }>();

    for (const line of filteredSchedule) {
      const size = getScheduleRebarSizeLabel(line);
      const key = [size, line.cutLength, line.leftFunction, line.usedLength, line.rightFunction].join("__");
      const existing = batches.get(key);
      if (existing) {
        existing.qty += line.qty;
        continue;
      }
      batches.set(key, {
        key,
        size,
        qty: line.qty,
        cutLength: line.cutLength,
        leftFunction: line.leftFunction,
        usedLength: line.usedLength,
        rightFunction: line.rightFunction,
        sampleMark: line.mark,
        sampleLocation: line.location,
        sampleLine: line,
      });
    }

    return Array.from(batches.values()).sort((a, b) => {
      const sizeCompare = a.size.localeCompare(b.size);
      if (sizeCompare) return sizeCompare;
      return parseFeet(b.cutLength) - parseFeet(a.cutLength);
    });
  }, [filteredSchedule]);

  const visibleReviewedCount = filteredSchedule.filter((line) => reviewedPieceMarks.includes(line.mark)).length;
  const scheduleReviewPercent = schedule.length ? Math.round((schedule.filter((line) => reviewedPieceMarks.includes(line.mark)).length / schedule.length) * 100) : 0;

  function markVisiblePiecesReviewed() {
    const visibleMarks = filteredSchedule.map((line) => line.mark);
    setReviewedPieceMarks((current) => Array.from(new Set([...current, ...visibleMarks])));
  }

  function clearVisiblePieceReviews() {
    const visibleMarks = new Set(filteredSchedule.map((line) => line.mark));
    setReviewedPieceMarks((current) => current.filter((mark) => !visibleMarks.has(mark)));
  }

  async function saveCurrentScheduleReviewMarks() {
    if (!schedule.length || !materialTakeoff) {
      setScheduleGenerationStatus("Generate a schedule before saving review marks.");
      return;
    }
    const generatedAtIso = savedScheduleAt || new Date().toISOString();
    await saveGeneratedScheduleOnly({
      generatedAtIso,
      sourceLabel: "current generated schedule",
      schedule,
      summary,
      materialTakeoff,
      reviewedPieceMarks,
    });
    setSavedScheduleAt(generatedAtIso);
    setScheduleGenerationStatus(`Review marks saved with latest generated schedule: ${reviewedPieceMarks.length}/${schedule.length} reviewed.`);
  }

  useEffect(() => {
    function closeCropDropdownOnOutsideClick(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-crop-dropdown]")) return;
      setOpenCropDropdownRowId("");
    }

    document.addEventListener("pointerdown", closeCropDropdownOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeCropDropdownOnOutsideClick);
  }, []);

  if (loading || !user) {
    return <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-4 text-slate-900 md:p-6">Loading Rebar Planner...</main>;
  }

  function getFieldValue(key: string) {
    return fields.find((field) => field.key === key)?.value || "";
  }

  function markAllMissing(reason: string): Record<string, FieldSource> {
    return Object.fromEntries(
      initialFields.map((field) => [
        field.key,
        { kind: "missing" as FieldSourceKind, reason },
      ]),
    );
  }

  function updateField(key: string, value: string) {
    const changed = fields.map((field) =>
      field.key === key ? { ...field, value } : field,
    );
    const withDerived = applyDerivedFieldValues(changed);
    setFields(withDerived);

    setFieldSources((current) =>
      applyDerivedFieldSources(
        {
          ...current,
          [key]: value.trim()
            ? { kind: "manual", reason: "Changed by user on screen." }
            : { kind: "blank" },
        },
        withDerived,
      ),
    );
  }




  function cropDisplayName(crop: PlanCropRef) {
    const label = crop.label?.trim();
    const base = label || `${crop.elementType} crop`;
    return `${base} - page ${crop.pageNumber}`;
  }

  function cropImageUrl(crop: PlanCropRef) {
    return crop.imageDataUrl || crop.downloadUrl || "";
  }

  function selectedCropSummary(row: RebarInfoRow) {
    const selectedIds = row.cropImages?.length ? row.cropImages : (row.cropImage ? [row.cropImage] : []);
    if (!selectedIds.length) return "No crops selected";
    const names = selectedIds
      .map((id) => cropRefs.find((crop) => crop.id === id))
      .filter((crop): crop is PlanCropRef => Boolean(crop))
      .map((crop) => cropDisplayName(crop));
    if (!names.length) return `${selectedIds.length} crop${selectedIds.length === 1 ? "" : "s"} selected`;
    if (names.length <= 2) return names.join(", ");
    return `${names[0]}, ${names[1]} + ${names.length - 2} more`;
  }

  function rebarInfoGuideline(row: RebarInfoRow) {
    if (row.itemType === "Base/Bottom rebar") {
      return "Base/bottom mat rule: this row describes one side/configuration of the foundation. Times to duplicate this means how many sides use this same configuration, for instance two sides like this in a rectangle foundation. Calculate each longitudinal bar by its position in the mat. The outer bar uses the full entered part length. Each inner bar is shortened by the space between longitudinal bars at every bent end/corner, so the bend lands in the correct place. Traverse bars are also scheduled from this row; if traverse Number is N/A, the app estimates quantity from the longitudinal length and traverse spacing. When a run is longer than the stock stick length, split it into multiple sticks and add the required overlap/lap splice.";
    }
    if (row.itemType === "Horiz continues longtidues") {
      return "Horizontal continuous bars: use the entered length, count, spacing, end bends, stock stick length, and required overlap/lap splice when splitting long runs.";
    }
    if (row.itemType === "Vertical Rebar") {
      return "Vertical/L bars: enter Count manually, or enter N/A and the app calculates quantity from Calculate len / total run divided by spacing + 1. If Calculate len is blank, the app uses total base/bottom run length, for example 52' x 2 + 13'-4\" x 2. Enter Bar straight len for the straight vertical part, and Start end / Finish end bend lengths for the L bend legs.";
    }
    if (row.itemType === "Pier") {
      return "Pier bars: Number of piers multiplies the whole pier cage. H-circle/hoop diameter = pier diameter minus side clearance on both sides. H-circle count can be entered, or set to N/A so the app calculates from clear vertical height: pier length minus top clearance minus bottom clearance, divided by H-circle spacing + 1. Pier vertical L bar straight length = pier length minus top/bottom clearance, then add the vertical bent length when Vertical bent is Yes.";
    }
    return "Misc row: use the entered quantity, length, rebar size, and note for special field instructions.";
  }

  const pdfViewerUrl = planPreviewUrl ? `${planPreviewUrl}${planPreviewUrl.includes("#") ? "&" : "#"}zoom=${pdfZoom}` : "";

  function saveSelectedCrop() {
    const sourceCanvas = regionCanvasRef.current;
    const baseImage = regionBaseImageRef.current;
    if (!sourceCanvas || !baseImage || !regionRect || regionRect.width < 5 || regionRect.height < 5) {
      setRegionStatus("Render a PDF page and drag a crop rectangle first.");
      return;
    }

    const sx = Math.max(0, Math.floor(regionRect.x));
    const sy = Math.max(0, Math.floor(regionRect.y));
    const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.floor(regionRect.width)));
    const sh = Math.max(1, Math.min(sourceCanvas.height - sy, Math.floor(regionRect.height)));

    const cleanCanvas = document.createElement("canvas");
    cleanCanvas.width = sourceCanvas.width;
    cleanCanvas.height = sourceCanvas.height;
    const cleanCtx = cleanCanvas.getContext("2d");
    if (!cleanCtx) {
      setRegionStatus("Could not create crop canvas.");
      return;
    }
    cleanCtx.putImageData(baseImage, 0, 0);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) {
      setRegionStatus("Could not create crop canvas.");
      return;
    }
    cropCtx.drawImage(cleanCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const id = crypto.randomUUID();
    const label = cropLabel.trim() || `${cropElementType} crop`;
    const newCrop: PlanCropRef = {
      id,
      label,
      elementType: cropElementType,
      pageNumber: Math.max(1, Number(regionPageNumber) || 1),
      note: cropNote,
      imageDataUrl: cropCanvas.toDataURL("image/png"),
      createdAtIso: new Date().toISOString(),
    };
    setCropRefs((current) => [newCrop, ...current]);
    setCropLabel(`${cropElementType} crop`);
    setCropNote("");
    setRegionStatus(`Saved crop evidence: ${label}. You can select it in Rebar Parameters rows.`);
  }

  function deleteCrop(id: string) {
    setCropRefs((current) => current.filter((crop) => crop.id !== id));
    setRebarInfoRows((current) => current.map((row) => ({ ...row, cropImage: row.cropImage === id ? "" : row.cropImage, cropImages: (row.cropImages || []).filter((cropId) => cropId !== id) })));
  }

  function updateRebarGlobalParam(key: keyof RebarGlobalParams, value: string) {
    setRebarGlobalParams((current) => ({ ...current, [key]: value }));
    if (key === "stickLength") {
      setStickLength(value.replace(/[^0-9.]/g, "") || "20");
    }
    if (key === "defaultOverlap") {
      setHorizontalLap(value.replace(/[^0-9.]/g, "") || "24");
    }
    if (key === "defaultVerticalToBase") {
      setVerticalBentLap(value.replace(/[^0-9.]/g, "") || "6");
    }
  }

  function updateFoundationRebarConfig(key: keyof FoundationRebarConfig, value: string) {
    setFoundationRebarConfig((current) => ({ ...current, [key]: value }));
  }

  function addRebarInfo(place: "top" | "bottom" = "bottom") {
    setRebarInfoRows((current) => {
      const row = createRebarInfoRow("Base/Bottom rebar", current.length + 1);
      setNewEmptyRowIds((ids) => ids.includes(row.id) ? ids : [...ids, row.id]);
      return place === "top" ? [row, ...current] : [...current, row];
    });
  }

  function updateRebarInfoRow(id: string, key: keyof RebarInfoRow, value: string) {
    setNewEmptyRowIds((ids) => ids.filter((rowId) => rowId !== id));
    setLengthUnitErrorFields((keys) => keys.filter((errorKey) => errorKey !== rowFieldErrorKey(id, key)));
    setRebarInfoRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function toggleRowCrop(rowId: string, cropId: string) {
    setRebarInfoRows((current) => current.map((row) => {
      if (row.id !== rowId) return row;
      const cropImages = row.cropImages || [];
      const nextCropImages = cropImages.includes(cropId)
        ? cropImages.filter((id) => id !== cropId)
        : [...cropImages, cropId];
      return { ...row, cropImages: nextCropImages, cropImage: nextCropImages[0] || "" };
    }));
  }

  function changeRebarInfoType(id: string, itemType: RebarInfoType) {
    setRebarInfoRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const defaults = createRebarInfoRow(itemType, current.filter((item) => item.id !== id && item.itemType === itemType).length + 1);
      return {
        ...row,
        itemType,
        segment: nextRebarSegment(current.filter((item) => item.id !== id), itemType),
        number: row.number || defaults.number,
        spacingBetween: row.spacingBetween || defaults.spacingBetween,
        spacing: row.spacing || defaults.spacing,
        traverseNumber: row.traverseNumber || defaults.traverseNumber,
        clearanceTop: row.clearanceTop || defaults.clearanceTop,
        clearanceBottom: row.clearanceBottom || defaults.clearanceBottom,
        clearanceSides: row.clearanceSides || defaults.clearanceSides,
        rebarSize: row.rebarSize || (itemType === "Pier" ? rebarGlobalParams.pierRebarSize : rebarGlobalParams.foundationRebarSize),
        duplicateTimes: row.duplicateTimes || defaults.duplicateTimes,
        count: row.count || defaults.count,
      };
    }));
  }

  function removeRebarInfoRow(id: string) {
    setRebarInfoRows((current) => current.length <= 1 ? current : current.filter((row) => row.id !== id));
  }

  function handlePlanUpload(file: File | undefined) {
    if (!file) return;

    if (planPreviewUrl) {
      URL.revokeObjectURL(planPreviewUrl);
    }

    setPlanFileName(file.name);
    setPlanFileType(file.type || "unknown");
    setPlanFileSize(file.size);
    setPlanStoragePath("");
    setPlanDownloadUrl("");
    setPlanFile(file);
    setPlanPreviewUrl(URL.createObjectURL(file));
    setExtractionStatus("");
    setExtractionNotes([]);
    setExtractedTextPreview("");
    setRecognitionReport(null);
    setVisualAnalysis(null);
    setVisualAnalysisStatus("");
    setUseExternalVisualAnalyzer(false);
    setShowDebugInfo(false);
    setFields(initialFields);
    setFields(initialFields);
    setFieldSources(getInitialFieldSources());
    setPierMode("unknown");
    setPierMessage("");
    setRegionRect(null);
    setRegionAnalysis(null);
    setRegionStatus("");
    setCropRefs([]);
  }

  function clearPlan() {
    if (planPreviewUrl) {
      URL.revokeObjectURL(planPreviewUrl);
    }

    setPlanFileName("");
    setPlanFileType("");
    setPlanFileSize(0);
    setPlanStoragePath("");
    setPlanDownloadUrl("");
    setPlanPreviewUrl("");
    setPlanFile(null);
    setExtractionStatus("");
    setExtractionNotes([]);
    setExtractedTextPreview("");
    setRecognitionReport(null);
    setVisualAnalysis(null);
    setVisualAnalysisStatus("");
    setUseExternalVisualAnalyzer(false);
    setShowDebugInfo(false);
    setFieldSources(getInitialFieldSources());
    setPierMode("unknown");
    setPierMessage("");
    setRegionRect(null);
    setRegionAnalysis(null);
    setRegionStatus("");
    setCropRefs([]);
  }

  function buildDetectedFields(values: DetectedValue[]) {
    const applied = fields.map((field) => {
      const detected = values.find((value) => value.key === field.key);
      if (detected) return { ...field, value: detected.value };
      return extractionMode === "live" ? { ...field, value: "" } : field;
    });
    return applyDerivedFieldValues(applied);
  }

  function fieldValueFromList(list: ExtractedField[], key: string) {
    return list.find((field) => field.key === key)?.value || "";
  }

  function buildCalculatedRebarRowsFromFields(list: ExtractedField[]) {
    const clonedRows = rebarInfoRows.map((row) => ({ ...row, cropImages: [...(row.cropImages || [])] }));
    const pierCountValue = fieldValueFromList(list, "pierCount");
    const pierDiameterValue = fieldValueFromList(list, "pierDiameter");
    const pierHeightValue = fieldValueFromList(list, "pierHeight");
    const sideWallLengthValue = fieldValueFromList(list, "sideWallLength");
    const endWallLengthValue = fieldValueFromList(list, "endWallLength");

    let nextRows = clonedRows.map((row) => {
      if (row.itemType === "Pier") {
        return {
          ...row,
          count: pierCountValue || row.count,
          diameter: pierDiameterValue || row.diameter,
          length: pierHeightValue || row.length,
          rebarSize: row.rebarSize || rebarGlobalParams.pierRebarSize,
        };
      }
      if (row.itemType === "Base/Bottom rebar" && !row.length) {
        return { ...row, length: sideWallLengthValue || endWallLengthValue || row.length };
      }
      return row;
    });

    if (!nextRows.some((row) => row.itemType === "Pier") && (pierCountValue || pierDiameterValue || pierHeightValue)) {
      nextRows = [
        ...nextRows,
        {
          ...createRebarInfoRow("Pier", nextRows.length + 1),
          count: pierCountValue,
          diameter: pierDiameterValue,
          length: pierHeightValue,
          rebarSize: rebarGlobalParams.pierRebarSize,
        },
      ];
    }

    return nextRows;
  }


  function firstRegex(text: string, patterns: RegExp[]) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return "";
  }

  function normalizeRebarSize(raw: string | undefined, fallback = "") {
    const match = (raw || "").match(/#\s*(\d{1,2})(?!\d)/i);
    if (!match) return fallback;
    const size = Number(match[1]);
    // Real US rebar sizes in this app should be small values like #3, #4, #5, etc.
    // Do not accept PDF/page/detail tags like #246 as a rebar size.
    if (!Number.isFinite(size) || size < 2 || size > 18) return fallback;
    return `#${size}`;
  }

  function firstRebarSize(text: string, fallback = "") {
    const pattern = /#\s*(\d{1,3})/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const normalized = normalizeRebarSize(match[0]);
      if (normalized) return normalized;
    }
    return fallback;
  }

  function firstContextRebarSize(text: string, patterns: RegExp[], fallback = "") {
    for (const pattern of patterns) {
      const raw = firstRegex(text, [pattern]);
      const normalized = normalizeRebarSize(raw);
      if (normalized) return normalized;
    }
    return fallback;
  }

  function buildCalculatedGlobalsFromPlanText(text: string, detectedList: ExtractedField[]) {
    const lowerText = text.toLowerCase();
    return {
      stickLength: rebarGlobalParams.stickLength,
      defaultOverlap: firstRegex(lowerText, [/(?:lap|overlap)\D{0,20}(\d+(?:\.\d+)?\s*(?:in|inch|"))/i]) || rebarGlobalParams.defaultOverlap,
      defaultVerticalToBase: rebarGlobalParams.defaultVerticalToBase,
      foundationRebarSize: firstRebarSize(lowerText, rebarGlobalParams.foundationRebarSize),
      pierRebarSize: firstContextRebarSize(lowerText, [/(?:pier|caisson|drilled pier)[\s\S]{0,120}(#\s*\d{1,3})/i], firstRebarSize(lowerText, rebarGlobalParams.pierRebarSize)),
    };
  }

  function buildCalculatedRebarRowsFromPlanText(text: string, detectedList: ExtractedField[]) {
    const lowerText = text.toLowerCase();
    const detectedValue = (key: string) => fieldValueFromList(detectedList, key);
    const sideWallLengthValue = detectedValue("sideWallLength");
    const endWallLengthValue = detectedValue("endWallLength");
    const pierCountValue = detectedValue("pierCount") || firstRegex(lowerText, [/(\d+)\s*(?:total\s*)?(?:piers|pier\s+locations|caissons)/i]);
    const pierDiameterValue = detectedValue("pierDiameter") || firstRegex(lowerText, [/(\d+(?:\.\d+)?\s*(?:in|inch|"|dia|diameter))\s*(?:diameter|dia|ø)?\s*(?:pier|caisson)/i, /(?:pier|caisson)[\s\S]{0,80}(\d+(?:\.\d+)?\s*(?:in|inch|")\s*(?:dia|diameter|ø))/i]);
    const pierHeightValue = detectedValue("pierHeight") || firstRegex(lowerText, [/(?:pier|caisson)[\s\S]{0,120}(\d+(?:\.\d+)?\s*(?:in|inch|"|ft|'))\s*(?:deep|height|long)/i]);
    const pierVertCount = firstRegex(lowerText, [/(\d+)\s*-?\s*#\s*\d+\s*(?:vert|vertical)/i, /(?:vert|vertical)[\s\S]{0,40}(\d+)\s*-?\s*#\s*\d+/i]);
    const circleCount = firstRegex(lowerText, [/(\d+)\s*(?:ties|stirrups|hoops|circles)/i]);
    const circleSpacing = firstRegex(lowerText, [/(?:ties|stirrups|hoops|circles)[\s\S]{0,40}@\s*(\d+(?:\.\d+)?\s*(?:in|inch|"|oc|o\.c\.))/i, /@\s*(\d+(?:\.\d+)?\s*(?:in|inch|"))\s*(?:o\.c\.|oc)/i]);

    return rebarInfoRows.map((manualRow, index) => {
      const row = { ...manualRow, cropImages: [...(manualRow.cropImages || [])] };
      const segmentText = `${row.segment} ${row.itemType}`.toLowerCase();
      if (row.itemType === "Pier") {
        return {
          ...row,
          rebarSize: firstContextRebarSize(lowerText, [/(?:pier|caisson)[\s\S]{0,120}(#\s*\d{1,3})/i]),
          count: pierCountValue,
          diameter: pierDiameterValue,
          length: pierHeightValue,
          numVerticalBars: pierVertCount,
          horizontalCircleCount: circleCount,
          spacing: circleSpacing,
        };
      }
      if (row.itemType === "Base/Bottom rebar") {
        return {
          ...row,
          rebarSize: firstRebarSize(lowerText),
          length: segmentText.includes("end") ? endWallLengthValue : (segmentText.includes("side") ? sideWallLengthValue : (sideWallLengthValue || endWallLengthValue)),
        };
      }
      if (row.itemType === "Horiz continues longtidues") {
        return {
          ...row,
          rebarSize: firstRebarSize(lowerText),
          length: segmentText.includes("end") ? endWallLengthValue : (sideWallLengthValue || endWallLengthValue),
          spacingBetween: firstRegex(lowerText, [/(?:horizontal|longitudinal|cont)[\s\S]{0,80}@\s*(\d+(?:\.\d+)?\s*(?:in|inch|"|oc|o\.c\.))/i]),
        };
      }
      if (row.itemType === "Vertical Rebar") {
        return {
          ...row,
          rebarSize: firstContextRebarSize(lowerText, [/(?:vert|vertical)[\s\S]{0,80}(#\s*\d{1,3})/i], firstRebarSize(lowerText)),
          verticalSpacingAdjacent: firstRegex(lowerText, [/(?:vert|vertical)[\s\S]{0,80}@\s*(\d+(?:\.\d+)?\s*(?:in|inch|"|oc|o\.c\.))/i]),
          count: firstRegex(lowerText, [/(\d+)\s*-?\s*#\s*\d+\s*(?:vert|vertical)/i]) || row.count,
        };
      }
      return row;
    });
  }

  function normalizeCompareValue(value: string | undefined) {
    return (value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function compareStatus(manualValue: string | undefined, calculatedValue: string | undefined) {
    const manual = normalizeCompareValue(manualValue);
    const calculated = normalizeCompareValue(calculatedValue);
    if (!manual && !calculated) return { text: "Both blank", className: "bg-gray-100 text-gray-700" };
    if (!calculated) return { text: "Missing from PDF", className: "bg-yellow-100 text-yellow-800" };
    if (!manual) return { text: "New from PDF", className: "bg-blue-100 text-blue-800" };
    if (manual === calculated) return { text: "Same", className: "bg-green-100 text-green-800" };
    return { text: "Different", className: "bg-red-100 text-red-800" };
  }

  function getCalculatedFieldValue(key: string) {
    return calculatedFields.find((field) => field.key === key)?.value || "";
  }

  function getCompareBadge(manualValue: string | undefined, calculatedValue: string | undefined) {
    const status = compareStatus(manualValue, calculatedValue);
    return (
      <span className={`ml-2 inline-flex rounded px-2 py-0.5 text-xs font-bold ${status.className}`}>
        {status.text}
      </span>
    );
  }

  function getCalculatedGlobalValue(key: keyof RebarGlobalParams) {
    return calculatedGlobals?.[key] || "";
  }

  function getCalculatedRowValue(rowIndex: number, key: keyof RebarInfoRow) {
    return String(calculatedRows[rowIndex]?.[key] || "");
  }

  function applyDetectedValues(values: DetectedValue[]) {
    const withDerived = buildDetectedFields(values);
    setFields(withDerived);

    setFieldSources(() => {
      const next: Record<string, FieldSource> = {};
      for (const field of initialFields) {
        next[field.key] =
          extractionMode === "live"
            ? {
                kind: "missing",
                reason:
                  "Live Mode did not find this value. Enter it manually, select a region, or enable the external visual analyzer.",
              }
            : { kind: "blank" };
      }
      for (const item of values) {
        next[item.key] = {
          kind: item.sourceKind,
          confidence: item.confidence,
          reason: item.reason,
        };
      }
      return applyDerivedFieldSources(next, withDerived);
    });
  }

  function confidenceFromNumber(value?: number): FieldSource["confidence"] {
    if (value === undefined) return "low";
    if (value >= 0.75) return "high";
    if (value >= 0.5) return "medium";
    return "low";
  }

  function applyVisualDetectedFields(analysis: VisualPlanAnalysis) {
    const visualFields = analysis.extractedFields || [];
    if (visualFields.length === 0) return;
    setFields((current) =>
      current.map((field) => {
        const detected = visualFields.find((value) => value.key === field.key);
        return detected ? { ...field, value: detected.value } : field;
      }),
    );
    setFieldSources((current) => {
      const next = { ...current };
      for (const item of visualFields) {
        if (!item.value?.trim()) continue;
        next[item.key] = {
          kind: item.source === "pdf-image" ? "pdf-image" : "pdf-text",
          confidence: confidenceFromNumber(item.confidence),
          reason: `${item.page ? `Page ${item.page}. ` : ""}${item.evidence || "Detected by PDF text + image analyzer."}${item.confidence !== undefined ? ` Confidence ${(item.confidence * 100).toFixed(0)}%.` : ""}`,
        };
      }
      return next;
    });
  }

  async function runSpatialPlanAnalysis(file: File) {
    setVisualAnalysisStatus("Running PDF text + image analyzer...");
    const formData = new FormData();
    formData.append("blueprint", file);

    const directAnalyzerUrl = process.env.NEXT_PUBLIC_ANALYZER_URL?.replace(/\/$/, "");
    const analyzeUrl = directAnalyzerUrl ? `${directAnalyzerUrl}/analyze` : "/api/analyze-plan";

    let response: Response;
    try {
      response = await fetch(analyzeUrl, { method: "POST", body: formData });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: VisualPlanAnalysis = {
        success: false,
        error: `Could not reach analyzer at ${analyzeUrl}: ${message}`,
      };
      setVisualAnalysis(failed);
      setVisualAnalysisStatus(`Visual analyzer failed: ${failed.error}`);
      return failed;
    }

    const rawText = await response.text();
    let analysis: VisualPlanAnalysis;
    try {
      analysis = JSON.parse(rawText) as VisualPlanAnalysis;
    } catch {
      analysis = {
        success: false,
        error: `Analyzer returned non-JSON response. HTTP ${response.status}. ${rawText.slice(0, 300)}`,
      };
    }

    setVisualAnalysis(analysis);
    if (!response.ok || !analysis.success) {
      setVisualAnalysisStatus(`Visual analyzer failed: ${analysis.error || response.statusText}`);
      return analysis;
    }
    applyVisualDetectedFields(analysis);
    const circleCount = analysis.imageAnalysis?.reduce((total, page) => total + (page.circles?.length || 0), 0) || 0;
    setVisualAnalysisStatus(`Visual analyzer completed. ${circleCount} circle candidates, ${analysis.extractedFields?.length || 0} field candidates.`);
    return analysis;
  }


  function getRegionCanvasPoint(event: MouseEvent<HTMLCanvasElement>) {
    const canvas = regionCanvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  function redrawRegionCanvas(rect?: RegionRect | null) {
    const canvas = regionCanvasRef.current;
    const baseImage = regionBaseImageRef.current;
    if (!canvas || !baseImage) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(baseImage, 0, 0);
    if (rect && rect.width > 2 && rect.height > 2) {
      ctx.save();
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillStyle = "rgba(220, 38, 38, 0.12)";
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.restore();
    }
  }

  async function renderRegionSelectionPage() {
    if (!planFile || !regionCanvasRef.current) {
      setRegionStatus("Upload a PDF first.");
      return;
    }

    setRegionStatus("Rendering PDF page for rectangle selection...");
    setRegionRect(null);
    setRegionAnalysis(null);
    setRegionZoom(1);

    try {
      const pdfjsLib = (await Function(
        'return import("https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.mjs")'
      )()) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs";

      const data = new Uint8Array(await planFile.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const requestedPage = Math.max(1, Math.min(pdf.numPages, Number(regionPageNumber) || 1));
      const page = await pdf.getPage(requestedPage);
      const baseViewport = page.getViewport({ scale: 1 });
      // Render the selection page much larger than it is displayed.
      // This keeps text/detail lines sharp when the browser zooms in.
      const targetWidth = 3200;
      const scale = targetWidth / baseViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = regionCanvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not create canvas context.");

      await page.render({ canvasContext: ctx, viewport }).promise;
      regionBaseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setRegionStatus(`Page ${requestedPage} rendered at high resolution (${canvas.width} × ${canvas.height}). Drag a rectangle around a detail/callout area, then click Analyze Selected Rectangle.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRegionStatus(`Could not render page: ${message}`);
    }
  }

  async function startCropMode() {
    if (!planFile || !isPdf) {
      setRegionStatus("Upload a PDF first.");
      return;
    }
    setCropToolOpen(true);
    setRegionStatus("Preparing crop canvas...");
    setTimeout(() => cropToolRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await renderRegionSelectionPage();
  }

  function handleRegionMouseDown(event: MouseEvent<HTMLCanvasElement>) {
    const point = getRegionCanvasPoint(event);
    if (!point) return;
    setRegionDragStart(point);
    setRegionRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleRegionMouseMove(event: MouseEvent<HTMLCanvasElement>) {
    if (!regionDragStart) return;
    const point = getRegionCanvasPoint(event);
    if (!point) return;

    const nextRect = {
      x: Math.min(regionDragStart.x, point.x),
      y: Math.min(regionDragStart.y, point.y),
      width: Math.abs(point.x - regionDragStart.x),
      height: Math.abs(point.y - regionDragStart.y),
    };

    setRegionRect(nextRect);
    redrawRegionCanvas(nextRect);
  }

  function handleRegionMouseUp() {
    setRegionDragStart(null);
    redrawRegionCanvas(regionRect);
  }

  async function analyzeSelectedRegion() {
    const canvas = regionCanvasRef.current;
    if (!planFile || !canvas || !regionRect || regionRect.width < 5 || regionRect.height < 5) {
      setRegionStatus("Render a PDF page and drag a rectangle first.");
      return;
    }

    const analyzerUrl = process.env.NEXT_PUBLIC_ANALYZER_URL?.replace(/\/$/, "");
    if (!analyzerUrl) {
      setRegionStatus("Missing NEXT_PUBLIC_ANALYZER_URL. Add it in Vercel to call the Render analyzer.");
      return;
    }

    const x0 = Math.max(0, regionRect.x / canvas.width);
    const y0 = Math.max(0, regionRect.y / canvas.height);
    const x1 = Math.min(1, (regionRect.x + regionRect.width) / canvas.width);
    const y1 = Math.min(1, (regionRect.y + regionRect.height) / canvas.height);

    const formData = new FormData();
    formData.append("blueprint", planFile);
    formData.append("page", String(Math.max(1, Number(regionPageNumber) || 1)));
    formData.append("x0", x0.toFixed(6));
    formData.append("y0", y0.toFixed(6));
    formData.append("x1", x1.toFixed(6));
    formData.append("y1", y1.toFixed(6));

    setRegionStatus("Analyzing selected rectangle with PDF text + image logic...");
    setRegionAnalysis(null);

    try {
      const response = await fetch(`${analyzerUrl}/analyze-region`, {
        method: "POST",
        body: formData,
      });
      const rawText = await response.text();
      let result: RegionAnalysis;
      try {
        result = JSON.parse(rawText) as RegionAnalysis;
      } catch {
        result = {
          success: false,
          error: `Analyzer returned non-JSON response. HTTP ${response.status}. ${rawText.slice(0, 300)}`,
        };
      }
      if (!response.ok && !result.error) {
        result.error = `HTTP ${response.status}: ${response.statusText || rawText.slice(0, 200)}`;
      }
      setRegionAnalysis(result);
      setRegionStatus(
        response.ok && result.success
          ? `Region analysis completed. ${result.params?.length || 0} fabrication parameter candidates found.`
          : `Region analysis failed: ${result.error || `HTTP ${response.status} ${response.statusText}`}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRegionStatus(`Region analyzer request failed: ${message}`);
    }
  }


  async function extractPlanData() {
    if (isExtractingPlan) return;
    setIsExtractingPlan(true);
    setExtractionProgress("Starting PDF calculation...");
    setExtractionStatus("Starting PDF calculation...");
    try {
      if (!planFile) {
      if (extractionMode === "simulation") {
        setExtractionStatus(
          "No file uploaded. Simulation Mode loaded sample values.",
        );
        fillSampleData();
      } else {
        setExtractionStatus(
          "No file uploaded. Live Mode will not load sample/canned values.",
        );
        setFieldSources(
          markAllMissing("No PDF uploaded. Live Mode does not guess values."),
        );
      }
      setExtractionProgress("Stopped: no plan file uploaded.");
        return;
      }

      if (!planFile.type.includes("pdf")) {
      if (extractionMode === "simulation") {
        setExtractionStatus(
          "Image OCR is not connected yet. Simulation Mode loaded sample values.",
        );
        fillSampleData();
      } else {
        setExtractionStatus(
          "Image OCR/PDF image analysis is not connected yet. Live Mode did not load fake data.",
        );
        setFieldSources(
          markAllMissing(
            "Image/PDF drawing analysis is not implemented yet. Enter this value manually.",
          ),
        );
      }
      setExtractionProgress("Stopped: uploaded file is not a PDF.");
        return;
      }

      setExtractionProgress("Reading PDF text...");
      setExtractionStatus("Reading PDF text...");
      const text = await extractPdfTextFromFile(planFile);
      setExtractedTextPreview(text.slice(0, 5000));
      setExtractionProgress("PDF text read. Looking for foundation/rebar pages...");
      const recognition = analyzePlanText(text);
      setRecognitionReport(recognition);

      setExtractionProgress("Extracting rebar parameters from PDF text...");
      const result = extractDetectedValuesFromPlanText(
        recognition.preferredText || text,
        { mode: extractionMode },
      );
      const calculatedFieldSet = buildDetectedFields(result.detectedValues);
      setManualComparisonFields(fields);
      setManualComparisonRows(rebarInfoRows.map((row) => ({ ...row, cropImages: [...(row.cropImages || [])] })));
      setManualComparisonGlobals({ ...rebarGlobalParams });
      setCalculatedFields(calculatedFieldSet);
      setCalculatedRows(buildCalculatedRebarRowsFromPlanText(recognition.preferredText || text, calculatedFieldSet));
      setCalculatedGlobals(buildCalculatedGlobalsFromPlanText(recognition.preferredText || text, calculatedFieldSet));
      setCalculatedAt(new Date().toLocaleString());
      setShowParamComparison(true);
      setParamViewMode("calculated");
      setExtractionProgress("Calculated parameters created. Comparing with manual entry...");

      let visualNotes: string[] = [];
      if (useExternalVisualAnalyzer) {
        try {
          setExtractionProgress("Running external visual/PDF image analyzer...");
          const visual = await runSpatialPlanAnalysis(planFile);
          visualNotes = [
            visual.sourcePolicy ? `External visual policy: ${visual.sourcePolicy}` : "",
            visual.scale ? `External scale: ${visual.scale.status}${visual.scale.px_per_foot ? `, ${visual.scale.px_per_foot} px/ft` : ""}. ${visual.scale.evidence || ""}` : "",
            ...(visual.notes || []),
          ].filter(Boolean);
        } catch (visualError) {
          console.error(visualError);
          setVisualAnalysisStatus("External visual analyzer failed. PDF text extraction was still applied.");
        }
      } else {
        setVisualAnalysis(null);
        setVisualAnalysisStatus("Internal-only extraction used: PDF text + in-app PDF rendering/region tools only. External Render visual analyzer was not called.");
        visualNotes = [
          "External visual analyzer disabled for this extraction. Full-sheet circle/symbol detection was skipped.",
          "Use Selected Rectangle Extraction for focused detail regions, or enable the external visual analyzer checkbox for full-sheet OpenCV analysis.",
        ];
      }

      setExtractionNotes([
        recognition.relevantPages.length
          ? `Foundation page scoring: using page(s) ${
              recognition.relevantPages
                .filter(
                  (page) =>
                    page.confidence === "high" || page.confidence === "medium",
                )
                .slice(0, 6)
                .map((page) => page.pageNumber)
                .join(", ") || "all pages"
            } first for extraction.`
          : "Foundation page scoring: no strong page match; using all PDF text.",
        ...result.notes,
        ...visualNotes,
        ...result.detectedValues.map(
          (item) =>
            `${item.key}: ${item.value} (${item.confidence}) - ${item.reason}`,
        ),
      ]);
      setExtractionProgress("Completed: PDF calculation finished and comparison table updated.");
      setExtractionStatus(
        extractionMode === "live"
          ? useExternalVisualAnalyzer
          ? `Live Mode extraction completed. PDF text filled ${result.detectedValues.length} values; external visual analyzer may have added PDF Image values. Missing values were not guessed.`
          : `Live Mode extraction completed in Internal Only mode. PDF text filled ${result.detectedValues.length} values. External full-sheet visual analyzer was skipped.`
          : `Simulation Mode extraction completed. PDF text/defaults filled ${result.detectedValues.length} values; defaults are marked Sim.`,
      );
    } catch (error) {
      console.error(error);
      if (extractionMode === "simulation") {
        setExtractionStatus(
          "Could not read PDF text. Simulation Mode loaded sample values.",
        );
        fillSampleData();
      } else {
        setExtractionStatus(
          "Could not read PDF text. Live Mode did not load fake data.",
        );
        setFieldSources(
          markAllMissing(
            "PDF text extraction failed. Live Mode does not guess values.",
          ),
        );
      }
    } finally {
      setIsExtractingPlan(false);
    }
  }

  function fillSampleData() {
    setFields([
      { key: "sideWallLength", label: "Side Wall Length", value: "52'" },
      {
        key: "sideBaseOuterLength",
        label: "Side Wall Base Outer Required Len (O = side wall + 3 in)",
        value: "52'-3\"",
      },
      {
        key: "sideBaseMiddleLength",
        label: "Side Wall Base Middle Required Len (M = side wall - 3 in)",
        value: "51'-9\"",
      },
      {
        key: "sideBaseInnerLength",
        label: "Side Wall Base Inner Required Len (I = side wall - 9 in)",
        value: "51'-3\"",
      },
      { key: "endWallLength", label: "End Wall Length", value: "13'-4\"" },
      {
        key: "endBaseOuterLength",
        label: "End Wall Base Outer Required Len (O = end wall - 3 in)",
        value: "13'-1\"",
      },
      {
        key: "endBaseMiddleLength",
        label: "End Wall Base Middle Required Len (M = end wall - 6 in)",
        value: "12'-10\"",
      },
      {
        key: "endBaseInnerLength",
        label: "End Wall Base Inner Required Len (I = end wall - 9 in)",
        value: "12'-7\"",
      },
      {
        key: "sideAboveGrade",
        label: "Side Wall Above Grade Height",
        value: '19"',
      },
      {
        key: "endAboveGrade",
        label: "End Wall Above Grade Height",
        value: '12.5"',
      },
      {
        key: "belowGradeEmbed",
        label: "Below Grade Stem Wall Embed",
        value: '6"',
      },
      {
        key: "sideTotalHeight",
        label: "Side Wall Total Concrete Height",
        value: '25"',
      },
      {
        key: "endTotalHeight",
        label: "End Wall Total Concrete Height",
        value: '18.5"',
      },
      { key: "wallThickness", label: "Wall Thickness", value: '6"' },
      {
        key: "footingDepth",
        label: "Footing Depth for Vertical Bars",
        value: '18"',
      },
      {
        key: "sideVerticalQty",
        label: "Side Wall Vertical Bar Qty (V-S)",
        value: "52",
      },
      {
        key: "sideVerticalBottomClearance",
        label: "Side Wall Vertical Bottom Clearance",
        value: '3"',
      },
      {
        key: "sideVerticalTopClearance",
        label: "Side Wall Vertical Top Clearance",
        value: '8"',
      },
      {
        key: "sideVerticalUsedHeight",
        label: "Side Wall Vertical Used Height Override (optional)",
        value: "",
      },
      {
        key: "endVerticalQty",
        label: "End Wall Vertical Bar Qty (V-E)",
        value: "16",
      },
      {
        key: "endVerticalBottomClearance",
        label: "End Wall Vertical Bottom Clearance",
        value: '3"',
      },
      {
        key: "endVerticalTopClearance",
        label: "End Wall Vertical Top Clearance",
        value: '3"',
      },
      {
        key: "endVerticalUsedHeight",
        label: "End Wall Vertical Used Height Override (optional)",
        value: "",
      },
      {
        key: "baseShortVerticalQty",
        label: "FOOTING_TIE_BAR Qty",
        value: "131",
      },
      {
        key: "baseShortVerticalCutLength",
        label: "FOOTING_TIE_BAR Cut Length",
        value: '12"',
      },
      { key: "footingSize", label: "Footing Size", value: '18" x 18"' },
      {
        key: "ptSillPlates",
        label: "PT Sill Plates",
        value:
          '1 plate @ 1.5" for end wall; 2 plates @ 1.5" each for side wall',
      },
      { key: "pierCount", label: "Pier Count", value: "14" },
      { key: "pierDiameter", label: "Pier Diameter", value: '28"' },
      { key: "pierHeight", label: "Pier Height / Cage Height", value: "" },
      {
        key: "rebarCallouts",
        label: "Rebar Callout Description",
        value: "#4 horizontal, V-E, V-S, pier cages",
      },
    ]);
    setFieldSources((current) => {
      const next = { ...current };
      for (const field of initialFields) {
        const hasValue =
          field.key !== "pierHeight" &&
          field.key !== "sideVerticalUsedHeight" &&
          field.key !== "endVerticalUsedHeight";
        next[field.key] = hasValue
          ? {
              kind: "default",
              confidence: "low",
              reason:
                "Simulation Mode sample/default value. Not read from PDF.",
            }
          : { kind: "blank" };
      }
      return applyDerivedFieldSources(next, fields);
    });
    setPierMode("unknown");
    setPierMessage(
      "Simulation Mode loaded defaults. Live Mode never uses these values unless you enter them manually.",
    );
  }

  function savePierDetails(mode: "yes" | "none") {
    if (mode === "none") {
      updateField("pierCount", "0");
      updateField("pierDiameter", "");
      updateField("pierHeight", "");
      setPierMode("none");
      setPierMessage("No piers selected. The schedule will skip pier cages.");
      setPierDialogOpen(false);
      return;
    }

    const count = Number(getFieldValue("pierCount") || 0);
    const diameter = getFieldValue("pierDiameter").trim();
    const height = getFieldValue("pierHeight").trim();
    if (!count || count <= 0 || !diameter || !height) {
      setPierMessage(
        "Enter pier count, pier diameter, and pier height/cage height, or choose I do not have piers.",
      );
      return;
    }

    setPierMode("yes");
    setPierMessage(
      `Pier details confirmed: ${count} piers, diameter ${diameter}, height ${height}.`,
    );
    setPierDialogOpen(false);
  }

  function getBlockingLiveModeMissingFields() {
    if (extractionMode !== "live") return [];

    const requiredKeys = [
      "sideWallLength",
      "sideBaseOuterLength",
      "sideBaseMiddleLength",
      "sideBaseInnerLength",
      "endWallLength",
      "endBaseOuterLength",
      "endBaseMiddleLength",
      "endBaseInnerLength",
      "sideTotalHeight",
      "endTotalHeight",
      "footingDepth",
      "sideVerticalQty",
      "sideVerticalBottomClearance",
      "sideVerticalTopClearance",
      "endVerticalQty",
      "endVerticalBottomClearance",
      "endVerticalTopClearance",
      "baseShortVerticalQty",
      "baseShortVerticalCutLength",
    ];

    return requiredKeys.filter((key) => {
      const field = fields.find((item) => item.key === key);
      const source = fieldSources[key];
      return (
        !field?.value.trim() ||
        !source ||
        source.kind === "missing" ||
        source.kind === "default" ||
        source.kind === "blank"
      );
    });
  }


  function rowFieldErrorKey(rowId: string, field: keyof RebarInfoRow) {
    return `${rowId}:${String(field)}`;
  }

  function valueHasLengthUnit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return true;
    if (/^n\/?a$/i.test(trimmed)) return true;
    if (!/\d/.test(trimmed)) return true;
    return /('|"|\bft\b|\bfeet\b|\bfoot\b|\bin\b|\binch\b|\binches\b)/i.test(trimmed);
  }

  function validateLengthUnitsBeforeGenerate(rowsToCheck: RebarInfoRow[]) {
    const lengthFields: Array<{ field: keyof RebarInfoRow; label: string }> = [
      { field: "length", label: "Length" },
      { field: "calcLength", label: "Calculate run" },
      { field: "side1BentLength", label: "Start end bent return length" },
      { field: "side2BentLength", label: "Finish end bent return length" },
      { field: "verticalBentLength", label: "Vertical bent overlap length" },
      { field: "traverseLength", label: "Traverse length" },
      { field: "spacingBetween", label: "Space between bars" },
      { field: "traverseSpacing", label: "Traverse space between bars" },
      { field: "spacing", label: "Spacing" },
      { field: "diameter", label: "Diameter" },
      { field: "clearanceTop", label: "Top clearance" },
      { field: "clearanceBottom", label: "Bottom clearance" },
      { field: "clearanceSides", label: "Side clearance" },
    ];

    const errors: string[] = [];
    const messages: string[] = [];

    rowsToCheck.forEach((row, index) => {
      const rowLabel = row.segment || `Row ${index + 1}`;
      lengthFields.forEach(({ field, label }) => {
        const rawValue = String(row[field] || "");
        if (!valueHasLengthUnit(rawValue)) {
          errors.push(rowFieldErrorKey(row.id, field));
          messages.push(`${rowLabel}: ${label} has "${rawValue}" but no unit. Use examples like 52', 24", or 2'-6".`);
        }
      });

      if (row.side1Bent === "Yes" && !String(row.side1BentLength || "").trim()) {
        errors.push(rowFieldErrorKey(row.id, "side1BentLength"));
        messages.push(`${rowLabel}: Start end is bent, so enter a bent overlap length with units, like 24".`);
      }
      if (row.side2Bent === "Yes" && !String(row.side2BentLength || "").trim()) {
        errors.push(rowFieldErrorKey(row.id, "side2BentLength"));
        messages.push(`${rowLabel}: Finish end is bent, so enter a bent overlap length with units, like 24".`);
      }
      if (row.verticalBent === "Yes" && !String(row.verticalBentLength || "").trim()) {
        errors.push(rowFieldErrorKey(row.id, "verticalBentLength"));
        messages.push(`${rowLabel}: Vertical bent is Yes, so enter a bent overlap length with units, like 6".`);
      }
    });

    return { errors, messages };
  }

  async function saveGeneratedScheduleOnly(savedGeneratedSchedule: SavedGeneratedSchedule) {
    if (!user || !workspaceDocId) return;
    const projectId = currentProjectId || `${user.uid}-${Date.now()}`;
    const cleanProjectName = projectName.trim() || "ADU Foundation";
    const payload = {
      ...getWorkspaceSnapshot(),
      projectName: cleanProjectName,
      savedGeneratedSchedule,
      id: projectId,
      ownerUid: user.uid,
      ownerEmail: user.email || "",
      app: "rebar-planner",
      updatedAt: serverTimestamp(),
      ...(currentProjectId ? {} : { createdAt: serverTimestamp() }),
    };

    await setDoc(doc(db, "plannerProjects", projectId), payload, { merge: true });
    await setDoc(doc(db, "plannerWorkspaces", workspaceDocId), {
      ...payload,
      activeProjectId: projectId,
      createdAt: serverTimestamp(),
    }, { merge: true });
    setCurrentProjectId(projectId);
    await loadSavedProjects(user.uid);
  }

  async function generateSchedule() {
    if (isGeneratingSchedule) return;
    const sourceRows = showingCalculatedParams && calculatedRows.length > 0 ? calculatedRows : rebarInfoRows;
    const sourceGlobals = showingCalculatedParams && calculatedGlobals ? calculatedGlobals : rebarGlobalParams;
    const sourceLabel = showingCalculatedParams && calculatedRows.length > 0 ? "calculated PDF parameters" : "manual parameters";
    const lengthUnitValidation = validateLengthUnitsBeforeGenerate(sourceRows);
    if (lengthUnitValidation.errors.length) {
      setLengthUnitErrorFields(lengthUnitValidation.errors);
      const visibleMessages = lengthUnitValidation.messages.slice(0, 20);
      const hiddenCount = Math.max(0, lengthUnitValidation.messages.length - visibleMessages.length);
      setScheduleGenerationStatus(`Fix these length/unit fields before generating: ${visibleMessages.join(" | ")}${hiddenCount ? ` | ...and ${hiddenCount} more.` : ""}`);
      window.alert(`Cannot generate yet. These fields have missing or unclear units:\n\n${visibleMessages.map((message, index) => `${index + 1}. ${message}`).join("\n")}${hiddenCount ? `\n\n...and ${hiddenCount} more.` : ""}\n\nUse units like 52', 24", 2'-6", ft, or in.`);
      return;
    }
    setLengthUnitErrorFields([]);
    setIsGeneratingSchedule(true);
    setScheduleGenerationStatus("Starting manual rebar schedule calculation...");

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      setScheduleGenerationStatus(`Reading ${sourceLabel}, row notes, bend settings, lap length, and stick length...`);
      await new Promise((resolve) => window.setTimeout(resolve, 80));

      const result = generateManualRebarSchedule({
        rows: sourceRows,
        stockLength: sourceGlobals.stickLength,
        defaultOverlap: sourceGlobals.defaultOverlap,
        defaultVerticalToBase: sourceGlobals.defaultVerticalToBase,
        defaultFoundationRebarSize: sourceGlobals.foundationRebarSize,
        defaultPierRebarSize: sourceGlobals.pierRebarSize,
      });

      setScheduleGenerationStatus("Splitting continuous bars by stick length, adding lap splices, and placing bent returns...");
      await new Promise((resolve) => window.setTimeout(resolve, 80));

      const generatedAtIso = new Date().toISOString();
      const savedGeneratedSchedule: SavedGeneratedSchedule = {
        generatedAtIso,
        sourceLabel,
        schedule: result.schedule,
        summary: result.summary,
        materialTakeoff: result.materialTakeoff,
        reviewedPieceMarks: [],
        validationWarnings: result.validationWarnings || [],
      };
      setReviewedPieceMarks([]);
      setSchedule(result.schedule);
      setSummary(result.summary);
      setMaterialTakeoff(result.materialTakeoff);
      setEngineValidationWarnings(result.validationWarnings || []);
      setSavedScheduleAt(generatedAtIso);
      setFilter("ALL");
      setSelectedMark(result.schedule[0]?.mark || "");
      setSelectedPrefix(result.schedule[0]?.prefix || "");
      setScheduleGenerationStatus("Saving latest generated schedule with project...");
      await saveGeneratedScheduleOnly(savedGeneratedSchedule);
      setScheduleGenerationStatus(
        `Completed and saved. Generated ${result.schedule.length} schedule lines, ${result.materialTakeoff.cutCount} cut pieces: ${result.materialTakeoff.bentPieceCount} need bending and ${result.materialTakeoff.straightPieceCount} stay straight. Sticks to buy: ${result.materialTakeoff.sticksToBuy}.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScheduleGenerationStatus(`Schedule generation failed: ${message}`);
    } finally {
      setIsGeneratingSchedule(false);
    }
  }

  function csvCell(value: unknown) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  const exportHeader = [
    "Qty",
    "Cut Len",
    "Left Function",
    "Used",
    "Right Function",
    "Stock Source",
    "Waste Fit",
    "Reviewed",
    "Piece ID",
    "Location",
    "Required Len",
    "Field Order",
  ];

  function scheduleExportRows() {
    return schedule.map((line) => [
      line.qty,
      line.cutLength,
      line.leftFunction,
      line.usedLength,
      line.rightFunction,
      line.stockSource || "",
      line.wasteFit || "",
      reviewedPieceMarks.includes(line.mark) ? "Reviewed" : "Not reviewed",
      line.mark,
      line.location,
      line.requiredLength,
      line.fieldOrder,
    ]);
  }

  function materialSummaryRows() {
    return [
      ["Summary", "Value"],
      ["Total Cut", materialTakeoff?.totalCut || ""],
      ["Stock Length", materialTakeoff?.stockLength || ""],
      ["Sticks to Buy", materialTakeoff?.sticksToBuy ?? ""],
      ["Available", materialTakeoff?.availableLength || ""],
      ["Waste", materialTakeoff?.waste || ""],
      ["Waste pieces", materialTakeoff?.wastePieceCount ?? ""],
      ["Largest waste piece", materialTakeoff?.maxWastePiece || ""],
      ["Cuts", materialTakeoff?.cutCount ?? ""],
      ["Bends", materialTakeoff?.bendCount ?? ""],
      ["Stock sticks no change/no cut/no bend", materialTakeoff?.straightStockStickCount ?? 0],
      ["Sticks needing cut/bend/partial use", materialTakeoff?.cutOrBentStockStickCount ?? 0],
    ];
  }

  function downloadCsv() {
    // CSV files cannot store colors, borders, or column widths.
    // This keeps one download button but exports an Excel-compatible table so the schedule opens formatted.
    downloadExcelWorkbook();
  }

  function xmlEscape(value: unknown) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function xmlCell(value: unknown, styleId = "DataCell") {
    return `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
  }

  function excelRow(cells: unknown[], styleId = "DataCell", keyColumnCount = 5) {
    return `<Row>${cells
      .map((cell, index) => xmlCell(cell, index < keyColumnCount ? `${styleId}Key` : styleId))
      .join("")}</Row>`;
  }

  function downloadExcelWorkbook() {
    const pieceRows = scheduleExportRows();
    const workbook = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="12"/><Interior ss:Color="#1F4E79" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="HeaderKey"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="12"/><Interior ss:Color="#8064A2" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="DataCell"><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="DataCellKey"><Font ss:Bold="1"/><Interior ss:Color="#EADCF8" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="SummaryTitle"><Font ss:Bold="1" ss:Size="14" ss:Color="#FFFFFF"/><Interior ss:Color="#1F4E79" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2"/></Borders></Style>
  <Style ss:ID="SummaryCell"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="SummaryValue"><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
</Styles>
<Worksheet ss:Name="Rebar Schedule">
<Table>
  <Column ss:Width="95"/><Column ss:Width="115"/><Column ss:Width="210"/><Column ss:Width="115"/><Column ss:Width="230"/><Column ss:Width="110"/><Column ss:Width="210"/><Column ss:Width="380"/><Column ss:Width="140"/><Column ss:Width="420"/>
  ${excelRow(exportHeader, "Header")}
  ${pieceRows.map((row) => excelRow(row, "DataCell")).join("")}
</Table>
<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>
</Worksheet>
</Workbook>`;
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName.replaceAll(" ", "-").toLowerCase()}-rebar-schedule.xls`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function selectPrefix(prefix: string) {
    setSelectedPrefix(prefix);
    setFilter(prefix);
    const firstMatch = schedule.find((line) => line.prefix === prefix);
    setSelectedMark(firstMatch?.mark || "");
  }

  function selectPiece(line: ScheduleLine) {
    setSelectedMark(line.mark);
    setSelectedPrefix(line.prefix);
  }

  function toggleReviewedPiece(mark: string) {
    setReviewedPieceMarks((current) =>
      current.includes(mark) ? current.filter((item) => item !== mark) : [...current, mark],
    );
  }

  function jumpToRebarType(type: RebarInfoType) {
    setActiveDiagramType(type);
    const matchingRows = Array.from(document.querySelectorAll<HTMLElement>("[data-rebar-type]"));
    const match = matchingRows.find((element) => element.dataset.rebarType === type);
    if (match) {
      match.scrollIntoView({ behavior: "smooth", block: "center" });
      match.classList.add("ring-4", "ring-blue-300");
      window.setTimeout(() => match.classList.remove("ring-4", "ring-blue-300"), 1600);
    }
  }


  function getPieceSketchType(line: ScheduleLine) {
    const text = `${line.mark} ${line.prefix} ${line.location} ${line.leftFunction} ${line.rightFunction}`.toUpperCase();
    const leftText = String(line.leftFunction || "").toLowerCase();
    const rightText = String(line.rightFunction || "").toLowerCase();
    const leftBent = leftText.includes("bent") || leftText.includes("hook") || leftText.includes("return");
    const rightBent = rightText.includes("bent") || rightText.includes("hook") || rightText.includes("return");
    if (text.includes("HCIRC") || text.includes("HOOP") || text.includes("CIRCLE")) return "circle";
    if (text.includes("VERT") || text.includes(" L ") || text.includes("L BAR")) return "lbar";
    if (leftBent && rightBent) return "u";
    if (leftBent || rightBent) return leftBent ? "leftBent" : "rightBent";
    if (text.includes("TRAVERSE")) return "traverse";
    if (text.includes("BASE") || text.includes("BOTTOM") || text.includes("FOOTING")) return "bottom";
    if (text.includes("HORIZ") || text.includes("WALL")) return "horizontal";
    return "straight";
  }

  function PieceShapeIcon({ line, compact = false }: { line: ScheduleLine; compact?: boolean }) {
    const type = getPieceSketchType(line);
    const label =
      type === "circle" ? "Hoop / circle" :
      type === "lbar" ? "Vertical L" :
      type === "traverse" ? "Traverse" :
      type === "bottom" ? "Straight" :
      type === "horizontal" ? "Straight" :
      type === "u" ? "Bent both ends" :
      type === "leftBent" ? "Bent left end" :
      type === "rightBent" ? "Bent right end" :
      "Straight";
    const common = { fill: "none", stroke: "currentColor", strokeWidth: 7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    return (
      <span className={compact ? "rp-shape-mini" : "rp-shape-icon"} title={label} aria-label={label}>
        <svg viewBox="0 0 120 42" role="img">
          {type === "circle" ? (
            <>
              <circle cx="56" cy="21" r="12" {...common} />
              <path d="M70 13 L92 8" {...common} strokeWidth={4} />
            </>
          ) : type === "lbar" ? (
            <path d="M32 8 L32 31 L92 31" {...common} />
          ) : type === "u" ? (
            <path d="M26 8 L26 30 L94 30 L94 8" {...common} />
          ) : type === "leftBent" ? (
            <path d="M28 31 L28 13 L96 13" {...common} />
          ) : type === "rightBent" ? (
            <path d="M24 13 L92 13 L92 31" {...common} />
          ) : type === "traverse" ? (
            <>
              <path d="M28 12 L92 12" {...common} />
              <path d="M28 30 L92 30" {...common} />
            </>
          ) : (
            <path d="M20 21 L100 21" {...common} />
          )}
        </svg>
      </span>
    );
  }

  function CollapsedCell({ value, className = "" }: { value?: string; className?: string }) {
    const text = String(value || "").trim();
    if (!text) return <span className={className}>—</span>;
    const first = text.split(/\s+/)[0] || text;
    if (text === first) return <span className={className}>{text}</span>;
    return (
      <details className={`rp-cell-details ${className}`}>
        <summary>{first}</summary>
        <div>{text}</div>
      </details>
    );
  }

  function PieceSketch({ line }: { line: ScheduleLine }) {
    const type = getPieceSketchType(line);
    const stroke = "#0f172a";
    const blue = "#dbeafe";
    const amber = "#fef3c7";
    const common = { fill: "none", stroke, strokeWidth: 5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    const label =
      type === "circle" ? "HOOP" :
      type === "lbar" ? "L BAR" :
      type === "traverse" ? "TRAV" :
      type === "bottom" ? "BOTTOM" :
      type === "horizontal" ? "HORIZ" :
      type === "u" ? "U / 2 BENDS" :
      type === "leftBent" ? "LEFT BEND" :
      type === "rightBent" ? "RIGHT BEND" :
      "STRAIGHT";
    return (
      <div className="flex min-w-[128px] flex-col items-center justify-center gap-1">
        <svg viewBox="0 0 150 58" className="h-14 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-sm" aria-label={`piece sketch ${label}`}>
          <rect x="2" y="2" width="146" height="54" rx="8" fill="#f8fafc" stroke="#e2e8f0" />
          {type === "circle" && (
            <>
              <circle cx="70" cy="27" r="16" fill={blue} stroke={stroke} strokeWidth="5" />
              <path d="M82 19 L101 12" {...common} strokeWidth={4} />
              <text x="116" y="17" textAnchor="middle" fontSize="8" fontWeight="900" fill="#1d4ed8">+ LAP</text>
            </>
          )}
          {type === "lbar" && (
            <>
              <path d="M40 10 V40 H115" {...common} />
              <circle cx="40" cy="40" r="4" fill={amber} stroke={stroke} />
            </>
          )}
          {type === "traverse" && (
            <>
              <path d="M25 24 H125" {...common} />
              <path d="M25 34 H125" {...common} strokeWidth={3} />
              <path d="M35 16 L25 42 M125 16 L115 42" {...common} strokeWidth={3} />
            </>
          )}
          {type === "bottom" && (
            <>
              <path d="M24 20 H126" {...common} stroke="#1d4ed8" />
              <path d="M24 29 H126" {...common} stroke="#1d4ed8" />
              <path d="M24 38 H126" {...common} stroke="#1d4ed8" />
            </>
          )}
          {type === "horizontal" && (
            <>
              <path d="M25 24 H125" {...common} stroke="#059669" />
              <path d="M25 34 H125" {...common} stroke="#059669" />
            </>
          )}
          {type === "u" && <path d="M28 42 V17 H122 V42" {...common} />}
          {type === "leftBent" && <path d="M30 42 V24 H122" {...common} />}
          {type === "rightBent" && <path d="M28 24 H120 V42" {...common} />}
          {type === "straight" && <path d="M25 29 H125" {...common} />}
          {(type === "leftBent" || type === "rightBent" || type === "u" || type === "lbar") && (
            <text x="75" y="53" textAnchor="middle" fontSize="8" fontWeight="900" fill="#92400e">BEND / OVERLAP</text>
          )}
        </svg>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-700">{label}</span>
      </div>
    );
  }


  const isPdf = planFileType.includes("pdf");
  const isImage = planFileType.startsWith("image/");
  const showingCalculatedParams = paramViewMode === "calculated";
  const displayedGlobalParams = showingCalculatedParams && calculatedGlobals ? calculatedGlobals : rebarGlobalParams;
  const rawDisplayedRows = showingCalculatedParams && calculatedRows.length > 0 ? calculatedRows : rebarInfoRows;
  const displayedRows = rawDisplayedRows;

  const pdfPanelSizeClass = pdfPanelSize === "small" ? "lg:max-w-[34rem]" : pdfPanelSize === "medium" ? "lg:max-w-[52rem]" : "lg:max-w-none";
  const pdfPanelHeightClass = pdfPanelSize === "small" ? "h-[420px]" : pdfPanelSize === "medium" ? "h-[600px]" : "h-[760px]";
  const rebarTypeCounts = displayedRows.reduce<Record<RebarInfoType, number>>((acc, row) => {
    acc[row.itemType] = (acc[row.itemType] || 0) + 1;
    return acc;
  }, {
    "Base/Bottom rebar": 0,
    "Horiz continues longtidues": 0,
    "Vertical Rebar": 0,
    Pier: 0,
    Misc: 0,
  });
  const scheduleTotalCutFeet = schedule.reduce((sum, line) => sum + Math.max(0, line.cutFeet || 0) * Math.max(1, line.qty || 1), 0);
  const commercialWorkflowSteps = [
    { title: "Project", detail: projectName || "Name the job", status: projectName ? "Ready" : "Needs name" },
    { title: "Plan PDF", detail: planFileName || "Upload or load PDF", status: planFileName ? "Loaded" : "Missing" },
    { title: "Rebar input", detail: `${displayedRows.length} row${displayedRows.length === 1 ? "" : "s"}`, status: displayedRows.length ? "Ready" : "Add rows" },
    { title: "Schedule", detail: schedule.length ? `${schedule.length} piece row${schedule.length === 1 ? "" : "s"}` : "Not generated", status: schedule.length ? "Saved" : "Generate" },
  ];

  const commercialScheduleStats = [
    { label: "Total cut", value: materialTakeoff?.totalCut || "—", tone: "blue" },
    { label: "Stock sticks", value: materialTakeoff?.sticksToBuy ?? "—", tone: "emerald" },
    { label: "No cut / no bend", value: materialTakeoff?.straightStockStickCount ?? 0, tone: "slate" },
    { label: "Need cut / bend", value: materialTakeoff?.cutOrBentStockStickCount ?? 0, tone: "amber" },
    { label: "Waste", value: materialTakeoff?.waste || "—", tone: "rose" },
  ];

  const scheduleHealthChecks = [
    {
      title: "Plan loaded",
      detail: planFileName ? planFileName : "Upload a PDF before takeoff.",
      ok: Boolean(planFileName),
    },
    {
      title: "Base / bottom rows",
      detail: `${rebarTypeCounts["Base/Bottom rebar"]} base/bottom row${rebarTypeCounts["Base/Bottom rebar"] === 1 ? "" : "s"}`,
      ok: rebarTypeCounts["Base/Bottom rebar"] > 0,
    },
    {
      title: "Vertical rows",
      detail: `${rebarTypeCounts["Vertical Rebar"]} vertical row${rebarTypeCounts["Vertical Rebar"] === 1 ? "" : "s"}`,
      ok: rebarTypeCounts["Vertical Rebar"] > 0,
    },
    {
      title: "Pier rows",
      detail: `${rebarTypeCounts.Pier} pier row${rebarTypeCounts.Pier === 1 ? "" : "s"}`,
      ok: rebarTypeCounts.Pier > 0,
    },
    {
      title: "Schedule generated",
      detail: schedule.length ? `${schedule.length} piece line${schedule.length === 1 ? "" : "s"}` : "Generate when inputs are ready.",
      ok: schedule.length > 0,
    },
  ];
  const scheduleHealthOkCount = scheduleHealthChecks.filter((item) => item.ok).length;
  const scheduleHealthLabel = scheduleHealthOkCount === scheduleHealthChecks.length ? "Ready for shop review" : `${scheduleHealthOkCount}/${scheduleHealthChecks.length} checks ready`;

  const subscriptionPreviewCards = [
    { label: "Trial", value: "Ready later", note: "Future 7/14/30 day trial hook." },
    { label: "Plan", value: authRole === "owner" ? "Owner" : "User", note: "Billing page can plug into this card." },
    { label: "Access", value: isOwner ? "Advanced + Simple" : "Simple", note: "Advanced tools remain owner-only." },
  ];

  const pieceLegendItems = [
    { title: "Straight stock", detail: "Full stick, no cut and no bend.", kind: "straight" },
    { title: "Bent end", detail: "One or both ends return into the next side.", kind: "bent" },
    { title: "Vertical L", detail: "Vertical bar plus bottom overlap leg.", kind: "lbar" },
    { title: "Pier H-circle", detail: "Hoop/circle cut from pier clear diameter plus overlap.", kind: "circle" },
  ];

  const RebarMiniDiagram = ({ type, compact = false }: { type: RebarInfoType; compact?: boolean }) => {
    const isBase = type === "Base/Bottom rebar";
    const isHoriz = type === "Horiz continues longtidues";
    const isVertical = type === "Vertical Rebar";
    const isPier = type === "Pier";
    const isMisc = type === "Misc";
    const stroke = (active: boolean, fallback = "#CBD5E1") => active ? "#2563eb" : fallback;
    const fill = (active: boolean) => active ? "#DBEAFE" : "#F8FAFC";
    const labelFill = (active: boolean) => active ? "#1D4ED8" : "#475569";
    return (
      <div className={`${compact ? "max-w-xs" : "w-full"} rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur`}>
        {!compact && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-slate-900">Foundation rebar map</div>
              <div className="text-xs text-slate-500">Labeled guide for bottom bars, horizontal bars, traverse bars, vertical L bars, side/end walls, and piers.</div>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{type}</span>
          </div>
        )}
        <svg viewBox="0 0 520 260" className={`${compact ? "h-36" : "h-72"} w-full`} role="img" aria-label="Foundation rebar diagram with labeled elements">
          <defs>
            <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,4 L0,8 z" fill="#2563eb" />
            </marker>
            <marker id="arrow-slate" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
            </marker>
          </defs>
          <rect x="78" y="38" width="365" height="168" rx="12" fill="#ffffff" stroke="#334155" strokeWidth="5" />
          <rect x="96" y="60" width="329" height="124" rx="4" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="2" />

          <text x="260" y="28" textAnchor="middle" fontSize="16" fontWeight="800" fill="#334155">SIDE WALL</text>
          <text x="260" y="235" textAnchor="middle" fontSize="16" fontWeight="800" fill="#334155">SIDE WALL</text>
          <text x="33" y="124" textAnchor="middle" fontSize="15" fontWeight="800" fill="#334155" transform="rotate(-90 33 124)">END WALL</text>
          <text x="487" y="124" textAnchor="middle" fontSize="15" fontWeight="800" fill="#334155" transform="rotate(90 487 124)">END WALL</text>

          {[78, 96, 114].map((y, i) => <line key={`base-${i}`} x1="104" y1={y} x2="416" y2={y} stroke={stroke(isBase)} strokeWidth={isBase ? 7 : 4} strokeLinecap="round" />)}
          {[136, 154, 172].map((y, i) => <line key={`h-${i}`} x1="104" y1={y} x2="416" y2={y} stroke={stroke(isHoriz)} strokeWidth={isHoriz ? 6 : 3} strokeDasharray={isHoriz ? "" : "7 7"} strokeLinecap="round" />)}
          {[126, 166, 206, 246, 286, 326, 366, 406].map((x, i) => <line key={`tr-${i}`} x1={x} y1="66" x2={x} y2="184" stroke={stroke(isBase, "#CBD5E1")} strokeWidth={isBase ? 5 : 2.5} strokeLinecap="round" opacity={isBase ? 0.95 : 0.55} />)}
          {[126, 166, 206, 246, 286, 326, 366, 406].map((x, i) => <path key={`v-${i}`} d={`M${x} 45 v36 h22`} fill="none" stroke={stroke(isVertical)} strokeWidth={isVertical ? 6 : 3} strokeLinecap="round" strokeLinejoin="round" />)}
          {[158, 260, 362].map((x, i) => <g key={`p-${i}`}><circle cx={x} cy="116" r="24" fill={fill(isPier)} stroke={stroke(isPier)} strokeWidth={isPier ? 6 : 3} /><circle cx={x} cy="116" r="9" fill={stroke(isPier)} opacity={isPier ? 0.78 : 0.35} /><circle cx={x} cy="116" r="17" fill="none" stroke={stroke(isPier)} strokeWidth="2" opacity="0.7" /></g>)}

          <line x1="63" y1="78" x2="103" y2="78" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow-blue)" />
          <text x="58" y="75" textAnchor="end" fontSize="12" fontWeight="800" fill={labelFill(isBase)}>Bottom/base longitudinal bars</text>
          <line x1="52" y1="155" x2="103" y2="155" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow-blue)" />
          <text x="48" y="151" textAnchor="end" fontSize="12" fontWeight="800" fill={labelFill(isHoriz)}>Horizontal continuous bars</text>
          <line x1="445" y1="72" x2="408" y2="72" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow-blue)" />
          <text x="450" y="69" fontSize="12" fontWeight="800" fill={labelFill(isVertical)}>Vertical L bars</text>
          <line x1="445" y1="124" x2="385" y2="118" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow-blue)" />
          <text x="450" y="121" fontSize="12" fontWeight="800" fill={labelFill(isPier)}>Pier cage / H-circles</text>
          <line x1="418" y1="208" x2="367" y2="184" stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow-blue)" />
          <text x="423" y="213" fontSize="12" fontWeight="800" fill={labelFill(isBase)}>Traverse bars</text>
          <line x1="257" y1="220" x2="257" y2="184" stroke="#64748b" strokeWidth="2" markerEnd="url(#arrow-slate)" />
          <text x="260" y="252" textAnchor="middle" fontSize="12" fontWeight="800" fill="#64748b">Foundation floor mat / footing plan area</text>
          {isMisc && <text x="260" y="132" textAnchor="middle" fontSize="20" fontWeight="900" fill="#64748b">MISC / FIELD ITEM</text>}
        </svg>
        {!compact && (
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-5">
            <div className={`rounded border p-2 ${isBase ? "border-blue-300 bg-blue-50 text-blue-900" : "bg-white text-slate-600"}`}><strong>Base/bottom:</strong> longitudinal bars plus traverse bars in the mat.</div>
            <div className={`rounded border p-2 ${isHoriz ? "border-blue-300 bg-blue-50 text-blue-900" : "bg-white text-slate-600"}`}><strong>Horizontal:</strong> continuous wall/footing runs.</div>
            <div className={`rounded border p-2 ${isVertical ? "border-blue-300 bg-blue-50 text-blue-900" : "bg-white text-slate-600"}`}><strong>Vertical:</strong> L bars with base overlap.</div>
            <div className={`rounded border p-2 ${isPier ? "border-blue-300 bg-blue-50 text-blue-900" : "bg-white text-slate-600"}`}><strong>Pier:</strong> vertical cage bars and H-circles.</div>
            <div className={`rounded border p-2 ${isMisc ? "border-blue-300 bg-blue-50 text-blue-900" : "bg-white text-slate-600"}`}><strong>Misc:</strong> custom field pieces.</div>
          </div>
        )}
      </div>
    );
  };

  const reviewedPieceCount = schedule.filter((line) => reviewedPieceMarks.includes(line.mark)).length;
  const rebarTypeOrder: RebarInfoType[] = ["Base/Bottom rebar", "Horiz continues longtidues", "Vertical Rebar", "Pier", "Misc"];
  const rebarItemGroups = rebarTypeOrder.map((type) => ({
    type,
    rows: displayedRows.filter((row) => row.itemType === type),
  }));
  const missingInputWarnings = displayedRows.flatMap((row) => {
    const label = row.segment || row.itemType;
    const warnings: string[] = [];
    if (!row.rebarSize.trim()) warnings.push(`${label}: missing rebar size.`);
    if (row.itemType === "Base/Bottom rebar") {
      if (!row.length.trim()) warnings.push(`${label}: missing bottom run length.`);
      if (!row.number.trim() || row.number.toUpperCase() === "N/A") warnings.push(`${label}: longitudinal bar count is N/A.`);
      if (!row.traverseLength.trim()) warnings.push(`${label}: missing traverse piece len.`);
    }
    if (row.itemType === "Vertical Rebar") {
      if (!row.verticalSpacingAdjacent.trim()) warnings.push(`${label}: missing vertical spacing.`);
      if (!row.length.trim()) warnings.push(`${label}: missing vertical straight length.`);
    }
    if (row.itemType === "Pier") {
      if (!row.diameter.trim()) warnings.push(`${label}: missing pier diameter.`);
      if (!row.length.trim()) warnings.push(`${label}: missing pier cage length.`);
      if (!row.clearanceSides.trim()) warnings.push(`${label}: missing side spacing for H-circle diameter.`);
      if (!row.numVerticalBars.trim() || row.numVerticalBars.toUpperCase() === "N/A") warnings.push(`${label}: missing pier vertical bars count.`);
    }
    return warnings;
  });
  const allValidationWarnings = Array.from(new Set([...missingInputWarnings, ...engineValidationWarnings]));
  const stage6ShopCards = [
    { label: "Stock sticks", value: materialTakeoff?.sticksToBuy ?? "—", note: "Total to buy" },
    { label: "Straight/no change", value: materialTakeoff?.straightStockStickCount ?? 0, note: "No cut, no bend" },
    { label: "Cut or bent", value: materialTakeoff?.cutOrBentStockStickCount ?? 0, note: "Shop work needed" },
    { label: "Reviewed pieces", value: `${reviewedPieceCount}/${schedule.length}`, note: "Manual review marks" },
  ];

  const stage7StockCutPlan = (() => {
    const stockFeet = parseFeet(materialTakeoff?.stockLength || stickLength || "20") || 20;
    type PlannedPiece = {
      id: string;
      mark: string;
      location: string;
      size: string;
      category: "bottom" | "horizontal" | "vertical" | "pier";
      cutFeet: number;
      cutLength: string;
      bent: boolean;
      overStock: boolean;
    };
    type PlannedStick = {
      id: number;
      size: string;
      pieces: PlannedPiece[];
      usedFeet: number;
      wasteFeet: number;
      needsShopWork: boolean;
      hasOverStockPiece: boolean;
    };

    const pieces: PlannedPiece[] = [];
    schedule.forEach((line) => {
      const qty = Math.max(Number(line.qty) || 1, 1);
      const cutFeet = line.cutFeet || parseFeet(line.cutLength || "");
      for (let index = 0; index < qty; index += 1) {
        pieces.push({
          id: `${line.mark}-${index + 1}`,
          mark: line.mark,
          location: line.location,
          size: getScheduleRebarSizeLabel(line),
          category: getScheduleCategory(line),
          cutFeet,
          cutLength: line.cutLength,
          bent: /bent|bend|circle|hoop|return|lap/i.test(`${line.leftFunction} ${line.rightFunction} ${line.location}`),
          overStock: cutFeet > stockFeet + 0.01,
        });
      }
    });

    const sticks: PlannedStick[] = [];
    pieces
      .filter((piece) => piece.cutFeet > 0)
      .sort((a, b) => b.cutFeet - a.cutFeet)
      .forEach((piece) => {
        const target = !piece.overStock
          ? sticks.find((stick) => stockFeet - stick.usedFeet + 0.0001 >= piece.cutFeet)
          : undefined;
        if (target) {
          target.pieces.push(piece);
          target.usedFeet += piece.cutFeet;
          target.wasteFeet = Math.max(stockFeet - target.usedFeet, 0);
          target.needsShopWork = target.needsShopWork || piece.bent || piece.cutFeet < stockFeet;
          target.hasOverStockPiece = target.hasOverStockPiece || piece.overStock;
          target.size = Array.from(new Set(target.pieces.map((part) => part.size))).sort().join("/") || target.size;
        } else {
          sticks.push({
            id: 0,
            size: piece.size,
            pieces: [piece],
            usedFeet: piece.cutFeet,
            wasteFeet: piece.overStock ? 0 : Math.max(stockFeet - piece.cutFeet, 0),
            needsShopWork: piece.bent || piece.cutFeet < stockFeet || piece.overStock,
            hasOverStockPiece: piece.overStock,
          });
        }
      });

    return sticks.map((stick, index) => ({ ...stick, id: index + 1 }));
  })();


  const stage7RebarSizeTakeoff = (() => {
    const takeoff = new Map<string, { size: string; pieces: number; cutFeet: number; bends: number }>();
    schedule.forEach((line) => {
      const match = `${line.location} ${line.mark}`.match(/#\d+/);
      const size = match?.[0] || "Unknown";
      const current = takeoff.get(size) || { size, pieces: 0, cutFeet: 0, bends: 0 };
      current.pieces += Math.max(Number(line.qty) || 1, 1);
      current.cutFeet += (line.cutFeet || parseFeet(line.cutLength || "")) * Math.max(Number(line.qty) || 1, 1);
      if (/bent|bend|circle|hoop|return/i.test(`${line.leftFunction} ${line.rightFunction} ${line.location}`)) {
        current.bends += Math.max(Number(line.qty) || 1, 1);
      }
      takeoff.set(size, current);
    });
    return Array.from(takeoff.values()).sort((a, b) => a.size.localeCompare(b.size));
  })();

  const stage8EstimatePackageCards = [
    {
      title: "Customer Proposal",
      status: projectName && schedule.length ? "Ready draft" : "Needs project + schedule",
      detail: "Use the project name, PDF, schedule totals, and material takeoff as the starting point for a customer-facing quote.",
      accent: "blue",
    },
    {
      title: "Shop Package",
      status: schedule.length ? "Ready to export" : "Generate first",
      detail: "Cut list, bends, piece sketches, stock sticks, and waste summary for field/shop use.",
      accent: "emerald",
    },
    {
      title: "Review Package",
      status: allValidationWarnings.length ? `${allValidationWarnings.length} checks` : "Clean",
      detail: "Missing input warnings and reviewed-piece marks help avoid sending incomplete schedules.",
      accent: "amber",
    },
  ];

  const stage8TemplateCards: { title: string; detail: string; action: string; templateKey: "rectangle" | "pier" | "wall" }[] = [
    {
      title: "Rectangle Foundation",
      detail: "Adds side-wall bottom, end-wall bottom, vertical L-bar, and pier cage starter rows.",
      action: "Add rows",
      templateKey: "rectangle",
    },
    {
      title: "Pier / Sonotube Layout",
      detail: "Adds a pier cage starter row with vertical bars, H-circle hoops, clearances, and hoop lap notes.",
      action: "Add pier",
      templateKey: "pier",
    },
    {
      title: "Wall / Stem Detail",
      detail: "Adds horizontal continuous bars and vertical L-bar starter rows for a wall/stem detail.",
      action: "Add wall",
      templateKey: "wall",
    },
  ];

  const stage8AuditTrail = [
    { label: "Project", value: projectName || "Untitled project" },
    { label: "Plan", value: planFileName || "No PDF loaded" },
    { label: "Manual rows", value: String(rebarInfoRows.length) },
    { label: "Schedule", value: savedScheduleAt ? `Last generated ${new Date(savedScheduleAt).toLocaleString()}` : "Not generated yet" },
  ];

  const projectStatusOptions: ProjectStatus[] = ["Draft", "Review", "Ready for Shop", "Issued", "Archived"];
  const projectStatusHelp: Record<ProjectStatus, string> = {
    Draft: "Still being entered or checked.",
    Review: "Ready for internal review before shop use.",
    "Ready for Shop": "Inputs and generated schedule are ready for fabrication review.",
    Issued: "Released to customer, field, or shop.",
    Archived: "Hidden from the normal project list but still saved.",
  };
  const projectStatusTone: Record<ProjectStatus, string> = {
    Draft: "border-slate-200 bg-slate-50 text-slate-700",
    Review: "border-amber-200 bg-amber-50 text-amber-800",
    "Ready for Shop": "border-emerald-200 bg-emerald-50 text-emerald-800",
    Issued: "border-blue-200 bg-blue-50 text-blue-800",
    Archived: "border-zinc-300 bg-zinc-100 text-zinc-700",
  };


  const stage9QualityChecks = [
    {
      title: "Project setup",
      ok: Boolean(projectName && projectName.trim()),
      detail: projectName ? "Project name is ready." : "Add a project name before sharing or exporting.",
    },
    {
      title: "PDF evidence",
      ok: Boolean(planFileName),
      detail: planFileName ? "Plan PDF is attached to this workspace." : "Upload the foundation plan PDF.",
    },
    {
      title: "Crop references",
      ok: cropRefs.length > 0,
      detail: cropRefs.length ? `${cropRefs.length} crop reference${cropRefs.length === 1 ? "" : "s"} saved.` : "Save at least one crop for visual proof if needed.",
    },
    {
      title: "Manual rebar rows",
      ok: rebarInfoRows.length > 0,
      detail: rebarInfoRows.length ? `${rebarInfoRows.length} manual row${rebarInfoRows.length === 1 ? "" : "s"} entered.` : "Add base, vertical, pier, or misc rebar rows.",
    },
    {
      title: "Schedule generated",
      ok: schedule.length > 0,
      detail: schedule.length ? `${schedule.length} schedule line${schedule.length === 1 ? "" : "s"} available.` : "Generate the rebar schedule after inputs are complete.",
    },
    {
      title: "Shop review",
      ok: schedule.length > 0 && reviewedPieceMarks.length >= Math.min(schedule.length, 1),
      detail: schedule.length ? `${reviewedPieceMarks.length} reviewed mark${reviewedPieceMarks.length === 1 ? "" : "s"}.` : "Review marks become available after schedule generation.",
    },
  ];
  const stage9ReadyCount = stage9QualityChecks.filter((check) => check.ok).length;
  const stage9ReadyPercent = Math.round((stage9ReadyCount / Math.max(stage9QualityChecks.length, 1)) * 100);

  const stage9CommercialCards = [
    {
      title: "Client-ready workflow",
      value: `${stage9ReadyPercent}%`,
      detail: "Combines project setup, PDF evidence, manual rows, schedule generation, and shop review.",
      tone: "blue",
    },
    {
      title: "SaaS access path",
      value: isOwner ? "Owner tools" : "Simple view",
      detail: "Advanced view remains owner-only. Users stay in the simplified commercial workflow.",
      tone: "emerald",
    },
    {
      title: "Support readiness",
      value: "Help stub",
      detail: "Placeholder for future help center, tutorial videos, support email, and billing FAQ.",
      tone: "amber",
    },
  ];

  const stage9WorkflowSteps = [
    { step: "1", title: "Create project", detail: "Name the job and attach the foundation PDF." },
    { step: "2", title: "Review plan", detail: "Use the small/medium/large PDF viewer and crop proof areas." },
    { step: "3", title: "Enter rebar", detail: "Use the manual rows and the diagram guide to describe each rebar system." },
    { step: "4", title: "Generate", detail: "Build the schedule, cut list, stock takeoff, and piece sketches." },
    { step: "5", title: "Review + export", detail: "Mark pieces reviewed and download the shop-ready CSV." },
  ];

  const stage10CommercialModules = [
    {
      title: "Estimator Workspace",
      status: projectName ? "Active" : "Needs project",
      detail: "Project header, PDF evidence, rebar inputs, schedule status, and export controls are presented as one professional job workspace.",
    },
    {
      title: "Shop Package",
      status: schedule.length ? "Ready" : "Generate schedule",
      detail: "Cut list, piece sketches, stock stick summary, bends, waste, and material takeoff are grouped for field/shop review.",
    },
    {
      title: "Client Package",
      status: schedule.length && projectName ? "Draft ready" : "Waiting",
      detail: "Future proposal export can reuse the same saved schedule, project name, PDF file name, and material totals.",
    },
    {
      title: "Subscription Path",
      status: isOwner ? "Owner preview" : "Locked preview",
      detail: "Trial, billing, and plan-limit areas are placeholders only for now; no payment logic is active yet.",
    },
  ];

  const stage10LaunchChecklist = [
    { label: "Branding", done: true, note: "Professional header, sidebar, background, and R icon area are in place." },
    { label: "Project workflow", done: Boolean(projectName && planFileName), note: projectName && planFileName ? "Project and PDF are attached." : "Add a project name and PDF to complete this step." },
    { label: "Rebar input", done: rebarInfoRows.length > 0, note: rebarInfoRows.length ? `${rebarInfoRows.length} manual rebar row${rebarInfoRows.length === 1 ? "" : "s"} entered.` : "Add at least one rebar row." },
    { label: "Schedule package", done: schedule.length > 0, note: schedule.length ? `${schedule.length} schedule line${schedule.length === 1 ? "" : "s"} generated and saved with the project.` : "Generate the schedule." },
    { label: "Export", done: schedule.length > 0, note: "CSV export is available from the schedule area." },
  ];

  const stage10DoneCount = stage10LaunchChecklist.filter((item) => item.done).length;

  const stage11DocumentationCards = [
    {
      title: "Getting Started",
      tag: "User guide",
      detail: "Create a project, upload the PDF, crop evidence, enter manual rows, and generate a shop-ready schedule.",
      action: "Use for onboarding",
    },
    {
      title: "Rebar Entry Rules",
      tag: "Calculation guide",
      detail: "Explains base/bottom, horizontal, vertical L bars, traverse bars, pier verticals, H-circles, overlaps, and bend overlap lengths.",
      action: "Connect to docs later",
    },
    {
      title: "Shop Review",
      tag: "Quality control",
      detail: "Review piece sketches, cut length, used length, left/right function, and mark each line reviewed before export.",
      action: "Use before download",
    },
    {
      title: "Subscription Help",
      tag: "Future SaaS",
      detail: "Placeholder for trial limits, paid plans, billing questions, and owner/admin/user access rules.",
      action: "Payment step later",
    },
  ];

  const stage11ActionShortcuts = [
    { label: "Open Plan", target: "plan", detail: "Jump to project information and PDF viewer." },
    { label: "Manual Rows", target: "rebar-input", detail: "Jump to the manual rebar parameter rows." },
    { label: "Generate", target: "schedule", detail: "Create or refresh the saved schedule." },
    { label: "Review Pieces", target: "schedule", detail: "Check sketches, cut lengths, and reviewed marks." },
  ];

  const stage11SupportItems = [
    { label: "Owner-only advanced view", ready: isOwner, detail: isOwner ? "Visible for owner account." : "Hidden from user/admin commercial workflow." },
    { label: "Simple user workflow", ready: true, detail: "Normal users stay in the simplified PDF + manual input + schedule workflow." },
    { label: "Saved schedule", ready: Boolean(savedScheduleAt), detail: savedScheduleAt ? `Last saved ${new Date(savedScheduleAt).toLocaleString()}` : "Generate once to save the current schedule with the project." },
    { label: "Export package", ready: schedule.length > 0, detail: schedule.length ? "CSV/Excel-compatible shop list is available." : "Generate schedule to enable export." },
  ];


  const stage13CalculationRules = [
    {
      title: "Base / bottom longitudinal bars",
      formula: "outer run = entered length; inner run = entered length - spacing offset at every bent end",
      detail: "Used for rectangle base mats where each side has several continuous longitudinal bars. The duplicate count represents matching sides.",
      type: "bottom",
    },
    {
      title: "Traverse bars",
      formula: "qty = floor(run length / spacing) + 1 when Number is N/A; cut len = Traverse piece len",
      detail: "Traverse pieces cross the bottom mat and are multiplied by the same matching-side count as the base/bottom row.",
      type: "bottom",
    },
    {
      title: "Vertical L bars",
      formula: "qty = floor(total bottom run / vertical spacing) + 1 when Count is N/A; cut = straight len + bent overlap len",
      detail: "The calculated run can use the combined bottom perimeter. Straight height should account for top/bottom concrete clearance.",
      type: "vertical",
    },
    {
      title: "Pier H-circles / hoops",
      formula: "hoop dia = pier diameter - 2 × side spacing; cut = π × hoop dia + 2 in overlap",
      detail: "Hoop count can be entered directly or calculated from clear pier height and hoop spacing.",
      type: "pier",
    },
    {
      title: "Pier verticals",
      formula: "straight = pier length - top spacing - bottom spacing; cut = straight + vertical bent overlap",
      detail: "Total quantity = number of piers × vertical bars per pier.",
      type: "pier",
    },
    {
      title: "Stock splitting",
      formula: "long runs split by stock stick length and lap overlap; latest generated schedule overwrites previous one",
      detail: "The saved schedule is the current shop package, not a history log.",
      type: "all",
    },
  ];

  const stage13AuditRows = [
    {
      label: "Base/bottom rows",
      value: rebarTypeCounts["Base/Bottom rebar"],
      status: rebarTypeCounts["Base/Bottom rebar"] > 0 ? "Ready" : "Add row",
      note: "Controls bottom longitudinal bars and traverse pieces.",
    },
    {
      label: "Vertical rows",
      value: rebarTypeCounts["Vertical Rebar"],
      status: rebarTypeCounts["Vertical Rebar"] > 0 ? "Ready" : "Optional/missing",
      note: "Needed for L bars around the perimeter.",
    },
    {
      label: "Pier rows",
      value: rebarTypeCounts.Pier,
      status: rebarTypeCounts.Pier > 0 ? "Ready" : "Optional/missing",
      note: "Needed for pier verticals and H-circles.",
    },
    {
      label: "Generated schedule lines",
      value: schedule.length,
      status: schedule.length > 0 ? "Generated" : "Not generated",
      note: "Saved with the project after Generate Rebar Schedule.",
    },
    {
      label: "Rows needing review",
      value: allValidationWarnings.length,
      status: allValidationWarnings.length ? "Check" : "Clean",
      note: "Missing inputs are shown before shop export.",
    },
  ];

  const stage13EngineReadyScore = Math.round(
    (
      stage13AuditRows.filter((row) => row.status === "Ready" || row.status === "Generated" || row.status === "Clean").length /
      Math.max(stage13AuditRows.length, 1)
    ) * 100,
  );

  const readinessMissing = [
    projectName ? "" : "project name",
    planFileName ? "" : "PDF",
    cropRefs.length ? "" : "crops",
    rebarInfoRows.length ? "" : "rebar rows",
    schedule.length ? "" : "schedule",
  ].filter(Boolean);
  const compactReadinessStatus = readinessMissing.length === 0 ? "Complete" : `Missing: ${readinessMissing.join(", ")}`;

  const InfoTip = ({ text }: { text: string }) => (
    <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 bg-blue-50 text-xs font-bold text-blue-700" title={text} aria-label={text}>i</span>
  );

  return (
    <main
      className="min-h-screen bg-slate-100 bg-cover bg-fixed bg-center p-4 text-slate-900 md:p-6"
      style={{
        backgroundImage:
          "linear-gradient(rgba(248,250,252,0.68), rgba(241,245,249,0.74)), url('/rebar-background.png')",
      }}
    >
      <div className="mx-auto w-full max-w-[1800px]">

        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden xl:block">
            <div className="sticky top-6 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur">
              <div className="border-b bg-gradient-to-br from-slate-950 to-blue-950 p-5 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-black shadow-lg">R</div>
                  <div>
                    <div className="text-sm font-black uppercase tracking-wide">Rebar Planner</div>
                    <div className="text-xs text-blue-100">Foundation schedule workbench</div>
                  </div>
                </div>
              </div>
              <nav className="space-y-3 p-4 text-sm font-bold">
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Workspace</div>
                  <a href="#top" className="rp-menu-item"><span>Dashboard</span><span className="text-xs">↗</span></a>
                  <button type="button" onClick={() => setShowPlanPanel((value) => !value)} className="rp-menu-item"><span>Plan + PDF</span><span className="text-xs">{showPlanPanel ? "Hide" : "Show"}</span></button>
                </div>
                <div>
                  <button type="button" onClick={() => setShowProjectsMenu((value) => !value)} className="rp-menu-heading"><span>Projects</span><span>{showProjectsMenu ? "▾" : "▸"}</span></button>
                  {showProjectsMenu && (
                    <div className="mt-2 space-y-1 pl-2">
                      <button type="button" onClick={startNewProject} className="rp-menu-item"><span>New Project</span><span className="text-xs">New</span></button>
                      <button type="button" onClick={saveWorkspace} className="rp-menu-item"><span>Save Project</span><span className="text-xs">Save</span></button>
                      <button type="button" onClick={loadWorkspace} className="rp-menu-item"><span>Load Workspace</span><span className="text-xs">Last</span></button>
                      <button type="button" onClick={() => { setShowProjectLibrary((value) => !value); loadSavedProjects(); }} className="rp-menu-item"><span>Project Library</span><span className="text-xs">{savedProjects.length} {showProjectLibrary ? "▾" : "▸"}</span></button>
                      {showProjectLibrary && (
                        <div className="mt-2 max-h-56 space-y-2 overflow-auto pr-1">
                          {savedProjects.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">No saved projects loaded.</div>
                          ) : (
                            savedProjects.slice(0, 8).map((project) => (
                              <button key={project.id} type="button" onClick={() => loadProject(project.id)} className={`w-full rounded-xl border bg-white p-3 text-left text-xs text-slate-900 hover:border-blue-300 hover:bg-blue-50 ${project.id === currentProjectId ? "border-blue-400 bg-blue-50" : ""}`}>
                                <div className="truncate font-black text-slate-950">{project.projectFavorite ? "★ " : ""}{project.projectName}</div>
                                <div className="mt-1 truncate font-semibold text-slate-500">{project.planFileName || "No PDF"}</div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${projectStatusTone[project.projectStatus]}`}>{project.projectStatus}</span>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">Rows {project.rowCount}</span>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Rebar input</div>
                  <a href="#rebar-input" className="rp-menu-item"><span>Manual Parameters</span></a>
                  <a href="#type-summary" className="rp-menu-item"><span>Type Summary</span></a>
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Output</div>
                  <a href="#schedule-output" className="rp-menu-item"><span>Schedule</span><span className="text-xs">CSV</span></a>
                  <button type="button" onClick={generateSchedule} disabled={isGeneratingSchedule} className="rp-menu-item"><span>{isGeneratingSchedule ? "Generating..." : "Generate Schedule"}</span><span className="text-xs">Run</span></button>
                </div>
                {isOwner && (
                  <div>
                    <button type="button" onClick={() => setShowOwnerMenu((value) => !value)} className="rp-menu-heading owner"><span>Owner view</span><span>{showOwnerMenu ? "▾" : "▸"}</span></button>
                    {showOwnerMenu && (
                      <div className="mt-2 space-y-1 pl-2">
                        <button type="button" onClick={() => setPlannerView("simple")} className="rp-menu-item"><span>Advanced 1</span><span className="text-xs">User/Admin</span></button>
                        <button type="button" onClick={() => setPlannerView("advanced")} className="rp-menu-item"><span>Advanced 2</span><span className="text-xs">Owner</span></button>
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <button type="button" onClick={() => setShowSubscriptionMenu((value) => !value)} className="rp-menu-heading subscription"><span>Subscription</span><span>{showSubscriptionMenu ? "▾" : "▸"}</span></button>
                  {showSubscriptionMenu && (
                    <div className="mt-2 space-y-1 pl-2">
                      <Link href="/pricing" className="rp-menu-item"><span>Subscription</span><span className="text-xs">Plan</span></Link>
                      <Link href="/billing" className="rp-menu-item"><span>Billing</span><span className="text-xs">Pay</span></Link>
                    </div>
                  )}
                </div>
                <div>
                  <button type="button" onClick={() => setShowHelpMenu((value) => !value)} className="rp-menu-heading help"><span>Help / Docs</span><span className="rp-arrow">{showHelpMenu ? "▾" : "▸"}</span></button>
                  {showHelpMenu && (
                    <div className="mt-2 space-y-1 pl-2">
                      <Link href="/docs" className="rp-menu-item"><span>Help / Docs</span><span className="text-xs">Open</span></Link>
                      <button type="button" onClick={() => setShowPieceLegend((value) => !value)} className="rp-menu-item"><span>Piece legend</span><span className="text-xs">{showPieceLegend ? "Hide" : "Show"}</span></button>
                      <button type="button" onClick={() => setShowFoundationMap((value) => !value)} className="rp-menu-item"><span>Foundation map</span><span className="text-xs">{showFoundationMap ? "Hide" : "Show"}</span></button>
                      <button type="button" onClick={() => setShowWasteReport((value) => !value)} className="rp-menu-item"><span>Waste cutoff report</span><span className="text-xs">{showWasteReport ? "Hide" : "Show"}</span></button>
                      <button type="button" onClick={() => setShowShopPlanning((value) => !value)} className="rp-menu-item"><span>Shop planning boxes</span><span className="text-xs">{showShopPlanning ? "Hide" : "Show"}</span></button>
                      <button type="button" onClick={() => setShowEngineAudit((value) => !value)} className="rp-menu-item"><span>Engine rules/audit</span><span className="text-xs">{showEngineAudit ? "Hide" : "Show"}</span></button>
                      <button type="button" onClick={() => setShowClientReadiness((value) => !value)} className="rp-menu-item"><span>Client readiness</span><span className="text-xs">{showClientReadiness ? "Hide" : "Show"}</span></button>
                      <button type="button" onClick={() => setShowProductWorkspace((value) => !value)} className="rp-menu-item"><span>Product/SaaS panels</span><span className="text-xs">{showProductWorkspace ? "Hide" : "Show"}</span></button>
                      <button type="button" onClick={() => setShowSupportCenter((value) => !value)} className="rp-menu-item"><span>Support center</span><span className="text-xs">{showSupportCenter ? "Hide" : "Show"}</span></button>
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wider text-red-500">Account</div>
                  <button type="button" onClick={logout} className="rp-menu-item danger"><span>Logout</span><span className="text-xs">Exit</span></button>
                </div>
              </nav>
              <div className="border-t bg-slate-50 p-4 text-xs text-slate-500">
                <div className="font-bold text-slate-700">{user.email}</div>
                <div className="mt-1">Role: {authRole}</div>
              </div>
            </div>
          </aside>
          <div id="top" className="min-w-0">
        {pierDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl">
              <h2 className="text-2xl font-bold">Pier Details</h2>
              <p className="mt-2 text-sm text-gray-600">
                Confirm this before calculation. The app will not guess the
                final pier count from OCR/image detection.
              </p>

              <div className="mt-4 grid gap-4">
                <label className="block">
                  <span className="mb-1 block font-semibold">Pier Count</span>
                  <input
                    value={getFieldValue("pierCount")}
                    onChange={(event) =>
                      updateField("pierCount", event.target.value)
                    }
                    placeholder="Example: 14"
                    className="w-full rounded border p-2"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold">
                    Pier Diameter
                  </span>
                  <input
                    value={getFieldValue("pierDiameter")}
                    onChange={(event) =>
                      updateField("pierDiameter", event.target.value)
                    }
                    placeholder={'Example: 28"'}
                    className="w-full rounded border p-2"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-semibold">
                    Pier Height / Cage Height
                  </span>
                  <input
                    value={getFieldValue("pierHeight")}
                    onChange={(event) =>
                      updateField("pierHeight", event.target.value)
                    }
                    placeholder={`Example: 30" or 2'-6"`}
                    className="w-full rounded border p-2"
                  />
                  <span className="mt-1 block text-xs text-gray-500">
                    Enter the pier concrete height or the rebar cage height you
                    want the schedule to reference.
                  </span>
                </label>
              </div>

              {pierMessage && (
                <div className="mt-3 rounded border border-yellow-300 bg-yellow-50 p-2 text-sm text-yellow-900">
                  {pierMessage}
                </div>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => savePierDetails("none")}
                  className="rounded border border-gray-400 px-4 py-2 font-semibold hover:bg-gray-50"
                >
                  I do not have piers
                </button>
                <button
                  type="button"
                  onClick={() => setPierDialogOpen(false)}
                  className="rounded border border-gray-400 px-4 py-2 font-semibold hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => savePierDetails("yes")}
                  className="rounded bg-purple-700 px-4 py-2 font-semibold text-white hover:bg-purple-800"
                >
                  Save Pier Details
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="mb-6 overflow-hidden rounded-2xl border border-white/20 bg-white/95 shadow-2xl backdrop-blur">
          <div className="bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 p-6 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.3em] text-blue-200">Commercial Rebar Estimator</div>
                <h1 className="mt-2 text-4xl font-black">Rebar Planner</h1>
                <p className="mt-2 max-w-3xl text-blue-100">Upload a foundation plan, crop important details, enter manual rebar parameters, and generate a professional cut schedule.</p>
              </div>
              <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm backdrop-blur">
                <div className="text-blue-100">Current project</div>
                <div className="text-lg font-bold">{projectName || "Untitled project"}</div>
              </div>
            </div>
          </div>
          <div className="p-6">
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded border bg-gray-50 px-3 py-2">{user.email} · {authRole}</span>
            {(authRole === "owner" || authRole === "admin") && <Link href="/admin" className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">Admin</Link>}
            {workspaceStatus && <span className="text-gray-600">{workspaceStatus}</span>}
          </div>
          </div>
        </div>

        <section className="mb-4">
          <div className="rounded-2xl border border-slate-200 bg-white/75 bg-cover bg-center p-3 shadow-xl backdrop-blur" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.78), rgba(255,255,255,0.84)), url('/rebar-background.png')" }}>
            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-800">
              <span className="text-xs font-black uppercase tracking-[0.22em] text-blue-700">Status:</span>
              <span className={readinessMissing.length === 0 ? "text-emerald-700" : "text-amber-800"}>{compactReadinessStatus}</span>
              {scheduleGenerationStatus && <span className="text-slate-500">| {scheduleGenerationStatus}</span>}
            </div>
          </div>
        </section>

        {materialTakeoff && (
          <section className="mb-4 rounded-2xl border border-blue-100 bg-white/70 bg-cover bg-center p-3 text-slate-950 shadow-sm" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.78)), url('/rebar-background.png')" }}>
            <div className="grid gap-2 md:grid-cols-5 xl:grid-cols-9">
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-blue-700">Sticks</div><div className="text-xl font-black">{materialTakeoff.sticksToBuy}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-slate-600">Total cut</div><div className="text-xl font-black">{materialTakeoff.totalCut}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-slate-600">Stock len</div><div className="text-xl font-black">{materialTakeoff.stockLength}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-slate-600">Available</div><div className="text-xl font-black">{materialTakeoff.availableLength}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Straight</div><div className="text-xl font-black">{materialTakeoff.straightStockStickCount ?? 0}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-amber-700">Cut/Bent</div><div className="text-xl font-black">{materialTakeoff.cutOrBentStockStickCount ?? 0}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-orange-700">Cuts</div><div className="text-xl font-black">{materialTakeoff.cutCount}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-orange-700">Bends</div><div className="text-xl font-black">{materialTakeoff.bendCount}</div></div>
              <div className="rounded-xl bg-white/78 p-2"><div className="text-[10px] font-black uppercase tracking-wide text-red-700">Waste</div><div className="text-xl font-black">{materialTakeoff.waste}</div><div className="text-[10px] font-bold text-red-700">{materialTakeoff.wastePieceCount ?? 0} pcs · max {materialTakeoff.maxWastePiece || "0'"}</div></div>
            </div>
          </section>
        )}

        {plannerView === "simple" && showPlanPanel && (
          <section id="plan-panel" className="mb-6 rounded-2xl border border-slate-200 bg-white/75 bg-cover bg-center p-5 shadow-xl" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.78), rgba(255,255,255,0.84)), url('/rebar-background.png')" }}>
            <div className="flex items-center justify-between gap-3"><h2 className="text-2xl font-bold text-gray-900">Project Information</h2><button type="button" onClick={() => setShowPlanPanel(false)} className="rounded-xl border px-3 py-2 text-sm font-bold hover:bg-slate-50">Hide Plan + PDF</button></div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="font-semibold">Project name
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="mt-1 w-full rounded border p-1.5 text-sm" />
              </label>
              <div className="rounded border bg-gray-50 p-3">
                <div className="text-sm font-semibold text-gray-600">PDF file</div>
                <div className="font-bold text-gray-900">{planFileName || "No PDF loaded"}</div>
              </div>
              <div className="rounded border bg-gray-50 p-3">
                <div className="text-sm font-semibold text-gray-600">File info</div>
                <div className="font-bold text-gray-900">{planFileType || "unknown"}{fileSizeLabel ? ` · ${fileSizeLabel}` : ""}</div>
              </div>
            </div>
            <div className={`mt-5 rounded-2xl border bg-slate-50 p-4 ${pdfPanelSizeClass}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xl font-bold">PDF Viewer</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="mr-2 flex rounded-lg border bg-white p-1">
                    {(["small", "medium", "large"] as const).map((size) => (
                      <button key={size} type="button" onClick={() => setPdfPanelSize(size)} className={`rounded px-3 py-1 text-xs font-bold capitalize ${pdfPanelSize === size ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{size}</button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setPdfZoom((z) => Math.max(50, z - 25))} className="rounded border bg-white px-3 py-2 font-semibold hover:bg-gray-100">−</button>
                  <span className="min-w-16 text-center font-semibold">{pdfZoom}%</span>
                  <button type="button" onClick={() => setPdfZoom((z) => Math.min(200, z + 25))} className="rounded border bg-white px-3 py-2 font-semibold hover:bg-gray-100">+</button>
                </div>
              </div>
              {pdfViewerUrl ? (
                <iframe src={pdfViewerUrl} title="PDF plan viewer" className={`${pdfPanelHeightClass} w-full rounded border bg-white`} />
              ) : (
                <div className="rounded border border-dashed bg-white p-8 text-center text-gray-600">No PDF available in this project yet. Load a saved project with a PDF plan.</div>
              )}
            </div>

            {planPreviewUrl && isPdf && (
              <div className="mt-5 rounded border border-blue-200 bg-blue-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-blue-950">Crop evidence from PDF</h3>
                    <p className="text-sm text-blue-900">Available in Simplified View for all users. Use it when the PDF sheet is huge and you only need a footing, wall, pier, or rebar detail.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm font-semibold text-blue-950">Page
                      <input
                        type="number"
                        min="1"
                        value={regionPageNumber}
                        onChange={(event) => setRegionPageNumber(event.target.value)}
                        className="ml-2 w-20 rounded border p-2"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={startCropMode}
                      className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      Start Crop <InfoTip text="Render this PDF page at high resolution, then drag a rectangle around the detail you need." />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {cropRefs.length > 0 && (
              <div className="mt-4 rounded border border-gray-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-950">Saved Crop Images</h3>
                    <p className="text-sm text-gray-600">Saved crop images load with the project and can be attached to rebar parameter rows.</p>
                  </div>
                  <span className="rounded bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">{cropRefs.length} crop{cropRefs.length === 1 ? "" : "s"}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {cropRefs.map((crop) => (
                    <div key={crop.id} className="rounded border bg-gray-50 p-2 text-xs">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-gray-950">{cropDisplayName(crop)}</div>
                          <div className="text-gray-600">{crop.elementType}{crop.note ? ` · ${crop.note}` : ""}</div>
                        </div>
                        <button type="button" onClick={() => deleteCrop(crop.id)} className="rounded border bg-white px-2 py-1 font-semibold hover:bg-gray-100">Delete</button>
                      </div>
                      {cropImageUrl(crop) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cropImageUrl(crop)} alt={crop.label} className="h-36 w-full rounded border bg-white object-contain" />
                      ) : (
                        <div className="flex h-36 items-center justify-center rounded border bg-white text-gray-500">Image URL missing</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {planPreviewUrl && isPdf && cropToolOpen && (
              <div ref={cropToolRef} className="mt-5 rounded border border-blue-200 bg-blue-50 p-4">
                <h3 className="mb-2 text-lg font-semibold text-blue-950">
                  Crop Evidence / Selected Rectangle
                </h3>
                <p className="mb-3 text-sm text-blue-900">
                  Render one PDF page, drag a box around the needed detail, then save it as crop evidence for this project.
                </p>

                <div className="mb-3 flex flex-wrap items-end gap-3">
                  <label className="text-sm font-semibold">
                    Page
                    <input
                      type="number"
                      min="1"
                      value={regionPageNumber}
                      onChange={(event) => setRegionPageNumber(event.target.value)}
                      className="ml-2 w-20 rounded border p-2"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={renderRegionSelectionPage}
                    className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    Re-render Page
                  </button>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={analyzeSelectedRegion}
                      disabled={!regionRect}
                      className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:bg-gray-400"
                    >
                      Analyze Selected Rectangle
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={saveSelectedCrop}
                    disabled={!regionRect}
                    className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:bg-gray-400"
                  >
                    Save Crop Evidence
                  </button>
                  <div className="flex items-center gap-2 rounded border bg-white px-2 py-1">
                    <span className="text-xs font-semibold text-gray-700">Viewer zoom</span>
                    <button
                      type="button"
                      onClick={() => setRegionZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}
                      className="rounded bg-gray-200 px-3 py-1 text-sm font-bold hover:bg-gray-300"
                    >
                      −
                    </button>
                    <span className="w-14 text-center text-xs font-semibold">{Math.round(regionZoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setRegionZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100))}
                      className="rounded bg-gray-200 px-3 py-1 text-sm font-bold hover:bg-gray-300"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegionZoom(1)}
                      className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold hover:bg-gray-200"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="mb-3 grid gap-3 rounded border border-blue-200 bg-white p-3 md:grid-cols-4">
                  <label className="text-sm font-semibold">Crop type
                    <select
                      value={cropElementType}
                      onChange={(event) => {
                        const next = event.target.value as RebarInfoType;
                        setCropElementType(next);
                        setCropLabel(`${next} crop`);
                      }}
                      className="mt-1 w-full rounded border p-1.5 text-sm"
                    >
                      {rebarInfoTypes.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">Crop label
                    <input value={cropLabel} onChange={(event) => setCropLabel(event.target.value)} className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                  <label className="text-sm font-semibold md:col-span-2">Crop note
                    <input value={cropNote} onChange={(event) => setCropNote(event.target.value)} placeholder="Example: Side wall detail rebar callout" className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                </div>

                <div className="mb-2 rounded border border-yellow-300 bg-yellow-50 p-2 text-sm text-yellow-900">
                  Drag directly on the canvas below to mark the crop rectangle. After the red box appears, choose type/label/note and click Save Crop Evidence.
                </div>
                <div className="overflow-auto rounded border bg-white p-2">
                  <canvas
                    ref={regionCanvasRef}
                    onMouseDown={handleRegionMouseDown}
                    onMouseMove={handleRegionMouseMove}
                    onMouseUp={handleRegionMouseUp}
                    onMouseLeave={handleRegionMouseUp}
                    className="block h-auto cursor-crosshair rounded"
                    style={{ width: `${regionZoom * 100}%`, maxWidth: "none" }}
                  />
                </div>

                {regionRect && (
                  <div className="mt-2 text-xs text-blue-900">
                    Selected box: x {Math.round(regionRect.x)}, y {Math.round(regionRect.y)}, w {Math.round(regionRect.width)}, h {Math.round(regionRect.height)}
                  </div>
                )}

                {regionStatus && (
                  <div className="mt-3 rounded border border-blue-300 bg-white p-2 text-sm text-blue-950">
                    {regionStatus}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {plannerView === "advanced" && (
        <>
        <section className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Saved Projects</h2>
              <p className="text-sm text-gray-600">Projects are saved in Firestore with crops, parameters, and rebar info rows. Load a project to edit and re-run.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded border bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={showArchivedProjects} onChange={(event) => setShowArchivedProjects(event.target.checked)} />
                Show archived
              </label>
              <button type="button" onClick={() => loadSavedProjects()} className="rounded bg-gray-200 px-3 py-2 font-semibold hover:bg-gray-300">Refresh Projects</button>
            </div>
          </div>
          {savedProjects.length === 0 ? (
            <p className="rounded border border-dashed p-3 text-gray-600">No saved projects yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b bg-gray-50 text-sm text-gray-600">
                    <th className="p-2">Project</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Plan</th>
                    <th className="p-2">Rows</th>
                    <th className="p-2">Crops</th>
                    <th className="p-2">Updated</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {savedProjects.map((project) => (
                    <tr key={project.id} className={`border-b ${project.id === currentProjectId ? "bg-blue-50" : ""}`}>
                      <td className="p-2 font-semibold">{project.projectFavorite ? "★ " : ""}{project.projectName}</td>
                      <td className="p-2"><span className={`rounded-full border px-2 py-1 text-xs font-black ${projectStatusTone[project.projectStatus]}`}>{project.projectStatus}</span></td>
                      <td className="p-2 text-sm text-gray-700">{project.planFileName}</td>
                      <td className="p-2">{project.rowCount}</td>
                      <td className="p-2">{project.cropCount}</td>
                      <td className="p-2 text-sm text-gray-600">{project.updatedAtLabel || ""}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => loadProject(project.id)} className="rounded bg-blue-700 px-3 py-1.5 font-semibold text-white hover:bg-blue-800">Load / Edit</button>
                          {project.projectArchived ? (
                            <button type="button" onClick={() => restoreProjectFromArchive(project.id)} className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700">Restore</button>
                          ) : null}
                          <button type="button" onClick={() => deleteProject(project.id, project.projectName)} className="rounded bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-2xl font-semibold">Project Setup</h2>

            <div className="grid gap-4">
              <div>
                <label className="mb-1 block font-semibold">Project Name</label>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  className="w-full rounded border p-2"
                />
              </div>

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 font-semibold">Extraction Mode</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded border p-3 ${extractionMode === "live" ? "border-red-300 bg-red-50" : "bg-white"}`}
                  >
                    <input
                      type="radio"
                      name="extractionMode"
                      checked={extractionMode === "live"}
                      onChange={() => setExtractionMode("live")}
                    />
                    <span>
                      <strong>Live Mode</strong>
                      <span className="block text-xs text-gray-600">
                        Internal-only by default: PDF text, selected-region/page rendering tools, user input, and traced calculations. Missing stays Missing.
                      </span>
                    </span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded border p-3 ${extractionMode === "simulation" ? "border-yellow-300 bg-yellow-50" : "bg-white"}`}
                  >
                    <input
                      type="radio"
                      name="extractionMode"
                      checked={extractionMode === "simulation"}
                      onChange={() => setExtractionMode("simulation")}
                    />
                    <span>
                      <strong>Simulation Mode</strong>
                      <span className="block text-xs text-gray-600">
                        Allows current demo/default values. They are marked Sim,
                        never PDF.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="rounded border border-blue-200 bg-blue-50 p-3">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={useExternalVisualAnalyzer}
                    onChange={(e) => setUseExternalVisualAnalyzer(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    <strong>Use External Visual Analyzer for full-sheet extraction</strong>
                    <span className="block text-xs text-gray-700">
                      Off = internal-only: PDF text plus the app's own rendered-page/selected-rectangle tools. On = also calls the Render OpenCV analyzer, which can be slower/noisier.
                    </span>
                  </span>
                </label>
              </div>

              <div>
                <label className="mb-1 block font-semibold">
                  Upload Foundation Plan
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => handlePlanUpload(e.target.files?.[0])}
                  className="w-full rounded border p-2"
                />

                {planFileName ? (
                  <div className="mt-3 rounded border border-green-300 bg-green-50 p-3 text-green-800">
                    <div>
                      ✓ Plan loaded: <strong>{planFileName}</strong>
                    </div>
                    <div className="mt-1 text-sm">
                      Type: {planFileType || "unknown"} | Size: {fileSizeLabel}
                    </div>
                    <button
                      type="button"
                      onClick={clearPlan}
                      className="mt-2 rounded border border-green-700 px-3 py-1 text-sm font-semibold hover:bg-green-100"
                    >
                      Clear File
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-3 text-gray-500">
                    No plan uploaded yet.
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold">
                    Horizontal Overlap
                  </label>
                  <input
                    type="number"
                    value={horizontalLap}
                    onChange={(e) => setHorizontalLap(e.target.value)}
                    className="w-full rounded border p-2"
                  />
                  <div className="mt-1 text-sm text-gray-500">inches</div>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">
                    V-E Bent Overlap
                  </label>
                  <input
                    type="number"
                    value={verticalBentLap}
                    onChange={(e) => setVerticalBentLap(e.target.value)}
                    className="w-full rounded border p-2"
                  />
                  <div className="mt-1 text-sm text-gray-500">inches</div>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">
                    Stick Length
                  </label>
                  <input
                    type="number"
                    value={stickLength}
                    onChange={(e) => setStickLength(e.target.value)}
                    className="w-full rounded border p-2"
                  />
                  <div className="mt-1 text-sm text-gray-500">feet</div>
                </div>
              </div>

              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={extractPlanData}
                  disabled={isExtractingPlan}
                  className="rounded bg-blue-600 p-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {isExtractingPlan
                    ? "Calculating Rebar Prms from PDF..."
                    : extractionMode === "live"
                    ? "Calculate Rebar Prms from PDF - Live"
                    : "Calculate Rebar Prms from PDF - Simulation"}
                </button>
                {(extractionProgress || extractionStatus) && (
                  <div className={`rounded border p-3 text-sm ${isExtractingPlan ? "border-blue-300 bg-blue-50 text-blue-900" : extractionProgress.startsWith("Completed") ? "border-green-300 bg-green-50 text-green-900" : "border-gray-300 bg-gray-50 text-gray-800"}`}>
                    <div className="font-bold">PDF calculation status</div>
                    <div>{extractionProgress || extractionStatus}</div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-2xl font-semibold">Plan Preview</h2>

            {!planPreviewUrl && (
              <div className="flex min-h-[500px] items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-500">
                Upload a PDF, PNG, JPG, or JPEG plan to preview it here.
              </div>
            )}

            {planPreviewUrl && isPdf && (
              <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-blue-950">Crop evidence from PDF</h3>
                    <p className="text-sm text-blue-900">Click Start Crop, then drag a rectangle on the rendered crop canvas. The normal PDF viewer below cannot be cropped directly.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm font-semibold text-blue-950">Page
                      <input
                        type="number"
                        min="1"
                        value={regionPageNumber}
                        onChange={(event) => setRegionPageNumber(event.target.value)}
                        className="ml-2 w-20 rounded border p-2"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={startCropMode}
                      className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                    >
                      Start Crop
                    </button>
                  </div>
                </div>
              </div>
            )}

            {cropRefs.length > 0 && (
              <div className="mb-4 rounded border border-gray-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-950">Saved Crop Images</h3>
                    <p className="text-sm text-gray-600">These crop images load with the project and can be attached to one or more rebar info rows.</p>
                  </div>
                  <span className="rounded bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700">{cropRefs.length} crop{cropRefs.length === 1 ? "" : "s"}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {cropRefs.map((crop) => (
                    <div key={crop.id} className="rounded border bg-gray-50 p-2 text-xs">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-gray-950">{cropDisplayName(crop)}</div>
                          <div className="text-gray-600">{crop.elementType}{crop.note ? ` · ${crop.note}` : ""}</div>
                        </div>
                        <button type="button" onClick={() => deleteCrop(crop.id)} className="rounded border bg-white px-2 py-1 font-semibold hover:bg-gray-100">Delete</button>
                      </div>
                      {cropImageUrl(crop) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cropImageUrl(crop)} alt={crop.label} className="h-36 w-full rounded border bg-white object-contain" />
                      ) : (
                        <div className="flex h-36 items-center justify-center rounded border bg-white text-gray-500">Image URL missing</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {planPreviewUrl && isPdf && (
              <iframe
                src={planPreviewUrl}
                className="h-[600px] w-full rounded border"
                title="PDF plan preview"
              />
            )}

            {planPreviewUrl && isImage && (
              <div className="rounded border bg-gray-50 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={planPreviewUrl}
                  alt="Uploaded foundation plan preview"
                  className="max-h-[600px] w-full rounded object-contain"
                />
              </div>
            )}


            {planPreviewUrl && isPdf && cropToolOpen && (
              <div ref={cropToolRef} className="mt-4 rounded border border-blue-200 bg-blue-50 p-4">
                <h3 className="mb-2 text-lg font-semibold text-blue-950">
                  Crop Evidence / Selected Rectangle Extraction
                </h3>
                <p className="mb-3 text-sm text-blue-900">
                  Use this when the full sheet is too noisy. Render one PDF page, drag a box around a detail/rebar specification
                  such as Side Wall Detail or End Wall Detail, then extract only that region.
                </p>

                <div className="mb-3 flex flex-wrap items-end gap-3">
                  <label className="text-sm font-semibold">
                    Page
                    <input
                      type="number"
                      min="1"
                      value={regionPageNumber}
                      onChange={(event) => setRegionPageNumber(event.target.value)}
                      className="ml-2 w-20 rounded border p-2"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={renderRegionSelectionPage}
                    className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    Re-render Page
                  </button>
                  <button
                    type="button"
                    onClick={analyzeSelectedRegion}
                    disabled={!regionRect}
                    className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:bg-gray-400"
                  >
                    Analyze Selected Rectangle
                  </button>
                  <button
                    type="button"
                    onClick={saveSelectedCrop}
                    disabled={!regionRect}
                    className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:bg-gray-400"
                  >
                    Save Crop Evidence
                  </button>
                  <div className="flex items-center gap-2 rounded border bg-white px-2 py-1">
                    <span className="text-xs font-semibold text-gray-700">Viewer zoom</span>
                    <button
                      type="button"
                      onClick={() => setRegionZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}
                      className="rounded bg-gray-200 px-3 py-1 text-sm font-bold hover:bg-gray-300"
                    >
                      −
                    </button>
                    <span className="w-14 text-center text-xs font-semibold">{Math.round(regionZoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setRegionZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100))}
                      className="rounded bg-gray-200 px-3 py-1 text-sm font-bold hover:bg-gray-300"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegionZoom(1)}
                      className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold hover:bg-gray-200"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="mb-3 grid gap-3 rounded border border-blue-200 bg-white p-3 md:grid-cols-4">
                  <label className="text-sm font-semibold">Crop type
                    <select
                      value={cropElementType}
                      onChange={(event) => {
                        const next = event.target.value as RebarInfoType;
                        setCropElementType(next);
                        setCropLabel(`${next} crop`);
                      }}
                      className="mt-1 w-full rounded border p-1.5 text-sm"
                    >
                      {rebarInfoTypes.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">Crop label
                    <input value={cropLabel} onChange={(event) => setCropLabel(event.target.value)} className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                  <label className="text-sm font-semibold md:col-span-2">Crop note
                    <input value={cropNote} onChange={(event) => setCropNote(event.target.value)} placeholder="Example: Side wall detail rebar callout" className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                </div>

                {cropRefs.length > 0 && (
                  <div className="mb-3 rounded border border-gray-200 bg-white p-3">
                    <h4 className="mb-2 font-semibold">Saved crop evidence</h4>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {cropRefs.map((crop) => (
                        <div key={crop.id} className="rounded border bg-gray-50 p-2 text-xs">
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <div>
                              <strong>{cropDisplayName(crop)}</strong>
                              {crop.note && <div className="text-gray-600">{crop.note}</div>}
                            </div>
                            <button type="button" onClick={() => deleteCrop(crop.id)} className="rounded border px-2 py-1 font-semibold hover:bg-white">Delete</button>
                          </div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={crop.imageDataUrl || crop.downloadUrl || ""} alt={crop.label} className="max-h-40 w-full rounded object-contain" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mb-2 rounded border border-yellow-300 bg-yellow-50 p-2 text-sm text-yellow-900">
                  Drag directly on the canvas below to mark the crop rectangle. After the red box appears, choose type/label/note and click Save Crop Evidence.
                </div>
                <div className="overflow-auto rounded border bg-white p-2">
                  <canvas
                    ref={regionCanvasRef}
                    onMouseDown={handleRegionMouseDown}
                    onMouseMove={handleRegionMouseMove}
                    onMouseUp={handleRegionMouseUp}
                    onMouseLeave={handleRegionMouseUp}
                    className="block h-auto cursor-crosshair rounded"
                    style={{ width: `${regionZoom * 100}%`, maxWidth: "none" }}
                  />
                </div>

                {regionRect && (
                  <div className="mt-2 text-xs text-blue-900">
                    Selected box: x {Math.round(regionRect.x)}, y {Math.round(regionRect.y)}, w {Math.round(regionRect.width)}, h {Math.round(regionRect.height)}
                  </div>
                )}

                {regionStatus && (
                  <div className="mt-3 rounded border border-blue-300 bg-white p-2 text-sm text-blue-950">
                    {regionStatus}
                  </div>
                )}

                {regionAnalysis && (
                  <div className="mt-3 rounded border bg-white p-3 text-sm">
                    <h4 className="mb-2 font-semibold">Selected Rectangle Results</h4>
                    {!regionAnalysis.success && (
                      <div className="rounded bg-red-50 p-2 text-red-800">{regionAnalysis.error || "Region analysis failed."}</div>
                    )}

                    {regionAnalysis.success && (
                      <>
                        <div className="mb-2 grid gap-2 md:grid-cols-3">
                          <div className="rounded border p-2"><strong>Page</strong><br />{regionAnalysis.page}</div>
                          <div className="rounded border p-2"><strong>Lines</strong><br />{regionAnalysis.lineCount ?? "n/a"}</div>
                          <div className="rounded border p-2"><strong>Circles</strong><br />{regionAnalysis.circleCount ?? "n/a"}</div>
                        </div>

                        <details className="mb-2 rounded border p-2" open>
                          <summary className="cursor-pointer font-semibold">Fabrication parameter candidates</summary>
                          {(regionAnalysis.params || []).length === 0 ? (
                            <div className="mt-2 rounded bg-yellow-50 p-2 text-yellow-900">No parameter candidates found in this rectangle.</div>
                          ) : (
                            <table className="mt-2 w-full border-collapse text-xs">
                              <thead>
                                <tr>
                                  <th className="border-b p-2 text-left">Name / Key</th>
                                  <th className="border-b p-2 text-left">Label</th>
                                  <th className="border-b p-2 text-left">Value</th>
                                  <th className="border-b p-2 text-left">Source</th>
                                  <th className="border-b p-2 text-left">Evidence</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(regionAnalysis.params || []).map((item, index) => (
                                  <tr key={`${item.key}-${index}`}>
                                    <td className="border-b p-2 font-mono font-bold">{item.key}</td>
                                    <td className="border-b p-2 font-semibold">{item.label}</td>
                                    <td className="border-b p-2 font-mono font-bold">{item.value}</td>
                                    <td className="border-b p-2">{item.source}</td>
                                    <td className="border-b p-2">{item.evidence}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </details>

                        <details className="rounded border p-2">
                          <summary className="cursor-pointer font-semibold">Raw text found inside selected rectangle</summary>
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{regionAnalysis.rawText || "(none)"}</pre>
                        </details>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {(extractionNotes.length > 0 ||
              recognitionReport ||
              visualAnalysis ||
              visualAnalysisStatus ||
              extractedTextPreview) && (
              <label className="mt-4 flex items-center gap-2 rounded border bg-gray-50 p-3 text-sm font-semibold text-gray-700">
                <input
                  type="checkbox"
                  checked={showDebugInfo}
                  onChange={(event) => setShowDebugInfo(event.target.checked)}
                />
                Show PDF extraction / developer debug info
              </label>
            )}

            {visualAnalysisStatus && (
              <div className="mt-4 rounded border border-purple-300 bg-purple-50 p-3 text-sm text-purple-900">
                <strong>PDF Image Analyzer:</strong> {visualAnalysisStatus}
              </div>
            )}

            {showDebugInfo && extractionNotes.length > 0 && (
              <div className="mt-4 rounded border bg-gray-50 p-3 text-sm">
                <h3 className="mb-2 font-semibold">PDF Extraction Notes</h3>
                <ul className="max-h-48 list-disc overflow-auto pl-5 text-gray-700">
                  {extractionNotes.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
            )}

            {showDebugInfo && recognitionReport && (
              <div className="mt-4 rounded border bg-white p-3 text-sm">
                <h3 className="mb-2 font-semibold">
                  Plan Recognition Workbench
                </h3>
                <div className="mb-3 grid gap-2 md:grid-cols-3">
                  <div className="rounded border p-2">
                    <strong>Pages read</strong>
                    <br />
                    {recognitionReport.pages.length}
                  </div>
                  <div className="rounded border p-2">
                    <strong>Unique dimensions</strong>
                    <br />
                    {recognitionReport.dimensions.length}
                  </div>
                  <div className="rounded border p-2">
                    <strong>Keyword hits</strong>
                    <br />
                    {recognitionReport.keywordSnippets.length}
                  </div>
                </div>

                <details className="mb-3 rounded border p-2" open>
                  <summary className="cursor-pointer font-semibold">
                    Relevant foundation pages
                  </summary>
                  <div className="mt-2 max-h-72 overflow-auto">
                    {recognitionReport.relevantPages.length === 0 ? (
                      <div className="rounded bg-yellow-50 p-2 text-yellow-900">
                        No strong foundation page found. The extractor is using
                        all PDF text.
                      </div>
                    ) : (
                      recognitionReport.relevantPages
                        .slice(0, 10)
                        .map((page) => {
                          const badgeClass =
                            page.confidence === "high"
                              ? "border-green-300 bg-green-50 text-green-800"
                              : page.confidence === "medium"
                                ? "border-yellow-300 bg-yellow-50 text-yellow-900"
                                : "border-gray-300 bg-gray-50 text-gray-700";

                          return (
                            <div
                              key={page.pageNumber}
                              className="mb-2 rounded border bg-gray-50 p-2"
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <strong>Page {page.pageNumber}</strong>
                                <span
                                  className={`rounded border px-2 py-0.5 text-xs font-bold uppercase ${badgeClass}`}
                                >
                                  {page.confidence}
                                </span>
                                <span className="text-xs text-gray-600">
                                  Score: {page.score}
                                </span>
                                <span className="text-xs text-gray-600">
                                  Dims: {page.dimensionCount}
                                </span>
                              </div>
                              <div className="text-xs text-gray-700">
                                {page.reason}
                              </div>
                              <div className="mt-1 font-mono text-xs text-gray-600">
                                {page.preview}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </details>

                <details className="mb-3 rounded border p-2" open>
                  <summary className="cursor-pointer font-semibold">
                    Likely foundation dimensions
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {recognitionReport.dimensions
                      .slice(0, 35)
                      .map((dimension) => (
                        <span
                          key={dimension.value}
                          title={`Found on page(s): ${dimension.pages.join(", ")}`}
                          className="rounded border bg-gray-50 px-2 py-1 font-mono text-xs"
                        >
                          {dimension.value} × {dimension.count}
                        </span>
                      ))}
                  </div>
                </details>

                <details className="mb-3 rounded border p-2">
                  <summary className="cursor-pointer font-semibold">
                    Important keyword snippets
                  </summary>
                  <div className="mt-2 max-h-72 overflow-auto">
                    {recognitionReport.keywordSnippets
                      .slice(0, 30)
                      .map((hit, index) => (
                        <div
                          key={`${hit.keyword}-${hit.pageNumber}-${index}`}
                          className="mb-2 rounded bg-gray-50 p-2"
                        >
                          <div className="font-semibold">
                            Page {hit.pageNumber} · {hit.keyword}
                          </div>
                          <div className="font-mono text-xs text-gray-700">
                            {hit.snippet}
                          </div>
                        </div>
                      ))}
                  </div>
                </details>

                <details className="rounded border p-2">
                  <summary className="cursor-pointer font-semibold">
                    Page-by-page scan
                  </summary>
                  <div className="mt-2 max-h-72 overflow-auto">
                    {recognitionReport.pages.map((page) => (
                      <div
                        key={page.pageNumber}
                        className="mb-2 rounded bg-gray-50 p-2"
                      >
                        <div className="font-semibold">
                          Page {page.pageNumber}
                        </div>
                        <div>
                          Dimensions: {page.dimensionCount} · Keywords:{" "}
                          {page.keywordHits.join(", ") || "none"}
                        </div>
                        <div className="mt-1 font-mono text-xs text-gray-600">
                          {page.preview}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {showDebugInfo && visualAnalysis && (
              <div className="mt-4 rounded border bg-white p-3 text-sm">
                <h3 className="mb-2 font-semibold">PDF Text + Visual Analyzer</h3>
                <div className="mb-3 grid gap-2 md:grid-cols-4">
                  <div className="rounded border p-2"><strong>Engine</strong><br />{visualAnalysis.engine || "unknown"}</div>
                  <div className="rounded border p-2"><strong>Scale</strong><br />{visualAnalysis.scale?.px_per_foot ? `${visualAnalysis.scale.px_per_foot} px/ft` : visualAnalysis.scale?.status || "missing"}</div>
                  <div className="rounded border p-2"><strong>Text dimensions</strong><br />{visualAnalysis.textEvidence?.dimensions?.length || 0}</div>
                  <div className="rounded border p-2"><strong>Image pages</strong><br />{visualAnalysis.imageAnalysis?.length || 0}</div>
                </div>
                {visualAnalysis.scale?.evidence && (
                  <div className="mb-3 rounded border border-yellow-300 bg-yellow-50 p-2 text-yellow-900"><strong>Scale evidence:</strong> {visualAnalysis.scale.evidence}</div>
                )}
                <details className="mb-3 rounded border p-2" open>
                  <summary className="cursor-pointer font-semibold">Extracted field candidates</summary>
                  <div className="mt-2 max-h-72 overflow-auto">
                    {(visualAnalysis.extractedFields || []).length === 0 ? (
                      <div className="rounded bg-red-50 p-2 text-red-800">No field candidates found by visual/text analyzer.</div>
                    ) : (
                      <table className="w-full border-collapse text-xs">
                        <thead className="bg-gray-100"><tr><th className="border-b p-2 text-left">Field</th><th className="border-b p-2 text-left">Value</th><th className="border-b p-2 text-left">Source</th><th className="border-b p-2 text-left">Evidence</th></tr></thead>
                        <tbody>{(visualAnalysis.extractedFields || []).map((item, index) => (
                          <tr key={`${item.key}-${index}`}><td className="border-b p-2 font-mono">{item.key}</td><td className="border-b p-2 font-bold">{item.value}</td><td className="border-b p-2">{item.source}</td><td className="border-b p-2">{item.page ? `Page ${item.page}. ` : ""}{item.evidence || ""}</td></tr>
                        ))}</tbody>
                      </table>
                    )}
                  </div>
                </details>
                <details className="mb-3 rounded border p-2">
                  <summary className="cursor-pointer font-semibold">Circle / symbol candidates</summary>
                  <div className="mt-2 max-h-72 overflow-auto">{(visualAnalysis.imageAnalysis || []).map((page) => (
                    <div key={page.page} className="mb-2 rounded bg-gray-50 p-2"><div className="font-semibold">Page {page.page}</div>{page.error ? <div className="text-red-700">{page.error}</div> : <div className="text-xs">Circles: {page.circles?.length || 0} · Lines: {page.lines?.length || 0}<div className="mt-1 flex flex-wrap gap-1">{(page.circles || []).slice(0, 60).map((circle, index) => (<span key={`${page.page}-${circle.x}-${circle.y}-${index}`} title={circle.evidence} className="rounded border bg-white px-2 py-1 font-mono">{circle.classification} ({circle.x},{circle.y}) r{circle.r}</span>))}</div></div>}</div>
                  ))}</div>
                </details>
              </div>
            )}

            {showDebugInfo && extractedTextPreview && (
              <details className="mt-4 rounded border bg-white p-3 text-sm">
                <summary className="cursor-pointer font-semibold">
                  Show first PDF text extracted
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-3 text-xs">
                  {extractedTextPreview}
                </pre>
              </details>
            )}
          </section>
        </div>

        </>
        )}

        <section id="rebar-input" className="mt-6 rounded-2xl border border-slate-200 bg-white/75 bg-cover bg-center p-6 shadow-xl" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.78), rgba(255,255,255,0.84)), url('/rebar-background.png')" }}>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">Rebar input command center</div>
              <h2 className="mt-1 text-2xl font-black text-slate-950">
                {plannerView === "simple" ? "Manual Rebar Parameters" : "Confirm Detected Values"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">Grouped input rows feed the schedule engine. Use crops as field evidence and regenerate whenever parameters change.</p>
            </div>
          </div>


          {plannerView === "advanced" && (
          <div className="mb-4 grid gap-2 text-xs md:grid-cols-6">
            <div className="rounded border border-green-300 bg-green-50 p-2 text-green-800">
              <strong>PDF Text</strong> = directly read from PDF text
            </div>
            <div className="rounded border border-purple-300 bg-purple-50 p-2 text-purple-800">
              <strong>PDF Image</strong> = from drawing/symbol analysis
            </div>
            <div className="rounded border border-blue-300 bg-blue-50 p-2 text-blue-800">
              <strong>Calc</strong> = calculated from traced inputs
            </div>
            <div className="rounded border border-gray-300 bg-gray-50 p-2 text-gray-800">
              <strong>User</strong> = entered/edited by user
            </div>
            <div className="rounded border border-yellow-300 bg-yellow-50 p-2 text-yellow-900">
              <strong>Sim</strong> = Simulation Mode default only
            </div>
            <div className="rounded border border-red-300 bg-red-50 p-2 text-red-800">
              <strong>Missing</strong> = not found; no fake data
            </div>
          </div>
          )}

          <div className="grid gap-4">
            <div className="rounded-2xl border border-slate-300 bg-white/72 bg-cover bg-center p-3" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.80), rgba(255,255,255,0.86)), url('/rebar-background.png')" }}>
              <h3 className="text-lg font-semibold">Rebar Parameters</h3>
              <p className="mb-4 text-xs text-gray-600">Shared collector/planner parameter structure. {plannerView === "simple" ? "Simple view: these manual parameters, row notes, overlaps, bend settings, and stock stick length are used by Generate Rebar Schedule." : "Use crop references only when visual proof is needed."}</p>

              <div className="mb-5">
                <RebarMiniDiagram type={activeDiagramType} />
              </div>

              <div className="mb-4 rounded-xl border border-amber-300 bg-yellow-100 p-3">
                <h4 className="mb-2 text-sm font-bold uppercase text-amber-900">Global params</h4>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="font-semibold">Stick len <InfoTip text="Stock rebar stick length used for splitting and buy quantity." /> {showingCalculatedParams && getCompareBadge(rebarGlobalParams.stickLength, getCalculatedGlobalValue("stickLength"))}
                    <input value={displayedGlobalParams.stickLength} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("stickLength", e.target.value)} placeholder="20'" className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                  <label className="font-semibold">Default overlap <InfoTip text="Default lap splice/overlap used when a run continues onto another stick." /> {showingCalculatedParams && getCompareBadge(rebarGlobalParams.defaultOverlap, getCalculatedGlobalValue("defaultOverlap"))}
                    <input value={displayedGlobalParams.defaultOverlap} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("defaultOverlap", e.target.value)} placeholder={'24"'} className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                  <label className="font-semibold">Default vertical to base overlap <InfoTip text="Default overlap/bend allowance where vertical bars tie into the base." /> {showingCalculatedParams && getCompareBadge(rebarGlobalParams.defaultVerticalToBase, getCalculatedGlobalValue("defaultVerticalToBase"))}
                    <input value={displayedGlobalParams.defaultVerticalToBase} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("defaultVerticalToBase", e.target.value)} placeholder={'6"'} className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                  <label className="font-semibold">Default rebar for footing / walls <InfoTip text="Default bar size for footing, base, wall, and similar rows." /> {showingCalculatedParams && getCompareBadge(rebarGlobalParams.foundationRebarSize, getCalculatedGlobalValue("foundationRebarSize"))}
                    <input value={displayedGlobalParams.foundationRebarSize} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("foundationRebarSize", e.target.value)} placeholder="#4" className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                  <label className="font-semibold">Default rebar for piers <InfoTip text="Default bar size used for pier vertical bars and H-circles when not overridden." /> {showingCalculatedParams && getCompareBadge(rebarGlobalParams.pierRebarSize, getCalculatedGlobalValue("pierRebarSize"))}
                    <input value={displayedGlobalParams.pierRebarSize} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("pierRebarSize", e.target.value)} placeholder="#4" className="mt-1 w-full rounded border p-1.5 text-sm" />
                  </label>
                </div>
              </div>

              <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">Manual rows below are compact one-line entry rows. Use Add rebar info at the bottom.</div>

              {plannerView === "advanced" && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-3">
                <div>
                  <div className="font-bold">Manual entry data vs calculated data</div>
                  <div className="text-xs text-gray-600">
                    Use the buttons to flip the parameter form between your manual entry and the calculated PDF values.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setParamViewMode("manual")}
                    className={`rounded px-3 py-2 font-semibold ${paramViewMode === "manual" ? "bg-blue-700 text-white" : "border hover:bg-gray-50"}`}
                  >
                    Show manual values
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setParamViewMode("calculated");
                      setShowParamComparison(true);
                    }}
                    className={`rounded px-3 py-2 font-semibold ${paramViewMode === "calculated" ? "bg-blue-700 text-white" : "border hover:bg-gray-50"}`}
                  >
                    Show calculated values
                  </button>
                  <button type="button" onClick={() => setShowParamComparison((current) => !current)} className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">
                    {showParamComparison ? "Hide comparison" : "Show comparison"}
                  </button>
                </div>
              </div>
              )}

              {plannerView === "advanced" && showingCalculatedParams && (
                <div className="mb-3 rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950">
                  Showing calculated PDF values in the form below. Fields are read-only here. Match badges show Same / Different / Missing from PDF / New from PDF compared with your manual entry.
                </div>
              )}

              {plannerView === "advanced" && showParamComparison && (
                <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
                  <div className="mb-3 font-bold text-blue-950">Comparison {calculatedAt ? `(calculated ${calculatedAt})` : "(not calculated yet)"}</div>
                  {calculatedRows.length === 0 ? (
                    <div className="rounded border bg-white p-3 text-gray-700">Press <strong>Calculate Rebar Prms from PDF</strong> first. The app will read PDF text, rendered PDF/image analysis when enabled, and crop evidence, then place those values here as calculated parameters.</div>
                  ) : (
                    <div className="grid gap-4">
                      <div className="overflow-auto rounded border bg-white">
                        <table className="w-full min-w-[760px] text-left text-xs">
                          <thead className="bg-gray-100"><tr><th className="p-2">Parameter</th><th className="p-2">Manual entry</th><th className="p-2">Calculated from PDF</th><th className="p-2">Status</th></tr></thead>
                          <tbody>
                            {manualComparisonGlobals && calculatedGlobals && ([
                              ["Stick len", manualComparisonGlobals.stickLength, calculatedGlobals.stickLength],
                              ["Default overlap", manualComparisonGlobals.defaultOverlap, calculatedGlobals.defaultOverlap],
                              ["Default vertical to base overlap", manualComparisonGlobals.defaultVerticalToBase, calculatedGlobals.defaultVerticalToBase],
                              ["Default rebar for footing / walls", manualComparisonGlobals.foundationRebarSize, calculatedGlobals.foundationRebarSize],
                              ["Default rebar for piers", manualComparisonGlobals.pierRebarSize, calculatedGlobals.pierRebarSize],
                            ] as [string, string, string][]).map(([label, manualValue, calculatedValue]) => {
                              const status = compareStatus(manualValue, calculatedValue);
                              return <tr key={label} className="border-t"><td className="p-2 font-semibold">{label}</td><td className="p-2">{manualValue || "—"}</td><td className="p-2">{calculatedValue || "—"}</td><td className="p-2"><span className={`rounded px-2 py-1 font-semibold ${status.className}`}>{status.text}</span></td></tr>;
                            })}
                            <tr className="border-t"><td className="p-2 text-gray-600" colSpan={4}>Old parameter-page values are hidden. Comparison now focuses on the new manual rebar parameter set below.</td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="overflow-auto rounded border bg-white">
                        <table className="w-full min-w-[900px] text-left text-xs">
                          <thead className="bg-gray-100"><tr><th className="p-2">Rebar row / field</th><th className="p-2">Manual entry</th><th className="p-2">Calculated from PDF</th><th className="p-2">Status</th></tr></thead>
                          <tbody>
                            {manualComparisonRows.flatMap((manualRow, rowIndex) => {
                              const calculatedRow = calculatedRows[rowIndex];
                              const rowFields: [keyof RebarInfoRow, string][] = [
                                ["itemType", "Rebar Type"], ["segment", "Location / Segment"], ["rebarSize", "Rebar Size"], ["duplicateTimes", "Copies / Piers"], ["count", "Count"], ["calcLength", "Calculate len"], ["length", "Length"], ["diameter", "Diameter"], ["number", "Number"], ["spacingBetween", "Space between bars"], ["traverseLength", "Traverse piece len"], ["spacing", "Spacing between circles"], ["horizontalCircleCount", "Number of H-Circles"], ["numVerticalBars", "Vertical bars count"], ["verticalBent", "Vertical bent"], ["verticalBentLength", "Vertical bent overlap len"], ["clearanceTop", "Soil clearance top"], ["clearanceBottom", "Soil clearance bottom"], ["clearanceSides", "Soil clearance sides"],
                              ];
                              return rowFields.map(([key, label]) => {
                                const manualValue = String(manualRow[key] || "");
                                const calculatedValue = String(calculatedRow?.[key] || "");
                                const status = compareStatus(manualValue, calculatedValue);
                                return <tr key={`${manualRow.id}-${String(key)}`} className="border-t"><td className="p-2 font-semibold">{manualRow.segment || `Row ${rowIndex + 1}`} — {label}</td><td className="p-2">{manualValue || "—"}</td><td className="p-2">{calculatedValue || "—"}</td><td className="p-2"><span className={`rounded px-2 py-1 font-semibold ${status.className}`}>{status.text}</span></td></tr>;
                              });
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mb-3 flex justify-end">
                <button type="button" onClick={() => addRebarInfo("top")} disabled={showingCalculatedParams} className="hidden rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400">Add rebar info <InfoTip text="Adds a new empty rebar parameter row at this location." /></button>
              </div>

              <div className="grid gap-1 compact-manual-rows">
                {displayedRows.map((row, rowIndex) => {
                  const isNewEmptyRow = newEmptyRowIds.includes(row.id);
                  const miniInputClass = "rp-mini-input";
                  const miniSelectClass = "rp-mini-select";
                  const RowField = ({ label, value, field, placeholder = "", className = "w-24", info }: { label: string; value: string; field: keyof RebarInfoRow; placeholder?: string; className?: string; info?: string }) => {
                    const hasUnitError = lengthUnitErrorFields.includes(rowFieldErrorKey(row.id, field));
                    return (
                      <label className={`rp-mini-field ${className}`} title={hasUnitError ? `${label}: add a unit like ', ", ft, or in.` : (info || label)}>
                        <span>{label}{info ? <InfoTip text={info} /> : null}</span>
                        <input value={value} onChange={(e) => updateRebarInfoRow(row.id, field, e.target.value)} placeholder={placeholder} className={`${miniInputClass} ${hasUnitError ? "border-2 border-red-600 bg-red-50" : ""}`} />
                      </label>
                    );
                  };
                  const RowSelect = ({ label, value, field, options, className = "w-24", info }: { label: string; value: string; field: keyof RebarInfoRow; options: string[]; className?: string; info?: string }) => (
                    <label className={`rp-mini-field ${className}`} title={info || label}>
                      <span>{label}{info ? <InfoTip text={info} /> : null}</span>
                      <select value={value} onChange={(e) => updateRebarInfoRow(row.id, field, e.target.value)} className={miniSelectClass}>
                        {options.map((option) => <option key={option} value={option}>{option || "Select"}</option>)}
                      </select>
                    </label>
                  );
                  return (
                  <div key={row.id} id={`rebar-row-${row.id}`} data-rebar-type={row.itemType} className={`rp-param-row rounded-lg border px-2 py-1 text-[11px] transition ${isNewEmptyRow ? "border-amber-500 bg-yellow-100" : "border-amber-300 bg-yellow-50"} ${showingCalculatedParams ? "pointer-events-none opacity-95" : ""}`}>
                    {isNewEmptyRow && <div className="mb-1 rounded border border-amber-400 bg-yellow-100 px-2 py-1 text-[11px] font-bold text-amber-900">NEW EMPTY ROW — enter or change any value and this warning will disappear.</div>}
                    <div className="rp-one-line-row">
                      <label className="rp-mini-field w-64" title="Choose what kind of rebar assembly this row describes: base/bottom, horizontal continuous, vertical, pier, or misc.">
                        <span>Rebar Type<InfoTip text="Choose what kind of rebar assembly this row describes: base/bottom, horizontal continuous, vertical, pier, or misc." /></span>
                        <select value={row.itemType} onFocus={() => setActiveDiagramType(row.itemType)} onChange={(e) => changeRebarInfoType(row.id, e.target.value as RebarInfoType)} className={miniSelectClass}>
                          {rebarInfoTypes.map((type) => <option key={type}>{type}</option>)}
                        </select>
                      </label>
                      <RowField label="Location / Segment" info="Physical area or row name, for example SideWall Bottom, EndWall Horizontal, Pier Cage, or custom location." value={row.segment} field="segment" placeholder="Name" className="w-64" />
                      <RowField label="Rebar Size" info="Bar size designation, for example #3, #4, #5. This is not the quantity." value={row.rebarSize} field="rebarSize" placeholder={row.itemType === "Pier" ? rebarGlobalParams.pierRebarSize : rebarGlobalParams.foundationRebarSize} className="w-36" />
                      <RowField label={row.itemType === "Pier" ? "Pier Count" : "Copies"} info={row.itemType === "Pier" ? "Number of identical pier cages to generate from this row." : "Number of identical copies of this whole rebar assembly to generate, for example 2 side walls."} value={row.duplicateTimes} field="duplicateTimes" placeholder={row.itemType === "Pier" ? "14" : "2"} className="w-36" />

                      {row.itemType === "Base/Bottom rebar" && (
                        <>
                          <span className="rp-line-break" /><span className="rp-row-tag">Continuous longitudinals</span>
                          <RowField label="Bar Count" info="Number of continuous parallel bars or nested loops in this group. Use N/A when not used." value={row.number} field="number" placeholder="N/A" className="w-28" />
                          <RowField label="Design Length" info="Overall design/run length before the app applies clearance, spacing, laps, bends, and stock splitting." value={row.length} field="length" placeholder="52'" className="w-28" />
                          <RowField label="Bar Spacing" info="Center-to-center spacing between adjacent bars." value={row.spacingBetween} field="spacingBetween" placeholder={'6"'} className="w-28" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Start end</span>
                          <RowSelect label="Bent?" info="Yes if this end has a bend, hook, return, or lap leg." value={row.side1Bent} field="side1Bent" options={["", "Yes", "No"]} className="w-20" />
                          <RowField label="Turn Angle" info="Bend angle in degrees, for example 90." value={row.side1TurnAngle} field="side1TurnAngle" placeholder="90" className="w-28" />
                          <RowField label="Bent Return Length" info="Length of bent return, hook, lap, or overlap. Include units, for example 24&quot;." value={row.side1BentLength} field="side1BentLength" placeholder={'24"'} className="w-32" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Finish end</span>
                          <RowSelect label="Bent?" info="Yes if this end has a bend, hook, return, or lap leg." value={row.side2Bent} field="side2Bent" options={["", "Yes", "No"]} className="w-20" />
                          <RowField label="Turn Angle" info="Bend angle in degrees, for example 90." value={row.side2TurnAngle} field="side2TurnAngle" placeholder="90" className="w-28" />
                          <RowField label="Bent Return Length" info="Length of bent return, hook, lap, or overlap. Include units, for example 24&quot;." value={row.side2BentLength} field="side2BentLength" placeholder={'24"'} className="w-32" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Traverse bars</span>
                          <RowField label="Bar Count" info="Number of traverse/cross bars. Use N/A when the app should calculate or skip it." value={row.traverseNumber} field="traverseNumber" placeholder="N/A" className="w-28" />
                          <RowField label="Bar Spacing" info="Center-to-center spacing between adjacent bars." value={row.traverseSpacing} field="traverseSpacing" placeholder={'12"'} className="w-28" />
                          <RowField label="Bar Length" info="Length of each traverse/cross bar. Include units, for example 12&quot;." value={row.traverseLength} field="traverseLength" placeholder={'12"'} className="w-28" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Clearance</span>
                          <RowField label="Top Clearance" info="Concrete cover/clearance from top surface to rebar." value={row.clearanceTop} field="clearanceTop" placeholder={'3"'} className="w-32" />
                          <RowField label="Bottom Clearance" info="Concrete cover/clearance from bottom/soil surface to rebar." value={row.clearanceBottom} field="clearanceBottom" placeholder={'3"'} className="w-32" />
                          <RowField label="Side Clearance" info="Concrete cover/clearance from side soil/form edge to rebar." value={row.clearanceSides} field="clearanceSides" placeholder={'3"'} className="w-32" />
                        </>
                      )}

                      {row.itemType === "Horiz continues longtidues" && (
                        <>
                          <span className="rp-line-break" /><span className="rp-row-tag">Horizontal continuous</span>
                          <RowField label="Design Length" info="Overall design/run length before the app applies clearance, spacing, laps, bends, and stock splitting." value={row.length} field="length" placeholder="52'" className="w-28" />
                          <RowField label="Bar Count" info="Number of continuous parallel bars or nested loops in this group. Use N/A when not used." value={row.number} field="number" placeholder="1" className="w-28" />
                          <RowField label="Bar Spacing" info="Center-to-center spacing between adjacent bars." value={row.spacingBetween} field="spacingBetween" placeholder={'12"'} className="w-28" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Start end</span>
                          <RowSelect label="Bent?" info="Yes if this end has a bend, hook, return, or lap leg." value={row.side1Bent} field="side1Bent" options={["", "Yes", "No"]} className="w-20" />
                          <RowField label="Turn Angle" info="Bend angle in degrees, for example 90." value={row.side1TurnAngle} field="side1TurnAngle" placeholder="90" className="w-28" />
                          <RowField label="Bent Return Length" info="Length of bent return, hook, lap, or overlap. Include units, for example 24&quot;." value={row.side1BentLength} field="side1BentLength" placeholder={'24"'} className="w-32" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Finish end</span>
                          <RowSelect label="Bent?" info="Yes if this end has a bend, hook, return, or lap leg." value={row.side2Bent} field="side2Bent" options={["", "Yes", "No"]} className="w-20" />
                          <RowField label="Turn Angle" info="Bend angle in degrees, for example 90." value={row.side2TurnAngle} field="side2TurnAngle" placeholder="90" className="w-28" />
                          <RowField label="Bent Return Length" info="Length of bent return, hook, lap, or overlap. Include units, for example 24&quot;." value={row.side2BentLength} field="side2BentLength" placeholder={'24"'} className="w-32" />
                        </>
                      )}

                      {row.itemType === "Vertical Rebar" && (
                        <>
                          <span className="rp-line-break" /><span className="rp-row-tag">Vertical L bars</span>
                          <RowField label="Bar Spacing" info="Center-to-center spacing between adjacent bars." value={row.spacing} field="spacing" placeholder={'18"'} className="w-28" />
                          <RowField label="Bar Count" info="Manual quantity, or N/A to calculate from run length and spacing." value={row.count} field="count" placeholder="N/A" className="w-28" />
                          <RowField label="Straight Length" info="Straight vertical portion before bent overlap/return." value={row.length} field="length" placeholder={'24"'} className="w-32" />
                          <RowField label="Calculate Run" info="Run length used to calculate quantity when Bar Count is N/A." value={row.calcLength} field="calcLength" placeholder="52'" className="w-28" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Start end</span>
                          <RowSelect label="Bent?" info="Yes if this end has a bend, hook, return, or lap leg." value={row.side1Bent} field="side1Bent" options={["", "Yes", "No"]} className="w-20" />
                          <RowField label="Turn Angle" info="Bend angle in degrees, for example 90." value={row.side1TurnAngle} field="side1TurnAngle" placeholder="90" className="w-28" />
                          <RowField label="Bent Return Length" info="Length of bent return, hook, lap, or overlap. Include units, for example 24&quot;." value={row.side1BentLength} field="side1BentLength" placeholder={'6"'} className="w-28" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Finish end</span>
                          <RowSelect label="Bent?" info="Yes if this end has a bend, hook, return, or lap leg." value={row.side2Bent} field="side2Bent" options={["", "Yes", "No"]} className="w-20" />
                          <RowField label="Turn Angle" info="Bend angle in degrees, for example 90." value={row.side2TurnAngle} field="side2TurnAngle" placeholder="90" className="w-28" />
                          <RowField label="Bent Return Length" info="Length of bent return, hook, lap, or overlap. Include units, for example 24&quot;." value={row.side2BentLength} field="side2BentLength" placeholder={'6"'} className="w-28" />
                        </>
                      )}

                      {row.itemType === "Pier" && (
                        <>
                          <span className="rp-line-break" /><span className="rp-row-tag">Pier cage</span>
                          <RowField label="Pier Diameter" info="Outside concrete pier diameter. Include units, for example 30&quot;." value={row.diameter} field="diameter" placeholder={'30"'} className="w-28" />
                          <RowField label="Cage Height" info="Pier cage/bar height. Include units, for example 30&quot;." value={row.length} field="length" placeholder={'30"'} className="w-28" />
                          <RowField label="Hoop Count" info="Number of horizontal circles/hoops. Use N/A to calculate from spacing." value={row.horizontalCircleCount} field="horizontalCircleCount" placeholder="N/A" className="w-28" />
                          <RowField label="Vertical Bar Count" info="Number of vertical bars per pier cage." value={row.numVerticalBars} field="numVerticalBars" placeholder="6" className="w-32" />
                          <RowField label="Bar Spacing" info="Center-to-center spacing between adjacent bars." value={row.spacing} field="spacing" placeholder={'8"'} className="w-16" />
                          <RowSelect label="Bent?" info="Yes if this end has a bend, hook, return, or lap leg." value={row.verticalBent} field="verticalBent" options={["", "Yes", "No"]} className="w-20" />
                          <RowField label="Bent Return Length" info="Length of bent return, hook, lap, or overlap. Include units, for example 24&quot;." value={row.verticalBentLength} field="verticalBentLength" placeholder={'6"'} className="w-28" />
                          <span className="rp-line-break" /><span className="rp-row-tag">Clearance</span>
                          <RowField label="Top Clearance" info="Concrete cover/clearance from top surface to rebar." value={row.clearanceTop} field="clearanceTop" placeholder={'3"'} className="w-32" />
                          <RowField label="Bottom Clearance" info="Concrete cover/clearance from bottom/soil surface to rebar." value={row.clearanceBottom} field="clearanceBottom" placeholder={'3"'} className="w-32" />
                          <RowField label="Side Clearance" info="Concrete cover/clearance from side soil/form edge to rebar." value={row.clearanceSides} field="clearanceSides" placeholder={'3"'} className="w-32" />
                        </>
                      )}

                      {row.itemType === "Misc" && <span className="text-[11px] text-slate-600">Misc row for unusual notes or field pieces.</span>}
                    </div>

                    {plannerView === "advanced" && cropRefs.length > 0 && (
                      <div className="mt-1 flex items-center gap-2 text-[11px]" data-crop-dropdown>
                        <button type="button" onClick={() => setOpenCropDropdownRowId((current) => current === row.id ? "" : row.id)} className="rounded border border-amber-300 bg-white px-2 py-1 font-bold text-slate-700">Crops: {selectedCropSummary(row)} ▾</button>
                        {openCropDropdownRowId === row.id && (
                          <div className="absolute z-30 mt-8 max-h-96 w-[520px] overflow-auto rounded border bg-white p-2 shadow-lg">
                            <div className="grid gap-2 sm:grid-cols-2">
                              {cropRefs.map((crop) => {
                                const selected = (row.cropImages || []).includes(crop.id) || row.cropImage === crop.id;
                                return (
                                  <label key={crop.id} className={`flex cursor-pointer gap-2 rounded border p-2 text-sm ${selected ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"}`}>
                                    <input type="checkbox" className="mt-1" checked={selected} onChange={() => toggleRowCrop(row.id, crop.id)} />
                                    <span className="min-w-0 flex-1">
                                      <span className="block font-semibold">{cropDisplayName(crop)}</span>
                                      {crop.note && <span className="block truncate text-xs font-normal text-gray-600">{crop.note}</span>}
                                      {cropImageUrl(crop) && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={cropImageUrl(crop)} alt={crop.label} className="mt-2 h-16 w-full rounded border bg-white object-contain" />
                                      )}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-1 flex items-center gap-2">
                      <details className="min-w-0 flex-1 rounded border border-amber-300 bg-yellow-100 px-2 py-1 text-[11px] text-slate-700">
                        <summary className="cursor-pointer font-bold text-amber-900">Notes / calculation guide</summary>
                        <div className="mt-1 rounded border border-amber-200 bg-yellow-50 p-1 leading-snug"><strong>Calculation guide:</strong> {rebarInfoGuideline(row)}</div>
                        <label className="mt-1 flex items-center gap-2 font-semibold">Additional field note
                          <textarea value={row.note} onChange={(e) => updateRebarInfoRow(row.id, "note", e.target.value)} placeholder="Extra notes" className="min-h-8 flex-1 rounded border bg-white px-2 py-1 text-[11px]" />
                        </label>
                      </details>
                      {rebarInfoRows.length > 1 && (
                        <button type="button" onClick={() => removeRebarInfoRow(row.id)} className="shrink-0 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-bold hover:bg-amber-50">Remove</button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>

              <div className="mt-4 flex justify-end">
                <button type="button" onClick={() => addRebarInfo("bottom")} disabled={showingCalculatedParams} className="rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400">Add rebar info <InfoTip text="Adds a new empty rebar parameter row at this location." /></button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={generateSchedule}
            disabled={isGeneratingSchedule}
            className="mt-5 w-full rounded bg-gray-900 p-3 font-semibold text-white hover:bg-gray-800 disabled:cursor-wait disabled:bg-gray-500"
          >
            {isGeneratingSchedule ? "Generating Rebar Schedule..." : "Generate Rebar Schedule"} <InfoTip text="Calculates pieces, cuts, bends, stick count, waste, and saves the latest schedule." />
          </button>
          {scheduleGenerationStatus && (
            <div className={`mt-3 rounded border p-3 font-semibold ${isGeneratingSchedule ? "border-blue-300 bg-blue-50 text-blue-900" : scheduleGenerationStatus.startsWith("Schedule generation failed") ? "border-red-300 bg-red-50 text-red-900" : "border-green-300 bg-green-50 text-green-900"}`}>
              {scheduleGenerationStatus}
              {savedScheduleAt && !isGeneratingSchedule && (
                <div className="mt-1 text-sm font-normal">Last saved schedule: {new Date(savedScheduleAt).toLocaleString()}</div>
              )}
            </div>
          )}
        </section>

        {showPieceLegend && (
          <section className="mt-4 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs shadow-sm">
            <span className="font-black">Legend:</span> <span className="font-black">SW/EW</span> Side/End Wall · <span className="font-black">BASE O/M/I</span> outer/middle/inner · <span className="font-black">WALL B/M/T</span> bottom/middle/top · <span className="font-black">V-S/V-E</span> vertical bars · <span className="font-black">PC</span> pier cage
          </section>
        )}

        {showFoundationMap && schedule.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-2xl font-semibold">Foundation Map</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded border bg-gray-50 p-6">
                <div className="mx-auto flex max-w-xl flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => selectPrefix("SW-H-WALL-T")}
                    className={`w-96 max-w-full rounded border p-3 font-semibold ${selectedPrefix === "SW-H-WALL-T" ? "bg-yellow-200" : "bg-white"}`}
                  >
                    SW-H-WALL-T / SW-H-BASE-T
                  </button>

                  <div className="flex w-full items-stretch justify-center gap-2">
                    <div className="grid content-center gap-2">
                      {[
                        "EW-H-BASE-O",
                        "EW-H-BASE-M",
                        "EW-H-BASE-I",
                        "EW-H-WALL-B",
                        "EW-H-WALL-M",
                        "EW-H-WALL-T",
                      ].map((prefix) => (
                        <button
                          key={prefix}
                          type="button"
                          onClick={() => selectPrefix(prefix)}
                          className={`rounded border px-3 py-2 text-sm font-semibold ${selectedPrefix === prefix ? "bg-yellow-200" : "bg-white"}`}
                        >
                          {prefix}
                        </button>
                      ))}
                    </div>

                    <div className="flex min-h-48 min-w-96 flex-[1.5] items-center justify-center rounded border-4 border-gray-400 bg-white text-center text-gray-500">
                      Foundation Plan Area<br />Top/Bottom = Side Walls<br />Left/Right = End Walls
                    </div>

                    <div className="grid content-center gap-2">
                      {[
                        "EW-H-BASE-O",
                        "EW-H-BASE-M",
                        "EW-H-BASE-I",
                        "EW-H-WALL-B",
                        "EW-H-WALL-M",
                        "EW-H-WALL-T",
                      ].map((prefix) => (
                        <button
                          key={`right-${prefix}`}
                          type="button"
                          onClick={() => selectPrefix(prefix)}
                          className={`rounded border px-3 py-2 text-sm font-semibold ${selectedPrefix === prefix ? "bg-yellow-200" : "bg-white"}`}
                        >
                          {prefix}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => selectPrefix("SW-H-WALL-B")}
                    className={`w-96 max-w-full rounded border p-3 font-semibold ${selectedPrefix === "SW-H-WALL-B" ? "bg-yellow-200" : "bg-white"}`}
                  >
                    SW-H-WALL-B / SW-H-BASE-B
                  </button>
                </div>
              </div>

              <div className="rounded border p-4">
                <h3 className="mb-2 text-lg font-semibold">
                  Selected Map Group
                </h3>
                {selectedPrefix && selectedGroupLines.length > 0 ? (
                  <div>
                    <div className="mb-3 rounded bg-yellow-50 p-3 text-sm">
                      <div>
                        <strong>Group:</strong> {selectedPrefix}
                      </div>
                      <div>
                        <strong>Pieces shown:</strong>{" "}
                        {selectedGroupLines.length}
                      </div>
                      <div>
                        <strong>Location:</strong>{" "}
                        {selectedGroupLines[0].location}
                      </div>
                    </div>

                    <div className="max-h-[420px] overflow-y-auto rounded border">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="sticky top-0 bg-gray-100">
                          <tr>
                            <th className="border-b p-2">Piece</th>
                            <th className="border-b p-2">Cut</th>
                            <th className="border-b p-2">Used</th>
                            <th className="border-b p-2">Field Order</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedGroupLines.map((line) => (
                            <tr
                              key={line.mark}
                              onClick={() => selectPiece(line)}
                              className={`cursor-pointer hover:bg-yellow-50 ${getScheduleCategoryRowClass(line)} ${selectedMark === line.mark ? "bg-yellow-100" : ""}`}
                            >
                              <td className="border-b p-2 font-bold">
                                {line.mark}
                              </td>
                              <td className="border-b p-2">{line.cutLength}</td>
                              <td className="border-b p-2 font-semibold">
                                {line.usedLength}
                              </td>
                              <td className="border-b p-2 font-mono">
                                {line.fieldOrder}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {selectedLine && (
                      <div className="mt-3 rounded border bg-gray-50 p-3 text-sm">
                        <div>
                          <strong>Selected Piece:</strong> {selectedLine.mark}
                        </div>
                        <div>
                          <strong>Required:</strong>{" "}
                          {selectedLine.requiredLength}
                        </div>
                        <div>
                          <strong>Left:</strong> {selectedLine.leftFunction}
                        </div>
                        <div>
                          <strong>Right:</strong> {selectedLine.rightFunction}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500">
                    Click a map label or schedule row to show all pieces in that
                    group.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        <section id="schedule-output" className="mt-6 rounded-2xl border border-slate-200 bg-white/75 bg-cover bg-center p-6 shadow-xl" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.78), rgba(255,255,255,0.84)), url('/rebar-background.png')" }}>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">Production output</div>
              <h2 className="text-2xl font-black text-slate-950">Rebar Schedule Output</h2>
              <p className="text-sm text-slate-600">Long parts list with sketches, cut lengths, bend notes, and export-ready rows.</p>
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <button
                type="button"
                onClick={downloadCsv}
                disabled={schedule.length === 0}
                className="rounded bg-green-700 px-4 py-2 font-semibold text-white hover:bg-green-800 disabled:bg-gray-400"
              >
                Download CSV <InfoTip text="Downloads the schedule as a formatted Excel-compatible file." />
              </button>
              <button
                type="button"
                onClick={downloadShopPackageHtml}
                disabled={schedule.length === 0}
                className="rounded bg-purple-700 px-4 py-2 font-semibold text-white hover:bg-purple-800 disabled:bg-gray-400"
              >
                Shop Package <InfoTip text="Downloads a printable HTML shop package with summary, warnings, review status, and cut list." />
              </button>
              <button
                type="button"
                onClick={saveWorkspace}
                className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              >
                Save Project <InfoTip text="Saves the current project, PDF, crops, manual rows, and latest schedule." />
              </button>
            </div>
          </div>



          {/* Summary prefix table omitted; the detailed parts list below is the primary schedule display. */}

          {/* Material details moved into compact top summary. */}

          {showWasteReport && materialTakeoff?.wastePieces?.length ? (
            <div className="mb-6 overflow-hidden rounded-2xl border border-red-200 bg-white shadow">
              <div className="border-b bg-red-50 px-4 py-3">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Waste cutoff report</div>
                <h3 className="text-lg font-black text-slate-950">Unused leftover pieces</h3>
                <p className="text-xs text-slate-600">These are the remaining cutoffs after the original single-pass stock packing finishes, sorted longest first. Suggested waste use expands Qty rows, so a 14' leftover can be assigned in the report to 14 pieces of 1' traverse. Analysis only: it shows what to cut from waste, but it does not change stick count.</p>
              </div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border-b p-2">Waste ID</th>
                      <th className="border-b p-2">Source stick</th>
                      <th className="border-b p-2">Rebar size</th>
                      <th className="border-b p-2">Leftover length</th>
                      <th className="border-b p-2">Suggested waste use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialTakeoff.wastePieces.slice(0, 80).map((piece) => (
                      <tr key={piece.id} className="hover:bg-red-50">
                        <td className="border-b p-2 font-black">{piece.id}</td>
                        <td className="border-b p-2 font-mono text-[11px] font-bold">{piece.sourceStickId || "—"}</td>
                        <td className="border-b p-2">{piece.size}</td>
                        <td className="border-b p-2 font-bold">{piece.length}</td>
                        <td className="border-b p-2 text-[11px]">
                          {piece.possibleFits?.length ? piece.possibleFits.slice(0, 6).map((fit) => `USE ${fit.qtyFit}× ${fit.mark} (${fit.cutLength} each = ${fit.totalFitLength})`).join(", ") : "No selected waste use"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {materialTakeoff.wastePieces.length > 80 && (
                <div className="border-t bg-slate-50 px-4 py-2 text-xs text-slate-500">Showing first 80 waste pieces.</div>
              )}
            </div>
          ) : null}

          {showShopPlanning && schedule.length > 0 && (
            <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow">
                <div className="border-b bg-slate-950 px-4 py-3 text-white">
                  <h3 className="text-lg font-black">Stock Cut Plan Preview</h3>
                  <p className="text-xs text-slate-300">First-fit planning from the generated piece list, packed separately by rebar size. Use this as a shop review aid before cutting.</p>
                </div>
                <div className="max-h-96 overflow-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-slate-100 text-slate-700">
                      <tr>
                        <th className="border-b p-2">Stick</th>
                        <th className="border-b p-2">Size</th>
                        <th className="border-b p-2">Pieces on stick</th>
                        <th className="border-b p-2">Used</th>
                        <th className="border-b p-2">Waste</th>
                        <th className="border-b p-2">Shop status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stage7StockCutPlan.slice(0, 80).map((stick) => (
                        <tr key={stick.id} className="hover:bg-blue-50">
                          <td className="border-b p-2 font-black">#{stick.id}</td>
                          <td className="border-b p-2">
                            <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-black text-white">{stick.size}</span>
                          </td>
                          <td className="border-b p-2">
                            <div className="font-bold text-slate-900">{stick.pieces.map((piece) => piece.cutLength).join(" + ")}</div>
                            <div className="mt-1 text-[11px] text-slate-500">{stick.pieces.map((piece) => piece.mark).slice(0, 4).join(", ")}{stick.pieces.length > 4 ? ` + ${stick.pieces.length - 4} more` : ""}</div>
                            {stick.hasOverStockPiece && (
                              <div className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] font-bold text-red-800">CHECK: at least one piece is longer than stock length.</div>
                            )}
                          </td>
                          <td className="border-b p-2 font-bold">{formatFeet(stick.usedFeet)}</td>
                          <td className="border-b p-2">{stick.hasOverStockPiece ? "CHECK" : formatFeet(stick.wasteFeet)}</td>
                          <td className="border-b p-2">
                            <span className={`rounded-full px-2 py-1 text-[11px] font-black ${stick.hasOverStockPiece ? "bg-red-100 text-red-900" : stick.needsShopWork ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                              {stick.hasOverStockPiece ? "Over stock" : stick.needsShopWork ? "Cut/Bend" : "No change"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {stage7StockCutPlan.length > 80 && (
                  <div className="border-t bg-slate-50 px-4 py-2 text-xs text-slate-500">Showing first 80 sticks. Export the full schedule for all rows.</div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">Material by rebar size</div>
                <h3 className="text-lg font-black text-slate-950">Takeoff Summary</h3>
                <div className="mt-3 overflow-hidden rounded-xl border">
                  <table className="rebar-detail-table w-full border-collapse text-left text-xs">
                    <thead className="bg-blue-50 text-blue-950">
                      <tr>
                        <th className="border-b p-2">Size</th>
                        <th className="border-b p-2">Pieces</th>
                        <th className="border-b p-2">Cut length</th>
                        <th className="border-b p-2">Bent/hoop pieces</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stage7RebarSizeTakeoff.map((row) => (
                        <tr key={row.size} className="hover:bg-slate-50">
                          <td className="border-b p-2 font-black">{row.size}</td>
                          <td className="border-b p-2">{row.pieces}</td>
                          <td className="border-b p-2">{formatFeet(row.cutFeet)}</td>
                          <td className="border-b p-2">{row.bends}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <strong>Review note:</strong> this cut plan is generated from the current schedule rows and replaces itself every time you regenerate. It does not keep history.
                </div>
              </div>
            </div>
          )}

          {schedule.length > 0 && (
            <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
              Legend: <span className="font-black">─</span> Straight | <span className="font-black">┐</span> Bent end | <span className="font-black">└</span> Vertical L | <span className="font-black">○</span> Pier H-circle
            </div>
          )}

          {schedule.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow">
              <div className="border-b bg-slate-950 px-4 py-3 text-white">
                <h3 className="text-lg font-black">Consolidated Cut Batches</h3>
                <p className="text-xs text-slate-300">Same rebar size, cut length, left function, used length, and right function are grouped together. Type/location is ignored here because this is the shop cutting list; the full detailed list stays below.</p>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="cut-batch-table w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-blue-50 text-blue-950 shadow-sm">
                    <tr>
                      <th className="border-b p-2">Size</th>
                      <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Total Qty</th>
                      <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Cut Len</th>
                      <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Left Function</th>
                      <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Used</th>
                      <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Right Function</th>
                      <th className="border-b p-2">Shape</th>
                      <th className="border-b p-2">Sample</th>
                      <th className="border-b p-2">Loc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fabricationBatchList.map((batch) => (
                      <tr key={batch.key} className="hover:bg-blue-50">
                        <td className="border-b p-2 font-black">{batch.size}</td>
                        <td className="border-b bg-yellow-50 p-2 text-sm font-extrabold text-yellow-950">{batch.qty}</td>
                        <td className="border-b bg-yellow-50 p-2 text-sm font-extrabold text-yellow-950">{batch.cutLength}</td>
                        <td className="border-b bg-yellow-50 p-2 font-bold text-yellow-950">{batch.leftFunction}</td>
                        <td className="border-b bg-yellow-50 p-2 text-sm font-extrabold text-yellow-950">{batch.usedLength}</td>
                        <td className="border-b bg-yellow-50 p-2 font-bold text-yellow-950">{batch.rightFunction}</td>
                        <td className="border-b p-1"><PieceShapeIcon line={batch.sampleLine} compact /></td>
                        <td className="border-b p-2 font-mono text-[10px]"><CollapsedCell value={batch.sampleMark} /></td>
                        <td className="border-b p-2 text-[11px]">
                          <details className="rp-location-details">
                            <summary>{String(batch.sampleLocation || "").split(" ")[0] || "Location"}</summary>
                            <div>{batch.sampleLocation}</div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">
                {fabricationBatchList.length} consolidated cut batches from {filteredSchedule.length} visible detailed pieces. Search/filter above changes this batch view too.
              </div>
            </div>
          )}

          {schedule.length === 0 ? (
            <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-6 text-gray-500">
              No schedule generated yet.
            </div>
          ) : (
            <div className="space-y-6">
              {groupedFilteredSchedule.map((group) => (
                <div key={group.title} className="overflow-x-auto rounded border">
                  <div className="border-b bg-gray-900 px-4 py-2 text-sm font-bold text-white">
                    {group.title}
                  </div>
                  <table className="rebar-detail-table w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
                      <tr>
                        <th className="border-b bg-emerald-100 p-3 text-base font-extrabold text-emerald-950">Reviewed</th>
                        <th className="border-b bg-sky-100 p-2 text-sm font-extrabold text-sky-950">Shape</th>
                        <th className="border-b p-2">Type</th>
                        <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Qty</th>
                        <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Cut Len</th>
                        <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Left Function</th>
                        <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Used</th>
                        <th className="border-b bg-yellow-100 p-2 text-sm font-extrabold text-yellow-950">Right Function</th>
                        <th className="border-b p-2">Stock</th>
                        <th className="border-b p-2">Waste</th>
                        <th className="border-b p-2">Piece</th>
                        <th className="border-b p-2">Loc</th>
                        <th className="border-b p-2">Req</th>
                        <th className="border-b p-2">Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map((line) => (
                        <tr
                          key={line.mark}
                          onClick={() => selectPiece(line)}
                          className={`cursor-pointer hover:bg-yellow-50 ${getScheduleCategoryRowClass(line)} ${selectedMark === line.mark ? "bg-yellow-100" : ""}`}
                        >
                          <td className="border-b bg-emerald-50 p-2 text-center">
                            <label className="inline-flex cursor-pointer items-center justify-center gap-1 text-[10px] font-black text-emerald-900" onClick={(event) => event.stopPropagation()}>
                              <input type="checkbox" checked={reviewedPieceMarks.includes(line.mark)} onChange={() => toggleReviewedPiece(line.mark)} className="h-4 w-4" />
                              <span>✓</span>
                            </label>
                          </td>
                          <td className="border-b bg-sky-50 p-1 text-center"><PieceShapeIcon line={line} compact /></td>
                          <td className="border-b p-2"><span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-slate-700 shadow-sm">{getScheduleCategoryLabel(getScheduleCategory(line))}</span></td>
                          <td className="border-b bg-yellow-50 p-2 text-sm font-extrabold text-yellow-950">{line.qty}</td>
                          <td className="border-b bg-yellow-50 p-2 text-sm font-extrabold text-yellow-950">
                            {line.cutLength}
                          </td>
                          <td className="border-b bg-yellow-50 p-2 text-xs font-bold text-yellow-950"><CollapsedCell value={line.leftFunction} /></td>
                          <td className="border-b bg-yellow-50 p-2 text-sm font-extrabold text-yellow-950">
                            {line.usedLength}
                          </td>
                          <td className="border-b bg-yellow-50 p-2 text-xs font-bold text-yellow-950"><CollapsedCell value={line.rightFunction} /></td>
                          <td className="border-b p-2 font-mono text-[10px] font-bold text-slate-700"><CollapsedCell value={line.stockSource || "—"} /></td>
                          <td className="border-b p-2 text-[10px] text-slate-600"><CollapsedCell value={line.wasteFit || "—"} /></td>
                          <td className="border-b p-2 text-[10px] font-bold"><CollapsedCell value={line.mark} /></td>
                          <td className="border-b p-2 text-[10px]"><CollapsedCell value={line.location} /></td>
                          <td className="border-b p-2 text-[10px]"><CollapsedCell value={line.requiredLength} /></td>
                          <td className="border-b p-2 font-mono text-[10px]"><CollapsedCell value={line.fieldOrder} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </section>


          {showEngineAudit && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-950">Rebar Engine Rules + Audit</h2>
                <p className="text-sm text-slate-600">This panel documents the formulas the schedule generator is using so the shop list can be checked before export.</p>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-3 text-center">
                <div className="text-xs font-black uppercase tracking-wide text-blue-700">Engine readiness</div>
                <div className="text-3xl font-black text-blue-950">{stage13EngineReadyScore}%</div>
                <div className="text-xs text-blue-700">based on current inputs</div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-lg font-black text-slate-950">Calculation rules used</h3>
                <div className="mt-3 space-y-3">
                  {stage13CalculationRules.map((rule) => (
                    <div key={rule.title} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-black text-slate-950">{rule.title}</div>
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black uppercase text-blue-700">{rule.type}</span>
                      </div>
                      <div className="mt-2 rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-800">{rule.formula}</div>
                      <p className="mt-2 text-xs text-slate-600">{rule.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-lg font-black text-slate-950">Current project audit</h3>
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                  <table className="rebar-detail-table w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-950 text-white">
                      <tr>
                        <th className="border-b border-slate-700 p-3">Check</th>
                        <th className="border-b border-slate-700 p-3">Value</th>
                        <th className="border-b border-slate-700 p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stage13AuditRows.map((row) => (
                        <tr key={row.label} className="hover:bg-blue-50">
                          <td className="border-b p-3">
                            <div className="font-black text-slate-950">{row.label}</div>
                            <div className="text-xs text-slate-500">{row.note}</div>
                          </td>
                          <td className="border-b p-3 text-lg font-black text-slate-950">{row.value}</td>
                          <td className="border-b p-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-black ${row.status === "Check" ? "bg-amber-100 text-amber-900" : row.status === "Not generated" || row.status === "Add row" ? "bg-slate-100 text-slate-700" : "bg-emerald-100 text-emerald-900"}`}>
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <strong>Next accuracy step:</strong> compare this generated schedule against one real hand-checked foundation job, then tune the engine formulas rather than adding more UI panels.
                </div>
              </div>
            </div>
          </section>
          )}

          {showClientReadiness && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-950">Client Workspace Readiness</h2>
                <p className="text-sm text-slate-600">This panel turns the app from a form into a guided job workflow for future paying users.</p>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-3 text-center">
                <div className="text-xs font-black uppercase tracking-wide text-blue-700">Ready score</div>
                <div className="text-3xl font-black text-blue-950">{stage9ReadyPercent}%</div>
                <div className="text-xs text-blue-700">{stage9ReadyCount} of {stage9QualityChecks.length} checks</div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {stage9CommercialCards.map((card) => (
                <div key={card.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">{card.title}</div>
                  <div className="mt-2 text-2xl font-black text-slate-950">{card.value}</div>
                  <div className="mt-1 text-sm text-slate-600">{card.detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-lg font-black text-slate-950">Guided workflow</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-5">
                  {stage9WorkflowSteps.map((item) => (
                    <div key={item.step} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-700 text-sm font-black text-white">{item.step}</div>
                      <div className="mt-3 text-sm font-black text-slate-950">{item.title}</div>
                      <div className="mt-1 text-xs text-slate-600">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-lg font-black text-slate-950">Quality checklist</h3>
                <div className="mt-3 space-y-2">
                  {stage9QualityChecks.map((check) => (
                    <div key={check.title} className={`rounded-xl border p-3 ${check.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className={`text-sm font-black ${check.ok ? "text-emerald-950" : "text-amber-950"}`}>{check.title}</div>
                        <span className={`rounded-full px-2 py-1 text-xs font-black ${check.ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{check.ok ? "OK" : "Check"}</span>
                      </div>
                      <div className={`mt-1 text-xs ${check.ok ? "text-emerald-800" : "text-amber-800"}`}>{check.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          )}

          {showProductWorkspace && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-950">Product Workspace Center</h2>
                <p className="text-sm text-slate-600">A professional overview that explains what is ready now and what becomes part of the future paid product path.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-center">
                <div className="text-xs font-black uppercase tracking-wide text-slate-500">Launch checklist</div>
                <div className="text-3xl font-black text-slate-950">{stage10DoneCount}/{stage10LaunchChecklist.length}</div>
                <div className="text-xs text-slate-600">workspace items ready</div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-4">
              {stage10CommercialModules.map((module) => (
                <div key={module.title} className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
                  <div className="text-sm font-black text-slate-950">{module.title}</div>
                  <div className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{module.status}</div>
                  <div className="mt-3 text-sm text-slate-600">{module.detail}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-lg font-black text-slate-950">Launch checklist</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {stage10LaunchChecklist.map((item) => (
                    <div key={item.label} className={`rounded-xl border p-3 ${item.done ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className={`text-sm font-black ${item.done ? "text-emerald-950" : "text-amber-950"}`}>{item.label}</div>
                        <span className={`rounded-full px-2 py-1 text-xs font-black ${item.done ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{item.done ? "Ready" : "Needs work"}</span>
                      </div>
                      <div className={`mt-1 text-xs ${item.done ? "text-emerald-800" : "text-amber-800"}`}>{item.note}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <h3 className="text-lg font-black text-blue-950">Future subscription path</h3>
                <div className="mt-3 space-y-3 text-sm text-blue-900">
                  <div className="rounded-xl bg-white/70 p-3">
                    <div className="font-black">Trial mode</div>
                    <div className="text-xs">Placeholder for free-trial days, sample project limits, and upgrade prompts.</div>
                  </div>
                  <div className="rounded-xl bg-white/70 p-3">
                    <div className="font-black">Paid plan mode</div>
                    <div className="text-xs">Future Stripe or payment integration can unlock saved projects, exports, and commercial packages.</div>
                  </div>
                  <div className="rounded-xl bg-white/70 p-3">
                    <div className="font-black">Owner controls</div>
                    <div className="text-xs">Owner keeps Advanced View and internal extraction tools hidden from normal users.</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          )}

          {showSupportCenter && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-950">Help, Training, and Support Center</h2>
                <p className="text-sm text-slate-600">This adds the commercial help structure users expect: onboarding, workflow shortcuts, calculation guidance, and support placeholders.</p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-3 text-center">
                <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Support mode</div>
                <div className="text-2xl font-black text-emerald-950">Built in</div>
                <div className="text-xs text-emerald-700">docs can connect later</div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-4">
              {stage11DocumentationCards.map((card) => (
                <div key={card.title} className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
                  <div className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{card.tag}</div>
                  <div className="mt-3 text-base font-black text-slate-950">{card.title}</div>
                  <div className="mt-2 text-sm text-slate-600">{card.detail}</div>
                  <div className="mt-3 text-xs font-black uppercase tracking-wide text-slate-500">{card.action}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-lg font-black text-slate-950">Workflow shortcuts</h3>
                <p className="mt-1 text-sm text-slate-600">These cards make the product easier for new users and can later become a guided tutorial.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  {stage11ActionShortcuts.map((shortcut) => (
                    <button
                      key={shortcut.label}
                      type="button"
                      onClick={() => document.getElementById(shortcut.target)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
                    >
                      <div className="text-sm font-black text-blue-950">{shortcut.label}</div>
                      <div className="mt-2 text-xs text-blue-800">{shortcut.detail}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="text-lg font-black text-slate-950">Support readiness</h3>
                <div className="mt-3 space-y-2">
                  {stage11SupportItems.map((item) => (
                    <div key={item.label} className={`rounded-xl border p-3 ${item.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className={`text-sm font-black ${item.ready ? "text-emerald-950" : "text-amber-950"}`}>{item.label}</div>
                        <span className={`rounded-full px-2 py-1 text-xs font-black ${item.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{item.ready ? "Ready" : "Pending"}</span>
                      </div>
                      <div className={`mt-1 text-xs ${item.ready ? "text-emerald-800" : "text-amber-800"}`}>{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          )}

          <footer className="mt-8 rounded-2xl border border-slate-200 bg-white/90 p-5 text-sm text-slate-600 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-black text-slate-950">Rebar Planner</div>
                <div>Commercial foundation rebar schedule workbench · Version preview · Support and documentation pages can connect here.</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="rounded-full bg-slate-100 px-3 py-1">Role: {authRole}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1">Plan: {isOwner ? "Owner" : "User"}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1">Trial/Billing: future</span>
              </div>
            </div>
          </footer>
          </div>
        </div>
      </div>
    </main>
  );
}
