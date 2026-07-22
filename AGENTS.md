# Plugin Directory Project Rules

This repository owns `plugin.turboism.dev` and is intended for `github.com/turboism/turboism-plugin-directory`.

- Keep this site independent from `www/`, `docs/`, and `learn/` at runtime.
- This is a curated Plugin Directory, not a marketplace, registry, package host, or self-service publishing system.
- The initial directory may be empty. Never fill it with planned, experimental, unavailable, or unverified placeholder entries.
- Entry data must remain structured, Git-reviewed, and controlled by the Turboism team.
- Directory copy must distinguish Official from Reviewed third-party, and never imply security certification or ongoing compatibility support.
- Interface text must be English/Chinese; authoritative content for future entries remains English-first.
- This site is dark-only and uses the restrained Turboism developer-tool visual language.
- Before changing Next.js routing or APIs, read the matching document in `node_modules/next/dist/docs/`.
- When starting a preview server, also expose it via a public tunnel and share that URL.
