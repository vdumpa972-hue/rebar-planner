import { NextResponse } from "next/server";

const PLAN_PRICE_ENV: Record<string, string | undefined> = {
  basic: process.env.STRIPE_PRICE_BASIC || process.env.NEXT_PUBLIC_STRIPE_PRICE_BASIC,
  pro: process.env.STRIPE_PRICE_PRO || process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO,
};

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function POST(request: Request) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      return NextResponse.json({ error: "Stripe is not configured. Add STRIPE_SECRET_KEY and price IDs to your environment." }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const plan = String(body.plan || "pro").toLowerCase();
    const price = PLAN_PRICE_ENV[plan];
    if (!price) {
      return NextResponse.json({ error: `Missing Stripe price ID for plan '${plan}'.` }, { status: 400 });
    }

    const origin = appUrl();
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("line_items[0][price]", price);
    params.set("line_items[0][quantity]", "1");
    params.set("success_url", `${origin}/billing?checkout=success&plan=${encodeURIComponent(plan)}`);
    params.set("cancel_url", `${origin}/pricing?checkout=cancelled&plan=${encodeURIComponent(plan)}`);
    params.set("allow_promotion_codes", "true");
    params.set("subscription_data[trial_period_days]", String(process.env.STRIPE_TRIAL_DAYS || "30"));
    if (body.email) params.set("customer_email", String(body.email));
    if (body.uid) params.set("client_reference_id", String(body.uid));
    params.set("metadata[app]", "rebar-planner");
    params.set("metadata[plan]", plan);
    params.set("subscription_data[metadata][app]", "rebar-planner");
    params.set("subscription_data[metadata][plan]", plan);
    if (body.uid) {
      params.set("metadata[uid]", String(body.uid));
      params.set("subscription_data[metadata][uid]", String(body.uid));
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message || "Stripe checkout failed." }, { status: response.status });
    }

    return NextResponse.json({ url: data.url, id: data.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Checkout failed." }, { status: 500 });
  }
}
