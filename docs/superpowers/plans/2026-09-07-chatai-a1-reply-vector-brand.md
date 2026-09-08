# ChatAI A1 Reply Vector Brand Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ChatAI’s canonical A1 Reply Vector mark across `apps/web` icons, BrandMark, and OG/Twitter metadata without changing global `--brand` tokens.

**Architecture:** SVG is source of truth (`public/icon.svg` full mark + dedicated optical 16 SVG). Raster favicon/apple/OG derivatives are generated from those SVGs via a small Node/sharp script so assets cannot drift. In-app `BrandMark` duplicates A1 geometry with theme-aware fills. Next metadata in `layout.tsx` + `opengraph-image.tsx` wires icons and a 1200×630 social card.

**Tech Stack:** Next.js 15 App Router metadata, SVG, sharp (dev script), React `BrandMark`, existing Syne/IBM Plex fonts for OG.

## Global Constraints

- Canonical full artwork path: `apps/web/public/icon.svg` (A1 Reply Vector, fixed `#05060c` / `#f4f6fb`).
- Maintain a deliberately optimized 16×16 variant; do not mechanically scale the full mark for favicon-16.
- Generate favicon/PNG derivatives from approved A1 geometry only.
- `BrandMark` uses same A1 geometry; theme-aware via `currentColor` / existing tokens — **do not modify global `--brand` or retire teal**.
- OG/Twitter: 1200×630; ChatAI primary; tagline “Your knowledge. Your AI. Anywhere.”; NightZeros tertiary.
- Verify sizes: favicon 16 & 32; mark 24, 32, 64, 180; BrandMark light + dark.
- Preserve decorative vs meaningful logo a11y.
- Search entire web app for old/default branding after replacement.
- Remove `brand-preview/` from production output when finished.
- Do not touch docs site, npm branding, GitHub avatar, or broader NZ design system.
- Do not deploy, merge, publish packages, or change global brand colors.

**Spec:** `docs/superpowers/specs/2026-09-07-chatai-a1-reply-vector-brand-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/public/icon.svg` | Canonical full A1 fixed-palette SVG |
| `apps/web/public/icon-16.svg` | Optical 16×16 source (build input; also served OK) |
| `apps/web/src/app/favicon.ico` | Multi-size ICO from optical 16 + full 32 |
| `apps/web/public/apple-touch-icon.png` | 180×180 PNG from full mark |
| `apps/web/scripts/generate-brand-assets.mjs` | Regenerates ICO/PNG from SVGs |
| `apps/web/src/components/brand/logo.tsx` | Theme-aware A1 `BrandMark` / lockup |
| `apps/web/src/app/opengraph-image.tsx` | 1200×630 OG image |
| `apps/web/src/app/twitter-image.tsx` | Re-export or twin of OG (1200×630) |
| `apps/web/src/app/layout.tsx` | Metadata icons + twitter card type |
| Delete `apps/web/public/brand-preview/**` | Preview-only; not production |

---

### Task 1: Canonical SVGs + asset generator

**Files:**
- Create: `apps/web/public/icon.svg`
- Create: `apps/web/public/icon-16.svg`
- Create: `apps/web/scripts/generate-brand-assets.mjs`
- Create: `apps/web/public/apple-touch-icon.png` (via script)
- Modify: `apps/web/src/app/favicon.ico` (via script)
- Modify: `apps/web/package.json` (script entry `brand:assets`)

**Interfaces:**
- Produces: full A1 SVG; optical 16 SVG; `favicon.ico`; `apple-touch-icon.png`
- Consumes: sharp from workspace

- [ ] **Step 1: Write `icon.svg` (full A1)**

Exact geometry from spec §2.3 (with hairline border).

- [ ] **Step 2: Write `icon-16.svg` (optical)**

No border; larger node (`r≈3.5`); thicker/shorter ticks per spec §2.5.

- [ ] **Step 3: Write generator script**

`generate-brand-assets.mjs` must:
1. Read `public/icon.svg` and `public/icon-16.svg`
2. Emit PNG buffers at 16 (from icon-16), 32/180 (from icon)
3. Build `src/app/favicon.ico` (16+32) using `sharp` to PNG then `to-ico` **or** write multi-size ICO via `sharp`+manual ICO packing / `png-to-ico` if available
4. Write `public/apple-touch-icon.png` at 180

If `png-to-ico` / `to-ico` missing, implement minimal ICO writer for 16+32 PNG buffers (standard ICO format) inside the script — no new production dependency preferred; `png-to-ico` as devDependency of `@chatai/web` is acceptable.

