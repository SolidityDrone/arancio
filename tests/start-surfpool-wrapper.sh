#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
temporary_directory=$(mktemp -d)
surfpool_called="$temporary_directory/surfpool-called"
fake_surfpool_directory="$temporary_directory/bin"
mkdir -p "$fake_surfpool_directory"
trap 'rm -rf "$temporary_directory"' EXIT

cat >"$fake_surfpool_directory/surfpool" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$SURFPOOL_CALLED"
EOF
chmod +x "$fake_surfpool_directory/surfpool"

isolated_database="$temporary_directory/config.sqlite"
PATH="$fake_surfpool_directory:$PATH" \
  SURFPOOL_CALLED="$surfpool_called" \
  ARANCIO_SURFPOOL_DB="$isolated_database" \
  "$repository_root/scripts/start-surfpool.sh"

set -- $(<"$surfpool_called")
