# Verified Luminovia brand and portal design system

## Provenance

Verified on 15 November 2026. Read-only source: [Website repository](https://github.com/Luminovia-Training-Consulting/Website) at `2778a9be96b7d6c29ec0f11a1677c7530c602ccc`; `git ls-remote` confirmed current `main` matches the local source checkout. Portal asset bytes were compared to raw files at that exact commit. The live [Luminovia website](https://luminovia.org/) was inspected as the brand reference. No website files were changed. No design-board image was present in the supplied attachment directory.

| Source file | SHA-256 |
| --- | --- |
| `src/index.css` | `02a8bea0420609089da99d3daf695775d5502c5c8b6c4026530deeb4add42949` |
| `src/styles/home.css` | `a74a180a7e8dd53e2acb87f46ffe8bdfb1506d85629e618ca4ffd13667a928ff` |
| `public/images/luminovia-logo-mark-160.webp` | `34659900f9c14b09f30e29bd7b1cb4c463b59da0f8dc77d05c5012d3755099d2` |
| `public/images/luminovia-logo-full.webp` | `13a1e718fd58b4d770019e2b845e0f60ead8383d89bda9aef9d14f309fb74b98` |
| `public/fonts/space-grotesk-latin-wght-normal.woff2` | `0640890476fc1198ab4de571fb658de443c4d85b66466ec09534a8737ab1ce9d` |
| `public/fonts/space-grotesk-OFL.txt` | `18a4de52385f6b988782639d5d0cc1326e5a8c2de9a7f01d7b20d9aedcc60943` |

The four asset files are copied unchanged under `public/brand/` with their original filenames. The font retains its SIL Open Font License. The full logo was visually checked: authentic book/learning mark, rainbow ring, Luminovia wordmark and “TRAINING & CONSULTING” on a light background. Use the compact mark in navigation and full logo where space permits; preserve aspect ratio and give the image a light backing where required. Do not fabricate a replacement mark or recolour the raster logo. Do not copy portraits, personal certificates or downloads into demo data.

## Tokens

| Token | Light | Dark |
| --- | --- | --- |
| paper | `#f8f5ee` | `#111a2e` |
| surface | `#fffdf8` | `#1b2840` |
| ink | `#14233b` | `#f6f9ff` |
| muted | `#4f5b70` | `#c7d3e9` |
| line | `#ccd6e3` | `#4a5c78` |
| accent | `#1749b5` | `#b5cdff` |
| accent-hover | `#123a92` | `#d4e2ff` |
| on-accent | `#ffffff` | `#102755` |

Persistent brand values: navy `#172b4b`, brand-blue `#1749b5`, brand-blue-hover `#123a92`, blue-soft `#dce8ff`. Seven-colour sequence: coral `#ffae9a`, peach `#ffc68e`, yellow `#ffdb76`, mint `#b8edd9`, blue `#1749b5`, indigo `#7d88d8`, lilac `#ded2fa`.

Use navy text on pastel panels, never low-contrast white. Blue is the primary action, not the sole decorative colour; indigo/lilac are restrained parts of the full palette. Night colours are intentional surface/text/accent substitutions; pale pastel cards retain dark text for contrast.

## Typography, forms and surfaces

Headings: self-hosted Space Grotesk variable weight 300–700 with `font-display: swap`; body: readable system sans-serif matching the source website. Use generous line heights and avoid tiny UI labels. Reuse the seven-colour strip, organic overlapping arcs and asymmetrically rounded panels from the website's visual language. Dense operational screens use compact headings; reserve the substantial hero for dashboard/login/onboarding.

Inputs require visible labels, validation text linked with `aria-describedby`, appropriate autocomplete and keyboard focus. Controls must have accessible names and at least 44px practical touch targets. Colour supplements text/status icons. Respect reduced motion. Dialogs need focus management, escape behaviour and labelled titles.

## Responsive patterns

Desktop: navy sidebar, content workspace, top language/theme controls and user actions. Navigation supports collapsing where implemented. Mobile: touch navigation for Home/Jobs/Calendar/Chats/Profile when those modules function, additional destinations under More. Never expose non-working module navigation as completed functionality. Keep layouts usable at 360px, large text and keyboard zoom. Loading/error/empty/offline states use real copy in DE/EN rather than invented content or figures.

## State and content

Persist only non-sensitive UI preferences such as locale and theme. Switching locale/theme must preserve unsaved form values and navigation state. Format money with original currency and dates with locale and explicit time zone. User content is displayed as authored text; no automatic translation claim. Interface screenshots must contain only fictional development records.
