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

program_id="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync("target/idl/arancio.json", "utf8")).address)')"
address_book="$(node -e 'const {PublicKey}=require("@solana/web3.js"); const p=new PublicKey(process.argv[1]); process.stdout.write(PublicKey.findProgramAddressSync([Buffer.from("address-book")], p)[0].toBase58())' "$program_id")"

export ARANCIO_PROGRAM_ID="$program_id"
export ARANCIO_ADDRESS_BOOK="$address_book"
exec anchor test --validator surfpool "$@"
