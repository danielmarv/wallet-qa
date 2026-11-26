FROM node:26.13.1-alpine AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN npm install -g pnpm@11.20.0 && pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm run build

FROM node:26.13.1-alpine AS runtime
WORKDIR /app
# web/ has only build-time dependencies (the bundle is in dist/web), so --prod installs nothing for it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN npm install -g pnpm@11.20.0 && pnpm install --prod --frozen-lockfile --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config

# Run as the image's unprivileged `node` user (uid 1000), which owns the run store in /app/data.
# The copied files keep the checkout's modes; a checkout made with a restrictive umask would
# leave them unreadable for `node`, so make the application files world-readable.
RUN mkdir -p /app/data && chown node:node /app/data && chmod -R a+rX /app/dist /app/config
USER node
EXPOSE 8787
CMD ["node", "dist/server/server.js"]
