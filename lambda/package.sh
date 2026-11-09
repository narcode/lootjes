#!/bin/sh
# Collect everything Lambda needs in lambda/dist/, which `sam deploy` uploads.
set -e
cd "$(dirname "$0")/.."

if [ ! -f lambda/config.json ]; then
  echo "lambda/config.json is missing. Run: node scripts/make-lambda-config.mjs <links-file>" >&2
  exit 1
fi

./build.sh
rm -rf lambda/dist
mkdir lambda/dist
cp lambda/index.mjs lambda/handler.mjs lambda/access.mjs lambda/lists.mjs lambda/s3-store.mjs \
   lambda/config.json web/lootjes.wasm lambda/dist/
# Lambda has no package.json here, so the .mjs extension is what marks this as an ES module.
cp web/wasm.js lambda/dist/wasm.mjs
echo "Packaged in lambda/dist/"
