# Sifta — Design Brief

**For:** Claude Code, alongside `SIFTA-PRD.md`
**Owner:** Usifoh Joshua
**Date:** 1 August 2026

---

## 0. The thesis

The logo is not decoration. **The logo is the data visualization.**

Look at what the mark already says: a field of navy squares, and in that field, a few amber ones. That is exactly what the product does — screen hundreds of candidates, surface the two that matter. The letterforms are built from the same grid the interface will be built from.

So the entire design system is one idea:

> **Everything snaps to the module. Amber means hit. Nothing else is ever amber.**

That constraint does the heavy lifting. It gives the product a visual logic that no competitor has, and it makes the interface legible at a glance — an analyst scanning the queue reads amber before they read a single word.

---

## 1. Design principles

**1. The grid is visible, not implied.** Hairline rules, exposed module boundaries, aligned edges. This is compliance software. It should feel engineered, auditable, precise. Softness is dishonest here.

**2. Amber is semantic, never decorative.** Amber marks a match, a hit, a thing requiring attention. It never appears in a button, a link, a heading, a logo lockup, or an illustration. Because it is rationed this way, it is loud when it appears. **This is the single most important rule in the document.**

**3. Zero border radius. Everywhere.** No exceptions — buttons, inputs, cards, modals, avatars, tags. The logo has hard corners. So does the product.

**4. Density is a feature.** Analysts work in queues. Show more rows, not more whitespace. Resist the instinct to make it "breathe" — this is a tool, not a landing page. (The marketing site is the one place density relaxes.)

**5. Monospace for anything a human might need to verify.** Names, IDs, dates, distances, timestamps, hashes. Tabular figures, aligned columns. If a compliance officer might read it aloud to a regulator, it's mono.

---

## 2. Color tokens

```css
--navy-900:  #16204A;   /* deepest — page background in dark surfaces */
--navy-700:  #1E2A5E;   /* THE logo navy — primary brand, filled modules */
--navy-500:  #38457D;   /* secondary fills, inactive states */
--navy-300:  #8A93B8;   /* muted text, disabled */

--amber:     #F5A623;   /* THE logo amber — HITS ONLY */

--paper:     #FAFAF7;   /* primary background, light surfaces */
--rule:      #DDDEE5;   /* hairlines, grid lines, borders — 1px only */
--ink:       #0E1330;   /* body text */

--cleared:   #B4B8C8;   /* hollow/gray — an alert a human has dispositioned */
```

**Notes:**
- Amber usage should be under 2% of any screen's pixels. If it's more, something is wrong.
- `--cleared` is the third semantic state and it matters: a cleared alert becomes *hollow* — outline only, no fill. Visually "emptied." An analyst sees their progress as the grid drains.
- No gradients. Anywhere. Flat fills only.
- Dark mode: swap `--paper` for `--navy-900`, `--ink` for `--paper`. Amber stays identical.

---

## 3. Typography

Two families. No more.

| Role | Face | Usage |
|---|---|---|
| **Display / UI** | **Archivo** (Google Fonts) | Headings, buttons, labels, prose. Use the *Expanded* width at heavy weights for display — it echoes the wide, square logo modules. |
| **Data** | **IBM Plex Mono** (Google Fonts) | Names, IDs, dates, match distances, timestamps, tool traces, log output |

**Why not Inter:** it's the default every AI-generated interface reaches for. Archivo has a squared-off, slightly industrial character that agrees with the logo's geometry, and its expanded widths give you a display voice Inter doesn't have.

**Type scale** (1.25 ratio, snapped to the 8px module):

```
display   48/52   Archivo Expanded 800   -0.02em
h1        32/40   Archivo Expanded 700   -0.01em
h2        24/32   Archivo 700
h3        18/24   Archivo 600
body      15/24   Archivo 400
label     12/16   Archivo 600   0.08em   UPPERCASE
data      13/20   IBM Plex Mono 400      tabular-nums
data-sm   11/16   IBM Plex Mono 400      tabular-nums
```

Labels are uppercase with wide tracking — it reads as system/form language, appropriate to regulated software, and it's a deliberate contrast against the tight display tracking.

---

## 4. Layout & spacing

**Base module: 8px.** Every dimension is a multiple. This is the logo's square, made into a unit.

```
Spacing scale: 4 · 8 · 16 · 24 · 32 · 48 · 64 · 96
```

- **Borders:** 1px, `--rule`. Never 2px. Never shadows.
- **Elevation:** communicated by borders and background shifts, never by drop shadow. There are no shadows in this product.
- **Grid:** 12-column, 24px gutters, 1440px max width for the console. Marketing site can go wider.
- **Tables:** 40px row height, 1px rules between rows, sticky header, no zebra striping (the rules do that work).

---

## 5. The signature element: The Field

**This is the one thing the product is remembered by. Build it well.**

When a subject is screened, render the candidate set as a live grid of small squares — same module as the logo.

```
█ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █      █ = candidate (navy-500)
█ █ █ █ █ █ █ █ ▓ █ █ █ █ █ █ █      ▓ = match (amber)
█ █ █ █ █ █ █ █ █ █ █ █ █ █ █ █      □ = cleared (hollow)
□ □ █ █ █ █ █ █ █ █ █ █ ▓ █ █ █
```

