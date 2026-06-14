# AIRED transcoding worker.
#
# Debian slim (not Alpine) so the well-tested apt ffmpeg is available — ffmpeg
# missing from the image is THE classic way this breaks, so it is installed
# explicitly and verified at build time below.

FROM node:22-bookworm-slim

# ffmpeg does the master → HLS transcode. ca-certificates lets us reach
# Supabase + R2 over HTTPS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -version

WORKDIR /app

# Install production deps first for better layer caching. Use the lockfile when
# present (npm ci); fall back to npm install if it is ever absent.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Application source.
COPY src ./src

ENV NODE_ENV=production
# Railway injects PORT; default to 8080 for local `docker run`.
ENV PORT=8080
EXPOSE 8080

# Container-level health probe (Railway can also use its own). Node 22 ships a
# global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
