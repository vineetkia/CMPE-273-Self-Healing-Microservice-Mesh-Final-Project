# Multi-stage build: Vite produces an optimized static bundle, nginx serves it.
# Build args bake the four backend URLs into the bundle so the same image
# runs identically in local dev and AWS (override at build time per env).

FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_GATEWAY_URL=http://localhost:8080
ARG VITE_HEALER_URL=http://localhost:8090
ARG VITE_JAEGER_URL=http://localhost:16686
ARG VITE_PROM_URL=http://localhost:9090

ENV VITE_GATEWAY_URL=${VITE_GATEWAY_URL}
ENV VITE_HEALER_URL=${VITE_HEALER_URL}
ENV VITE_JAEGER_URL=${VITE_JAEGER_URL}
ENV VITE_PROM_URL=${VITE_PROM_URL}

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html
# Vite copies public/ into dist/ at build, so static aux files (Login.html /
# Settings.html) are already in /usr/share/nginx/html. No second copy needed.

# Tiny SPA-aware nginx config: route everything that doesn't map to a file
# back to index.html so React owns client-side routing.
RUN printf 'server {\n\
  listen 5173 default_server;\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  gzip on;\n\
  gzip_types text/css application/javascript application/json image/svg+xml;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
  location ~* \\.(js|css|svg|png|jpg|jpeg|gif|ico|woff2?)$ {\n\
    expires 1d;\n\
    add_header Cache-Control "public, max-age=86400, immutable";\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf \
  && rm -f /etc/nginx/conf.d/default.conf.bak

EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
