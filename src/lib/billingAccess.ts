export type PlanStatus = "owner" | "active" | "trialing" | "past_due" | "canceled" | "inactive";

export type BillingProfile = {
  role?: string;
  planName?: string;
  planStatus?: string;
  trialStartedAt?: string;
  trialEndsAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionCurrentPeriodEnd?: string;
};

const OWNER_EMAIL = "vdumpa972@gmail.com";
const DEFAULT_TRIAL_DAYS = 14;

export function isOwnerEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase() === OWNER_EMAIL;
}

export function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function makeInitialBillingProfile(email?: string | null, role?: string): BillingProfile {
  if (isOwnerEmail(email) || role === "owner") {
    return {
      role: "owner",
      planName: "owner",
      planStatus: "owner",
    };
  }

  const now = new Date();
  const trialEndsAt = addDays(now, DEFAULT_TRIAL_DAYS).toISOString();
  return {
    role: role || "user",
    planName: "trial",
    planStatus: "trialing",
    trialStartedAt: now.toISOString(),
    trialEndsAt,
  };
}

export function getTrialDaysLeft(profile?: BillingProfile | null) {
  if (!profile?.trialEndsAt) return null;
  const end = new Date(profile.trialEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
}

export function hasActiveAccess(profile?: BillingProfile | null, email?: string | null) {
  if (isOwnerEmail(email) || profile?.role === "owner" || profile?.planStatus === "owner") return true;
  if (profile?.planStatus === "active") return true;
  if (profile?.planStatus === "trialing") {
    const daysLeft = getTrialDaysLeft(profile);
    return daysLeft === null || daysLeft >= 0;
  }
  return false;
}

export function billingStatusLabel(profile?: BillingProfile | null, email?: string | null) {
  if (isOwnerEmail(email) || profile?.role === "owner" || profile?.planStatus === "owner") return "Owner account";
  if (!profile) return "Trial not started";
  if (profile.planStatus === "active") return `Active ${profile.planName || "plan"}`;
  if (profile.planStatus === "trialing") {
    const daysLeft = getTrialDaysLeft(profile);
    if (daysLeft === null) return "Trialing";
    if (daysLeft < 0) return "Trial expired";
    return `${daysLeft} trial day${daysLeft === 1 ? "" : "s"} left`;
  }
  if (profile.planStatus === "past_due") return "Payment past due";
  if (profile.planStatus === "canceled") return "Subscription canceled";
  return profile.planStatus || "Inactive";
}
