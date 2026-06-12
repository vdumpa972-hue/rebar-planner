"use client";

import Link from "next/link";
import { useState } from "react";
import { auth } from "@/lib/firebase";

const plans = [
  { key: "basic", name: "Basic", price: "$29/mo", tagline: "For homeowners and small jobs", features: ["Manual rebar parameters", "PDF crop evidence", "CSV cut schedule", "Saved projects"] },
  { key: "pro", name: "Pro", price: "$79/mo", tagline: "For owner-builders and contractors", features: ["Everything in Basic", "Shop package export", "Project backups", "Review workflow", "Future PDF extraction tools"] },
];

export default function PricingPage() {
  const [busyPlan, setBusyPlan] = useState("");
  const [message, setMessage] = useState("");

  async function startCheckout(plan: string) {
    setBusyPlan(plan);
    setMessage("");
    try {
      const user = auth.currentUser;
      const res = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, email: user?.email || "", uid: user?.uid || "" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout.");
      window.location.href = data.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout failed.");
    } finally {
      setBusyPlan("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.25em] text-blue-700">Rebar Planner</div>
            <h1 className="mt-2 text-4xl font-black">Pricing & Free Trial</h1>
            <p className="mt-2 max-w-2xl text-slate-600">Start with a 14-day free trial. Stripe checkout is wired here; set your Stripe environment variables before going live.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100">Back to app</Link>
            <Link href="/billing" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100">Billing</Link>
            <Link href="/about" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100">About</Link>
          </div>
        </div>

        {message && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900">{message}</div>}

        <div className="grid gap-5 md:grid-cols-2">
          {plans.map((plan) => (
            <section key={plan.key} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">{plan.name}</h2>
                  <p className="text-slate-600">{plan.tagline}</p>
                </div>
                <div className="rounded-2xl bg-blue-50 px-4 py-2 text-2xl font-black text-blue-900">{plan.price}</div>
              </div>
              <ul className="mt-6 space-y-2 text-sm font-semibold text-slate-700">
                {plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}
              </ul>
              <button onClick={() => startCheckout(plan.key)} disabled={Boolean(busyPlan)} className="mt-6 w-full rounded-2xl bg-blue-700 px-4 py-3 font-black text-white hover:bg-blue-800 disabled:opacity-60">
                {busyPlan === plan.key ? "Opening checkout..." : "Start free trial"}
              </button>
            </section>
          ))}
        </div>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
          <h2 className="text-xl font-black">Stripe setup needed before live billing</h2>
          <div className="mt-3 grid gap-3 text-sm font-semibold text-slate-700 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 p-4">STRIPE_SECRET_KEY</div>
            <div className="rounded-2xl bg-slate-50 p-4">STRIPE_PRICE_BASIC</div>
            <div className="rounded-2xl bg-slate-50 p-4">STRIPE_PRICE_PRO</div>
            <div className="rounded-2xl bg-slate-50 p-4">NEXT_PUBLIC_APP_URL</div>
            <div className="rounded-2xl bg-slate-50 p-4">STRIPE_WEBHOOK_SECRET</div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-blue-200 bg-blue-50 p-6 text-sm font-semibold text-blue-950">
          Stripe webhook endpoint: <span className="font-black">/api/stripe/webhook</span>. Add it in Stripe Dashboard so checkout/subscription changes update the user plan automatically.
        </section>
      </div>
    </main>
  );
}
