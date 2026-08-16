# Portable image for hosts that take a Dockerfile (Fly.io, Koyeb, Cloud Run).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Dev dependencies are the build toolchain (TypeScript, Vite), so they are
# needed here even though the runtime does not use them.
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8787
CMD ["npm", "start"]
