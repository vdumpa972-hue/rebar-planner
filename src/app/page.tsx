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
};

type SavedPlannerProject = {
  id: string;
  projectName: string;
  planFileName: string;
  updatedAtLabel: string;
  cropCount: number;
  rowCount: number;
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
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);
  const [scheduleGenerationStatus, setScheduleGenerationStatus] = useState("");
  const [savedScheduleAt, setSavedScheduleAt] = useState("");
  const [selectedMark, setSelectedMark] = useState("");
  const [selectedPrefix, setSelectedPrefix] = useState("");
  const [filter, setFilter] = useState("ALL");
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
  const [plannerView, setPlannerView] = useState<"advanced" | "simple">("advanced");
  const [pdfZoom, setPdfZoom] = useState(100);


  const workspaceDocId = user?.uid || "";

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
      savedGeneratedSchedule: schedule.length && materialTakeoff ? {
        generatedAtIso: savedScheduleAt || new Date().toISOString(),
        sourceLabel: showingCalculatedParams && calculatedRows.length > 0 ? "calculated PDF parameters" : "manual parameters",
        schedule,
        summary,
        materialTakeoff,
      } : null,
    };
  }

  function applyWorkspaceSnapshot(data: Partial<PlannerWorkspace>) {
    if (typeof data.projectName === "string") setProjectName(data.projectName);
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
      setSavedScheduleAt(data.savedGeneratedSchedule.generatedAtIso || "");
      setSelectedMark(data.savedGeneratedSchedule.schedule[0]?.mark || "");
      setSelectedPrefix(data.savedGeneratedSchedule.schedule[0]?.prefix || "");
      setScheduleGenerationStatus(`Saved schedule loaded${data.savedGeneratedSchedule.generatedAtIso ? ` from ${new Date(data.savedGeneratedSchedule.generatedAtIso).toLocaleString()}` : ""}. Click Generate Rebar Schedule to recalculate.`);
    } else {
      setSchedule([]);
      setSummary([]);
      setMaterialTakeoff(null);
      setSavedScheduleAt("");
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
      const projectId = currentProjectId || `${user.uid}-${Date.now()}`;
      const cleanProjectName = projectName.trim();
      if (!cleanProjectName) {
        setWorkspaceStatus("Save failed: project name is required.");
        return;
      }
      const existingSnaps = await getDocs(query(collection(db, "plannerProjects"), orderBy("updatedAt", "desc")));
      const duplicateProject = existingSnaps.docs
        .map((projectSnap) => ({ id: projectSnap.id, ...(projectSnap.data() as Partial<PlannerWorkspace> & { ownerUid?: string }) }))
        .find((project) => project.ownerUid === user.uid && project.id !== projectId && (project.projectName || "").trim().toLowerCase() === cleanProjectName.toLowerCase());
      if (duplicateProject) {
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
        }));
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
  }, [loading, router, user, workspaceLoaded]);

  const fileSizeLabel = useMemo(() => {
    if (!planFileSize) return "";
    const mb = planFileSize / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
  }, [planFileSize]);

  const filteredSchedule = useMemo(() => {
    if (filter === "ALL") return schedule;
    return schedule.filter((line) => line.prefix === filter);
  }, [filter, schedule]);

  const selectedLine = schedule.find((line) => line.mark === selectedMark);
  const selectedGroupLines = selectedPrefix
    ? schedule.filter((line) => line.prefix === selectedPrefix)
    : selectedLine
      ? schedule.filter((line) => line.prefix === selectedLine.prefix)
      : [];
  const filterOptions = Array.from(
    new Set(schedule.map((line) => line.prefix)),
  );

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
    return <main className="min-h-screen bg-gray-100 p-6">Loading Rebar Planner...</main>;
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
      return "Base/bottom mat rule: this row describes one side/configuration of the foundation. Duplicate times means how many sides use this same configuration, usually 2. Calculate each longitudinal bar by its position in the mat. The outer bar uses the full entered part length. Each inner bar is shortened by the space between longitudinal bars at every bent end/corner, so the bend lands in the correct place. Traverse bars are also scheduled from this row; if traverse Number is N/A, the app estimates quantity from the longitudinal length and traverse spacing. When a run is longer than the stock stick length, split it into multiple sticks and add the required overlap/lap splice.";
    }
    if (row.itemType === "Horiz continues longtidues") {
      return "Horizontal continuous bars: use the entered length, count, spacing, end bends, stock stick length, and required overlap/lap splice when splitting long runs.";
    }
    if (row.itemType === "Vertical Rebar") {
      return "Vertical/L bars: enter Count manually, or enter N/A and the app calculates quantity from Calculate len / total run divided by spacing + 1. If Calculate len is blank, the app uses total base/bottom run length, for example 52' x 2 + 13'-4\" x 2. Enter Bar straight len for the straight vertical part, and Side 1/Side 2 bend lengths for the L bend legs.";
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

  function addRebarInfo() {
    setRebarInfoRows((current) => [...current, createRebarInfoRow("Base/Bottom rebar", current.length + 1)]);
  }

  function updateRebarInfoRow(id: string, key: keyof RebarInfoRow, value: string) {
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
    setIsGeneratingSchedule(true);
    const sourceRows = showingCalculatedParams && calculatedRows.length > 0 ? calculatedRows : rebarInfoRows;
    const sourceGlobals = showingCalculatedParams && calculatedGlobals ? calculatedGlobals : rebarGlobalParams;
    const sourceLabel = showingCalculatedParams && calculatedRows.length > 0 ? "calculated PDF parameters" : "manual parameters";
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
      };
      setSchedule(result.schedule);
      setSummary(result.summary);
      setMaterialTakeoff(result.materialTakeoff);
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

  function downloadCsv() {
    const header = [
      "Piece ID",
      "Location",
      "Qty",
      "Required Len",
      "Cut Len",
      "Left Function",
      "Used",
      "Right Function",
      "Field Order",
    ];

    const rows = schedule.map((line) => [
      line.mark,
      line.location,
      line.qty,
      line.requiredLength,
      line.cutLength,
      line.leftFunction,
      line.usedLength,
      line.rightFunction,
      line.fieldOrder,
    ]);

    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName.replaceAll(" ", "-").toLowerCase()}-rebar-schedule.csv`;
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

  const isPdf = planFileType.includes("pdf");
  const isImage = planFileType.startsWith("image/");
  const showingCalculatedParams = paramViewMode === "calculated";
  const displayedGlobalParams = showingCalculatedParams && calculatedGlobals ? calculatedGlobals : rebarGlobalParams;
  const rawDisplayedRows = showingCalculatedParams && calculatedRows.length > 0 ? calculatedRows : rebarInfoRows;
  const rebarTypeOrder: RebarInfoType[] = ["Base/Bottom rebar", "Horiz continues longtidues", "Vertical Rebar", "Pier", "Misc"];
  const displayedRows = [...rawDisplayedRows].sort((a, b) => {
    const typeDiff = rebarTypeOrder.indexOf(a.itemType) - rebarTypeOrder.indexOf(b.itemType);
    if (typeDiff !== 0) return typeDiff;
    return rebarInfoRows.findIndex((row) => row.id === a.id) - rebarInfoRows.findIndex((row) => row.id === b.id);
  });

  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto w-full max-w-[1800px]">
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
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h1 className="text-4xl font-bold text-gray-900">Rebar Planner</h1>
          <p className="mt-2 text-gray-600">
            Upload a foundation plan, enter overlap rules, confirm detected values,
            then generate a rebar schedule.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded border bg-gray-50 px-3 py-2">{user.email} · {authRole}</span>
            {(authRole === "owner" || authRole === "admin") && <Link href="/admin" className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">Admin</Link>}
            <button type="button" onClick={startNewProject} className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">New Project</button>
            <button type="button" onClick={saveWorkspace} className="rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800">Save Project</button>
            <button type="button" onClick={loadWorkspace} className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">Load Last Workspace</button>
            <button type="button" onClick={logout} className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">Logout</button>
            {workspaceStatus && <span className="text-gray-600">{workspaceStatus}</span>}
          </div>
        </div>

        <div className="mb-6 rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Planner View</h2>
              <p className="text-sm text-gray-600">Simple view keeps only project information, PDF viewing, and the manual parameters. Advanced view keeps the original tools.</p>
            </div>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-40">
                <button
                  type="button"
                  onClick={() => setPlannerView("simple")}
                  title="Show the simpler project/PDF/manual-parameters screen."
                  className={`w-full rounded px-4 py-2 font-semibold ${plannerView === "simple" ? "bg-blue-700 text-white" : "border bg-white hover:bg-gray-50"}`}
                >
                  Simplified View <span className="ml-1 rounded-full border px-1 text-xs" aria-hidden="true">i</span>
                </button>
                <div className="mt-1 text-xs text-gray-500">Simple PDF + manual data view.</div>
              </div>
              <div className="min-w-40">
                <button
                  type="button"
                  onClick={() => setPlannerView("advanced")}
                  title="Show the full extraction, crop, calculated-data, and project tools."
                  className={`w-full rounded px-4 py-2 font-semibold ${plannerView === "advanced" ? "bg-gray-900 text-white" : "border bg-white hover:bg-gray-50"}`}
                >
                  Advanced View <span className="ml-1 rounded-full border px-1 text-xs" aria-hidden="true">i</span>
                </button>
                <div className="mt-1 text-xs text-gray-500">Full tools and PDF extraction.</div>
              </div>
              <div className="min-w-56">
                <button
                  type="button"
                  onClick={generateSchedule}
                  disabled={isGeneratingSchedule}
                  title="Generate the rebar schedule from the current manual parameters and save the latest schedule with this project."
                  className="w-full rounded bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800 disabled:cursor-wait disabled:bg-gray-500"
                >
                  {isGeneratingSchedule ? "Generating..." : "Generate Rebar Schedule"} <span className="ml-1 rounded-full border px-1 text-xs" aria-hidden="true">i</span>
                </button>
                <div className="mt-1 text-xs text-gray-500">Calculates pieces, bends, sticks, and saves latest schedule.</div>
              </div>
            </div>
          </div>
          {scheduleGenerationStatus && (
            <div className={`mt-3 rounded border p-3 text-sm font-semibold ${isGeneratingSchedule ? "border-blue-300 bg-blue-50 text-blue-900" : scheduleGenerationStatus.startsWith("Schedule generation failed") ? "border-red-300 bg-red-50 text-red-900" : "border-green-300 bg-green-50 text-green-900"}`}>
              {scheduleGenerationStatus}
              {savedScheduleAt && !isGeneratingSchedule && (
                <div className="mt-1 text-xs font-normal">Last saved schedule: {new Date(savedScheduleAt).toLocaleString()}</div>
              )}
            </div>
          )}
        </div>

        {plannerView === "simple" && (
          <section className="mb-6 rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-bold text-gray-900">Project Information</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="font-semibold">Project name
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="mt-1 w-full rounded border p-2" />
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
            <div className="mt-5 rounded border bg-gray-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xl font-bold">PDF Viewer</h3>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPdfZoom((z) => Math.max(50, z - 25))} className="rounded border bg-white px-3 py-2 font-semibold hover:bg-gray-100">−</button>
                  <span className="min-w-16 text-center font-semibold">{pdfZoom}%</span>
                  <button type="button" onClick={() => setPdfZoom((z) => Math.min(200, z + 25))} className="rounded border bg-white px-3 py-2 font-semibold hover:bg-gray-100">+</button>
                </div>
              </div>
              {pdfViewerUrl ? (
                <iframe src={pdfViewerUrl} title="PDF plan viewer" className="h-[720px] w-full rounded border bg-white" />
              ) : (
                <div className="rounded border border-dashed bg-white p-8 text-center text-gray-600">No PDF available in this project yet. Use Advanced View to upload/load a plan.</div>
              )}
            </div>
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
            <button type="button" onClick={() => loadSavedProjects()} className="rounded bg-gray-200 px-3 py-2 font-semibold hover:bg-gray-300">Refresh Projects</button>
          </div>
          {savedProjects.length === 0 ? (
            <p className="rounded border border-dashed p-3 text-gray-600">No saved projects yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b bg-gray-50 text-sm text-gray-600">
                    <th className="p-2">Project</th>
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
                      <td className="p-2 font-semibold">{project.projectName}</td>
                      <td className="p-2 text-sm text-gray-700">{project.planFileName}</td>
                      <td className="p-2">{project.rowCount}</td>
                      <td className="p-2">{project.cropCount}</td>
                      <td className="p-2 text-sm text-gray-600">{project.updatedAtLabel || ""}</td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => loadProject(project.id)} className="rounded bg-blue-700 px-3 py-1.5 font-semibold text-white hover:bg-blue-800">Load / Edit</button>
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
                      className="mt-1 w-full rounded border p-2"
                    >
                      {rebarInfoTypes.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">Crop label
                    <input value={cropLabel} onChange={(event) => setCropLabel(event.target.value)} className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="text-sm font-semibold md:col-span-2">Crop note
                    <input value={cropNote} onChange={(event) => setCropNote(event.target.value)} placeholder="Example: Side wall detail rebar callout" className="mt-1 w-full rounded border p-2" />
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

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-semibold">
            {plannerView === "simple" ? "Manual Rebar Parameters" : "Confirm Detected Values"}
          </h2>

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
            <div className="rounded-lg border bg-gray-50 p-4">
              <h3 className="text-lg font-semibold">Rebar Parameters</h3>
              <p className="mb-4 text-xs text-gray-600">Shared collector/planner parameter structure. {plannerView === "simple" ? "Simple view: these manual parameters, row notes, overlaps, bend settings, and stock stick length are used by Generate Rebar Schedule." : "Use crop references only when visual proof is needed."}</p>

              <div className="mb-5 rounded border bg-white p-4">
                <h4 className="mb-3 text-sm font-bold uppercase text-gray-700">Global params</h4>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="font-semibold">Stick len {showingCalculatedParams && getCompareBadge(rebarGlobalParams.stickLength, getCalculatedGlobalValue("stickLength"))}
                    <input value={displayedGlobalParams.stickLength} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("stickLength", e.target.value)} placeholder="20'" className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default overlap {showingCalculatedParams && getCompareBadge(rebarGlobalParams.defaultOverlap, getCalculatedGlobalValue("defaultOverlap"))}
                    <input value={displayedGlobalParams.defaultOverlap} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("defaultOverlap", e.target.value)} placeholder={'24"'} className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default vertical to base {showingCalculatedParams && getCompareBadge(rebarGlobalParams.defaultVerticalToBase, getCalculatedGlobalValue("defaultVerticalToBase"))}
                    <input value={displayedGlobalParams.defaultVerticalToBase} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("defaultVerticalToBase", e.target.value)} placeholder={'6"'} className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default rebar for footing / walls {showingCalculatedParams && getCompareBadge(rebarGlobalParams.foundationRebarSize, getCalculatedGlobalValue("foundationRebarSize"))}
                    <input value={displayedGlobalParams.foundationRebarSize} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("foundationRebarSize", e.target.value)} placeholder="#4" className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default rebar for piers {showingCalculatedParams && getCompareBadge(rebarGlobalParams.pierRebarSize, getCalculatedGlobalValue("pierRebarSize"))}
                    <input value={displayedGlobalParams.pierRebarSize} disabled={showingCalculatedParams} onChange={(e) => updateRebarGlobalParam("pierRebarSize", e.target.value)} placeholder="#4" className="mt-1 w-full rounded border p-2" />
                  </label>
                </div>
              </div>

              <div className="mb-4 rounded border bg-white p-4">
                <h3 className="mb-2 text-lg font-bold">Foundation / Rebar Item Structure</h3>
                <p className="text-sm text-gray-600">
                  Use <strong>Add rebar info</strong> to add one item at a time. Each item can be Base/Bottom rebar, horizontal continuous longitudinals, vertical rebar, pier, or misc, and each item can reference one or more crop images.
                </p>
              </div>

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
                              ["Default vertical to base", manualComparisonGlobals.defaultVerticalToBase, calculatedGlobals.defaultVerticalToBase],
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
                                ["itemType", "Type"], ["segment", "Segment"], ["rebarSize", "Rebar #"], ["duplicateTimes", "Times to duplicate / number of piers"], ["count", "Count"], ["calcLength", "Calculate len"], ["length", "Length"], ["diameter", "Diameter"], ["number", "Number"], ["spacingBetween", "Space between"], ["traverseLength", "Traverse piece len"], ["spacing", "Spacing between circles"], ["horizontalCircleCount", "Number of H-Circles"], ["numVerticalBars", "Vertical bars count"], ["verticalBent", "Vertical bent"], ["verticalBentLength", "Vertical bent len"], ["clearanceTop", "Soil clearance top"], ["clearanceBottom", "Soil clearance bottom"], ["clearanceSides", "Soil clearance sides"],
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
                <button type="button" onClick={addRebarInfo} disabled={showingCalculatedParams} className="rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400">Add rebar info</button>
              </div>

              <div className="grid gap-4">
                {displayedRows.map((row, rowIndex) => (
                  <div key={row.id} className={`rounded-lg border bg-white p-4 ${showingCalculatedParams ? "pointer-events-none opacity-95" : ""}`}>
                    <div className="grid gap-4">
                      <div className="grid gap-4 md:grid-cols-4">
                        <label className="font-semibold">Type {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.itemType, row.itemType)}
                          <select value={row.itemType} onChange={(e) => changeRebarInfoType(row.id, e.target.value as RebarInfoType)} className="mt-1 w-full rounded border p-2">
                            {rebarInfoTypes.map((type) => <option key={type}>{type}</option>)}
                          </select>
                        </label>
                        <label className="font-semibold">Segment / item name {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.segment, row.segment)}
                          <input value={row.segment} onChange={(e) => updateRebarInfoRow(row.id, "segment", e.target.value)} placeholder="BaseBottom1 / Horiz1 / Vertical1 / Pier1 / Misc1" className="mt-1 w-full rounded border p-2" />
                        </label>
                        <label className="font-semibold">Rebar # {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.rebarSize, row.rebarSize)}
                          <input value={row.rebarSize} onChange={(e) => updateRebarInfoRow(row.id, "rebarSize", e.target.value)} placeholder={row.itemType === "Pier" ? rebarGlobalParams.pierRebarSize : rebarGlobalParams.foundationRebarSize} className="mt-1 w-full rounded border p-2" />
                        </label>
                        <label className="font-semibold">{row.itemType === "Pier" ? "Number of piers" : "Times to duplicate this"} {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.duplicateTimes, row.duplicateTimes)}
                          <input value={row.duplicateTimes} onChange={(e) => updateRebarInfoRow(row.id, "duplicateTimes", e.target.value)} placeholder={row.itemType === "Pier" ? "14" : "2"} className="mt-1 w-full rounded border p-2" />
                          <span className="mt-1 block text-xs font-normal text-gray-500">{row.itemType === "Pier" ? "number of piers" : "number of sides like this"}</span>
                        </label>
                      </div>


                      {row.itemType === "Base/Bottom rebar" && (
                        <div className="grid gap-4">
                          <div className="rounded border bg-gray-50 p-3">
                            <h4 className="mb-3 font-bold">Continuous longitudinals</h4>
                            <div className="grid gap-3 md:grid-cols-3">
                              <label className="font-semibold">Number {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.number, row.number)}
                                <input value={row.number} onChange={(e) => updateRebarInfoRow(row.id, "number", e.target.value)} placeholder="N/A or number" className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Len {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.length, row.length)}
                                <input value={row.length} onChange={(e) => updateRebarInfoRow(row.id, "length", e.target.value)} placeholder={`Example: 52' 0"`} className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Space between {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.spacingBetween, row.spacingBetween)}
                                <input value={row.spacingBetween} onChange={(e) => updateRebarInfoRow(row.id, "spacingBetween", e.target.value)} placeholder={'Example: 8"'} className="mt-1 w-full rounded border p-2" />
                              </label>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <div className="rounded border bg-white p-3">
                                <h5 className="mb-2 font-bold">Ending - Side 1</h5>
                                <div className="grid gap-3 md:grid-cols-3">
                                  <label className="font-semibold">Bent?
                                    <select value={row.side1Bent} onChange={(e) => updateRebarInfoRow(row.id, "side1Bent", e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select</option><option>Yes</option><option>No</option></select>
                                  </label>
                                  <label className="font-semibold">Turn angle
                                    <input value={row.side1TurnAngle} onChange={(e) => updateRebarInfoRow(row.id, "side1TurnAngle", e.target.value)} placeholder="0 / 45 / 90" className="mt-1 w-full rounded border p-2" />
                                  </label>
                                  <label className="font-semibold">Bent len
                                    <input value={row.side1BentLength} onChange={(e) => updateRebarInfoRow(row.id, "side1BentLength", e.target.value)} placeholder={'Example: 24"'} className="mt-1 w-full rounded border p-2" />
                                  </label>
                                </div>
                              </div>
                              <div className="rounded border bg-white p-3">
                                <h5 className="mb-2 font-bold">Ending - Side 2</h5>
                                <div className="grid gap-3 md:grid-cols-3">
                                  <label className="font-semibold">Bent?
                                    <select value={row.side2Bent} onChange={(e) => updateRebarInfoRow(row.id, "side2Bent", e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select</option><option>Yes</option><option>No</option></select>
                                  </label>
                                  <label className="font-semibold">Turn angle
                                    <input value={row.side2TurnAngle} onChange={(e) => updateRebarInfoRow(row.id, "side2TurnAngle", e.target.value)} placeholder="0 / 45 / 90" className="mt-1 w-full rounded border p-2" />
                                  </label>
                                  <label className="font-semibold">Bent len
                                    <input value={row.side2BentLength} onChange={(e) => updateRebarInfoRow(row.id, "side2BentLength", e.target.value)} placeholder={'Example: 24"'} className="mt-1 w-full rounded border p-2" />
                                  </label>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded border bg-gray-50 p-3">
                            <h4 className="mb-3 font-bold">Traverse bars</h4>
                            <div className="grid gap-3 md:grid-cols-3">
                              <label className="font-semibold">Number
                                <input value={row.traverseNumber} onChange={(e) => updateRebarInfoRow(row.id, "traverseNumber", e.target.value)} placeholder="N/A or number" className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Space between
                                <input value={row.traverseSpacing} onChange={(e) => updateRebarInfoRow(row.id, "traverseSpacing", e.target.value)} placeholder={'Example: 12" OC'} className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Traverse piece len
                                <input value={row.traverseLength} onChange={(e) => updateRebarInfoRow(row.id, "traverseLength", e.target.value)} placeholder={`Example: 13' 4"`} className="mt-1 w-full rounded border p-2" />
                              </label>
                            </div>
                          </div>

                          <div className="rounded border bg-gray-50 p-3">
                            <h4 className="mb-3 font-bold">Space from trench soil</h4>
                            <div className="grid gap-3 md:grid-cols-3">
                              <label className="font-semibold">Top
                                <input value={row.clearanceTop} onChange={(e) => updateRebarInfoRow(row.id, "clearanceTop", e.target.value)} placeholder={'3"'} className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Bottom
                                <input value={row.clearanceBottom} onChange={(e) => updateRebarInfoRow(row.id, "clearanceBottom", e.target.value)} placeholder={'3"'} className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Sides
                                <input value={row.clearanceSides} onChange={(e) => updateRebarInfoRow(row.id, "clearanceSides", e.target.value)} placeholder={'3"'} className="mt-1 w-full rounded border p-2" />
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      {row.itemType === "Horiz continues longtidues" && (
                        <div className="grid gap-4">
                          <div className="rounded border bg-gray-50 p-3">
                            <h4 className="mb-3 font-bold">Horizontal continuous longitudinals</h4>
                            <div className="grid gap-3 md:grid-cols-3">
                              <label className="font-semibold">Len {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.length, row.length)}
                                <input value={row.length} onChange={(e) => updateRebarInfoRow(row.id, "length", e.target.value)} placeholder={`Example: 52' 0"`} className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Number {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.number, row.number)}
                                <input value={row.number} onChange={(e) => updateRebarInfoRow(row.id, "number", e.target.value)} placeholder="1 / N/A / blank" className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Space between {showingCalculatedParams && getCompareBadge(rebarInfoRows[rowIndex]?.spacingBetween, row.spacingBetween)}
                                <input value={row.spacingBetween} onChange={(e) => updateRebarInfoRow(row.id, "spacingBetween", e.target.value)} placeholder="0" className="mt-1 w-full rounded border p-2" />
                              </label>
                            </div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <div className="rounded border bg-white p-3">
                                <h5 className="mb-2 font-bold">Ending - Side 1</h5>
                                <div className="grid gap-3 md:grid-cols-3">
                                  <label className="font-semibold">Bent?
                                    <select value={row.side1Bent} onChange={(e) => updateRebarInfoRow(row.id, "side1Bent", e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select</option><option>Yes</option><option>No</option></select>
                                  </label>
                                  <label className="font-semibold">Turn angle
                                    <input value={row.side1TurnAngle} onChange={(e) => updateRebarInfoRow(row.id, "side1TurnAngle", e.target.value)} placeholder="0 / 45 / 90" className="mt-1 w-full rounded border p-2" />
                                  </label>
                                  <label className="font-semibold">Bent len
                                    <input value={row.side1BentLength} onChange={(e) => updateRebarInfoRow(row.id, "side1BentLength", e.target.value)} placeholder={'Example: 24"'} className="mt-1 w-full rounded border p-2" />
                                  </label>
                                </div>
                              </div>
                              <div className="rounded border bg-white p-3">
                                <h5 className="mb-2 font-bold">Ending - Side 2</h5>
                                <div className="grid gap-3 md:grid-cols-3">
                                  <label className="font-semibold">Bent?
                                    <select value={row.side2Bent} onChange={(e) => updateRebarInfoRow(row.id, "side2Bent", e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select</option><option>Yes</option><option>No</option></select>
                                  </label>
                                  <label className="font-semibold">Turn angle
                                    <input value={row.side2TurnAngle} onChange={(e) => updateRebarInfoRow(row.id, "side2TurnAngle", e.target.value)} placeholder="0 / 45 / 90" className="mt-1 w-full rounded border p-2" />
                                  </label>
                                  <label className="font-semibold">Bent len
                                    <input value={row.side2BentLength} onChange={(e) => updateRebarInfoRow(row.id, "side2BentLength", e.target.value)} placeholder={'Example: 24"'} className="mt-1 w-full rounded border p-2" />
                                  </label>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {row.itemType === "Vertical Rebar" && (
                        <div className="rounded border bg-gray-50 p-3">
                          <h4 className="mb-3 font-bold">Vertical bars</h4>
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="font-semibold">Space between adjacent
                              <input value={row.verticalSpacingAdjacent} onChange={(e) => updateRebarInfoRow(row.id, "verticalSpacingAdjacent", e.target.value)} placeholder={'Example: 12" OC'} className="mt-1 w-full rounded border p-2" />
                            </label>
                            <label className="font-semibold">Count
                              <input value={row.count} onChange={(e) => updateRebarInfoRow(row.id, "count", e.target.value)} onBlur={(e) => { if (!e.target.value.trim()) updateRebarInfoRow(row.id, "count", "N/A"); }} placeholder="N/A" className="mt-1 w-full rounded border p-2" />
                              <span className="mt-1 block text-xs font-normal text-gray-500">Use N/A to calculate from run length and spacing.</span>
                            </label>
                            <label className="font-semibold">Bar straight len
                              <input value={row.length} onChange={(e) => updateRebarInfoRow(row.id, "length", e.target.value)} placeholder={'Example: 30"'} className="mt-1 w-full rounded border p-2" />
                            </label>
                            <label className="font-semibold">Calculate len / total run
                              <input value={row.calcLength} onChange={(e) => updateRebarInfoRow(row.id, "calcLength", e.target.value)} placeholder="Auto from base/bottom total" className="mt-1 w-full rounded border p-2" />
                              <span className="mt-1 block text-xs font-normal text-gray-500">If Count is N/A, qty = this run length / spacing + 1. Blank uses total base/bottom length.</span>
                            </label>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded border bg-white p-3">
                              <h5 className="mb-2 font-bold">Side 1</h5>
                              <div className="grid gap-3 md:grid-cols-3">
                                <label className="font-semibold">Bent?
                                  <select value={row.side1Bent} onChange={(e) => updateRebarInfoRow(row.id, "side1Bent", e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select</option><option>Yes</option><option>No</option></select>
                                </label>
                                <label className="font-semibold">Turn angle
                                  <input value={row.side1TurnAngle} onChange={(e) => updateRebarInfoRow(row.id, "side1TurnAngle", e.target.value)} placeholder="0 / 45 / 90" className="mt-1 w-full rounded border p-2" />
                                </label>
                                <label className="font-semibold">Bent len
                                  <input value={row.side1BentLength} onChange={(e) => updateRebarInfoRow(row.id, "side1BentLength", e.target.value)} placeholder={'Example: 6"'} className="mt-1 w-full rounded border p-2" />
                                </label>
                              </div>
                            </div>
                            <div className="rounded border bg-white p-3">
                              <h5 className="mb-2 font-bold">Side 2</h5>
                              <div className="grid gap-3 md:grid-cols-3">
                                <label className="font-semibold">Bent?
                                  <select value={row.side2Bent} onChange={(e) => updateRebarInfoRow(row.id, "side2Bent", e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Select</option><option>Yes</option><option>No</option></select>
                                </label>
                                <label className="font-semibold">Turn angle
                                  <input value={row.side2TurnAngle} onChange={(e) => updateRebarInfoRow(row.id, "side2TurnAngle", e.target.value)} placeholder="0 / 45 / 90" className="mt-1 w-full rounded border p-2" />
                                </label>
                                <label className="font-semibold">Bent len
                                  <input value={row.side2BentLength} onChange={(e) => updateRebarInfoRow(row.id, "side2BentLength", e.target.value)} placeholder={'Example: 6"'} className="mt-1 w-full rounded border p-2" />
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {row.itemType === "Pier" && (
                        <div className="rounded border bg-gray-50 p-3">
                          <h4 className="mb-3 font-bold">Pier rebar</h4>
                          <div className="grid gap-3 md:grid-cols-3">
                            <label className="font-semibold">Diameter
                              <input value={row.diameter} onChange={(e) => updateRebarInfoRow(row.id, "diameter", e.target.value)} placeholder={'Example: 28"'} className="mt-1 w-full rounded border p-2" />
                            </label>
                            <label className="font-semibold">Length
                              <input value={row.length} onChange={(e) => updateRebarInfoRow(row.id, "length", e.target.value)} placeholder={'Example: 30"'} className="mt-1 w-full rounded border p-2" />
                            </label>
                            <label className="font-semibold">Number of H-Circles
                              <input value={row.horizontalCircleCount} onChange={(e) => updateRebarInfoRow(row.id, "horizontalCircleCount", e.target.value)} placeholder="N/A or 4" className="mt-1 w-full rounded border p-2" />
                              <span className="mt-1 block text-xs font-normal text-gray-500">Use N/A to calculate from pier length and spacing.</span>
                            </label>
                            <label className="font-semibold">Vertical bars count
                              <input value={row.numVerticalBars} onChange={(e) => updateRebarInfoRow(row.id, "numVerticalBars", e.target.value)} placeholder="Example: 6" className="mt-1 w-full rounded border p-2" />
                            </label>
                            <label className="font-semibold">Spacing between circles
                              <input value={row.spacing} onChange={(e) => updateRebarInfoRow(row.id, "spacing", e.target.value)} placeholder='Example: 8"' className="mt-1 w-full rounded border p-2" />
                            </label>
                            <label className="font-semibold">Vertical bent?
                              <select value={row.verticalBent} onChange={(e) => updateRebarInfoRow(row.id, "verticalBent", e.target.value)} className="mt-1 w-full rounded border p-2">
                                <option value="">Select</option><option>Yes</option><option>No</option>
                              </select>
                            </label>
                            <label className="font-semibold">Vertical bent len
                              <input value={row.verticalBentLength} onChange={(e) => updateRebarInfoRow(row.id, "verticalBentLength", e.target.value)} placeholder={'Example: 6"'} className="mt-1 w-full rounded border p-2" />
                            </label>
                          </div>
                          <div className="mt-3 rounded border bg-white p-3">
                            <h4 className="mb-3 font-bold">Space from trench soil</h4>
                            <div className="grid gap-3 md:grid-cols-3">
                              <label className="font-semibold">Top
                                <input value={row.clearanceTop} onChange={(e) => updateRebarInfoRow(row.id, "clearanceTop", e.target.value)} placeholder={'3"'} className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Bottom
                                <input value={row.clearanceBottom} onChange={(e) => updateRebarInfoRow(row.id, "clearanceBottom", e.target.value)} placeholder={'3"'} className="mt-1 w-full rounded border p-2" />
                              </label>
                              <label className="font-semibold">Sides
                                <input value={row.clearanceSides} onChange={(e) => updateRebarInfoRow(row.id, "clearanceSides", e.target.value)} placeholder={'3"'} className="mt-1 w-full rounded border p-2" />
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      {row.itemType === "Misc" && (
                        <div className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
                          Misc rows are for notes, unusual rebar details, or plan callouts that do not fit the main types.
                        </div>
                      )}

                      {plannerView === "advanced" && (
                      <div className="font-semibold" data-crop-dropdown>
                        <div>Crop images</div>
                        {cropRefs.length === 0 ? (
                          <div className="mt-1 rounded border bg-white p-3 text-sm font-normal text-gray-500">No crops saved yet.</div>
                        ) : (
                          <div className="relative mt-1 rounded border bg-white">
                            <button
                              type="button"
                              onClick={() => setOpenCropDropdownRowId((current) => current === row.id ? "" : row.id)}
                              className="plainButton flex w-full items-center justify-between gap-3 p-3 text-left text-sm font-semibold"
                            >
                              <span className="truncate">{selectedCropSummary(row)}</span>
                              <span className="shrink-0 text-gray-500">Select one or more ▾</span>
                            </button>
                            {openCropDropdownRowId === row.id && (
                              <div className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded border bg-white p-2 shadow-lg">
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
                                            <img src={cropImageUrl(crop)} alt={crop.label} className="mt-2 h-20 w-full rounded border bg-white object-contain" />
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
                      </div>
                      )}

                      <div className="rounded border bg-gray-100 p-3 text-sm text-gray-700">
                        <div className="mb-2 font-semibold text-gray-900">Descriptive note</div>
                        <div className="mb-2 rounded border border-gray-200 bg-gray-50 p-2 text-gray-700">
                          <strong>Calculation guide:</strong> {rebarInfoGuideline(row)}
                        </div>
                        <label className="block font-semibold">Additional field note
                          <textarea value={row.note} onChange={(e) => updateRebarInfoRow(row.id, "note", e.target.value)} placeholder="Add your extra field notes here. The calculation guide above stays with this row and cannot be deleted." className="mt-1 min-h-20 w-full rounded border bg-white p-2" />
                        </label>
                      </div>
                    </div>
                    {rebarInfoRows.length > 1 && (
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={() => removeRebarInfoRow(row.id)} className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">Remove this row</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end">
                <button type="button" onClick={addRebarInfo} disabled={showingCalculatedParams} className="rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400">Add rebar info</button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={generateSchedule}
            disabled={isGeneratingSchedule}
            className="mt-5 w-full rounded bg-gray-900 p-3 font-semibold text-white hover:bg-gray-800 disabled:cursor-wait disabled:bg-gray-500"
          >
            {isGeneratingSchedule ? "Generating Rebar Schedule..." : "Generate Rebar Schedule"}
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

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-semibold">Piece Naming Legend</h2>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded border p-3">
              <strong>SW / EW</strong>
              <br />
              Side Wall / End Wall
            </div>
            <div className="rounded border p-3">
              <strong>BASE O/M/I</strong>
              <br />
              Footing outer / middle / inner
            </div>
            <div className="rounded border p-3">
              <strong>WALL B/M/T</strong>
              <br />
              Stem wall bottom / middle / top
            </div>
            <div className="rounded border p-3">
              <strong>V-S / V-E</strong>
              <br />
              Side Wall/End Wall vertical bars with 6 in bottom bent overlap
            </div>
            <div className="rounded border p-3">
              <strong>FOOTING_TIE_BAR</strong>
              <br />
              FOOTING_TIE_BAR pieces
            </div>
            <div className="rounded border p-3">
              <strong>PC</strong>
              <br />
              Pier cage / sonotube count confirmed by user
            </div>
          </div>
        </section>

        {schedule.length > 0 && (
          <section className="mt-6 rounded-lg bg-white p-6 shadow">
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
                              className={`cursor-pointer hover:bg-yellow-50 ${selectedMark === line.mark ? "bg-yellow-100" : ""}`}
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

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-2xl font-semibold">Rebar Schedule Output</h2>
            <div className="flex flex-col gap-2 md:flex-row">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="rounded border p-2"
              >
                <option value="ALL">All Pieces</option>
                {filterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={schedule.length === 0}
                className="rounded bg-green-700 px-4 py-2 font-semibold text-white hover:bg-green-800 disabled:bg-gray-400"
              >
                Download CSV
              </button>
            </div>
          </div>

          {summary.length > 0 && (
            <div className="mb-6 overflow-x-auto rounded border">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border-b p-3">Mark Prefix</th>
                    <th className="border-b p-3">Description</th>
                    <th className="border-b p-3">Pieces</th>
                    <th className="border-b p-3">Required Len</th>
                    <th className="border-b p-3">Total Used</th>
                    <th className="border-b p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((line) => (
                    <tr key={`${line.prefix}-${line.description}`}>
                      <td className="border-b p-3 font-bold">{line.prefix}</td>
                      <td className="border-b p-3">{line.description}</td>
                      <td className="border-b p-3">{line.qty}</td>
                      <td className="border-b p-3">{line.requiredLength}</td>
                      <td className="border-b p-3">{line.totalUsed}</td>
                      <td className="border-b p-3 font-semibold">
                        {line.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {materialTakeoff && (
            <div className="mb-6 grid gap-3 md:grid-cols-7">
              <div className="rounded border p-3">
                <strong>Total Cut</strong>
                <br />
                {materialTakeoff.totalCut}
              </div>
              <div className="rounded border p-3">
                <strong>Stock Length</strong>
                <br />
                {materialTakeoff.stockLength}
              </div>
              <div className="rounded border p-3">
                <strong>Sticks to Buy</strong>
                <br />
                {materialTakeoff.sticksToBuy}
              </div>
              <div className="rounded border p-3">
                <strong>Available</strong>
                <br />
                {materialTakeoff.availableLength}
              </div>
              <div className="rounded border p-3">
                <strong>Waste</strong>
                <br />
                {materialTakeoff.waste}
              </div>
              <div className="rounded border p-3">
                <strong>Cuts</strong>
                <br />
                {materialTakeoff.cutCount}
              </div>
              <div className="rounded border p-3">
                <strong>Bends</strong>
                <br />
                {materialTakeoff.bendCount}
              </div>
              <div className="rounded border p-3">
                <strong>Full sticks straight/no cut</strong>
                <br />
                {materialTakeoff.straightStockStickCount ?? 0}
              </div>
              <div className="rounded border p-3">
                <strong>Sticks need cut/bend</strong>
                <br />
                {materialTakeoff.cutOrBentStockStickCount ?? 0}
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
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="border-b p-3">Piece ID</th>
                        <th className="border-b p-3">Location</th>
                        <th className="border-b p-3">Qty</th>
                        <th className="border-b p-3">Required Len</th>
                        <th className="border-b p-3">Cut Len</th>
                        <th className="border-b p-3">Left Function</th>
                        <th className="border-b p-3">Used</th>
                        <th className="border-b p-3">Right Function</th>
                        <th className="border-b p-3">Field Order / Check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.lines.map((line) => (
                        <tr
                          key={line.mark}
                          onClick={() => selectPiece(line)}
                          className={`cursor-pointer hover:bg-yellow-50 ${selectedMark === line.mark ? "bg-yellow-100" : ""}`}
                        >
                          <td className="border-b p-3 font-bold">{line.mark}</td>
                          <td className="border-b p-3">{line.location}</td>
                          <td className="border-b p-3 font-semibold">{line.qty}</td>
                          <td className="border-b p-3">{line.requiredLength}</td>
                          <td className="border-b p-3 font-semibold">
                            {line.cutLength}
                          </td>
                          <td className="border-b p-3">{line.leftFunction}</td>
                          <td className="border-b p-3 font-semibold">
                            {line.usedLength}
                          </td>
                          <td className="border-b p-3">{line.rightFunction}</td>
                          <td className="border-b p-3 font-mono">
                            {line.fieldOrder}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
