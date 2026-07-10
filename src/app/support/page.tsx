import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = {
  title: "Support | Rebar Planner",
  description: "Get help with Rebar Planner projects, calculations, uploads, exports, billing, and account access.",
  alternates: { canonical: "https://rebar-planner.vercel.app/support" },
  openGraph: {
    title: "Support | Rebar Planner",
    description: "Get help with Rebar Planner projects, calculations, uploads, exports, billing, and account access.",
    url: "https://rebar-planner.vercel.app/support",
    type: "website",
  },
};

const ticketChecklist = [
  "Project backup JSON",
  "PDF file name and page number",
  "Screenshot of the wrong row or calculation",
  "Expected hand-check result",
  "Browser and device",
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.25em] text-blue-700">Rebar Planner</div>
            <h1 className="mt-2 text-4xl font-black">Support</h1>
            <p className="mt-2 text-slate-600">For beta and paid users, collect enough job data to reproduce the exact result.</p>
          </div>
          <div className="flex gap-2"><Link href="/docs" className="rounded-xl border bg-white px-4 py-2 font-bold">Docs</Link><Link href="/" className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white">Back to app</Link></div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
          <h2 className="text-2xl font-black">Before sending a support request</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {ticketChecklist.map((item) => <div key={item} className="rounded-2xl bg-slate-50 p-4 font-bold">✓ {item}</div>)}
          </div>
          <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-950">
            Future wiring: this page can become a real support form that creates a ticket, attaches the project backup, and records plan level from billing.
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border bg-white p-5 shadow"><h3 className="font-black">Calculation issue</h3><p className="mt-2 text-sm text-slate-600">Send expected length, app length, row type, and screenshot.</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow"><h3 className="font-black">Billing issue</h3><p className="mt-2 text-sm text-slate-600">Send account email, Stripe checkout result, and current billing status.</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow"><h3 className="font-black">PDF issue</h3><p className="mt-2 text-sm text-slate-600">Send PDF page number, crop area, and what text/detail should be visible.</p></div>
        </section>
      </div>
    </main>
  );
}
