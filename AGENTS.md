# Plugin Directory Project Rules

This repository owns the independently deployed plugin directory, canonically mounted at `turboism.dev/plugins`; `plugin.turboism.dev` is a legacy redirect and gateway origin.

- Keep this site independent from `www/`, `docs/`, and `learn/` at runtime; the apex site proxies `/plugins/*` to this deployment.
- This is a curated Plugin Directory, not a marketplace, registry, package host, or self-service publishing system.
- The initial directory may be empty. Never fill it with planned, experimental, unavailable, or unverified placeholder entries.
- Entry data must remain structured, Git-reviewed, and controlled by the Turboism team.
- Directory copy must distinguish Official from Reviewed third-party, and never imply security certification or ongoing compatibility support.
- Interface text must be English/Chinese; authoritative content for future entries remains English-first.
- Match the approved Violet V4 theme via `brand/`: #6A5ACD primary, #EEE8AA highlight and #FCFBF7 paper. Preserve semantic state colors, filtering and directory actions. Do not add landing-page animations behind content.
- Before changing Next.js routing or APIs, read the matching document in `node_modules/next/dist/docs/`.
- When starting a preview server, also expose it via a public tunnel and share that URL.
