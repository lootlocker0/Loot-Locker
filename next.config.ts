import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev`/`next build` otherwise appends an AI-agent-rules block to
  // CLAUDE.md on every run. CLAUDE.md is manager-only (its own ownership
  // map says so) and this file is the actual orchestration contract every
  // agent reads first — it should never be silently rewritten by tooling.
  agentRules: false,
};

export default nextConfig;
