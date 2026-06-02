FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PDF2ZH_DATA_DIR=/data \
    PDF2ZH_BIN=pdf2zh \
    PDF2ZH_MAX_UPLOAD_MB=120 \
    PDF2ZH_TIMEOUT_SECONDS=3600

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-noto-cjk \
    fonts-droid-fallback \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app.py ./

RUN mkdir -p /data/jobs

EXPOSE 8080

CMD ["python", "app.py"]
