#!/usr/bin/env bash
# Dev checkout: starts Slop Academy on http://localhost:8795 with this folder's data/ (SLOP_MODEL=haiku for faster, cheaper grading).
# Installed users run `npx slop-academy` instead, which keeps data in ~/.slop-academy.
cd "$(dirname "$0")" && SLOP_DATA="${SLOP_DATA:-$PWD/data}" SLOP_MODELS="${SLOP_MODELS:-$HOME/.slop-academy/models}" exec node bin/slop-academy.mjs --no-open "$@"
