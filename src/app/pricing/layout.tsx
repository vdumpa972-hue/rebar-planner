import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing & Free Trial | Rebar Planner",
  description: "Review Rebar Planner pricing, try the guest demo, or start a free trial for foundation reinforcement planning and cut-list generation.",
  alternates: { canonical: "https://rebar-planner.vercel.app/pricing" },
  openGraph: {
    title: "Pricing & Free Trial | Rebar Planner",
    description: "Review Rebar Planner pricing, guest demo, and free-trial options.",
    url: "https://rebar-planner.vercel.app/pricing",
    type: "website",
  },
};

export default function PricingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
