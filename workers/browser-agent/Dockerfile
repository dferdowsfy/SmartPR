FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    DISPLAY=:99 \
    PIP_NO_CACHE_DIR=1

# Xvfb + x11vnc export the headed Chromium; novnc ships the JS viewer assets
# (served token-gated by the FastAPI app itself).
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb \
      x11vnc \
      novnc \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt ./
RUN pip install -r requirements.txt \
 && python -m playwright install chromium --with-deps

COPY app.py start.sh ./
RUN chmod +x start.sh

EXPOSE 8000
CMD ["./start.sh"]
