// Moving covers for the Fresh drop spotlight on Listen (Tee, Nov 2026).
// The spotlight always shows the two newest live songs, so it rotates by itself
// as new songs go live. A song listed here plays its looping video in place of
// its still cover; any other song shows its cover. Videos are short silent
// loops (5 s, 960x960, Kling 3.0 on OpenArt) made from the song's own cover
// art, served from OpenArt's CDN. To add one: list the song's id and its video
// URL below. Old entries can stay or be removed once a song leaves the
// spotlight. If a video fails to load, the card falls back to the cover.
export const FRESH_VIDEOS: Record<number, string> = {
  // AIRED-0153 ABADAYAH - RU-LE
  153: "https://cdn.openart.ai/openart-ai/production/2026-11/create-video/yVmPo7UAwG14W1MwhjtW/f5ab4e385c2be4b49d20419b71345813-b1526b64-aaf9-47ca-b8e3-abe5482cd5dd_c2pa_1794568489439_2df14bab.mp4",
  // AIRED-0152 LA COLLE / ست الكل
  152: "https://cdn.openart.ai/openart-ai/production/2026-11/create-video/yVmPo7UAwG14W1MwhjtW/7f5c09ec93a7017b60f547c243884528-f2c0732e-5258-4f8a-b690-b8a6a28e0ded_c2pa_1794568492420_2306bb16.mp4",
};

export const FRESH_COUNT = 2;
