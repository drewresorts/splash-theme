# AGENTS.md

## Cursor Cloud specific instructions

This is a **Shopify theme** ("Coming Soon Live") built on **[Shopify Dawn](https://github.com/Shopify/dawn)** as the storefront base, plus custom sections (3D boutique, coming soon, splash streams). It is pure Liquid/HTML/CSS/JS with no theme build step and no root `package.json`. The only tool needed is **Shopify CLI** (installed globally via `npm install -g @shopify/cli@latest`).

### Key commands

| Task | Command | Notes |
|---|---|---|
| Lint | `shopify theme check` | Runs [Theme Check](https://shopify.dev/docs/themes/tools/theme-check) — no store auth needed |
| Dev preview | `shopify theme dev --store <store>` | Requires Shopify partner/staff auth; will prompt for login |
| Push to store | `shopify theme push --unpublished` | Uploads theme to a connected store |

### Repo structure

- Theme files live at the repo root (`config/`, `layout/`, `locales/`, `sections/`, `snippets/`, `templates/`, `assets/`). Dawn provides the standard product, collection, cart, blog, and customer templates; custom templates include `page.coming-soon.json` and `page.splash-streams.json`.
- `streaming/` is a separate Docker Compose stack (MediaMTX + Caddy) for the self-hosted live stream server. It is excluded from Shopify via `.shopifyignore` and is **optional** for theme development.
- There are no automated test suites; `shopify theme check` is the primary validation tool.

### Gotchas

- `shopify theme dev` and `shopify theme push` require authentication to a Shopify store. Without store credentials, linting (`shopify theme check`) is the main local validation.
- The theme gracefully degrades when no stream URL is configured — it falls back to a poster image or shows nothing, so a working streaming server is not required for development.