- [ ] **Step 4: Run generator**

```bash
pnpm --filter @chatai/web brand:assets
```

Expected: files written; exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/icon.svg apps/web/public/icon-16.svg apps/web/public/apple-touch-icon.png apps/web/src/app/favicon.ico apps/web/scripts/generate-brand-assets.mjs apps/web/package.json
git commit -m "feat(web): add A1 Reply Vector icon assets and generator"
```

---

### Task 2: Theme-aware BrandMark

**Files:**
- Modify: `apps/web/src/components/brand/logo.tsx`

**Interfaces:**
- Consumes: A1 path geometry from Task 1
- Produces: `BrandMark`, `BrandLockup` unchanged public API

- [ ] **Step 1: Replace bubble paths with A1**

Frame: `fill="currentColor"` (or class that maps to foreground).  
Node + ticks: use existing token classes that contrast on the frame — prefer `fill-background` / `stroke-background` **or** hardcode `#fff`/`#05060c` only if tokens fail contrast; prefer:

```tsx
<rect width="32" height="32" rx="7" fill="currentColor" />
<circle ... className="fill-background" /> // or fill that contrasts
```

Do **not** use `fill-brand` / teal. Do **not** edit `globals.css` brand tokens.

Keep `aria-hidden` on decorative mark when lockup includes “ChatAI” text.

- [ ] **Step 2: Smoke-check usages**

Grep `BrandMark|BrandLockup|fill-brand` under `apps/web`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): switch BrandMark to A1 Reply Vector (theme-aware)"
```

---

### Task 3: OG / Twitter image + layout metadata

**Files:**
- Create: `apps/web/src/app/opengraph-image.tsx`
- Create: `apps/web/src/app/twitter-image.tsx` (re-export opengraph or duplicate `export { default, size, contentType }`)
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Produces: 1200×630 image route; metadata icons array

- [ ] **Step 1: Implement `opengraph-image.tsx`**

Use `ImageResponse` from `next/og`:
- size `{ width: 1200, height: 630 }`
- Background `#05060c`
- A1 mark (inline SVG or img)
- Large “ChatAI”
- Tagline “Your knowledge. Your AI. Anywhere.”
- Tertiary “A NightZeros project” / NZ muted

- [ ] **Step 2: Update `layout.tsx` metadata**

```ts
icons: {
  icon: [
    { url: "/icon.svg", type: "image/svg+xml" },
    { url: "/favicon.ico", sizes: "any" },
  ],
  apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
},
twitter: {
  card: "summary_large_image",
  title: "...",
  description: "...",
},
```

Open Graph title/description may stay; images come from file-based `opengraph-image.tsx` automatically.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): add A1 OG/Twitter card and icon metadata"
```

---

### Task 4: Cleanup + old-brand search

**Files:**
- Delete: `apps/web/public/brand-preview/**`

- [ ] **Step 1: Remove brand-preview directory**

- [ ] **Step 2: Search web app**

```bash
rg -n "favicon|icon\.svg|BrandMark|next\.js|create-next-app|2A7A78|speech|chat bubble|fill-brand" apps/web --glob '!**/node_modules/**'
```

Document hits; fix any remaining old bubble geometry in web UI.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(web): remove brand-preview artifacts"
```

---

### Task 5: Verification + report

- [ ] **Step 1: Lint / typecheck / build / tests**

```bash
pnpm --filter @chatai/web lint
pnpm --filter @chatai/web typecheck
pnpm --filter @chatai/web test
pnpm --filter @chatai/web build
```

- [ ] **Step 2: Inspect build output / metadata routes**

Confirm `.next` includes favicon, apple-touch, opengraph-image, twitter-image. Curl or fetch local production server headers/`<link rel=icon>` if server started; otherwise inspect built files + `layout` export.

- [ ] **Step 3: Rasterize verification sheet** (16/32/24/64/180) from final SVGs; screenshot BrandMark light/dark if app running.

- [ ] **Step 4: Final report** to user (files, inventory, metadata, verification, search, CI results, commit hash, deferred items).

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Canonical `icon.svg` | 1 |
| Optical 16 | 1 |
| Derivatives from A1 | 1 |
| Theme-aware BrandMark | 2 |
| No `--brand` change | 2, Global |
| OG 1200×630 hierarchy | 3 |
| Size verification | 5 |
| Light/dark BrandMark | 5 |
| A11y decorative vs meaningful | 2 |
| Old brand search | 4 |
| Remove brand-preview | 4 |
| No docs/npm/GitHub/DS | Global |
