import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about", "/docs", "/pricing", "/privacy", "/support", "/delete-account"],
      disallow: ["/api/", "/admin/", "/auth/", "/billing/"],
    },
    sitemap: "https://rebar-planner.vercel.app/sitemap.xml",
    host: "https://rebar-planner.vercel.app",
  };
}
