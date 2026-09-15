#!/usr/bin/env bash
set -euo pipefail

exec anchor test --validator surfpool "$@"
