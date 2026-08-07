import { spawn } from "child_process";

// We simply start "next dev" using process.env.PORT, no tunnel here to avoid cloudflared rate limits.
const port = process.env.PORT || "3001";

console.log(`\n[dev] Starting Next.js dev server on port ${port}...\n`);

const next = spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  shell: true
});

next.on("close", (code) => {
  console.log(`[dev] Next.js dev server exited with code ${code}`);
  process.exit(code || 0);
});
