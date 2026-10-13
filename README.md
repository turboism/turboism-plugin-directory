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

When the **Publish Plugin Directory v2 catalog** workflow (`publish-plugin-directory-v2.yml`) commits and pushes a new signed generation to `main` as `github-actions[bot]`, it optionally triggers a Vercel Deploy Hook if `VERCEL_DEPLOY_HOOK_URL` (`https://api.vercel.com/v1/integrations/deploy/...`) is configured in the `catalog-signing` environment (or repository secrets) as a fallback when the Vercel GitHub App does not deploy bot pushes.
