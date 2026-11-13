# AIRED transcoding worker.
#
# Debian slim (not Alpine) so the well-tested apt ffmpeg is available — ffmpeg
# missing from the image is THE classic way this breaks, so it is installed
# explicitly and verified at build time below.

FROM node:22-bookworm-slim

# ffmpeg does the master → HLS transcode. ca-certificates lets us reach
# Supabase + R2 over HTTPS. fonts-noto-cjk gives the REEL typesetter (libass)
# Noto Sans CJK for the Chinese / Japanese / Korean in our lyrics; Geist and
# Tajawal (Latin + Arabic) ship in ./fonts below. The build fails loudly if
# ffmpeg lacks libass or the CJK face is missing — a reel must never silently
# fall back to tofu boxes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -version \
  && ffmpeg -hide_banner -filters | grep -q " ass " \
  && test -f /usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc

# STEMS: the open Demucs model (MIT) splits each live song into vocals, drums,
# bass and the rest for the Mixer. CPU-only PyTorch; the htdemucs weights are
# downloaded at build time so the running worker never fetches a model.
# Debian's pip (23.0) chokes on a typing_extensions wheel on the PyTorch index,
# so pip is upgraded first, and only torch comes from that index (its other
# needs come from PyPI). demucs imports numpy without declaring it. A 3-second
# test split at the end proves the whole chain works before the image ships.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/stems \
  && /opt/stems/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/stems/bin/pip install --no-cache-dir \
       --index-url https://download.pytorch.org/whl/cpu \
       --extra-index-url https://pypi.org/simple \
       torch==2.5.1+cpu \
  && /opt/stems/bin/pip install --no-cache-dir demucs==4.1.0 "numpy<3" \
  && /opt/stems/bin/python -c "from demucs.pretrained import get_model; get_model('htdemucs')" \
  && ffmpeg -hide_banner -loglevel error -f lavfi -i "sine=frequency=220:duration=3" -ac 2 -ar 44100 /tmp/probe.wav \
  && /opt/stems/bin/python -m demucs.separate -n htdemucs -d cpu -o /tmp/probe-out --filename "{stem}.{ext}" /tmp/probe.wav \
  && test "$(find /tmp/probe-out -name "*.wav" | wc -l)" -eq 4 \
  && rm -rf /tmp/probe.wav /tmp/probe-out

# The weights are in the image; never reach for the hub at run time.
ENV HF_HUB_OFFLINE=1

WORKDIR /app

# Install production deps first for better layer caching. Use the lockfile when
# present (npm ci); fall back to npm install if it is ever absent.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Application source + the reel fonts (Geist, Tajawal — OFL, licences alongside).
COPY src ./src
COPY fonts ./fonts

ENV NODE_ENV=production
# Railway injects PORT; default to 8080 for local `docker run`.
ENV PORT=8080
EXPOSE 8080

# Container-level health probe (Railway can also use its own). Node 22 ships a
# global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
