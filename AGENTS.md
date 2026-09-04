# Plugin Directory Project Rules

This repository owns the independently deployed plugin directory, canonically mounted at `turboism.dev/plugins`; `plugin.turboism.dev` is a legacy redirect and gateway origin.

- Keep this site independent from `www/`, `docs/`, and `learn/` at runtime; the apex site proxies `/plugins/*` to this deployment.
- This is a curated Plugin Directory, not a marketplace, registry, package host, or self-service publishing system.
- The initial directory may be empty. Never fill it with planned, experimental, unavailable, or unverified placeholder entries.
- Entry data must remain structured, Git-reviewed, and controlled by the Turboism team.
- Directory copy must distinguish Official from Reviewed third-party, and never imply security certification or ongoing compatibility support.
- Interface text must be English/Chinese; authoritative content for future entries remains English-first.
- This site must match `www.turboism.dev`'s light sacred visual language: white base, sacred texture, Geist, Klein-blue accents, amber reserved for the shared brand gradient and semantic warning states, translucent glass surfaces, and the shared header/footer DOM and classes.
- Before changing Next.js routing or APIs, read the matching document in `node_modules/next/dist/docs/`.
- When starting a preview server, also expose it via a public tunnel and share that URL.
