"use client";

import { useMemo, useState } from "react";
import {
  RebarScheduleLine,
  RebarScheduleSummary,
  generateRebarSchedule,
} from "@/lib/rebarEngine";

type ExtractedField = {
  key: string;
  label: string;
  value: string;
};

export default function Home() {
  const [projectName, setProjectName] = useState("ADU Foundation");
  const [planFileName, setPlanFileName] = useState("");
  const [planFileType, setPlanFileType] = useState("");
  const [planFileSize, setPlanFileSize] = useState(0);
  const [planPreviewUrl, setPlanPreviewUrl] = useState("");
  const [horizontalLap, setHorizontalLap] = useState("24");
  const [verticalBentLap, setVerticalBentLap] = useState("6");
  const [stickLength, setStickLength] = useState("20");
  const [schedule, setSchedule] = useState<RebarScheduleLine[]>([]);
  const [summaries, setSummaries] = useState<RebarScheduleSummary[]>([]);

  const [fields, setFields] = useState<ExtractedField[]>([
    { key: "sideWallLength", label: "Side Wall Length", value: "" },
    { key: "endWallLength", label: "End Wall Length", value: "" },
    { key: "sideAboveGrade", label: "Side Wall Above Grade Height", value: "" },
    { key: "endAboveGrade", label: "End Wall Above Grade Height", value: "" },
    { key: "belowGradeEmbed", label: "Below Grade Stem Wall Embed", value: "" },
    { key: "sideTotalHeight", label: "Side Wall Total Concrete Height", value: "" },
    { key: "endTotalHeight", label: "End Wall Total Concrete Height", value: "" },
    { key: "wallThickness", label: "Wall Thickness", value: "" },
    { key: "footingSize", label: "Footing Size", value: "" },
    { key: "ptSillPlates", label: "PT Sill Plates", value: "" },
    { key: "pierCount", label: "Pier Count", value: "" },
    { key: "pierDiameter", label: "Pier Diameter", value: "" },
    { key: "rebarCallouts", label: "Rebar Callouts", value: "" },
  ]);

  const fileSizeLabel = useMemo(() => {
    if (!planFileSize) return "";
    const mb = planFileSize / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
  }, [planFileSize]);

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
      { key: "endWallLength", label: "End Wall Length", value: "13'-4\"" },
      { key: "sideAboveGrade", label: "Side Wall Above Grade Height", value: "19\"" },
      { key: "endAboveGrade", label: "End Wall Above Grade Height", value: "12.5\"" },
      { key: "belowGradeEmbed", label: "Below Grade Stem Wall Embed", value: "6\"" },
      { key: "sideTotalHeight", label: "Side Wall Total Concrete Height", value: "25\"" },
      { key: "endTotalHeight", label: "End Wall Total Concrete Height", value: "18.5\"" },
      { key: "wallThickness", label: "Wall Thickness", value: "6\"" },
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
      endWallLength: getFieldValue("endWallLength"),
      stickLengthFeet: Number(stickLength) || 20,
      lapInches: Number(horizontalLap) || 24,
    });

    setSchedule(result.lines);
    setSummaries(result.summaries);
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
                button will read the uploaded PDF/image automatically.
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
          <h2 className="mb-4 text-2xl font-semibold">Rebar Schedule Output</h2>

          {schedule.length === 0 ? (
            <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-6 text-gray-500">
              No schedule generated yet.
            </div>
          ) : (
            <>
              <div className="mb-6 overflow-x-auto rounded border">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="border-b p-3">Location</th>
                      <th className="border-b p-3">Required Len</th>
                      <th className="border-b p-3">Total Used</th>
                      <th className="border-b p-3">Pieces</th>
                      <th className="border-b p-3">Total Cut</th>
                      <th className="border-b p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((summary) => (
                      <tr key={summary.location} className="bg-green-50">
                        <td className="border-b p-3 font-bold">{summary.location}</td>
                        <td className="border-b p-3">{summary.requiredLength}</td>
                        <td className="border-b p-3 font-bold">{summary.totalUsed}</td>
                        <td className="border-b p-3">{summary.pieceCount}</td>
                        <td className="border-b p-3">{summary.totalCut}</td>
                        <td className="border-b p-3 font-bold text-green-800">{summary.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded border">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="border-b p-3">Piece ID</th>
                      <th className="border-b p-3">Location</th>
                      <th className="border-b p-3">Required Len</th>
                      <th className="border-b p-3">Cut Len</th>
                      <th className="border-b p-3">Left Function</th>
                      <th className="border-b p-3">Used / Adds to Required</th>
                      <th className="border-b p-3">Right Function</th>
                      <th className="border-b p-3">Field Order / Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((line) => (
                      <tr key={line.mark}>
                        <td className="border-b p-3 font-bold">{line.mark}</td>
                        <td className="border-b p-3">{line.location}</td>
                        <td className="border-b p-3">{line.requiredLength}</td>
                        <td className="border-b p-3 font-mono">{line.cutLength}</td>
                        <td className="border-b p-3">{line.leftFunction}</td>
                        <td className="border-b p-3 font-bold">{line.usedLength}</td>
                        <td className="border-b p-3">{line.rightFunction}</td>
                        <td className="border-b p-3 font-mono">{line.fieldOrder}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
