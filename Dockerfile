# One Dockerfile for every backend service + the local Lambda runner.
# Build:  docker build -t habitloop-activity --build-arg SERVICE_DIR=services/activity-service .
# All images share the same build layers (SERVICE_DIR is only declared at the end), so the monorepo compiles once.
FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY lambdas ./lambdas
RUN npm install --no-audit --no-fund && npm run build
ARG SERVICE_DIR=services/user-service
ENV SERVICE_DIR=${SERVICE_DIR} NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["sh", "-c", "node ${SERVICE_DIR}/dist/${ENTRY:-index.js}"]
