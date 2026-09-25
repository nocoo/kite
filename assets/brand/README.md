# Kite identity

The first independent Logo is the owner-approved faceted bird head from Hexly
study `2026-09-25-02`, finishing `03`.

![Kite](icon-rounded.png)

- `../../logo.png`: transparent foreground, native 2048-square canvas; small app
  and browser marks derive from this source without another tile or CSS mask.
- `icon.png`: square presentation for large promotional surfaces.
- `icon-rounded.png`: rounded presentation for README and social use.
- Transparent SHA-256: `5e414e28dc102ee25dc7fa5ab51c1bd1ef20de1c318fdceeec5299d7a255d0d6`.
- Complete source, prompt, variants and usage: https://hexly.ai/projects/kite#brand

Azure OpenAI `gpt-image-2.5-sunburst` generated the source. The owner approved its
exact bytes. White-matte extraction and separate presentation layers are recorded
in Hexly; no original source image existed. Preserve the species, faceted colors
and off-center framing. Artwork rights follow the project owner's generated
identity; support documentation follows the repository license.

The identity adoption commit published these assets only. Application
implementation was developed separately and later merged into the main branch.

The application now consumes transparent derivatives in `../../public/`: the
sidebar uses `logo-24.png` with `logo-48.png` at 2×, and the browser uses
`logo-16.png` and `logo-32.png`. All resize the entire approved canvas uniformly,
preserving alpha, placement and colors without a background or CSS mask.
Regenerate these checked-in PNGs on macOS with `node scripts/resize-logo.mjs`
(the native `sips` tool). No image-generation or runtime image dependency is
required. README presentation assets remain separate from navigation marks.
