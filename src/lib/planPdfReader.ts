export async function extractPdfTextFromFile(file: File): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("PDF extraction must run in the browser.");
  }

  // Load PDF.js only in the browser. This avoids Next.js/Turbopack trying to
  // evaluate PDF.js during server-side rendering, where DOMMatrix is not defined.
  // Function() keeps TypeScript from trying to resolve the HTTPS module at build time.
  const pdfjsLib = (await Function(
    'return import("https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.mjs")'
  )()) as any;

  // Use the matching browser worker from the same PDF.js version.
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs";

  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item: { str?: string }) => ("str" in item ? item.str || "" : ""))
      .join(" ");

    pageTexts.push(`--- PAGE ${pageNumber} ---\n${pageText}`);
  }

  return pageTexts.join("\n\n");
}
