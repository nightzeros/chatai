# ChatAI A1 Reply Vector — brand mark & app metadata

**Date:** 2026-09-07  
**Status:** Approved direction (A1); awaiting user review of this spec before implementation  
**Scope:** `apps/web` logo mark, favicon/icons, OG/social graphics, and metadata only  
**Out of scope:** Global `--brand` / teal token changes; docs site mark; npm package icons; GitHub org avatar upload

---

## 1. Goal

Give the ChatAI web app a professional, ownable identity that clearly belongs to NightZeros: canonical **A1 Reply Vector** mark, correct favicons, complete link-preview metadata, and a theme-aware in-app SVG — without redesigning the product color system in this pass.

## 2. Canonical mark: A1 Reply Vector

### 2.1 Concept

- NightZeros **geometry**: rounded square (squircle) frame, near-black field, light ink, precision spacing.
- ChatAI **signal**: solid circular **node** (left of center) + **two outbound ticks** opening to the right (reply / signal), with a clear gap between node and ticks.
- Not a speech bubble, Wi‑Fi arcs, sun rays, mic, spinner, or sparkle-AI glyph.

### 2.2 Source of truth

- **Primary:** SVG, `viewBox="0 0 32 32"`.
- Raster icons (ICO, PNG apple-touch, OG art) are **derivatives** of the SVG (or of the dedicated 16×16 optical SVG), not independent redraws.
- In-app React `BrandMark` must match the theme-aware SVG paths 1:1.

### 2.3 Geometry (full-size / 24px+)

| Element | Spec |
|--------|------|
| Frame | `rect` 32×32, `rx=7`, fill `#05060c` |
| Hairline border | Optional inset stroke `#8b9cc8` @ 35% opacity, `stroke-width=1`; **omit on 16×16 optical favicon** |
| Node | Circle `cx=12.25 cy=16 r=3.15`, fill `#f4f6fb` |
| Upper tick | Line `(17.1, 12.85) → (23.4, 10.55)`, stroke `#f4f6fb`, `stroke-width=2.35`, `stroke-linecap=round` |
| Lower tick | Line `(17.1, 19.15) → (23.4, 21.45)`, same stroke |
| Gap node→ticks | ~1.7 units (must remain visible at 24–32px) |

Locked reference paths (mono fixed asset):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" rx="7" fill="#05060c"/>
  <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="6.25"
        fill="none" stroke="#8b9cc8" stroke-opacity="0.35" stroke-width="1"/>
  <circle cx="12.25" cy="16" r="3.15" fill="#f4f6fb"/>
  <path d="M17.1 12.85 L23.4 10.55" stroke="#f4f6fb" stroke-width="2.35" stroke-linecap="round"/>
  <path d="M17.1 19.15 L23.4 21.45" stroke="#f4f6fb" stroke-width="2.35" stroke-linecap="round"/>
</svg>
```

### 2.4 Spacing & silhouette rules

- Keep asymmetric weight (node left, energy right) — do not center the whole glyph as a balanced burst.
- Maintain ≥1 unit clear gap between node and tick starts.
- Tick angle and length stay paired (mirror across horizontal axis); do not add a third tick.
- Corner radius stays NZ-family (`rx ≈ 7/32`); do not switch to circle badge or sharp square.

### 2.5 Minimum size & 16×16 optical variant

| Size | Variant | Notes |
|------|---------|--------|
| ≥24 CSS px | Full geometry | Border optional; preferred on 32+ app icons |
| 16×16 (favicon) | **Optical variant required** | Do not naively downscale full SVG |

**16×16 optical rules:**

- Drop hairline border (it collapses into mud).
- Slightly enlarge node (`r` ≈ 3.4–3.6 in 32 viewBox terms when authored for 16 export).
- Slightly thicken ticks (`stroke-width` ≈ 2.6–2.8) and shorten tick length ~5–8% so they don’t merge into a chevron blob.
- Preserve the “node + open V to the right” read under nearest-neighbor and browser favicon scaling.
- Export dedicated `favicon-16.png` (and ICO including 16) from this optical SVG, not from the full mark.

Validation gate: at 16×16, a stranger should still see “dot + two strokes right,” not a generic arrow or Wi‑Fi.

### 2.6 Color systems

**Fixed permanent assets** (favicon, apple-touch, default OG mark plate, GitHub-ready PNG):

| Token | Hex | Use |
|-------|-----|-----|
| Field | `#05060c` | Frame fill |
| Ink | `#f4f6fb` | Node + ticks |
| Line (optional) | `#8b9cc8` @ ~35% | Large-only hairline |
| Accent (optional) | `#7b8cff` | At most **one** tick on large OG/social art; never required for recognition |

**Theme-aware in-app mark:**

- Frame uses a semantic fill tied to existing UI chrome (e.g. `currentColor` or foreground/muted tokens already used by the shell) — **not** a new global `--brand` rewrite.
- Node + ticks use contrasting ink (light on dark field / inverse on light field) so contrast stays WCAG-sensible against the frame.
- **Do not change** `globals.css` `--brand` / teal tokens in this pass.

### 2.7 Monochrome

