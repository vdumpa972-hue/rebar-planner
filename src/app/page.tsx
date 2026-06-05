"use client";

import { useState } from "react";

type ExtractedField = {
  key: string;
  label: string;
  value: string;
};

export default function Home() {
  const [projectName, setProjectName] = useState("ADU Foundation");
  const [planFileName, setPlanFileName] = useState("");
  const [horizontalLap, setHorizontalLap] = useState("24");
  const [verticalBentLap, setVerticalBentLap] = useState("6");
  const [stickLength, setStickLength] = useState("20");

  const [fields, setFields] = useState<ExtractedField[]>([
    { key: "stemWallLength", label: "Stem Wall Length", value: "" },
    { key: "stemWallHeight", label: "Stem Wall Height", value: "" },
    { key: "wallThickness", label: "Wall Thickness", value: "" },
    { key: "footingSize", label: "Footing Size", value: "" },
    { key: "pierCount", label: "Pier Count", value: "" },
    { key: "pierDiameter", label: "Pier Diameter", value: "" },
    { key: "rebarCallouts", label: "Rebar Callouts", value: "" },
  ]);

  function updateField(key: string, value: string) {
    setFields((current) =>
      current.map((field) =>
        field.key === key ? { ...field, value } : field
      )
    );
  }

  function fillSampleData() {
    setFields([
      { key: "stemWallLength", label: "Stem Wall Length", value: "52'" },
      { key: "stemWallHeight", label: "Stem Wall Height", value: "24\"" },
      { key: "wallThickness", label: "Wall Thickness", value: "6\"" },
      { key: "footingSize", label: "Footing Size", value: "18\" x 18\"" },
      { key: "pierCount", label: "Pier Count", value: "14" },
      { key: "pierDiameter", label: "Pier Diameter", value: "28\"" },
      {
        key: "rebarCallouts",
        label: "Rebar Callouts",
        value: "#4 horizontal, V-E, V-S, pier cages",
      },
    ]);
  }

  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h1 className="text-4xl font-bold text-gray-900">Rebar Planner</h1>
          <p className="mt-2 text-gray-600">
            Upload a foundation plan, enter lap rules, confirm extracted values,
            then generate a rebar schedule.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
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
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setPlanFileName(file ? file.name : "");
                  }}
                  className="w-full rounded border p-2"
                />

                {planFileName ? (
                  <div className="mt-3 rounded border border-green-300 bg-green-50 p-3 text-green-800">
                    ✓ Plan loaded: <strong>{planFileName}</strong>
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
            <h2 className="mb-4 text-2xl font-semibold">
              Confirm Extracted Values
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
              className="mt-5 w-full rounded bg-gray-900 p-3 font-semibold text-white hover:bg-gray-800"
            >
              Generate Rebar Schedule
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}