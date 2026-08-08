FROM node:24-alpine AS web
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY gateway/requirements.txt ./gateway/requirements.txt
RUN pip install --no-cache-dir -r gateway/requirements.txt
COPY gateway ./gateway
COPY --from=web /build/dist ./dist
EXPOSE 18700
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:18700/healthz')"
CMD ["uvicorn", "gateway.app:app", "--host", "0.0.0.0", "--port", "18700", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
