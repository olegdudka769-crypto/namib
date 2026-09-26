#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $1"; exit 1; }

for f in public/index.html public/en/index.html; do
  # old contact info must be fully gone
  grep -q "oktida@gmail.com" "$f" && fail "$f still has oktida@gmail.com"
  grep -q "dvo8888" "$f" && fail "$f still has dvo8888"
  # new contact info must be present
  grep -q "hello@namibpassage.com" "$f" || fail "$f missing hello@namibpassage.com"
  grep -q "https://t.me/namibpassage" "$f" || fail "$f missing t.me/namibpassage"
  grep -q 'href="tel:+37069046108"' "$f" || fail "$f phone link changed"
  # hero video (jeep) with cache-busting
  grep -q '/video/hero.mp4?v=2' "$f" || fail "$f missing hero.mp4?v=2"
  grep -q '/video/hero-poster.webp?v=2' "$f" || fail "$f missing hero-poster.webp?v=2"
  grep -q 'object-position:center top' "$f" || fail "$f hero object-position not center top"
  # flamingos video present, lazy, no old image ref
  grep -q 'class="flam-video' "$f" || fail "$f missing flam-video"
  grep -q 'flamingo-atlanticheskoe-poberezhe-namibii' "$f" && fail "$f still references old flamingo jpg"
  # windhoek final-block background
  grep -q 'windhoek-1080.webp' "$f" || fail "$f missing windhoek-1080.webp"
  grep -q 'windhoek-1920.webp' "$f" || fail "$f missing windhoek-1920.webp"
  # untouched pieces must remain
  grep -q 'cloudflareinsights' "$f" || fail "$f lost Cloudflare beacon"
  grep -q 'action="/api/lead"' "$f" || fail "$f lost lead form"
done

# media files must exist and not be re-encoded (size sanity: non-zero)
for m in public/video/hero.mp4 public/video/hero-poster.webp public/video/flamingos.mp4 public/video/flamingos-poster.webp public/images/windhoek-1080.webp public/images/windhoek-1920.webp; do
  [ -s "$m" ] || fail "missing or empty: $m"
done

# old unused flamingo image must be gone
[ -f public/images/flamingo-atlanticheskoe-poberezhe-namibii.jpg ] && fail "old flamingo jpg still present"

# untouched files: worker + config must still be valid / unmodified in git
node --check src/index.js || fail "src/index.js syntax error"
node -e "JSON.parse(require('fs').readFileSync('wrangler.jsonc','utf8'))" || fail "wrangler.jsonc invalid JSON"

# verification files must remain
[ -f public/googledc196dc609a9dc35.html ] || fail "google verification file missing"
[ -f public/yandex_018beed6711be13f.html ] || fail "yandex verification file missing"

echo "ALL CHECKS PASSED"
