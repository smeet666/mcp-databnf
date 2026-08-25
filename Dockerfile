# How this server is built for a directory that runs it in a container.
#
# Checked in rather than left to be inferred: the repository root also holds
# packaging/manifest.json, whose entry point describes the layout inside a
# packed bundle rather than inside this tree, and a build guessing from that
# starts a path that does not exist here.
#
# Two stages, so the image carries what running the server needs and nothing
# that building it needed. It runs as the unprivileged user the base image
# ships, since a server that only reads a public site has nothing to do as root.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
