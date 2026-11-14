// POST /api/host/voice — Kahotia's own voice (optional).
//
// Body: { text: string, lang?: "ar" | "en" }. Reply: audio/mpeg of Kahotia
// saying it.
//
// The phone's own speech voice is free, but on most phones (Samsung and other
// Android phones especially) a website can't choose it: it is whatever the
// phone's default is, usually a woman's. With a server voice, every listener
// hears the same Kahotia. Two services can be switched on in Vercel:
//
//   - Microsoft Azure Speech (AZURE_SPEECH_KEY + AZURE_SPEECH_REGION): male
//     neural voices, including Egyptian Arabic (ar-EG-ShakirNeural). Its free
//     tier covers AIRED's size. Change the voices with AZURE_SPEECH_VOICE_AR
//     and AZURE_SPEECH_VOICE_EN.
//   - ElevenLabs (ELEVENLABS_API_KEY, optional ELEVENLABS_VOICE_ID): used
//     instead when its key is set.
//
// Without either key this replies 501 and the app quietly uses the phone's
// voice. Keys stay on the server (CLAUDE.md §1.7). The text is only Kahotia's
// own reply, and nothing is stored.

export const runtime = "nodejs";

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const MAX_TEXT = 600;

const WINDOW_MS = 60_000;
const LIMIT = 20;
const hitsByIp = new Map<string, { start: number; count: number }>();
function allow(ip: string): boolean {
  const now = Date.now();
  const w = hitsByIp.get(ip);
  if (!w || now - w.start > WINDOW_MS) {
    if (hitsByIp.size > 1000) hitsByIp.clear();
    hitsByIp.set(ip, { start: now, count: 1 });
    return true;
  }
  w.count++;
  return w.count <= LIMIT;
}

const ARABIC = /[\u0600-\u06FF]/;

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function audio(res: Response): Response {
  if (!res.ok || !res.body) return new Response(null, { status: 502 });
  return new Response(res.body, {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
}

async function azure(text: string, lang: "ar" | "en", key: string, region: string) {
  const voice =
    lang === "ar"
      ? process.env.AZURE_SPEECH_VOICE_AR || "ar-EG-ShakirNeural"
      : process.env.AZURE_SPEECH_VOICE_EN || "en-US-AndrewNeural";
  const xmlLang = voice.split("-").slice(0, 2).join("-");
  // A touch slower than default: Kahotia is a late-night radio host.
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlLang}"><voice name="${xmlEscape(voice)}"><prosody rate="-4%">${xmlEscape(text)}</prosody></voice></speak>`;
  const res = await fetch(
    `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "content-type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
        "user-agent": "aired-host",
      },
      body: ssml,
      signal: AbortSignal.timeout(15_000),
    },
  );
  return audio(res);
}

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION;
  if (!key && !(azureKey && azureRegion)) return new Response(null, { status: 501 });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return new Response(null, { status: 429 });

  let text = "";
  let lang: "ar" | "en" = "en";
  try {
    const body = (await request.json()) as { text?: unknown; lang?: unknown };
    text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
    lang = body.lang === "ar" ? "ar" : "en";
  } catch {
    // fall through
  }
  if (!text) return new Response(null, { status: 400 });
  // What he actually wrote wins over the language the phone listens in.
  if (ARABIC.test(text)) lang = "ar";

  if (!key) {
    try {
      return await azure(text, lang, azureKey!, azureRegion!);
    } catch {
      return new Response(null, { status: 502 });
    }
  }

  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35 },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return audio(res);
  } catch {
    return new Response(null, { status: 502 });
  }
}
