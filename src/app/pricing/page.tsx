"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const plans = [
  { key: "basic", name: "Basic", price: "$29/mo", tagline: "For homeowners and small jobs", features: ["Manual rebar parameters", "PDF crop evidence", "CSV cut schedule", "Saved projects"] },
  { key: "pro", name: "Pro", price: "$79/mo", tagline: "For owner-builders and contractors", features: ["Everything in Basic", "Shop package export", "Project backups", "Review workflow", "Future PDF extraction tools"] },
];

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function makeTempPassword() {
  return `Rp-${Math.random().toString(36).slice(2)}-${Date.now()}!A7`;
}

export default function PricingPage() {
  const [busyPlan, setBusyPlan] = useState("");
  const [trialBusy, setTrialBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [trialName, setTrialName] = useState("");
  const [trialEmail, setTrialEmail] = useState("");
  const [trialCompany, setTrialCompany] = useState("");
  const [trialPhone, setTrialPhone] = useState("");
  const [trialReadyEmail, setTrialReadyEmail] = useState("");

  async function startTrial(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    setMessage("");
    setTrialReadyEmail("");
    const email = normalizeEmail(trialEmail);
    if (!email) {
      setMessage("Enter an email address to start the free trial.");
      return;
    }
    setTrialBusy(true);
    try {
      const displayName = trialName.trim() || trialCompany.trim() || email.split("@")[0];
      const cred = await createUserWithEmailAndPassword(auth, email, makeTempPassword());
      await updateProfile(cred.user, { displayName }).catch(() => {});
      const now = Date.now();
      const trialEndsAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
      await setDoc(doc(db, "users", cred.user.uid), {
        email,
        username: email.split("@")[0],
        displayName,
        companyName: trialCompany.trim(),
        phone: trialPhone.trim(),
        role: "user",
        status: "active",
        planStatus: "trialing",
        planName: "trial",
        trialStartedAt: new Date(now).toISOString(),
        trialEndsAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await sendPasswordResetEmail(auth, email);
      setTrialReadyEmail(email);
      setMessage("Trial account created. We sent a password setup email. Open that email first, set your password, then log in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the trial right now.");
    } finally {
      setTrialBusy(false);
    }
  }

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
            <p className="mt-2 max-w-2xl text-slate-600">Start a 30-day free trial, or purchase a monthly plan when you are ready.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100">Back to app</Link>
            <Link href="/billing" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100">Billing</Link>
            <Link href="/about" className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-bold hover:bg-slate-100">About</Link>
          </div>
        </div>

        {message && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900">{message}</div>}

        <section className="mb-6 rounded-3xl border border-blue-200 bg-white p-6 shadow-xl">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.2em] text-blue-700">Free trial</div>
              <h2 className="mt-2 text-3xl font-black">Create your trial workspace</h2>
              <p className="mt-2 text-slate-600">Enter your information. We create the account and send a password setup email. After you set the password, log in and start working.</p>
              {trialReadyEmail && <p className="mt-4 rounded-2xl bg-green-50 p-3 font-bold text-green-900">Trial ready for {trialReadyEmail}. Check that inbox for the password setup email.</p>}
            </div>
            <form onSubmit={startTrial} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-black text-slate-700">Name<input value={trialName} onChange={(e) => setTrialName(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 font-semibold" placeholder="Your name" /></label>
                <label className="grid gap-1 text-sm font-black text-slate-700">Company<input value={trialCompany} onChange={(e) => setTrialCompany(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 font-semibold" placeholder="Company name" /></label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-black text-slate-700">Email<input value={trialEmail} onChange={(e) => setTrialEmail(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 font-semibold" placeholder="email@example.com" type="email" required /></label>
                <label className="grid gap-1 text-sm font-black text-slate-700">Phone<input value={trialPhone} onChange={(e) => setTrialPhone(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 font-semibold" placeholder="Optional" /></label>
              </div>
              <button disabled={trialBusy} type="submit" className="rounded-2xl bg-blue-700 px-4 py-3 font-black text-white hover:bg-blue-800 disabled:opacity-60">{trialBusy ? "Creating trial..." : "Start 30-day free trial"}</button>
            </form>
          </div>
        </section>

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
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                <a href="#" onClick={(e) => { e.preventDefault(); document.querySelector("input[type='email']")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="rounded-2xl bg-blue-700 px-4 py-3 text-center font-black text-white hover:bg-blue-800">
                  Start free trial
                </a>
                <button onClick={() => startCheckout(plan.key)} disabled={Boolean(busyPlan)} className="rounded-2xl bg-slate-200 px-4 py-3 font-black text-slate-950 hover:bg-slate-300 disabled:opacity-60">
                  {busyPlan === plan.key ? "Opening checkout..." : "Purchase"}
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
