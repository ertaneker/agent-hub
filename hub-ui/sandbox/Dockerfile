# Agent Hub sandbox imajı: agent'ın komutları (Bash) bu konteynerde çalışır.
# Yalnızca bağlanan klasörleri (çalışma kopyası, notlar) görür; ana bilgisayarın dosyalarına, anahtarlarına erişemez.
FROM node:22-bookworm-slim
ARG CLAUDE_VERSION=2.1.299
RUN apt-get update && apt-get install -y --no-install-recommends \
      git subversion python3 python3-pip ca-certificates curl ripgrep procps jq unzip \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_VERSION} && npm cache clean --force
USER node
ENV HOME=/home/node CLAUDE_CONFIG_DIR=/home/node/.claude
WORKDIR /work
