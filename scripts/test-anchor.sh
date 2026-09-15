#!/usr/bin/env bash
set -euo pipefail

for argument in "$@"; do
  case "$argument" in
    --skip-local-validator|--validator|--validator=*|--provider.cluster|--provider.cluster=*|--provider.url|--provider.url=*)
      echo "error: $argument is fixed for mainnet-backed Surfpool" >&2
      exit 2
      ;;
  esac
done

exec anchor test --validator surfpool "$@"
