import Link from "next/link";

const workflowSections = [
  ["1. Create a project", "Upload the foundation PDF, name the project, choose status, and save early."],
  ["2. Crop evidence", "Crop footing, stem wall, pier, and overall plan details so every row has visual proof."],
  ["3. Enter rebar rows", "Add Base/Bottom, Horizontal, Vertical, Pier, and Misc rows. Notes explain the calculation rules."],
  ["4. Generate schedule", "The engine creates pieces, bend notes, stock counts, cut plans, validation warnings, and review status."],
  ["5. Review + export", "Filter/search the schedule, mark rows reviewed, download CSV, or print the shop package."],
];

const setupSections = [
  ["Firebase", "Create users from Admin, keep owner email as vdumpa972@gmail.com, and verify Firestore/Storage rules before selling access."],
  ["Stripe", "Set STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC, STRIPE_PRICE_PRO, STRIPE_WEBHOOK_SECRET, and NEXT_PUBLIC_APP_URL in Vercel."],
  ["Webhook", "In Stripe Dashboard, point the webhook to /api/stripe/webhook and listen for checkout.session.completed and customer.subscription.updated/deleted."],
  ["Python analyzer", "For production PDF image analysis, set PYTHON_ANALYZER_URL to the deployed analyzer service."],
];

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.25em] text-blue-700">Rebar Planner</div>
            <h1 className="mt-2 text-4xl font-black">Documentation</h1>
            <p className="mt-2 text-slate-600">Workflow guide, setup checklist, and production launch notes.</p>
          </div>
          <div className="flex gap-2"><Link href="/support" className="rounded-xl border bg-white px-4 py-2 font-bold">Support</Link><Link href="/" className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white">Back to app</Link></div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
          <h2 className="text-2xl font-black">User workflow</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {workflowSections.map(([title, body]) => <div key={title} className="rounded-2xl bg-slate-50 p-5"><h3 className="font-black">{title}</h3><p className="mt-2 text-sm text-slate-600">{body}</p></div>)}
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
          <h2 className="text-2xl font-black">Production setup checklist</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {setupSections.map(([title, body]) => <div key={title} className="rounded-2xl border border-slate-200 p-5"><h3 className="font-black">{title}</h3><p className="mt-2 text-sm text-slate-600">{body}</p></div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
