# Multi-stage build: frontend builder stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Build-time version metadata (can be injected by CI)
ARG APP_VERSION=dev
ARG STORAGE_SCHEMA_VERSION=1
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_STORAGE_SCHEMA_VERSION=$STORAGE_SCHEMA_VERSION

# Builder needs devDependencies for vite/tsc
RUN npm ci

COPY . .

RUN npm run build

# Runtime stage: serve static files via nginx
FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
