#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common-v2.sh
source "${SCRIPT_DIR}/common-v2.sh"

ENV_FILE="${DEFAULT_ENV_FILE}"
while (($# > 0)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || die "--env-file 缺少路径"
      ENV_FILE="$2"
      shift 2
      ;;
    -h|--help)
      printf '用法：backup.sh [--env-file FILE]\n'
      exit 0
      ;;
    *)
      die "未知参数：$1"
      ;;
  esac
done

validate_environment "${ENV_FILE}"
export BACKUP_RUN_UID="${BACKUP_RUN_UID:-$(id -u)}"
export BACKUP_RUN_GID="${BACKUP_RUN_GID:-$(id -g)}"
detect_compose
compose config >/dev/null || die "Compose 配置解析失败"
compose up -d postgres
wait_for_postgres
printf '==> 在隔离的 backup 服务中执行加密备份\n'
compose --profile maintenance run --rm backup
