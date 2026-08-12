#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

die() {
  printf '备份失败：%s\n' "$*" >&2
  exit 1
}

checksum_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

for name in POSTGRES_HOST POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD BACKUP_ENCRYPTION_PASSPHRASE BACKUP_DIR; do
  [[ -n "${!name:-}" ]] || die "缺少环境变量 ${name}"
done
((${#BACKUP_ENCRYPTION_PASSPHRASE} >= 24)) || die "备份口令至少 24 位"

PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
command -v "${PG_DUMP_BIN}" >/dev/null 2>&1 || die "缺少 pg_dump"
command -v openssl >/dev/null 2>&1 || die "缺少 openssl"
mkdir -p "${BACKUP_DIR}"
chmod 0700 "${BACKUP_DIR}" 2>/dev/null || true

timestamp="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%S)}"
[[ "${timestamp}" =~ ^[0-9]{8}T[0-9]{6}$ ]] || die "BACKUP_TIMESTAMP 格式无效"
base_name="hainan-fttr-${timestamp}.dump.enc"
final_path="${BACKUP_DIR}/${base_name}"
partial_path="${final_path}.partial"
rm -f "${partial_path}"
trap 'rm -f "${partial_path}"' EXIT

export PGPASSWORD="${POSTGRES_PASSWORD}"
export BACKUP_ENCRYPTION_PASSPHRASE
printf '==> 生成 PostgreSQL custom dump 并直接加密\n'
"${PG_DUMP_BIN}" \
  --host "${POSTGRES_HOST}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --format custom \
  --no-owner \
  --no-privileges \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
      -out "${partial_path}"

[[ -s "${partial_path}" ]] || die "加密备份为空"
mv "${partial_path}" "${final_path}"
chmod 0600 "${final_path}"
(
  cd "${BACKUP_DIR}"
  checksum_file "${base_name}" > "${base_name}.sha256"
)
chmod 0600 "${final_path}.sha256"
cat > "${final_path}.meta" <<EOF
format=hainan-fttr-encrypted-pgdump-v1
created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
database=${POSTGRES_DB}
app_version=${APP_VERSION:-unknown}
cipher=aes-256-cbc
kdf=pbkdf2-sha256
kdf_iterations=200000
EOF
chmod 0600 "${final_path}.meta"

retention_days="${BACKUP_RETENTION_DAYS:-30}"
[[ "${retention_days}" =~ ^[0-9]{1,4}$ ]] || die "BACKUP_RETENTION_DAYS 格式无效"
if ((10#${retention_days} >= 1)); then
  while IFS= read -r expired; do
    rm -f "${expired}" "${expired}.sha256" "${expired}.meta"
  done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'hainan-fttr-*.dump.enc' -mtime "+${retention_days}" -print)
fi

printf 'BACKUP_FILE=%s\n' "${final_path}"
printf 'BACKUP_CHECKSUM=%s\n' "${final_path}.sha256"
