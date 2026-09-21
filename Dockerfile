# syntax=docker/dockerfile:1

# 1. build the React app
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2. the Python app, serving the API and the built files from one process
FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml README.md LICENSE ./
COPY quote_agent/ quote_agent/
RUN pip install --no-cache-dir ".[web]"
COPY fixtures/ fixtures/
COPY --from=web /web/dist web/dist
# the package is installed into site-packages, so point it at the files that live in /app
ENV QUOTE_DESK_ROOT=/app QUOTE_DESK_LOG=/app/data/decisions.demo.jsonl
RUN useradd --create-home desk && mkdir -p /app/data && chown -R desk /app/data
USER desk
EXPOSE 8101
CMD ["uvicorn", "quote_agent.api:app", "--host", "0.0.0.0", "--port", "8101"]