Behaviour:
1. Grid populates as the vector search returns candidates — fast, mechanical, no easing curves that feel "designed"
2. Cells the agent rules out go hollow, left to right
3. The surviving match snaps to amber
4. Hover any cell → name variant + match distance in mono, in a hard-edged tooltip

**Why this is the right signature:** it's your logo, alive. It shows the product working without explaining it. On the hero of your marketing site, a visitor understands what Sifta does in three seconds without reading. In the video, it's the shot judges will remember.

**Second use — the memory bar.** When the agent recalls a prior decision, show the historical grid *beside* the current one, with the previously-cleared cells already hollow. Two grids side by side, the second mostly empty. That single visual is the entire "agentic memory" argument, and it's the frame you should freeze on in the demo video.

---

## 6. Hard prohibitions — the AI-slop blacklist

**None of these appear in this product. Not one.**

**Visual tells:**
- Purple/blue/violet gradients — or any gradient
- Glassmorphism, `backdrop-blur`, frosted panels
- Rounded corners of any radius
- Drop shadows, glows, `box-shadow` of any kind
- Emoji anywhere in the UI — not as icons, bullets, empty states, or toasts
- Icons sitting inside colored circles
- Untouched shadcn/Tailwind defaults (`rounded-lg`, `shadow-md`, default slate palette)
- Floating dashboard mockups tilted at an angle
- Generated-looking avatars or stock photography
- Mesh gradients, blob shapes, aurora backgrounds
- Grainy noise texture overlays

**Copy tells:**
- A pill badge above the hero saying "✨ Introducing…" or "🚀 Now in beta"
- "Powered by AI" / "AI-powered" / "Built with AI" anywhere
- "Revolutionize," "seamless," "unlock," "supercharge," "game-changing," "delve"
- Em-dash-heavy marketing prose
- Three feature cards with a generic icon, a two-word title, and a sentence that says nothing
- Fake testimonials, fake logos, fake customer counts

**Motion tells:**
- Fade-up-on-scroll applied to every section
- Staggered entrance animations on lists
- Anything springy, bouncy, or elastic
- Parallax
- Typewriter text effects

---

## 7. Motion rules

Motion in this product is **mechanical, not expressive.** Things snap, count, or fill. Nothing floats, breathes, or bounces.

```
Duration:  120ms (state change) · 240ms (grid population)
Easing:    cubic-bezier(0.2, 0, 0, 1)   — fast out, hard stop
```

Permitted, and only these:
- Field cells populating and resolving
- Row state transitions in the queue
- A numeric counter ticking when the alert count drops

Respect `prefers-reduced-motion`: the Field renders in its final state instantly.

---

## 8. Voice & copy

Plain, exact, unhurried. This is software people use to defend a decision to a regulator.

| Don't write | Write |
|---|---|
| "AI-powered screening" | "Screening" |
| "Submit" | "Clear alert" / "Escalate" |
| "Oops! Something went wrong" | "Screening failed. The watchlist connection timed out. Retry." |
| "No alerts yet! 🎉" | "Queue empty. 47 alerts dispositioned today." |
| "Unlock deeper insights" | "See prior decisions for this subject" |

Sentence case everywhere except `label` tokens. Actions keep the same word through the whole flow: the button says **Clear alert**, the toast says **Alert cleared**, the ledger says **Cleared**.

Errors state what happened and what to do. They don't apologize.

---

## 9. Screens

**Alert queue** (primary) — dense table. Columns: subject name (mono), jurisdiction, match distance (mono, tabular), status, raised. Amber left-edge marker on rows with a live match. Sticky header. Keyboard navigable: `j`/`k` to move, `Enter` to open, `c` to clear, `e` to escalate. Analysts live here all day; the keyboard shortcuts are not a flourish, they're the product.

**Investigation view** — two columns. Left: subject details and the Field. Right: agent reasoning trace as a mono log, streaming, timestamped. Beneath it, prior decisions if any exist — this is the memory payoff, so give it room. Disposition controls pinned bottom-right.

**Decision ledger** — append-only list, mono throughout, filterable, exportable. Deliberately austere. It should look like a record, not a dashboard.

**Marketing site** — one page. Hero is the Field, animating, with a single sentence beneath it. Then the problem stated in plain numbers (your measured false-positive count). Then how it works, three steps, no icons. Then the architecture diagram. Then a single call to action. No pricing table, no testimonials, no logo wall.

---

## 10. Making the demo not look AI-generated

The same discipline applies to the video, since you'll be judged on it:

- Record at 1920×1080, 60fps, in a clean browser window — no bookmarks bar, no extensions, no tab clutter
- Use **real data**: actual OFAC list entries, real Nigerian name variants. Fake data always looks fake
- Move the cursor deliberately. Don't jump-cut every two seconds
- No stock background music, no whoosh transitions, no zoom-punch effects
- Your own voice, unhurried. Nigerian accent is an asset here — it makes the domain expertise credible
- Show one real terminal with real query output. `EXPLAIN` running against the actual cluster is worth more than any animation
- Let the Field animation carry the visual interest. It's enough.

---

## 11. Build order

1. Tokens file — color, type, spacing. Everything else derives from it.
2. The Field component. Build it first; it defines the product's feel.
3. Alert queue table with keyboard navigation.
4. Investigation view with streaming agent trace.
5. Decision ledger.
6. Marketing page last — reuse the Field.
