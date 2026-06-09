"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  formatFeet,
  generateRebarSchedule,
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
import { db } from "@/lib/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

type ExtractedField = {
  key: string;
  label: string;
  value: string;
};

type RebarInfoType = "Footing" | "Wall" | "Pier" | "Misc";

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
  cropImage: string;
  rebarSize: string;
  note: string;
};

type RebarGlobalParams = {
  stickLength: string;
  defaultOverlap: string;
  defaultVerticalToBase: string;
  foundationRebarSize: string;
  pierRebarSize: string;
};

type PlannerWorkspace = {
  projectName: string;
  planFileName: string;
  planFileType: string;
  planFileSize: number;
  extractionMode: ExtractionMode;
  horizontalLap: string;
  verticalBentLap: string;
  stickLength: string;
  fields: ExtractedField[];
  fieldSources: Record<string, FieldSource>;
  pierMode: "unknown" | "yes" | "none";
  rebarGlobalParams?: RebarGlobalParams;
  rebarInfoRows?: RebarInfoRow[];
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


const rebarInfoTypes: RebarInfoType[] = ["Footing", "Wall", "Pier", "Misc"];

function createRebarInfoRow(itemType: RebarInfoType = "Footing", index = 1): RebarInfoRow {
  return {
    id: crypto.randomUUID(),
    itemType,
    segment: `${itemType}${index}`,
    length: "",
    turn: "",
    bentLength: "",
    diameter: "",
    horizontalCircleCount: "",
    numVerticalBars: "",
    verticalBent: "",
    verticalBentLength: "",
    cropImage: "",
    rebarSize: "",
    note: "",
  };
}

function nextRebarSegment(rows: RebarInfoRow[], itemType: RebarInfoType) {
  const count = rows.filter((row) => row.itemType === itemType).length + 1;
  return `${itemType}${count}`;
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
  const [projectName, setProjectName] = useState("ADU Foundation");
  const [planFileName, setPlanFileName] = useState("");
  const [planFileType, setPlanFileType] = useState("");
  const [planFileSize, setPlanFileSize] = useState(0);
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
  const [rebarInfoRows, setRebarInfoRows] = useState<RebarInfoRow[]>(() => [createRebarInfoRow("Footing", 1)]);
  const [fields, setFields] = useState<ExtractedField[]>(initialFields);
  const [fieldSources, setFieldSources] = useState<Record<string, FieldSource>>(
    getInitialFieldSources(),
  );
  const [schedule, setSchedule] = useState<ScheduleLine[]>([]);
  const [summary, setSummary] = useState<SummaryLine[]>([]);
  const [materialTakeoff, setMaterialTakeoff] =
    useState<MaterialTakeoff | null>(null);
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
  const [regionPageNumber, setRegionPageNumber] = useState("4");
  const [regionRect, setRegionRect] = useState<RegionRect | null>(null);
  const [regionDragStart, setRegionDragStart] = useState<{ x: number; y: number } | null>(null);
  const [regionStatus, setRegionStatus] = useState("");
  const [regionAnalysis, setRegionAnalysis] = useState<RegionAnalysis | null>(null);
  const [regionZoom, setRegionZoom] = useState(1);


  const workspaceDocId = user?.uid || "";

  function getWorkspaceSnapshot(): PlannerWorkspace {
    return {
      projectName,
      planFileName,
      planFileType,
      planFileSize,
      extractionMode,
      horizontalLap,
      verticalBentLap,
      stickLength,
      fields,
      fieldSources,
      pierMode,
      rebarGlobalParams,
      rebarInfoRows,
    };
  }

  function applyWorkspaceSnapshot(data: Partial<PlannerWorkspace>) {
    if (typeof data.projectName === "string") setProjectName(data.projectName);
    if (typeof data.planFileName === "string") setPlanFileName(data.planFileName);
    if (typeof data.planFileType === "string") setPlanFileType(data.planFileType);
    if (typeof data.planFileSize === "number") setPlanFileSize(data.planFileSize);
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
    if (Array.isArray(data.rebarInfoRows) && data.rebarInfoRows.length) {
      setRebarInfoRows(data.rebarInfoRows.map((row, index) => ({
        ...createRebarInfoRow(row.itemType || "Footing", index + 1),
        ...row,
        itemType: rebarInfoTypes.includes(row.itemType) ? row.itemType : "Footing",
      })));
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

  async function saveWorkspace() {
    if (!user || !workspaceDocId) {
      setWorkspaceStatus("Login required before saving.");
      return;
    }
    setWorkspaceStatus("Saving workspace...");
    try {
      await setDoc(doc(db, "plannerWorkspaces", workspaceDocId), {
        ...getWorkspaceSnapshot(),
        ownerUid: user.uid,
        ownerEmail: user.email || "",
        app: "rebar-planner",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });
      setWorkspaceStatus("Workspace saved to Firestore.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? `Save failed: ${error.message}` : "Save failed.");
    }
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
    const order = ["Side Wall Rebar", "End Wall Rebar", "Pier Rebar", "Footing Tie Bars", "Other Rebar"];
    const groups = new Map<string, ScheduleLine[]>();

    for (const line of filteredSchedule) {
      const title = getScheduleGroupTitle(line);
      const current = groups.get(title) || [];
      current.push(line);
      groups.set(title, current);
    }

    return order
      .filter((title) => groups.has(title))
      .map((title) => ({ title, lines: groups.get(title) || [] }));
  }, [filteredSchedule]);

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

  function addRebarInfo() {
    setRebarInfoRows((current) => [...current, createRebarInfoRow("Footing", current.length + 1)]);
  }

  function updateRebarInfoRow(id: string, key: keyof RebarInfoRow, value: string) {
    setRebarInfoRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function changeRebarInfoType(id: string, itemType: RebarInfoType) {
    setRebarInfoRows((current) => current.map((row) => (row.id === id ? { ...row, itemType, segment: nextRebarSegment(current.filter((item) => item.id !== id), itemType), rebarSize: row.rebarSize || (itemType === "Pier" ? rebarGlobalParams.pierRebarSize : rebarGlobalParams.foundationRebarSize) } : row)));
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
  }

  function clearPlan() {
    if (planPreviewUrl) {
      URL.revokeObjectURL(planPreviewUrl);
    }

    setPlanFileName("");
    setPlanFileType("");
    setPlanFileSize(0);
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
  }

  function applyDetectedValues(values: DetectedValue[]) {
    const applied = fields.map((field) => {
      const detected = values.find((value) => value.key === field.key);
      if (detected) return { ...field, value: detected.value };
      return extractionMode === "live" ? { ...field, value: "" } : field;
    });
    const withDerived = applyDerivedFieldValues(applied);
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
      return;
    }

    try {
      setExtractionStatus("Reading PDF text...");
      const text = await extractPdfTextFromFile(planFile);
      setExtractedTextPreview(text.slice(0, 5000));
      const recognition = analyzePlanText(text);
      setRecognitionReport(recognition);

      const result = extractDetectedValuesFromPlanText(
        recognition.preferredText || text,
        { mode: extractionMode },
      );
      applyDetectedValues(result.detectedValues);

      let visualNotes: string[] = [];
      if (useExternalVisualAnalyzer) {
        try {
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

  function generateSchedule() {
    const blockingMissingKeys = getBlockingLiveModeMissingFields();
    if (blockingMissingKeys.length > 0) {
      const labels = blockingMissingKeys
        .map(
          (key) =>
            initialFields.find((field) => field.key === key)?.label || key,
        )
        .slice(0, 8)
        .join(", ");
      setExtractionStatus(
        `Live Mode blocked schedule generation. Missing/Sim values must be entered or extracted first: ${labels}${blockingMissingKeys.length > 8 ? "..." : ""}`,
      );
      return;
    }

    if (pierMode === "unknown") {
      setPierDialogOpen(true);
      setPierMessage(
        "Confirm pier details before generating, or choose I do not have piers.",
      );
      return;
    }
    const result = generateRebarSchedule({
      sideWallLength: getFieldValue("sideWallLength"),
      sideBaseOuterLength: getFieldValue("sideBaseOuterLength"),
      sideBaseMiddleLength: getFieldValue("sideBaseMiddleLength"),
      sideBaseInnerLength: getFieldValue("sideBaseInnerLength"),
      endWallLength: getFieldValue("endWallLength"),
      endBaseOuterLength: getFieldValue("endBaseOuterLength"),
      endBaseMiddleLength: getFieldValue("endBaseMiddleLength"),
      endBaseInnerLength: getFieldValue("endBaseInnerLength"),
      stockLengthFeet: Number(stickLength) || 20,
      horizontalOverlapInches: Number(horizontalLap) || 24,
      verticalBentOverlapInches: Number(verticalBentLap) || 6,
      sideTotalHeight: getFieldValue("sideTotalHeight"),
      endTotalHeight: getFieldValue("endTotalHeight"),
      footingDepth: getFieldValue("footingDepth"),
      sideVerticalQty: getFieldValue("sideVerticalQty"),
      sideVerticalBottomClearance: getFieldValue("sideVerticalBottomClearance"),
      sideVerticalTopClearance: getFieldValue("sideVerticalTopClearance"),
      sideVerticalUsedHeight: getFieldValue("sideVerticalUsedHeight"),
      endVerticalQty: getFieldValue("endVerticalQty"),
      endVerticalBottomClearance: getFieldValue("endVerticalBottomClearance"),
      endVerticalTopClearance: getFieldValue("endVerticalTopClearance"),
      endVerticalUsedHeight: getFieldValue("endVerticalUsedHeight"),
      baseShortVerticalQty: getFieldValue("baseShortVerticalQty"),
      baseShortVerticalCutLength: getFieldValue("baseShortVerticalCutLength"),
      hasPiers: pierMode === "yes",
      pierCount: getFieldValue("pierCount"),
      pierDiameter: getFieldValue("pierDiameter"),
      pierHeight: getFieldValue("pierHeight"),
    });

    setSchedule(result.schedule);
    setSummary(result.summary);
    setMaterialTakeoff(result.materialTakeoff);
    setFilter("ALL");
    setSelectedMark(result.schedule[0]?.mark || "");
    setSelectedPrefix(result.schedule[0]?.prefix || "");
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

  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto w-full max-w-[1800px]">
        {pierDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl">
              <h2 className="text-2xl font-bold">Enter Pier Details</h2>
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
            <button type="button" onClick={saveWorkspace} className="rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800">Save Workspace</button>
            <button type="button" onClick={loadWorkspace} className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">Load Workspace</button>
            <button type="button" onClick={logout} className="rounded border px-3 py-2 font-semibold hover:bg-gray-50">Logout</button>
            {workspaceStatus && <span className="text-gray-600">{workspaceStatus}</span>}
          </div>
        </div>

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

              <button
                type="button"
                onClick={extractPlanData}
                className="rounded bg-blue-600 p-3 font-semibold text-white hover:bg-blue-700"
              >
                {extractionMode === "live"
                  ? "Extract Plan Data - Live"
                  : "Extract Plan Data - Simulation"}
              </button>
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


            {planPreviewUrl && isPdf && (
              <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4">
                <h3 className="mb-2 text-lg font-semibold text-blue-950">
                  Selected Rectangle Extraction
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
                    Render Page for Selection
                  </button>
                  <button
                    type="button"
                    onClick={analyzeSelectedRegion}
                    disabled={!regionRect}
                    className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:bg-gray-400"
                  >
                    Analyze Selected Rectangle
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

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-semibold">
            Confirm Detected Values
          </h2>

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

          <div className="grid gap-4">
            <div className="rounded-lg border bg-gray-50 p-4">
              <h3 className="text-lg font-semibold">Rebar Parameters</h3>
              <p className="mb-4 text-xs text-gray-600">Shared collector/planner parameter structure. Use crop references only when visual proof is needed.</p>

              <div className="mb-5 rounded border bg-white p-4">
                <h4 className="mb-3 text-sm font-bold uppercase text-gray-700">Global params</h4>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="font-semibold">Stick len
                    <input value={rebarGlobalParams.stickLength} onChange={(e) => updateRebarGlobalParam("stickLength", e.target.value)} placeholder="20'" className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default overlap
                    <input value={rebarGlobalParams.defaultOverlap} onChange={(e) => updateRebarGlobalParam("defaultOverlap", e.target.value)} placeholder={'24"'} className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default vertical to base
                    <input value={rebarGlobalParams.defaultVerticalToBase} onChange={(e) => updateRebarGlobalParam("defaultVerticalToBase", e.target.value)} placeholder={'6"'} className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default rebar for footing / walls
                    <input value={rebarGlobalParams.foundationRebarSize} onChange={(e) => updateRebarGlobalParam("foundationRebarSize", e.target.value)} placeholder="#4" className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="font-semibold">Default rebar for piers
                    <input value={rebarGlobalParams.pierRebarSize} onChange={(e) => updateRebarGlobalParam("pierRebarSize", e.target.value)} placeholder="#4" className="mt-1 w-full rounded border p-2" />
                  </label>
                </div>
              </div>

              <div className="mb-3 flex justify-end">
                <button type="button" onClick={addRebarInfo} className="rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800">Add rebar info</button>
              </div>

              <div className="grid gap-4">
                {rebarInfoRows.map((row) => (
                  <div key={row.id} className="rounded-lg border bg-white p-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                      <label className="font-semibold">Type
                        <select value={row.itemType} onChange={(e) => changeRebarInfoType(row.id, e.target.value as RebarInfoType)} className="mt-1 w-full rounded border p-2">
                          {rebarInfoTypes.map((type) => <option key={type}>{type}</option>)}
                        </select>
                      </label>
                      <label className="font-semibold">Segment
                        <input value={row.segment} onChange={(e) => updateRebarInfoRow(row.id, "segment", e.target.value)} placeholder="Footing1 / Wall1 / Pier1 / Misc1" className="mt-1 w-full rounded border p-2" />
                      </label>

                      {(row.itemType === "Footing" || row.itemType === "Wall" || row.itemType === "Misc") && (
                        <>
                          <label className="font-semibold">Len
                            <input value={row.length} onChange={(e) => updateRebarInfoRow(row.id, "length", e.target.value)} placeholder={`Example: 52' 0"`} className="mt-1 w-full rounded border p-2" />
                          </label>
                          <label className="font-semibold">Turn
                            <input value={row.turn} onChange={(e) => updateRebarInfoRow(row.id, "turn", e.target.value)} placeholder="0 / 45 / 90 / free text" className="mt-1 w-full rounded border p-2" />
                          </label>
                          <label className="font-semibold">Bent len
                            <input value={row.bentLength} onChange={(e) => updateRebarInfoRow(row.id, "bentLength", e.target.value)} placeholder={'Example: 6" or 12"'} className="mt-1 w-full rounded border p-2" />
                          </label>
                        </>
                      )}

                      {row.itemType === "Pier" && (
                        <>
                          <label className="font-semibold">Diameter
                            <input value={row.diameter} onChange={(e) => updateRebarInfoRow(row.id, "diameter", e.target.value)} placeholder={'Example: 28"'} className="mt-1 w-full rounded border p-2" />
                          </label>
                          <label className="font-semibold">Length
                            <input value={row.length} onChange={(e) => updateRebarInfoRow(row.id, "length", e.target.value)} placeholder={'Example: 30"'} className="mt-1 w-full rounded border p-2" />
                          </label>
                          <label className="font-semibold">Horizontal circle count
                            <input value={row.horizontalCircleCount} onChange={(e) => updateRebarInfoRow(row.id, "horizontalCircleCount", e.target.value)} placeholder="Example: 4" className="mt-1 w-full rounded border p-2" />
                          </label>
                          <label className="font-semibold">Vertical bars
                            <input value={row.numVerticalBars} onChange={(e) => updateRebarInfoRow(row.id, "numVerticalBars", e.target.value)} placeholder="Example: 6" className="mt-1 w-full rounded border p-2" />
                          </label>
                          <label className="font-semibold">Vertical bent?
                            <select value={row.verticalBent} onChange={(e) => updateRebarInfoRow(row.id, "verticalBent", e.target.value)} className="mt-1 w-full rounded border p-2">
                              <option value="">Select</option><option>Yes</option><option>No</option>
                            </select>
                          </label>
                          <label className="font-semibold">Vertical bent len
                            <input value={row.verticalBentLength} onChange={(e) => updateRebarInfoRow(row.id, "verticalBentLength", e.target.value)} placeholder={'Example: 6"'} className="mt-1 w-full rounded border p-2" />
                          </label>
                        </>
                      )}

                      <label className="font-semibold">Crop image
                        <input value={row.cropImage} onChange={(e) => updateRebarInfoRow(row.id, "cropImage", e.target.value)} placeholder="No crop / crop id / reference" className="mt-1 w-full rounded border p-2" />
                      </label>
                      <label className="font-semibold">Rebar #
                        <input value={row.rebarSize} onChange={(e) => updateRebarInfoRow(row.id, "rebarSize", e.target.value)} placeholder={row.itemType === "Pier" ? rebarGlobalParams.pierRebarSize : rebarGlobalParams.foundationRebarSize} className="mt-1 w-full rounded border p-2" />
                      </label>
                      <label className="font-semibold sm:col-span-2 lg:col-span-3 2xl:col-span-4">Descriptive note
                        <textarea value={row.note} onChange={(e) => updateRebarInfoRow(row.id, "note", e.target.value)} placeholder="Any extra note for this row." className="mt-1 min-h-24 w-full rounded border p-2" />
                      </label>
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
                <button type="button" onClick={addRebarInfo} className="rounded bg-blue-700 px-3 py-2 font-semibold text-white hover:bg-blue-800">Add rebar info</button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded border border-purple-300 bg-purple-50 p-3 text-sm text-purple-900">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>Pier Details</strong>
                <div className="text-xs">
                  {pierMode === "unknown"
                    ? "Not confirmed yet. Required before generating."
                    : pierMode === "yes"
                      ? `Confirmed: ${getFieldValue("pierCount") || "?"} piers, ${getFieldValue("pierDiameter") || "diameter ?"}, height ${getFieldValue("pierHeight") || "?"}`
                      : "No piers selected."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPierDialogOpen(true)}
                className="rounded bg-purple-700 px-3 py-2 font-semibold text-white hover:bg-purple-800"
              >
                Enter Pier Details
              </button>
            </div>
            {pierMessage && <div className="text-xs">{pierMessage}</div>}
          </div>

          <button
            type="button"
            onClick={generateSchedule}
            className="mt-5 w-full rounded bg-gray-900 p-3 font-semibold text-white hover:bg-gray-800"
          >
            Generate Rebar Schedule
          </button>
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
                    onClick={() => selectPrefix("EW-H-WALL-T")}
                    className={`w-64 rounded border p-3 font-semibold ${selectedPrefix === "EW-H-WALL-T" ? "bg-yellow-200" : "bg-white"}`}
                  >
                    EW-H-WALL-T
                  </button>

                  <div className="flex w-full items-stretch justify-center gap-2">
                    <div className="grid gap-2">
                      {[
                        "SW-H-BASE-O",
                        "SW-H-BASE-M",
                        "SW-H-BASE-I",
                        "SW-H-WALL-B",
                        "SW-H-WALL-M",
                        "SW-H-WALL-T",
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

                    <div className="flex min-h-56 flex-1 items-center justify-center rounded border-4 border-gray-400 bg-white text-center text-gray-500">
                      Foundation Plan Area
                    </div>

                    <div className="grid gap-2">
                      {[
                        "SW-H-BASE-O",
                        "SW-H-BASE-M",
                        "SW-H-BASE-I",
                        "SW-H-WALL-B",
                        "SW-H-WALL-M",
                        "SW-H-WALL-T",
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
                    onClick={() => selectPrefix("EW-H-WALL-B")}
                    className={`w-64 rounded border p-3 font-semibold ${selectedPrefix === "EW-H-WALL-B" ? "bg-yellow-200" : "bg-white"}`}
                  >
                    EW-H-WALL-B
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
