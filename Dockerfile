FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# Bibliothèques système requises par OpenCV
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv

# Versions exactes de uv.lock, uniquement depuis des paquets précompilés (aucune compilation)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-build --no-cache

COPY . .

EXPOSE 5000

CMD ["python", "main.py"]
