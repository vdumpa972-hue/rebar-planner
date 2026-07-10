import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Rebar Planner",
    short_name: "Rebar Planner",
    description: "Create rebar quantities, cut lists, bend schedules, and material takeoffs for foundation work.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111827",
    categories: ["business", "productivity", "utilities"],
  };
}
