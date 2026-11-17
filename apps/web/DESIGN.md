# ChatAI web — design system (Operate)

Operate-mode UI for the owner dashboard and assistant workspace. Marketing landing is separate.

## Product character

Calm, precise, infrastructure-adjacent — closer to Vercel / ElevenLabs Agents dashboards than to consumer chat toys. Brand shows up in spacing, type, and clear ownership of “knowledge + voice control,” not in decorative chrome.

## Tokens

Defined in `src/app/globals.css` (oklch). Light and dark themes share the same roles:

| Role | Use |
|------|-----|
| `background` / `foreground` | Page canvas and primary text |
| `muted` / `muted-foreground` | Secondary labels, hints |
| `accent` | Active nav pill, hover rows |
| `brand` | Primary CTAs / focus ring when needed |
| `border` | Hairline structure; prefer borders over shadows |
| `destructive` / `success` / `warning` | Status only |

`--content-max` (~72rem) for dashboard main. `--spacing-page` for gutters.

## Navigation (two layers + page sections)

Shared primitives: `NavItem`, `NavSection`, `SectionNav`, `Breadcrumb` under `components/layout/`. Workspace destinations live in `lib/workspace-nav.ts` and nest under **Assistants** in the app rail when an assistant is open.

| Layer | Role | Desktop | Smaller screens |
|-------|------|---------|-----------------|
| **1 — App shell** | Product areas + assistant pages (when in a workspace) | Fixed viewport-height left rail from `md` | Hamburger drawer (same tree) |
| **2 — Page sections** | Settings / Widget / Insights | Settings: rail from `lg`, tabs `md`–`lg`; hubs: underline tabs | Settings: select when &gt;4 items; hubs: tabs |

When `/dashboard/assistants/:id/*` is active, the app rail expands under Assistants with grouped pages (Build / Deploy / Monitor / Configure), the assistant name, and switcher. No second on-page nav column.

Breadcrumbs in page chrome: `Assistants / {name} / {page} [/ {section}]`.

App rail groups: **Product** (Assistants → nested workspace) · **Account** (Usage, Billing, Account) · footer **Resources** (Docs, GitHub, Contribute).

## Layout

- **App shell:** `h-svh` flex row; left nav stays viewport height; only main content scrolls.
- **Assistant workspace:** slim context header (breadcrumb, name, copyable id) + full-width main content.
- **Hubs:** Identity, Widget (tabs), Insights (tabs), Settings (SectionNav). Prefer section titles + dividers over nested card stacks.

## Navigation destinations (assistant)

Overview · Knowledge · Identity · Playground · Widget · Conversations · Insights · Settings

Old routes (`/profile`, `/customize`, `/install`, `/analytics`, `/evals`, general settings) redirect into hubs.

## Components

- `PageHeader` — title + one-line purpose + optional actions
- `SectionNav` / `HubTabs` — page-level sections
- `SettingsSubnav` — models / retrieval / voice / privacy / security via SectionNav
- Cards: `shadow-none`, border-first
- Confirm destructive actions with `ConfirmDialog`, not `window.confirm`

## Progressive disclosure

- Retrieval guardrails/chunking under “Advanced retrieval”
- Playground Voice “Developer trace” collapsed by default
- Install advanced snippets in `<details>`

## Motion

Respect `prefers-reduced-motion`. Avoid decorative entrance animations in Operate surfaces.
