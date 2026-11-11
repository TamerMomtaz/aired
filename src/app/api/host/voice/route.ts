// POST /api/host/voice — the host's human voice (optional).
//
// Body: { text: string }. Reply: audio/mpeg of the host saying it.
//
// The phone's own speech voice is free but often sounds robotic. When
// ELEVENLABS_API_KEY is set in Vercel, this turns the host's words into a
// natural human voice instead (ElevenLabs, multilingual, speaks Egyptian
// Arabic and English). Pick the voice with ELEVENLABS_VOICE_ID. Without the
// key this replies 501 and the app quietly uses the phone's voice.
//
// The key stays on the server (CLAUDE.md §1.7). The text is only the host's
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

export async function POST(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return new Response(null, { status: 501 });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) return new Response(null, { status: 429 });

  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  } catch {
    // fall through
  }
  if (!text) return new Response(null, { status: 400 });

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
    if (!res.ok || !res.body) return new Response(null, { status: 502 });
    return new Response(res.body, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
