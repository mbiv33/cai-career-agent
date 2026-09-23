import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cai Career Agent",
    short_name: "Cai Career",
    description: "Command center for Cai's autonomous job search: what the agent is doing, what needs you, and what's happening.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fdfbf8",
    theme_color: "#c2632b",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
