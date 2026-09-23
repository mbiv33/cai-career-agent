import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  reactStrictMode: true,
  // Skip `next dev`'s auto-generated AGENTS.md/CLAUDE.md stubs — this repo
  // already has a root CLAUDE.md that is the source of truth for agents.
  agentRules: false,
};

export default nextConfig;
