#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

command -v pnpm >/dev/null 2>&1 || {
  echo "错误：未找到 pnpm，请先安装项目要求的 pnpm。" >&2
  exit 1
}
command -v openssl >/dev/null 2>&1 || {
  echo "错误：未找到 openssl，无法生成本地测试密钥。" >&2
  exit 1
}

LOCAL_DIR="${LOCAL_TEST_DIR:-$ROOT_DIR/.local}"
SQLITE_PATH="${SQLITE_PATH:-$LOCAL_DIR/acceptance.sqlite}"
ACCEPTANCE_PASSWORD="${ACCEPTANCE_PASSWORD:-11223344}"
KEY_FILE="$LOCAL_DIR/test-keys"

find_free_port() {
  node -e '
    const net = require("node:net");
    const start = Number(process.argv[1]);
    const probe = (port) => {
      const server = net.createServer();
      server.once("error", () => probe(port + 1));
      server.listen({ host: "127.0.0.1", port }, () => {
        server.close(() => process.stdout.write(String(port)));
      });
    };
    probe(start);
  ' "$1"
}

API_PORT="${PORT:-$(find_free_port 3001)}"
WEB_PORT="${VITE_PORT:-$(find_free_port 5173)}"

mkdir -p "$LOCAL_DIR"

if [[ -f "$KEY_FILE" ]]; then
  SAVED_ENCRYPTION_KEY=""
  SAVED_LOOKUP_KEY=""
  {
    IFS= read -r SAVED_ENCRYPTION_KEY || true
    IFS= read -r SAVED_LOOKUP_KEY || true
  } < "$KEY_FILE"
  PII_ENCRYPTION_KEY_BASE64="${PII_ENCRYPTION_KEY_BASE64:-$SAVED_ENCRYPTION_KEY}"
  PII_LOOKUP_HMAC_KEY_BASE64="${PII_LOOKUP_HMAC_KEY_BASE64:-$SAVED_LOOKUP_KEY}"
fi
PII_ENCRYPTION_KEY_BASE64="${PII_ENCRYPTION_KEY_BASE64:-$(openssl rand -base64 32)}"
PII_LOOKUP_HMAC_KEY_BASE64="${PII_LOOKUP_HMAC_KEY_BASE64:-$(openssl rand -base64 32)}"
if [[ ! -f "$KEY_FILE" ]]; then
  umask 077
  printf '%s\n%s\n' "$PII_ENCRYPTION_KEY_BASE64" "$PII_LOOKUP_HMAC_KEY_BASE64" > "$KEY_FILE"
fi

export NODE_ENV="${NODE_ENV:-development}"
export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:${WEB_PORT}}"
export APP_BASE_PATH="${APP_BASE_PATH:-/}"
export HOST="${HOST:-127.0.0.1}"
export PORT="$API_PORT"
export VITE_PORT="$WEB_PORT"
export VITE_API_PORT="$API_PORT"
export SQLITE_PATH
export ACCEPTANCE_SQLITE_PATH="$SQLITE_PATH"
export ACCEPTANCE_PASSWORD
export PII_ENCRYPTION_KEY_BASE64
export PII_LOOKUP_HMAC_KEY_BASE64
export VITE_BASE_PATH="${VITE_BASE_PATH:-$APP_BASE_PATH}"

echo "初始化本地验收数据库：$SQLITE_PATH"
pnpm db:seed:acceptance

cat <<INFO

本地测试服务即将启动：
  Web: http://127.0.0.1:${WEB_PORT}${APP_BASE_PATH%/}
  API: http://127.0.0.1:${API_PORT}/api/health
  测试账号：admin、manage、sale、regional、hr、finance
  测试密码：${ACCEPTANCE_PASSWORD}

按 Ctrl+C 可同时停止 Web 和 API。
INFO

exec pnpm dev
