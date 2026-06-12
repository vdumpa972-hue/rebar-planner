import { NextResponse } from "next/server";

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function POST(request: Request) {
  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecret) {
      return NextResponse.json({ error: "Stripe is not configured. Add STRIPE_SECRET_KEY to your environment." }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const customer = String(body.customerId || "").trim();
    if (!customer) {
      return NextResponse.json({ error: "No Stripe customer ID is saved for this account yet. Use Pricing to start checkout first." }, { status: 400 });
    }

    const params = new URLSearchParams();
    params.set("customer", customer);
    params.set("return_url", `${appUrl()}/billing`);

    const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message || "Could not open Stripe billing portal." }, { status: response.status });
    }

    return NextResponse.json({ url: data.url, id: data.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Billing portal failed." }, { status: 500 });
  }
}
