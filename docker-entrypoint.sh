#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="/app/data"
UPLOADS_DIR="${DATA_DIR}/uploads"

TARGET_UID="${AOOSTAR_UID:-${PUID:-1000}}"
TARGET_GID="${AOOSTAR_GID:-${PGID:-1000}}"

if ! [[ "$TARGET_UID" =~ ^[0-9]+$ ]] || ! [[ "$TARGET_GID" =~ ^[0-9]+$ ]]; then
  echo "[aoostar-entrypoint] ERROR: AOOSTAR_UID ('${TARGET_UID}') and AOOSTAR_GID ('${TARGET_GID}') must be numeric IDs." >&2
  exit 1
fi

if [[ "$TARGET_UID" -eq 0 ]] || [[ "$TARGET_GID" -eq 0 ]]; then
  echo "[aoostar-entrypoint] ERROR: Refusing to run application as UID/GID 0 (root)." >&2
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  set -- node dist-server/server.mjs
fi

# If container was started explicitly as a non-root UID (e.g. --user), verify writability and exec directly.
if [[ "$(id -u)" -ne 0 ]]; then
  if ! mkdir -p "$DATA_DIR" "$UPLOADS_DIR" 2>/dev/null || ! [[ -w "$DATA_DIR" && -w "$UPLOADS_DIR" ]]; then
    echo "[aoostar-entrypoint] ERROR: Running as UID $(id -u) without write permission on ${DATA_DIR}." >&2
    exit 1
  fi
  exec "$@"
fi

# Ensure required runtime directories exist.
if ! mkdir -p "$DATA_DIR" "$UPLOADS_DIR"; then
  echo "[aoostar-entrypoint] ERROR: Failed to create ${DATA_DIR} or ${UPLOADS_DIR}." >&2
  exit 1
fi

# Repair ownership only for /app/data entries whose UID/GID does not match TARGET_UID:TARGET_GID.
if find "$DATA_DIR" \( ! -uid "$TARGET_UID" -o ! -gid "$TARGET_GID" \) -print -quit 2>/dev/null | grep -q .; then
  echo "[aoostar-entrypoint] WARNING: Repairing ownership of mismatched entries in ${DATA_DIR} to ${TARGET_UID}:${TARGET_GID}" >&2
  if ! find "$DATA_DIR" \( ! -uid "$TARGET_UID" -o ! -gid "$TARGET_GID" \) -exec chown -h "${TARGET_UID}:${TARGET_GID}" {} +; then
    echo "[aoostar-entrypoint] ERROR: Failed to repair ownership of ${DATA_DIR} to ${TARGET_UID}:${TARGET_GID}." >&2
    exit 1
  fi
fi

# Guarantee owner rwx on data directories without loosening 0600 file permissions inside /app/data.
if ! chmod u+rwx "$DATA_DIR" "$UPLOADS_DIR"; then
  echo "[aoostar-entrypoint] ERROR: Failed to ensure permissions on ${DATA_DIR} or ${UPLOADS_DIR}." >&2
  exit 1
fi

# Preserve supplementary groups passed by Docker (e.g. --group-add=20) and host serial device GIDs when dropping privileges via gosu.
EXTRA_GIDS="$(id -G)"
TARGET_USER=""

if [[ "$TARGET_UID" -eq 1000 ]] && [[ "$TARGET_GID" -eq 1000 ]]; then
  if getent passwd node >/dev/null 2>&1; then
    TARGET_USER="node"
  fi
fi

if [[ -z "$TARGET_USER" ]]; then
  EXISTING_GROUP="$(getent group "$TARGET_GID" | cut -d: -f1 || true)"
  if [[ -z "$EXISTING_GROUP" ]]; then
    groupadd -g "$TARGET_GID" aoostar >/dev/null 2>&1 || true
  fi
  EXISTING_USER="$(getent passwd "$TARGET_UID" | cut -d: -f1 || true)"
  if [[ -z "$EXISTING_USER" ]]; then
    if useradd -M -N -u "$TARGET_UID" -g "$TARGET_GID" -s /usr/sbin/nologin aoostar >/dev/null 2>&1; then
      TARGET_USER="aoostar"
    fi
  else
    TARGET_USER="$EXISTING_USER"
    usermod -g "$TARGET_GID" "$TARGET_USER" >/dev/null 2>&1 || true
  fi
fi

add_supplementary_gid() {
  local gid="$1"
  if [[ -z "$TARGET_USER" ]] || ! [[ "$gid" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  if [[ "$gid" -eq 0 ]] || [[ "$gid" -eq "$TARGET_GID" ]]; then
    return 0
  fi
  local grp_name
  grp_name="$(getent group "$gid" | cut -d: -f1 || true)"
  if [[ -z "$grp_name" ]]; then
    grp_name="aoostar_grp_${gid}"
    groupadd -g "$gid" "$grp_name" >/dev/null 2>&1 || true
    grp_name="$(getent group "$gid" | cut -d: -f1 || true)"
  fi
  if [[ -n "$grp_name" ]]; then
    usermod -a -G "$grp_name" "$TARGET_USER" >/dev/null 2>&1 || true
  fi
}

SERIAL_DEVS=()
for dev in /dev/aoostar_lcd /dev/ttyACM* /dev/ttyUSB*; do
  if [[ -e "$dev" ]]; then
    real_dev="$(readlink -f "$dev" 2>/dev/null || echo "$dev")"
    if [[ -c "$real_dev" ]]; then
      SERIAL_DEVS+=("$real_dev")
    fi
  fi
done

if [[ -n "$TARGET_USER" ]] && getent passwd "$TARGET_USER" >/dev/null 2>&1; then
  for gid in $EXTRA_GIDS; do
    add_supplementary_gid "$gid"
  done
  usermod -a -G dialout "$TARGET_USER" >/dev/null 2>&1 || true
  if [[ ${#SERIAL_DEVS[@]} -gt 0 ]]; then
    for real_dev in "${SERIAL_DEVS[@]}"; do
      dev_gid="$(stat -c '%g' "$real_dev" 2>/dev/null || true)"
      add_supplementary_gid "$dev_gid"
    done
  fi
  GOSU_SPEC="$TARGET_USER"
else
  GOSU_SPEC="${TARGET_UID}:${TARGET_GID}"
fi

if [[ ${#SERIAL_DEVS[@]} -gt 0 ]]; then
  for real_dev in "${SERIAL_DEVS[@]}"; do
    if ! gosu "$GOSU_SPEC" test -r "$real_dev" || ! gosu "$GOSU_SPEC" test -w "$real_dev"; then
      echo "[aoostar-entrypoint] WARNING: Adjusting container serial device ${real_dev} group/mode for UID/GID ${TARGET_UID}:${TARGET_GID} access" >&2
      chgrp "$TARGET_GID" "$real_dev" 2>/dev/null || true
      chmod g+rw "$real_dev" 2>/dev/null || true
      if ! gosu "$GOSU_SPEC" test -r "$real_dev" || ! gosu "$GOSU_SPEC" test -w "$real_dev"; then
        echo "[aoostar-entrypoint] WARNING: Serial device ${real_dev} is still not R/W for ${GOSU_SPEC}; serial writes may fail." >&2
      fi
    fi
  done
fi

if ! gosu "$GOSU_SPEC" test -w "$DATA_DIR" || ! gosu "$GOSU_SPEC" test -w "$UPLOADS_DIR"; then
  echo "[aoostar-entrypoint] ERROR: ${DATA_DIR} is not writable by ${TARGET_UID}:${TARGET_GID} after repair." >&2
  exit 1
fi

exec gosu "$GOSU_SPEC" "$@"
