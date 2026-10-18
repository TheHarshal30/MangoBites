# Inji Interop Playground (UI + API + reference issuer/wallet/verifier)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build -w apps/web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /app /app
EXPOSE 4000
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
