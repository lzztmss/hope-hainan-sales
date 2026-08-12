#!/usr/bin/env bash

set -Eeuo pipefail

die() {
  printf '恢复失败：%s\n' "$*" >&2
  exit 1
}

checksum_verify() {
  local file="$1"
  local directory name
  directory="$(cd "$(dirname "${file}")" && pwd)"
  name="$(basename "${file}")"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "${directory}" && sha256sum -c "${name}.sha256" >/dev/null)
  else
    (cd "${directory}" && shasum -a 256 -c "${name}.sha256" >/dev/null)
  fi
}

for name in BACKUP_FILE BACKUP_ENCRYPTION_PASSPHRASE POSTGRES_HOST POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD STAGING_DATABASE; do
  [[ -n "${!name:-}" ]] || die "缺少环境变量 ${name}"
done
[[ -f "${BACKUP_FILE}" ]] || die "找不到备份 ${BACKUP_FILE}"
[[ -f "${BACKUP_FILE}.sha256" ]] || die "备份缺少 ${BACKUP_FILE}.sha256"
[[ "${POSTGRES_DB}" =~ ^[A-Za-z][A-Za-z0-9_]{2,62}$ ]] || die "POSTGRES_DB 格式无效"
[[ "${STAGING_DATABASE}" =~ ^[A-Za-z][A-Za-z0-9_]{2,62}$ ]] || die "STAGING_DATABASE 格式无效"
[[ "${STAGING_DATABASE}" != "${POSTGRES_DB}" ]] || die "staging 库不得与生产库同名"
((${#BACKUP_ENCRYPTION_PASSPHRASE} >= 24)) || die "备份口令至少 24 位"

CREATEDB_BIN="${CREATEDB_BIN:-createdb}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
PSQL_BIN="${PSQL_BIN:-psql}"
for binary in "${CREATEDB_BIN}" "${PG_RESTORE_BIN}" "${PSQL_BIN}" openssl; do
  command -v "${binary}" >/dev/null 2>&1 || die "缺少命令 ${binary}"
done

export PGPASSWORD="${POSTGRES_PASSWORD}"
export BACKUP_ENCRYPTION_PASSPHRASE
psql_base=("${PSQL_BIN}" --host "${POSTGRES_HOST}" --username "${POSTGRES_USER}" --no-psqlrc --set ON_ERROR_STOP=1)

query_scalar() {
  local database="$1"
  local query="$2"
  "${psql_base[@]}" --dbname "${database}" --tuples-only --no-align --command "${query}" | tr -d '[:space:]'
}

run_invariants() {
  local database="$1"
  local query result
  queries=(
    "SELECT count(*) FROM (SELECT quote_id FROM orders GROUP BY quote_id HAVING count(*) > 1) broken"
    "SELECT count(*) FROM (SELECT o.id FROM orders o LEFT JOIN order_attributions a ON a.order_id=o.id GROUP BY o.id HAVING COALESCE(sum(a.basis_points),0) <> 10000) broken"
    "SELECT count(*) FROM (SELECT s.id FROM order_commission_snapshots s LEFT JOIN commission_ledger l ON l.snapshot_id=s.id AND l.entry_type='accrual' GROUP BY s.id,s.total_fen HAVING COALESCE(sum(l.amount_fen),0) <> s.total_fen) broken"
    "SELECT count(*) FROM (SELECT ri.order_line_id FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE r.status='completed' GROUP BY ri.order_line_id HAVING sum(ri.quantity) > max(ri.order_line_quantity)) broken"
    "SELECT count(*) FROM (SELECT ledger_entry_id FROM settlement_items GROUP BY ledger_entry_id HAVING count(*) > 1) broken"
    "SELECT count(*) FROM orders o WHERE o.catalog_snapshot IS NULL OR o.customer_snapshot IS NULL OR o.quote_snapshot IS NULL OR o.store_snapshot IS NULL OR o.seller_snapshot IS NULL"
  )
  for query in "${queries[@]}"; do
    result="$(query_scalar "${database}" "${query}")"
    [[ "${result}" == "0" ]] || die "staging 数据一致性检查未通过（异常数 ${result:-unknown}）"
  done
}

checksum_verify "${BACKUP_FILE}" || die "备份 SHA-256 验证失败"

existing="$(query_scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${STAGING_DATABASE}'")"
[[ "${existing}" == "0" ]] || die "staging 库 ${STAGING_DATABASE} 已存在；恢复必须使用全新空库"

printf '==> 创建空白 staging 数据库 %s\n' "${STAGING_DATABASE}"
"${CREATEDB_BIN}" --host "${POSTGRES_HOST}" --username "${POSTGRES_USER}" --template template0 --encoding UTF8 "${STAGING_DATABASE}"

printf '==> 解密并恢复到 staging\n'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
  -in "${BACKUP_FILE}" \
  | "${PG_RESTORE_BIN}" \
      --host "${POSTGRES_HOST}" \
      --username "${POSTGRES_USER}" \
      --dbname "${STAGING_DATABASE}" \
      --no-owner \
      --no-privileges \
      --exit-on-error

printf '==> 对 staging 执行数据一致性检查\n'
run_invariants "${STAGING_DATABASE}"

if [[ -z "${CONFIRM_PRODUCTION_OVERWRITE:-}" ]]; then
  printf 'PASS: staging 恢复与一致性检查通过：%s\n' "${STAGING_DATABASE}"
  printf '生产库 %s 未被修改。\n' "${POSTGRES_DB}"
  exit 0
fi

[[ "${CONFIRM_PRODUCTION_OVERWRITE}" == "${POSTGRES_DB}" ]] ||
  die "显式确认值必须等于生产库名 ${POSTGRES_DB}"

archive_database="${POSTGRES_DB}_before_restore_$(date -u +%Y%m%dT%H%M%S)"
[[ "${archive_database}" =~ ^[A-Za-z][A-Za-z0-9_]{2,62}$ ]] || die "旧库归档名过长，请缩短 POSTGRES_DB"
printf '==> 保留旧生产库为 %s 并原子切换 staging\n' "${archive_database}"
"${psql_base[@]}" --dbname postgres --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${POSTGRES_DB}','${STAGING_DATABASE}') AND pid <> pg_backend_pid();" >/dev/null
"${psql_base[@]}" --dbname postgres --command "ALTER DATABASE \"${POSTGRES_DB}\" RENAME TO \"${archive_database}\";"
if ! "${psql_base[@]}" --dbname postgres --command "ALTER DATABASE \"${STAGING_DATABASE}\" RENAME TO \"${POSTGRES_DB}\";"; then
  "${psql_base[@]}" --dbname postgres --command "ALTER DATABASE \"${archive_database}\" RENAME TO \"${POSTGRES_DB}\";" || true
  die "新库切换失败，已尝试恢复旧库名"
fi
run_invariants "${POSTGRES_DB}"
printf 'PASS: 生产库已切换；旧库保留为 %s，请等待业务验收后再人工处理。\n' "${archive_database}"
