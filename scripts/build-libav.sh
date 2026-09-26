#!/usr/bin/env bash
# Rebuilds public/libav/ — the Glass Studio's ProRes 4444 encoder: FFmpeg's
# prores_ks + the QuickTime muxer and nothing else, compiled to WebAssembly by
# libav.js (~1 MB, against ffmpeg.wasm's 32 MB). See src/lib/prores.ts for why.
#
#   scripts/build-libav.sh
#
# Needs python3, node/npm, make, curl, xz. Downloads a prebuilt Emscripten
# toolchain (~300 MB) and libav.js (which bundles the FFmpeg source) into
# $WORK (default: a temp dir). Takes a few minutes.
#
# If libav.js moves to a new FFmpeg major, re-check YUVA444P10LE in prores.ts:
# it is FFmpeg's AVPixelFormat number, and libav.js doesn't export it.
set -euo pipefail

LIBAVJS_VERSION=6.10.9
LIBAVJS_FULL=6.10.9.0 # libav.js version + FFmpeg revision, as it names its files
VARIANT=wtp-prores
FRAGMENTS='["avformat","avcodec","encoder-prores","encoder-prores_ks","muxer-mov"]'

root="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"
cd "$WORK"
echo "working in $WORK"

# Emscripten, as emsdk would install it
if [ ! -x emsdk/install/emscripten/emcc ]; then
  hash=$(curl -fsSL https://raw.githubusercontent.com/emscripten-core/emsdk/main/emscripten-releases-tags.json |
    python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["releases"][d["aliases"]["latest"]])')
  mkdir -p emsdk && cd emsdk
  curl -fL "https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/$hash/wasm-binaries.tar.xz" | tar xJ
  (cd install/emscripten && npm ci --no-audit --no-fund)
  cd ..
fi
cat > emsdk/.emscripten <<EOF
LLVM_ROOT = '$WORK/emsdk/install/bin'
BINARYEN_ROOT = '$WORK/emsdk/install'
NODE_JS = '$(command -v node)'
EOF
export EM_CONFIG="$WORK/emsdk/.emscripten"
export PATH="$WORK/emsdk/install/emscripten:$WORK/emsdk/install/bin:$PATH"

# libav.js ships its build system and the FFmpeg source in the npm tarball
if [ ! -d libavjs ]; then
  npm pack "libav.js@$LIBAVJS_VERSION" >/dev/null
  mkdir -p pkg && tar xzf "libav.js-$LIBAVJS_VERSION.tgz" -C pkg
  mkdir -p libavjs && tar xJf pkg/package/sources/libav.js.tar.xz -C libavjs
  mkdir -p libavjs/build
  cp pkg/package/sources/ffmpeg-*.tar.xz pkg/package/sources/emfiberthreads-*.tar.gz libavjs/build/
fi
cd libavjs
npm ci --no-audit --no-fund
(cd configs && ./mkconfig.js "$VARIANT" "$FRAGMENTS")
make -j"$(nproc)" "dist/libav-$LIBAVJS_FULL-$VARIANT.mjs" "dist/libav-$LIBAVJS_FULL-$VARIANT.wasm.mjs"

mkdir -p "$root/public/libav"
cp "dist/libav-$LIBAVJS_FULL-$VARIANT".{mjs,wasm.mjs,wasm.wasm} "$root/public/libav/"
echo "done: public/libav/"
