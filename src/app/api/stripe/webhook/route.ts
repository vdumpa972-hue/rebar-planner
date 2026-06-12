import crypto from "crypto";
import { NextResponse } from "next/server";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const runtime = "nodejs";

function verifyStripeSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const parts = Object.fromEntries(signature.split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch {
    return false;
  }
}

function unixToIso(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : "";
}

async function updateUserFromSession(session: Record<string, unknown>) {
  const metadata = (session.metadata || {}) as Record<string, unknown>;
  const uid = String(metadata.uid || session.client_reference_id || "").trim();
  if (!uid) return { updated: false, reason: "No uid/client_reference_id on Stripe session." };

  const subscription = typeof session.subscription === "string" ? session.subscription : "";
  const customer = typeof session.customer === "string" ? session.customer : "";
  const plan = String(metadata.plan || "pro");

  await setDoc(doc(db, "users", uid), {
    planName: plan,
    planStatus: "active",
    stripeCustomerId: customer,
    stripeSubscriptionId: subscription,
    trialEndsAt: "",
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { updated: true, uid };
}

async function updateUserFromSubscription(subscription: Record<string, unknown>) {
  const metadata = (subscription.metadata || {}) as Record<string, unknown>;
  const uid = String(metadata.uid || "").trim();
  if (!uid) return { updated: false, reason: "No uid metadata on subscription." };

  const status = String(subscription.status || "inactive");
  const planStatus = status === "active" || status === "trialing" ? status : status === "past_due" ? "past_due" : status === "canceled" ? "canceled" : "inactive";

  await setDoc(doc(db, "users", uid), {
    planStatus,
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : "",
    stripeSubscriptionId: typeof subscription.id === "string" ? subscription.id : "",
    subscriptionCurrentPeriodEnd: unixToIso(subscription.current_period_end),
    trialEndsAt: unixToIso(subscription.trial_end),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return { updated: true, uid };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (webhookSecret && !verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), webhookSecret)) {
    return NextResponse.json({ error: "Invalid Stripe webhook signature." }, { status: 400 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid webhook JSON." }, { status: 400 });
  }

  const type = String(event.type || "");
  const data = event.data as { object?: Record<string, unknown> } | undefined;
  const object = data?.object || {};
  let result: Record<string, unknown> = { ignored: true };

  try {
    if (type === "checkout.session.completed") {
      result = await updateUserFromSession(object);
    } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(type)) {
      result = await updateUserFromSubscription(object);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook update failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true, type, ...result });
}
