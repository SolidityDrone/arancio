#!/usr/bin/env bash
set -euo pipefail

for argument in "$@"; do
  case "$argument" in
    --validator|--validator=*)
      echo "error: --validator is fixed to surfpool" >&2
      exit 2
      ;;
  esac
done

exec anchor test --validator surfpool "$@"
