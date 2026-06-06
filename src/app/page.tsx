"use client";

import { useMemo, useState } from "react";
import {
  generateRebarSchedule,
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

type ExtractedField = {
  key: string;
  label: string;
  value: string;
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

const initialFields: ExtractedField[] = [
  { key: "sideWallLength", label: "Side Wall Length", value: "" },
  {
    key: "sideBaseOuterLength",
    label: "Side Base Outer Required Len (O = side + 3 in)",
    value: "",
  },
  {
    key: "sideBaseMiddleLength",
    label: "Side Base Middle Required Len (M = side - 3 in)",
    value: "",
  },
  {
    key: "sideBaseInnerLength",
    label: "Side Base Inner Required Len (I = side - 9 in)",
    value: "",
  },
  { key: "endWallLength", label: "End Wall Length", value: "" },
  { key: "sideAboveGrade", label: "Side Wall Above Grade Height", value: "" },
  { key: "endAboveGrade", label: "End Wall Above Grade Height", value: "" },
  { key: "belowGradeEmbed", label: "Below Grade Stem Wall Embed", value: "" },
  {
    key: "sideTotalHeight",
    label: "Side Wall Total Concrete Height",
    value: "",
  },
  { key: "endTotalHeight", label: "End Wall Total Concrete Height", value: "" },
  { key: "wallThickness", label: "Wall Thickness", value: "" },
  { key: "footingDepth", label: "Footing Depth for Vertical Bars", value: "" },
  { key: "sideVerticalQty", label: "Side Vertical Bar Qty (V-S)", value: "" },
  {
    key: "sideVerticalBottomClearance",
    label: "Side Vertical Bottom Clearance",
    value: "",
  },
  {
    key: "sideVerticalTopClearance",
    label: "Side Vertical Top Clearance",
    value: "",
  },
  {
    key: "sideVerticalUsedHeight",
    label: "Side Vertical Used Height Override (optional)",
    value: "",
  },
  { key: "endVerticalQty", label: "End Vertical Bar Qty (V-E)", value: "" },
  {
    key: "endVerticalBottomClearance",
    label: "End Vertical Bottom Clearance",
    value: "",
  },
  {
    key: "endVerticalTopClearance",
    label: "End Vertical Top Clearance",
    value: "",
  },
  {
    key: "endVerticalUsedHeight",
    label: "End Vertical Used Height Override (optional)",
    value: "",
  },
  {
    key: "baseShortVerticalQty",
    label: "Small 12 in Base Vertical Qty",
    value: "",
  },
  {
    key: "baseShortVerticalCutLength",
    label: "Small Base Vertical Cut Length",
    value: "",
  },
  { key: "footingSize", label: "Footing Size", value: "" },
  { key: "ptSillPlates", label: "PT Sill Plates", value: "" },
  { key: "pierCount", label: "Pier Count", value: "" },
  { key: "pierDiameter", label: "Pier Diameter", value: "" },
  { key: "pierHeight", label: "Pier Height / Cage Height", value: "" },
  { key: "rebarCallouts", label: "Rebar Callouts", value: "" },
];

const fieldHelp: Record<string, string> = {
  sideWallLength: `Overall long foundation wall length. Example: 52'-0". Used for side horizontal rebar runs.`,
  sideBaseOuterLength: `Outer footing/base rebar required length. Formula: side wall + 3 in. Source should be Calc, not PDF.`,
  sideBaseMiddleLength: `Middle footing/base rebar required length. Formula: side wall - 3 in. Source should be Calc, not PDF.`,
  sideBaseInnerLength: `Inner footing/base rebar required length. Formula: side wall - 9 in. Source should be Calc, not PDF.`,
  endWallLength: `Foundation end-wall width. Example: 13'-4". Used for end wall horizontal rebar runs.`,
  sideAboveGrade: `Concrete stem wall height visible above finished grade on side walls.`,
  endAboveGrade: `Concrete stem wall height visible above finished grade on end walls.`,
  belowGradeEmbed: `Concrete stem wall depth below grade. Used to calculate total concrete wall height.`,
  sideTotalHeight: `Side wall total concrete height = above-grade height + below-grade embed.`,
  endTotalHeight: `End wall total concrete height = above-grade height + below-grade embed.`,
  wallThickness: `Concrete stem wall thickness. Example: 6".`,
  footingDepth: `Footing depth used in vertical bar calculations. Example: 18".`,
  sideVerticalQty: `Total quantity of V-S vertical bars on both side walls. Verify against the plan.`,
  sideVerticalBottomClearance: `Clearance from footing bottom to start of side vertical bar. Commonly 3 in, but Live Mode requires PDF/user value.`,
  sideVerticalTopClearance: `Clearance from top of side wall to top of vertical bar. Used around vent/opening areas.`,
  sideVerticalUsedHeight: `Optional override. Leave blank for automatic calculation from total height minus top/bottom clearance.`,
  endVerticalQty: `Total quantity of V-E vertical bars on both end walls. Verify against the plan.`,
  endVerticalBottomClearance: `Clearance from footing bottom to start of end vertical bar. Commonly 3 in, but Live Mode requires PDF/user value.`,
  endVerticalTopClearance: `Clearance from top of end wall to top of vertical bar.`,
  endVerticalUsedHeight: `Optional override. Leave blank for automatic calculation from total height minus top/bottom clearance.`,
  baseShortVerticalQty: `Quantity of small 12" base vertical pieces tying footing steel to the stem wall steel.`,
  baseShortVerticalCutLength: `Cut length for each small base vertical piece. Live Mode requires PDF/user value.`,
  footingSize: `Footing size callout from plan. Example: 18" x 18".`,
  ptSillPlates: `Pressure-treated sill plates sitting on the concrete stem wall. Used when deriving concrete height from beam/grade dimensions.`,
  pierCount: `Total number of pier cages/support piers. Verify against plan marks.`,
  pierDiameter: `Pier/sonotube diameter. Example: 28".`,
  pierHeight: `Pier concrete height or cage height to use for pier cage planning. Example: 30" or 2'-6". Enter from plan or field measurement.`,
  rebarCallouts: `Important rebar notes found on the plan, such as #4, V-E, V-S, pier cages, or spacing.`,
};

const calculatedFieldKeys = new Set([
  "sideBaseOuterLength",
  "sideBaseMiddleLength",
  "sideBaseInnerLength",
  "sideTotalHeight",
  "endTotalHeight",
]);

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
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>("live");
  const [horizontalLap, setHorizontalLap] = useState("24");
  const [verticalBentLap, setVerticalBentLap] = useState("6");
  const [stickLength, setStickLength] = useState("20");
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
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, value } : field)),
    );

    setFieldSources((current) => ({
      ...current,
      [key]: value.trim()
        ? { kind: "manual", reason: "Changed by user on screen." }
        : { kind: "blank" },
    }));
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
    setShowDebugInfo(false);
    setFields(initialFields);
    setFields(initialFields);
    setFieldSources(getInitialFieldSources());
    setPierMode("unknown");
    setPierMessage("");
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
    setShowDebugInfo(false);
    setFieldSources(getInitialFieldSources());
    setPierMode("unknown");
    setPierMessage("");
  }

  function applyDetectedValues(values: DetectedValue[]) {
    setFields((current) =>
      current.map((field) => {
        const detected = values.find((value) => value.key === field.key);
        if (detected) return { ...field, value: detected.value };
        return extractionMode === "live" ? { ...field, value: "" } : field;
      }),
    );

    setFieldSources(() => {
      const next: Record<string, FieldSource> = {};
      for (const field of initialFields) {
        next[field.key] =
          extractionMode === "live"
            ? {
                kind: "missing",
                reason:
                  "Live Mode did not find this value. Enter it manually or add PDF image analysis.",
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
      return next;
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
    const response = await fetch("/api/analyze-plan", { method: "POST", body: formData });
    const analysis = (await response.json()) as VisualPlanAnalysis;
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
      try {
        const visual = await runSpatialPlanAnalysis(planFile);
        visualNotes = [
          visual.sourcePolicy ? `Visual policy: ${visual.sourcePolicy}` : "",
          visual.scale ? `Scale: ${visual.scale.status}${visual.scale.px_per_foot ? `, ${visual.scale.px_per_foot} px/ft` : ""}. ${visual.scale.evidence || ""}` : "",
          ...(visual.notes || []),
        ].filter(Boolean);
      } catch (visualError) {
        console.error(visualError);
        setVisualAnalysisStatus("Visual analyzer failed. PDF text extraction was still applied.");
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
          ? `Live Mode extraction completed. PDF text filled ${result.detectedValues.length} values; visual analyzer may have added PDF Image values. Missing values were not guessed.`
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
        label: "Side Base Outer Required Len (O = side + 3 in)",
        value: "52'-3\"",
      },
      {
        key: "sideBaseMiddleLength",
        label: "Side Base Middle Required Len (M = side - 3 in)",
        value: "51'-9\"",
      },
      {
        key: "sideBaseInnerLength",
        label: "Side Base Inner Required Len (I = side - 9 in)",
        value: "51'-3\"",
      },
      { key: "endWallLength", label: "End Wall Length", value: "13'-4\"" },
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
        label: "Side Vertical Bar Qty (V-S)",
        value: "52",
      },
      {
        key: "sideVerticalBottomClearance",
        label: "Side Vertical Bottom Clearance",
        value: '3"',
      },
      {
        key: "sideVerticalTopClearance",
        label: "Side Vertical Top Clearance",
        value: '8"',
      },
      {
        key: "sideVerticalUsedHeight",
        label: "Side Vertical Used Height Override (optional)",
        value: "",
      },
      {
        key: "endVerticalQty",
        label: "End Vertical Bar Qty (V-E)",
        value: "16",
      },
      {
        key: "endVerticalBottomClearance",
        label: "End Vertical Bottom Clearance",
        value: '3"',
      },
      {
        key: "endVerticalTopClearance",
        label: "End Vertical Top Clearance",
        value: '3"',
      },
      {
        key: "endVerticalUsedHeight",
        label: "End Vertical Used Height Override (optional)",
        value: "",
      },
      {
        key: "baseShortVerticalQty",
        label: "Small 12 in Base Vertical Qty",
        value: "24",
      },
      {
        key: "baseShortVerticalCutLength",
        label: "Small Base Vertical Cut Length",
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
        label: "Rebar Callouts",
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
      return next;
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
      stockLengthFeet: Number(stickLength) || 20,
      horizontalLapInches: Number(horizontalLap) || 24,
      verticalBentLapInches: Number(verticalBentLap) || 6,
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
      <div className="mx-auto max-w-7xl">
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
            Upload a foundation plan, enter lap rules, confirm detected values,
            then generate a rebar schedule.
          </p>
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
                        Only PDF text, PDF image analysis, user input, and
                        traced calculations. Missing stays Missing.
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
                    Horizontal Lap
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
                    V-E Bent Lap
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

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fields.map((field) => {
              const source = fieldSources[field.key] || {
                kind: "blank" as FieldSourceKind,
              };
              const sourceStyle = getFieldSourceStyle(source);
              const tooltip = makeTooltip(field, source);

              return (
                <div key={field.key}>
                  <label className="mb-1 flex items-center gap-2 font-semibold">
                    <span>{field.label}</span>
                    <span
                      title={tooltip}
                      className={`inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border text-xs ${sourceStyle.badgeClass}`}
                    >
                      i
                    </span>
                    <span
                      title={tooltip}
                      className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${sourceStyle.badgeClass}`}
                    >
                      {sourceStyle.badge}
                    </span>
                  </label>
                  <input
                    value={field.value}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder="Enter or confirm value"
                    title={tooltip}
                    className={`w-full rounded border p-2 ${sourceStyle.inputClass}`}
                  />
                </div>
              );
            })}
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
              Side/end vertical bars with 6 in bottom bent lap
            </div>
            <div className="rounded border p-3">
              <strong>BV-12</strong>
              <br />
              Small 12 in base verticals
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
            <div className="overflow-x-auto rounded border">
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
                  {filteredSchedule.map((line) => (
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
          )}
        </section>
      </div>
    </main>
  );
}
