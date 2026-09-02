# Turboism Plugin Directory

The curated Turboism Plugin Directory, canonically served at [`turboism.dev/plugins`](https://turboism.dev/plugins) while remaining independently deployed.

The first release intentionally supports an honest empty state. Entries are reviewed through Git and must meet the directory’s provenance and availability requirements before being listed.

## Local development

```bash
npm install
npm run dev
```

Before a production preview, run `npm run release:check` and `npm run build`.

## Deployment

Vercel hosts the independently deployed application behind the apex gateway. The UI is built with the `/plugins` base path. `plugin.turboism.dev/api/*` remains the stable machine-facing API contract and is rewritten internally to the base-path build; legacy browser pages redirect to `turboism.dev/plugins`. For a provider-equivalent local build, link the repository with `npx --yes vercel@59.10.0 link`, pull production settings with `npx --yes vercel@59.10.0 pull --yes --environment=production`, then run `npm run release:build`.

Production deployment is manual through the **Deploy production to Vercel** GitHub Actions workflow. Configure its `Production` environment with `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`; no credentials belong in the repository. The workflow builds with Vercel, deploys the prebuilt artifact, and runs `verify:deployment` plus `verify:production` against the production alias.
