# Bundled fonts

These WOFF2 Latin subsets are served locally under the Platform-reserved `/fonts/` path, outside the dynamic API Gateway. Chinese text uses the system font fallbacks defined in `app/assets/css/main.css`.

- Inter variable (normal and italic, weights 100–900): `@fontsource-variable/inter@5.3.0`, https://www.npmjs.com/package/@fontsource-variable/inter/v/5.3.0
- IBM Plex Mono (normal, weights 400, 500, 600, 700): `@fontsource/ibm-plex-mono@5.3.0`, https://www.npmjs.com/package/@fontsource/ibm-plex-mono/v/5.3.0

Both families use the SIL Open Font License 1.1. Their original license notices are included alongside the font files. Update the CSS and the relevant license notice together when replacing a font.

Code and URL text deliberately disable ligatures and kerning so each character, including repeated slashes, remains distinct.
