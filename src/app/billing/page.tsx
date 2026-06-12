"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { billingStatusLabel, makeInitialBillingProfile, type BillingProfile } from "@/lib/billingAccess";

const plans = [
  { key: "basic", name: "Basic", price: "$29/mo", note: "Homeowner / owner-builder projects" },
  { key: "pro", name: "Pro", price: "$79/mo", note: "Contractor workflow + shop package" },
];

export default function BillingPage() {
  const [message, setMessage] = useState("Loading billing status...");
  const [userEmail, setUserEmail] = useState("");
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [busy, setBusy] = useState("");

  async function loadBilling() {
    const user = auth.currentUser;
    if (!user) {
      setMessage("Login first to view billing.");
      return;
    }
    setUserEmail(user.email || "");
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const initial = makeInitialBillingProfile(user.email, "user");
      await setDoc(ref, { email: user.email || "", ...initial, updatedAt: serverTimestamp() }, { merge: true });
      setProfile(initial);
      setMessage(billingStatusLabel(initial, user.email));
      return;
    }
    const data = snap.data() as BillingProfile;
    setProfile(data);
    setMessage(billingStatusLabel(data, user.email));
  }

  useEffect(() => {
    loadBilling().catch((error) => setMessage(error instanceof Error ? error.message : "Billing lookup failed."));
  }, []);

  async function startCheckout(plan: string) {
    setBusy(`checkout-${plan}`);
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
      setBusy("");
    }
  }

  async function openPortal() {
    setBusy("portal");
    setMessage("");
    try {
      const res = await fetch("/api/stripe/create-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: profile?.stripeCustomerId || "" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || "Could not open billing portal.");
      window.location.href = data.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Portal failed.");
      setBusy("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.25em] text-blue-700">Rebar Planner</div>
            <h1 className="mt-2 text-4xl font-black">Billing & Trial</h1>
            <p className="mt-2 text-slate-600">{userEmail || "Account"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/pricing" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100">Pricing</Link>
            <Link href="/" className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white hover:bg-blue-800">Back to app</Link>
          </div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-blue-50 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-blue-700">Status</div>
              <div className="mt-1 text-xl font-black text-blue-950">{message}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">Plan</div>
              <div className="mt-1 text-xl font-black">{profile?.planName || "trial"}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">Trial ends</div>
              <div className="mt-1 text-xl font-black">{profile?.trialEndsAt ? new Date(profile.trialEndsAt).toLocaleDateString() : "—"}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wider text-slate-500">Stripe customer</div>
              <div className="mt-1 truncate text-sm font-bold">{profile?.stripeCustomerId || "Not created yet"}</div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <div key={plan.key} className="rounded-2xl border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-black">{plan.name}</h2>
                    <p className="text-sm text-slate-600">{plan.note}</p>
                  </div>
                  <div className="rounded-xl bg-blue-50 px-3 py-2 text-lg font-black text-blue-900">{plan.price}</div>
                </div>
                <button onClick={() => startCheckout(plan.key)} disabled={Boolean(busy)} className="mt-4 w-full rounded-xl bg-blue-700 px-4 py-3 font-black text-white hover:bg-blue-800 disabled:opacity-60">
                  {busy === `checkout-${plan.key}` ? "Opening checkout..." : "Start / upgrade"}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={openPortal} disabled={Boolean(busy) || !profile?.stripeCustomerId} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100 disabled:opacity-50">
              {busy === "portal" ? "Opening portal..." : "Open Stripe customer portal"}
            </button>
            <button onClick={loadBilling} disabled={Boolean(busy)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100 disabled:opacity-50">Refresh billing status</button>
          </div>

          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
            Production note: Stripe checkout and portal are wired. For automatic plan updates, add the Stripe webhook endpoint in Stripe Dashboard: <span className="font-black">/api/stripe/webhook</span> and set STRIPE_WEBHOOK_SECRET.
          </div>
        </section>
      </div>
    </main>
  );
}
