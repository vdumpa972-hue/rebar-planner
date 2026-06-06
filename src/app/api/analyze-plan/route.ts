import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

export const runtime = "nodejs";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.pdf";
}

function normalizeAnalyzerUrl(raw: string) {
  return raw.replace(/\/+$/, "") + "/analyze";
}

async function callRemoteAnalyzer(file: File, formData: FormData, remoteBaseUrl: string) {
  const remoteUrl = normalizeAnalyzerUrl(remoteBaseUrl);
  const forward = new FormData();
  forward.append("blueprint", file, file.name || "upload.pdf");

  // Keep small future-proof fields if the UI sends them later.
  for (const [key, value] of formData.entries()) {
    if (key !== "blueprint" && typeof value === "string") forward.append(key, value);
  }

  const started = Date.now();
  const res = await fetch(remoteUrl, { method: "POST", body: forward });
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { success: false, error: "Remote analyzer returned non-JSON response.", raw: text.slice(0, 2000) };
  }

  if (!res.ok) {
    return {
      success: false,
      error: `Remote analyzer failed with HTTP ${res.status}`,
      analyzerMode: "remote-python",
      remoteUrl,
      elapsedMs: Date.now() - started,
      details: payload,
    };
  }

  return {
    ...(payload as Record<string, unknown>),
    analyzerMode: "remote-python",
    remoteUrl,
    elapsedMs: Date.now() - started,
  };
}

async function callLocalAnalyzer(file: File) {
  let filePath = "";
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rebar-plan-"));
    filePath = path.join(dir, `${Date.now()}-${safeFileName(file.name)}`);
    await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const pythonCandidates = [
      process.env.REBAR_PYTHON,
      process.env.PYTHON,
      "python",
      "python3",
    ].filter(Boolean) as string[];

    const scriptPath = path.join(process.cwd(), "scripts", "spatial_analyzer.py");
    const attempts: Array<{ python: string; error?: string }> = [];

    for (const python of pythonCandidates) {
      try {
        const started = Date.now();
        const { stdout, stderr } = await execFileAsync(python, [scriptPath, filePath], {
          timeout: 120000,
          maxBuffer: 25 * 1024 * 1024,
        });
        const parsed = JSON.parse(stdout);
        return {
          ...(parsed as Record<string, unknown>),
          analyzerMode: "local-python",
          pythonCommand: python,
          stderr: stderr?.trim() || undefined,
          elapsedMs: Date.now() - started,
        };
      } catch (error) {
        attempts.push({ python, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return {
      success: false,
      error: "Local Python analyzer failed. Set PYTHON_ANALYZER_URL for Vercel/production, or set REBAR_PYTHON locally.",
      analyzerMode: "local-python",
      attempts,
    };
  } finally {
    if (filePath) await fs.rm(path.dirname(filePath), { recursive: true, force: true }).catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("blueprint");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "No blueprint file provided." }, { status: 400 });
    }

    const remoteUrl = process.env.PYTHON_ANALYZER_URL || process.env.REBAR_ANALYZER_URL;
    const result = remoteUrl
      ? await callRemoteAnalyzer(file, formData, remoteUrl)
      : await callLocalAnalyzer(file);

    return NextResponse.json({
      ...result,
      uploadedFile: { name: file.name, type: file.type, size: file.size },
      sourcePolicy: "No canned values. Remote/local analyzer may return pdf-text, pdf-image, ocr, calc, user, or missing only.",
    });
  } catch (error) {
    console.error("Plan analysis failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Plan analysis failed." },
      { status: 500 },
    );
  }
}
