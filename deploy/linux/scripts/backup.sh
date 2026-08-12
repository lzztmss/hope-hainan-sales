#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-v2.sh
source "${SCRIPT_DIR}/common-v2.sh"

ENV_FILE="${DEFAULT_ENV_FILE}"
if [[ "${1:-}" == "--env-file" ]]; then
  (($# >= 2)) || die "--env-file 缺少路径"
  ENV_FILE="$2"
  shift 2
fi
(($# == 0)) || die "未知参数：$1"

validate_environment "${ENV_FILE}"
detect_compose
mkdir -p "${DEPLOY_ROOT}/backups"
chmod 0700 "${DEPLOY_ROOT}/backups"
printf '==> 执行 SQLite 在线一致性备份与完整性检查\n'
compose --profile maintenance run --rm backup
