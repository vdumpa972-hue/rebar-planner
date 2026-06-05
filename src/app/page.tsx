"use client";

import { useMemo, useState } from "react";
import {
  generateRebarSchedule,
  type MaterialTakeoff,
  type ScheduleLine,
  type SummaryLine,
} from "@/lib/rebarEngine";

type ExtractedField = {
  key: string;
  label: string;
  value: string;
};

const initialFields: ExtractedField[] = [
  { key: "sideWallLength", label: "Side Wall Length", value: "" },
  { key: "sideBaseOuterLength", label: "Side Base Outer Required Len (O = side + 3 in)", value: "" },
  { key: "sideBaseMiddleLength", label: "Side Base Middle Required Len (M = side - 3 in)", value: "" },
  { key: "sideBaseInnerLength", label: "Side Base Inner Required Len (I = side - 9 in)", value: "" },
  { key: "endWallLength", label: "End Wall Length", value: "" },
  { key: "sideAboveGrade", label: "Side Wall Above Grade Height", value: "" },
  { key: "endAboveGrade", label: "End Wall Above Grade Height", value: "" },
  { key: "belowGradeEmbed", label: "Below Grade Stem Wall Embed", value: "" },
  { key: "sideTotalHeight", label: "Side Wall Total Concrete Height", value: "" },
  { key: "endTotalHeight", label: "End Wall Total Concrete Height", value: "" },
  { key: "wallThickness", label: "Wall Thickness", value: "" },
  { key: "footingDepth", label: "Footing Depth for Vertical Bars", value: "" },
  { key: "sideVerticalQty", label: "Side Vertical Bar Qty (V-S)", value: "" },
  { key: "sideVerticalBottomClearance", label: "Side Vertical Bottom Clearance", value: "" },
  { key: "sideVerticalTopClearance", label: "Side Vertical Top Clearance", value: "" },
  { key: "sideVerticalUsedHeight", label: "Side Vertical Used Height Override (optional)", value: "" },
  { key: "endVerticalQty", label: "End Vertical Bar Qty (V-E)", value: "" },
  { key: "endVerticalBottomClearance", label: "End Vertical Bottom Clearance", value: "" },
  { key: "endVerticalTopClearance", label: "End Vertical Top Clearance", value: "" },
  { key: "endVerticalUsedHeight", label: "End Vertical Used Height Override (optional)", value: "" },
  { key: "baseShortVerticalQty", label: "Small 12 in Base Vertical Qty", value: "" },
  { key: "baseShortVerticalCutLength", label: "Small Base Vertical Cut Length", value: "" },
  { key: "footingSize", label: "Footing Size", value: "" },
  { key: "ptSillPlates", label: "PT Sill Plates", value: "" },
  { key: "pierCount", label: "Pier Count", value: "" },
  { key: "pierDiameter", label: "Pier Diameter", value: "" },
  { key: "rebarCallouts", label: "Rebar Callouts", value: "" },
];

