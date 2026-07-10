import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = {
  title: "About Rebar Planner",
  description: "Learn how Rebar Planner organizes foundation reinforcement, cut lists, stock lengths, and waste-aware planning.",
  alternates: { canonical: "https://rebar-planner.vercel.app/about" },
  openGraph: {
    title: "About Rebar Planner",
    description: "Learn how Rebar Planner organizes foundation reinforcement, cut lists, stock lengths, and waste-aware planning.",
    url: "https://rebar-planner.vercel.app/about",
    type: "website",
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="text-sm font-black uppercase tracking-[0.25em] text-blue-700">Rebar Planner</div>
        <h1 className="mt-2 text-4xl font-black">Foundation rebar scheduling for real projects</h1>
        <p className="mt-4 text-lg text-slate-600">Rebar Planner helps owner-builders, contractors, and estimators organize foundation rebar information, crop plan evidence, and generate cut schedules with stock-length, overlap, bend, pier, vertical, and traverse logic.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {["PDF evidence crops", "Manual rebar parameters", "Shop-ready cut list"].map((item) => <div key={item} className="rounded-2xl bg-slate-50 p-5 font-black text-slate-800">{item}</div>)}
        </div>
        <div className="mt-8 flex gap-2"><Link href="/pricing" className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white">Pricing</Link><Link href="/" className="rounded-xl border px-4 py-2 font-bold">Open app</Link></div>
      </div>
    </main>
  );
}
