#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
temporary_directory=$(mktemp -d)
anchor_called="$temporary_directory/anchor-called"
fake_anchor_directory="$temporary_directory/bin"
mkdir -p "$fake_anchor_directory"
trap 'rm -rf "$temporary_directory"' EXIT

cat >"$fake_anchor_directory/anchor" <<'EOF'
#!/usr/bin/env bash
touch "$ANCHOR_CALLED"
exit 99
EOF
chmod +x "$fake_anchor_directory/anchor"

for argument in \
  --skip-local-validator \
  --validator \
  --validator=localnet \
  --provider.cluster \
  --provider.cluster=devnet \
  --provider.url \
  --provider.url=https://example.invalid; do
  set +e
  output=$(
    PATH="$fake_anchor_directory:$PATH" \
      ANCHOR_CALLED="$anchor_called" \
      "$repository_root/scripts/test-anchor.sh" "$argument" 2>&1
  )
  status=$?
  set -e

  test "$status" -eq 2
  test ! -e "$anchor_called"
  test -n "$output"
done