export default function Home() {
  const [projectName, setProjectName] = useState("ADU Foundation");
  const [planFileName, setPlanFileName] = useState("");
  const [planFileType, setPlanFileType] = useState("");
  const [planFileSize, setPlanFileSize] = useState(0);
  const [planPreviewUrl, setPlanPreviewUrl] = useState("");
  const [horizontalLap, setHorizontalLap] = useState("24");
  const [verticalBentLap, setVerticalBentLap] = useState("6");
  const [stickLength, setStickLength] = useState("20");
  const [fields, setFields] = useState<ExtractedField[]>(initialFields);
  const [schedule, setSchedule] = useState<ScheduleLine[]>([]);
  const [summary, setSummary] = useState<SummaryLine[]>([]);
  const [materialTakeoff, setMaterialTakeoff] = useState<MaterialTakeoff | null>(null);
  const [selectedMark, setSelectedMark] = useState("");
  const [selectedPrefix, setSelectedPrefix] = useState("");
  const [filter, setFilter] = useState("ALL");

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
  const filterOptions = Array.from(new Set(schedule.map((line) => line.prefix)));

  function getFieldValue(key: string) {
    return fields.find((field) => field.key === key)?.value || "";
  }

  function updateField(key: string, value: string) {
    setFields((current) =>
      current.map((field) =>
        field.key === key ? { ...field, value } : field
      )
    );
  }

  function handlePlanUpload(file: File | undefined) {
    if (!file) return;

    if (planPreviewUrl) {
      URL.revokeObjectURL(planPreviewUrl);
    }

    setPlanFileName(file.name);
    setPlanFileType(file.type || "unknown");
    setPlanFileSize(file.size);
    setPlanPreviewUrl(URL.createObjectURL(file));
  }

  function clearPlan() {
    if (planPreviewUrl) {
      URL.revokeObjectURL(planPreviewUrl);
    }

    setPlanFileName("");
    setPlanFileType("");
    setPlanFileSize(0);
    setPlanPreviewUrl("");
  }

  function fillSampleData() {
    setFields([
      { key: "sideWallLength", label: "Side Wall Length", value: "52'" },
      { key: "sideBaseOuterLength", label: "Side Base Outer Required Len (O = side + 3 in)", value: "52'-3\"" },
      { key: "sideBaseMiddleLength", label: "Side Base Middle Required Len (M = side - 3 in)", value: "51'-9\"" },
      { key: "sideBaseInnerLength", label: "Side Base Inner Required Len (I = side - 9 in)", value: "51'-3\"" },
      { key: "endWallLength", label: "End Wall Length", value: "13'-4\"" },
      { key: "sideAboveGrade", label: "Side Wall Above Grade Height", value: "19\"" },
      { key: "endAboveGrade", label: "End Wall Above Grade Height", value: "12.5\"" },
      { key: "belowGradeEmbed", label: "Below Grade Stem Wall Embed", value: "6\"" },
      { key: "sideTotalHeight", label: "Side Wall Total Concrete Height", value: "25\"" },
      { key: "endTotalHeight", label: "End Wall Total Concrete Height", value: "18.5\"" },
      { key: "wallThickness", label: "Wall Thickness", value: "6\"" },
      { key: "footingDepth", label: "Footing Depth for Vertical Bars", value: "18\"" },
      { key: "sideVerticalQty", label: "Side Vertical Bar Qty (V-S)", value: "52" },
      { key: "sideVerticalBottomClearance", label: "Side Vertical Bottom Clearance", value: "3\"" },
      { key: "sideVerticalTopClearance", label: "Side Vertical Top Clearance", value: "8\"" },
      { key: "sideVerticalUsedHeight", label: "Side Vertical Used Height Override (optional)", value: "" },
      { key: "endVerticalQty", label: "End Vertical Bar Qty (V-E)", value: "16" },
      { key: "endVerticalBottomClearance", label: "End Vertical Bottom Clearance", value: "3\"" },
      { key: "endVerticalTopClearance", label: "End Vertical Top Clearance", value: "3\"" },
      { key: "endVerticalUsedHeight", label: "End Vertical Used Height Override (optional)", value: "" },
      { key: "baseShortVerticalQty", label: "Small 12 in Base Vertical Qty", value: "24" },
      { key: "baseShortVerticalCutLength", label: "Small Base Vertical Cut Length", value: "12\"" },
      { key: "footingSize", label: "Footing Size", value: "18\" x 18\"" },
      {
        key: "ptSillPlates",
        label: "PT Sill Plates",
        value: "1 plate @ 1.5\" for end wall; 2 plates @ 1.5\" each for side wall",
      },
      { key: "pierCount", label: "Pier Count", value: "14" },
      { key: "pierDiameter", label: "Pier Diameter", value: "28\"" },
      {
        key: "rebarCallouts",
        label: "Rebar Callouts",
        value: "#4 horizontal, V-E, V-S, pier cages",
      },
    ]);
  }

  function generateSchedule() {
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
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
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
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h1 className="text-4xl font-bold text-gray-900">Rebar Planner</h1>
          <p className="mt-2 text-gray-600">
            Upload a foundation plan, enter lap rules, confirm detected values,
            then generate a rebar schedule.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
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
                onClick={fillSampleData}
                className="rounded bg-blue-600 p-3 font-semibold text-white hover:bg-blue-700"
              >
                Extract Plan Data
              </button>

              <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
                For now, “Extract Plan Data” fills sample values. Later this
                button will read the uploaded PDF/image automatically. Base O/M/I required lengths are separate because each base line can have a different path length. Vertical bars calculate used height from stem height + footing depth - bottom/top clearance unless an override is entered.
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
          </section>

          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-2xl font-semibold">
              Confirm Detected Values
            </h2>

            <div className="grid gap-3">
              {fields.map((field) => (
                <div key={field.key}>
                  <label className="mb-1 block font-semibold">
                    {field.label}
                  </label>
                  <input
                    value={field.value}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    placeholder="Enter or confirm value"
                    className="w-full rounded border p-2"
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={generateSchedule}
              className="mt-5 w-full rounded bg-gray-900 p-3 font-semibold text-white hover:bg-gray-800"
            >
              Generate Rebar Schedule
            </button>
          </section>
        </div>

        <section className="mt-6 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-semibold">Piece Naming Legend</h2>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded border p-3"><strong>SW / EW</strong><br />Side Wall / End Wall</div>
            <div className="rounded border p-3"><strong>BASE O/M/I</strong><br />Footing outer / middle / inner</div>
            <div className="rounded border p-3"><strong>WALL B/M/T</strong><br />Stem wall bottom / middle / top</div>
            <div className="rounded border p-3"><strong>V-S / V-E</strong><br />Side/end vertical bars with 6 in bottom bent lap</div>
            <div className="rounded border p-3"><strong>BV-12</strong><br />Small 12 in base verticals</div>
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
                <h3 className="mb-2 text-lg font-semibold">Selected Map Group</h3>
                {selectedPrefix && selectedGroupLines.length > 0 ? (
                  <div>
                    <div className="mb-3 rounded bg-yellow-50 p-3 text-sm">
                      <div><strong>Group:</strong> {selectedPrefix}</div>
                      <div><strong>Pieces shown:</strong> {selectedGroupLines.length}</div>
                      <div><strong>Location:</strong> {selectedGroupLines[0].location}</div>
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
                              <td className="border-b p-2 font-bold">{line.mark}</td>
                              <td className="border-b p-2">{line.cutLength}</td>
                              <td className="border-b p-2 font-semibold">{line.usedLength}</td>
                              <td className="border-b p-2 font-mono">{line.fieldOrder}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {selectedLine && (
                      <div className="mt-3 rounded border bg-gray-50 p-3 text-sm">
                        <div><strong>Selected Piece:</strong> {selectedLine.mark}</div>
                        <div><strong>Required:</strong> {selectedLine.requiredLength}</div>
                        <div><strong>Left:</strong> {selectedLine.leftFunction}</div>
                        <div><strong>Right:</strong> {selectedLine.rightFunction}</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500">Click a map label or schedule row to show all pieces in that group.</div>
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
                  <option key={option} value={option}>{option}</option>
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
                      <td className="border-b p-3 font-semibold">{line.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {materialTakeoff && (
            <div className="mb-6 grid gap-3 md:grid-cols-5">
              <div className="rounded border p-3"><strong>Total Cut</strong><br />{materialTakeoff.totalCut}</div>
              <div className="rounded border p-3"><strong>Stock Length</strong><br />{materialTakeoff.stockLength}</div>
              <div className="rounded border p-3"><strong>Sticks to Buy</strong><br />{materialTakeoff.sticksToBuy}</div>
              <div className="rounded border p-3"><strong>Available</strong><br />{materialTakeoff.availableLength}</div>
              <div className="rounded border p-3"><strong>Waste</strong><br />{materialTakeoff.waste}</div>
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
                      <td className="border-b p-3 font-semibold">{line.cutLength}</td>
                      <td className="border-b p-3">{line.leftFunction}</td>
                      <td className="border-b p-3 font-semibold">{line.usedLength}</td>
                      <td className="border-b p-3">{line.rightFunction}</td>
                      <td className="border-b p-3 font-mono">{line.fieldOrder}</td>
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