- Recognition must work in pure black-on-white and white-on-black (node + both ticks same ink; no accent).
- Single-color stencil: frame may be omitted when the mark sits on an already-dark or already-light surface; the **node + two ticks** alone must still read as ChatAI.

### 2.8 Accessibility

- Decorative UI mark: `aria-hidden="true"` when adjacent wordmark “ChatAI” is present.
- Standalone icon buttons/links: accessible name via `aria-label` / visible text (“ChatAI”, “Home”).
- Prefer SVG over CSS-only shapes for crisp scaling.
- Fixed favicons remain high-contrast light-on-`#05060c` (not low-contrast grey-on-grey).

### 2.9 Misuse rules

Do not:

- Recolor the fixed favicon/app icon with product teal or arbitrary gradients.
- Add speech-bubble tails, sparkles, orbital rings, Wi‑Fi arcs, or letterforms (`AI`, `N0`) inside the mark.
- Stretch, rotate >0°, or crop ticks off the frame.
- Place busy photography under the mark without a solid NZ field plate.
- Use the accent violet as the only ink (breaks monochrome / 16px recognition).
- Ship the default Next.js `favicon.ico` alongside ChatAI icons.

## 3. Asset plan (implementation checklist)

### 3.1 Files

| Asset | Path (proposed) | Derivation |
|-------|-----------------|------------|
| Canonical SVG (full) | `apps/web/public/icon.svg` | Source of truth (fixed palette) |
| Optical 16 SVG (optional keep) | `apps/web/public/icon-16.svg` or build-only | Optical variant; may be build input only |
| Favicon ICO | `apps/web/src/app/favicon.ico` | Replace Next default; include 16 (optical) + 32 |
| Apple touch | `apps/web/public/apple-touch-icon.png` | 180×180 from full mark (+ border OK) |
| OG image | `apps/web/src/app/opengraph-image.tsx` **or** `public/og.png` | See §4 |
| Twitter | Same image via metadata | `summary_large_image` |
| In-app mark | `apps/web/src/components/brand/logo.tsx` | Theme-aware paths = A1 |
| Preview artifacts | `apps/web/public/brand-preview/**` | Remove or `.gitignore` after ship (not production brand) |

### 3.2 Metadata (`apps/web/src/app/layout.tsx`)

- Keep `title.default` / `template` (`ChatAI`, `%s · ChatAI`).
- Keep NightZeros as `authors` / `creator`.
- `icons`: SVG + ICO/PNG sizes + `apple` touch icon.
- `openGraph.images` + `twitter.images` pointing at OG asset.
- `twitter.card`: `summary_large_image`.
- Copy refinements allowed if they stay consistent with product positioning; do not remove NightZeros attribution from prose.

### 3.3 Explicit non-goals (this pass)

- No change to `--brand` / `--brand-foreground` or teal retirement.
- No docs (`apps/docs`) mark swap.
- No npm `packages/*/package.json` icon fields unless already trivial; defer.
- No remote GitHub avatar upload (export PNG for manual use later is enough if convenient).

## 4. OG / social composition

**Primary identity:** ChatAI (large wordmark + A1 mark).  
**Tagline:** `Your knowledge. Your AI. Anywhere.`  
**Secondary:** NightZeros attribution (smaller, muted) — e.g. `A NightZeros project` or `NightZeros · NZ/001`.

Suggested layout (1200×630):

1. NZ dark field `#05060c`, subtle grid or soft violet glow (restrained; mark remains mono-legible).
2. A1 mark (full geometry, optional single accent tick).
3. **ChatAI** as dominant type.
4. Tagline under brand.
5. NightZeros line at bottom or under tagline at lower contrast — never competing with ChatAI.

## 5. Implementation / asset plan (ordered)

1. Lock optical 16×16 SVG; rasterize 16 / 32 / 180; build `favicon.ico`; replace `public/icon.svg`.
2. Update `BrandMark` / lockup to A1 theme-aware paths (no `--brand` token edits).
3. Add OG image + wire `layout.tsx` metadata (`summary_large_image`, apple icon, icon list).
4. Delete or ignore `brand-preview/`; remove stock Next favicon residue.
5. Visual QA: browser tab 16px, sidebar mark light/dark, auth shell, landing, iOS add-to-home, Slack/Twitter card debugger if available.
6. Follow-up ticket (not this pass): design-system `--brand` alignment away from teal.

## 6. Success criteria

- [ ] Tab favicon is ChatAI A1, not Next.js default.
- [ ] 16×16 still reads as node + two outbound ticks.
- [ ] In-app mark matches fixed mark geometry; works in light and dark without new brand tokens.
- [ ] Link previews show ChatAI-first card with tagline; NightZeros secondary; large image card.
- [ ] No teal token / global brand CSS changes in the diff.

## 7. Open points resolved by this spec

| Topic | Decision |
|-------|----------|
| Mark | A1 Reply Vector |
| Palette (fixed) | Dual system; NZ dark for permanent assets |
| Teal / `--brand` | Unchanged this pass |
| 16×16 | Dedicated optical variant |
| OG hierarchy | ChatAI → tagline → NightZeros |
| Accent | Optional one tick on large art only |
