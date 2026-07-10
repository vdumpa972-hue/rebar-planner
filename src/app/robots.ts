import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/pricing", "/plans", "/about", "/docs", "/privacy", "/terms", "/support", "/account-deletion", "/delete-account"],
      disallow: ["/api/", "/auth/", "/owner/", "/employee/", "/client/", "/admin/", "/super-admin/", "/profile/", "/billing/", "/subscription/", "/master/", "/follower/", "/trial/", "/stripe-success/"],
    },
    sitemap: "https://rebar-planner.vercel.app/sitemap.xml",
    host: "https://rebar-planner.vercel.app",
  };
}
