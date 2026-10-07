#!/usr/bin/env bash
# Upload images and swap them into Elementor image widgets — nothing else on the page changes.
# Run from the project root (needs .env and the CSV).
#
# CSV (default images/output/swap.csv), header + one row per image widget to replace:
#   slug,page_id,file,title,alt,old_id
#   ai-penetration-testing,990029,images/output/ai-penetration-testing/ai-penetration-testing-feature-img01.webp,AI Penetration Testing Feature Image,AI Penetration Testing Feature Image,9024
# old_id = media ID currently in the widget. No commas inside values.
#
# Usage: swap-images.sh [--csv file] <slug> [<slug> ...]
set -euo pipefail

CSV=images/output/swap.csv
[ "${1:-}" = "--csv" ] && { CSV=$2; shift 2; }
[ $# -gt 0 ] || { echo "Usage: $0 [--csv file] <slug>..."; exit 1; }

# .env is parsed line by line, never sourced (passwords may contain shell characters)
while IFS= read -r l || [ -n "$l" ]; do
  l="${l%$'\r'}"; case "$l" in ''|\#*) continue;; esac
  printf -v "${l%%=*}" '%s' "${l#*=}"
done < .env

TMP=$(mktemp -d); command -v cygpath >/dev/null && TMP=$(cygpath -m "$TMP")  # Windows curl/node need C:/ paths
trap 'rm -rf "$TMP"' EXIT
BK=$(dirname "$CSV")/backups; mkdir -p "$BK"
J="$TMP/cookies.txt"
C=(curl -sS --fail-with-body -u "$BASIC_USER:$BASIC_PASS" -b "$J" -c "$J")
[ -z "${BASIC_USER:-}" ] && C=(curl -sS --fail-with-body -b "$J" -c "$J")  # site without Basic Auth

# Log in once (cookie session; avoids the Basic Auth vs Application Password header clash)
"${C[@]}" -o /dev/null "$SITE/wp-login.php"
"${C[@]}" -o /dev/null -b "wordpress_test_cookie=WP%20Cookie%20check" \
  --data-urlencode "log=$WP_USER" --data-urlencode "pwd=$WP_PASS" \
  -d "wp-submit=Log+In&testcookie=1" "$SITE/wp-login.php"
grep -q wordpress_logged_in "$J" || { echo "Login failed"; exit 1; }
RN=$("${C[@]}" "$SITE/wp-admin/admin-ajax.php?action=rest-nonce")
R=("${C[@]}" -H "X-WP-Nonce: $RN")

# Reuse an existing upload with this slug, else upload with slug = filename, title/alt, attached to the page
media() { # file title alt page_id -> "id url"
  local name; name=$(basename "${1%.*}")
  local found; found=$("${R[@]}" "$SITE/wp-json/wp/v2/media?slug=$name&_fields=id,source_url")
  [ "$found" = "[]" ] && found=$("${R[@]}" -F "file=@$1" -F "slug=$name" -F "title=$2" -F "alt_text=$3" -F "post=$4" \
    "$SITE/wp-json/wp/v2/media?_fields=id,source_url")
  node -e 'let m=JSON.parse(process.argv[1]);m=Array.isArray(m)?m[0]:m;console.log(m.id+" "+m.source_url)' "$found"
}

for slug in "$@"; do
  grep -q "^$slug," "$CSV" || { echo "$slug: not in $CSV"; continue; }
  pid=$(grep -m1 "^$slug," "$CSV" | cut -d, -f2)
  echo "== $slug (page $pid)"

  EN=$("${C[@]}" "$SITE/wp-admin/post.php?post=$pid&action=elementor" \
    | grep -oE '"ajax":\{"url":"https[^}]*"nonce":"[0-9a-f]+"' | grep -oE '[0-9a-f]{10}' | head -1)
  ajax() { "${C[@]}" "$SITE/wp-admin/admin-ajax.php" --data-urlencode "action=elementor_ajax" \
    --data-urlencode "_nonce=$EN" --data-urlencode "editor_post_id=$pid" --data-urlencode "initial_document_id=$pid" \
    --data-urlencode "actions@$1"; }

  echo "{\"get\":{\"action\":\"get_document_config\",\"data\":{\"id\":$pid}}}" > "$TMP/get.json"
  ajax "$TMP/get.json" > "$TMP/doc.json"

  # Skip if none of this page's old images are still in it (already done)
  olds=$(grep "^$slug," "$CSV" | cut -d, -f6 | paste -sd'|')
  if ! grep -qE "\"id\":($olds)[,}]" "$TMP/doc.json"; then echo "   already done, skipped"; continue; fi
  cp "$TMP/doc.json" "$BK/$slug-$(date +%Y%m%d-%H%M%S).json"

  : > "$TMP/map.txt"
  while IFS=, read -r _ _ file title alt old; do
    read -r nid nurl < <(media "$file" "$title" "$alt" "$pid")
    echo "$old $nid $nurl $alt" >> "$TMP/map.txt"
    echo "   $old -> $nid ($(basename "$file"))"
  done < <(grep "^$slug," "$CSV")

  # Swap only settings.image id/url/alt; send original page settings (save_builder resets any not sent)
  node -e '
    const fs=require("fs");const [docf,mapf,out]=process.argv.slice(1);
    const d=JSON.parse(fs.readFileSync(docf)).data.responses.get.data;const els=d.elements,settings=d.settings.settings;
    const map={},n={};for(const l of fs.readFileSync(mapf,"utf8").trim().split("\n")){const [o,id,url,...alt]=l.split(" ");map[o]={id:+id,url,alt:alt.join(" ")};n[o]=0}
    (function walk(a){for(const e of a){const im=e.settings&&e.settings.image;
      if(im&&map[im.id]){n[im.id]++;Object.assign(im,map[im.id])}walk(e.elements||[])}})(els);
    const bad=Object.entries(n).filter(([,c])=>c!==1);
    if(bad.length){console.error("   each old image must be in exactly 1 widget, found:",JSON.stringify(n));process.exit(1)}
    fs.writeFileSync(out,JSON.stringify({save:{action:"save_builder",data:{status:settings.post_status,elements:els,settings}}}))' \
    "$TMP/doc.json" "$TMP/map.txt" "$TMP/save.json"

  ajax "$TMP/save.json" | grep -q '"success":true' || { echo "   SAVE FAILED"; exit 1; }

  # Prove only the images changed: settings identical per key, elements identical except image + render cache
  ajax "$TMP/get.json" > "$TMP/after.json"
  node -e 'const fs=require("fs");const g=f=>JSON.parse(fs.readFileSync(f)).data.responses.get.data;
    const a=g(process.argv[1]),b=g(process.argv[2]);const bad=[];
    const sa=a.settings.settings,sb=b.settings.settings;  // per key: Elementor may reorder keys
    for(const k of new Set([...Object.keys(sa),...Object.keys(sb)]))if(JSON.stringify(sa[k])!==JSON.stringify(sb[k]))bad.push("page setting "+k);
    (function d(x,y,p){if(JSON.stringify(x)===JSON.stringify(y)||/\.(htmlCache|settings\.image)$/.test(p))return;
      if(x&&y&&typeof x=="object"&&typeof y=="object"){for(const k of new Set([...Object.keys(x),...Object.keys(y)]))d(x[k],y[k],p+"."+k);return}
      bad.push(p)})(a.elements,b.elements,"");
    if(bad.length){console.error("   UNEXPECTED CHANGES:",bad.join(", "));process.exit(1)}' "$TMP/doc.json" "$TMP/after.json" \
    || { echo "   STOPPED: backup in $BK"; exit 1; }
  echo "   only images changed (page settings + layout identical)"

  html=$("${C[@]}" "$SITE/$slug/"); ok=1
  while read -r old nid _; do
    grep -q "wp-image-$nid\"" <<<"$html" || ok=0
    grep -q "wp-image-$old\"" <<<"$html" && ok=0
  done < "$TMP/map.txt"
  [ $ok = 1 ] && echo "   verified on front end" || echo "   WARNING: front end not showing all new images yet (cache?)"
done
