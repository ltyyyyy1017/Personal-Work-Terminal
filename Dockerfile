FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 WORKBENCH_STANDALONE=true
RUN pnpm build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3939 TZ=Asia/Shanghai WORKBENCH_DATA_DIR=/app/data
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/browser-helper ./browser-helper
COPY --from=build --chown=node:node /app/scripts/ocr-worker.py ./scripts/ocr-worker.py
COPY --from=build --chown=node:node /app/scripts/ocr-requirements.txt ./scripts/ocr-requirements.txt
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3939
CMD ["node","server.js"]
