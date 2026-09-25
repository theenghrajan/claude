#!/usr/bin/env node
'use strict';
/**
 * Mine every block-editor item out of a WordPress WXR export and print a
 * human-readable catalog:
 *   - per item: an outline of every block with its PATH (what build scripts
 *     pass to beGetByPath), its comment attrs, and (truncated) own HTML;
 *   - block names and instance counts, split core vs third-party namespace;
 *   - per block, every attr key seen (flattened: style.spacing.padding.top);
 *   - SITE FACTS: WordPress version, block theme (FSE) or not + theme slug,
 *     preset slugs used (colors, font sizes, spacing), global styles,
 *     synced-pattern refs, image URLs, highest post id.
 *
 * A reading aid for picking real blocks to clone; nothing machine-parses it.
 *
 * Usage: node mine-block-data.js <export.xml> --out <catalog.txt> [--max-text 300]
 */

const fs = require('fs');
const {
  beExtractAllContent, beExtractGlobalStyles, beExtractAttachments, beExtractSiteHeader, beMaxPostId, beWalk,
} = require('./wxr-helpers');

function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  for (const k of Object.keys(obj)) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const xmlPath = args[0];
  const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const maxText = args.includes('--max-text') ? parseInt(args[args.indexOf('--max-text') + 1], 10) : 300;
  if (!xmlPath) {
    process.stderr.write('Usage: node mine-block-data.js <export.xml> --out <catalog.txt> [--max-text 300]\n');
    process.exit(1);
  }

  const items = beExtractAllContent(xmlPath);
  if (!items.length) {
    process.stderr.write(`No block-editor content (<!-- wp:… --> markup) found in ${xmlPath}\n`);
    process.exit(1);
  }
  const header = beExtractSiteHeader(xmlPath);

  const lines = [];
  const counts = new Map();
  const attrKeys = new Map();
  const postTypes = new Map();
  const presets = new Map();
  const themes = new Set();
  const refs = [];
  const images = new Map();
  let total = 0;
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

  for (const it of items) {
    bump(postTypes, it.postType);
    for (const t of it.terms) if (t.domain === 'wp_theme') themes.add(t.nicename);
    for (const m of it.content.matchAll(/has-([a-z0-9-]+?)-(color|background-color|font-size|gradient-background|border-color)\b/g)) {
      if (!['text', 'link', 'border', 'background'].includes(m[1])) bump(presets, `${m[2]}: ${m[1]}`);
    }
    for (const m of it.content.matchAll(/var:preset\|([a-z-]+)\|([a-z0-9-]+)/g)) bump(presets, `${m[1]}: ${m[2]}`);

    lines.push('================================================================');
    lines.push(`ITEM: ${it.title}  (post_id=${it.postId}, post_type=${it.postType}, status=${it.status}, slug=${it.postName})`);
    const terms = it.terms.map((t) => `${t.domain}=${t.nicename}`).join(', ');
    if (terms) lines.push(`  terms: ${terms}`);
    const meta = Object.entries(it.meta).filter(([k]) => /^(wp_pattern_sync_status|_wp_page_template|footnotes)$/.test(k));
    if (meta.length) lines.push(`  meta: ${meta.map(([k, v]) => `${k}=${oneLine(v).slice(0, 80)}`).join(' | ')}`);
    lines.push(`  build-script handle: items.find(i => i.postId === ${it.postId}).tree`);
    lines.push('================================================================');

    beWalk(it.tree, (n, p) => {
      total++;
      bump(counts, n.name);
      if (!attrKeys.has(n.name)) attrKeys.set(n.name, new Map());
      const flat = flatten(n.attrs);
      for (const k of Object.keys(flat)) bump(attrKeys.get(n.name), k);
      if (n.attrs.ref) refs.push(`${it.postId} ${p.join('.')} ${n.name} ref=${n.attrs.ref}`);
      const depth = '  '.repeat(p.length - 1);
      lines.push(`${depth}#### path=${p.join('.')}  ${n.name}${n.selfClosing ? ' (void)' : ''}  (post_id=${it.postId})`);
      if (Object.keys(n.attrs).length) lines.push(`${depth}    attrs ${JSON.stringify(n.attrs)}`);
      const own = n.children.filter((c) => c.kind === 'text').map((c) => c.text).join(' … ');
      if (own.trim()) {
        const t = oneLine(own);
        lines.push(`${depth}    html  ${t.length > maxText ? t.slice(0, maxText) + ' …' : t}`);
        for (const m of own.matchAll(/https?:\/\/[^\s"'<>()]+\.(png|jpe?g|gif|webp|svg|avif)/gi)) bump(images, `${n.name}  ${m[0]}`);
      }
    });
    lines.push('');
  }

  const section = (title) => lines.push('', '================================================================', title, '================================================================');
  section('SUMMARY: block names (instances) — core first, then third-party namespaces');
  const names = [...counts.keys()].sort((a, b) => (a.includes('/') - b.includes('/')) || a.localeCompare(b));
  for (const k of names) lines.push(`  ${k.padEnd(40)} x${counts.get(k)}`);

  section('ATTRIBUTE KEYS SEEN PER BLOCK (key xcount) — proven on this site');
  for (const k of names) {
    const keys = [...attrKeys.get(k).entries()].sort((a, b) => b[1] - a[1]);
    if (keys.length) lines.push(`  ${k}:`, '    ' + keys.map(([key, c]) => `${key} x${c}`).join(', '));
  }

  section('SITE FACTS');
  const fse = postTypes.has('wp_template') || postTypes.has('wp_template_part') || themes.size > 0;
  lines.push(`  WordPress version (export generator): ${header.wp_version || 'unknown'}`);
  lines.push(`  block theme / FSE: ${fse ? 'yes' : 'no evidence (no wp_template/wp_template_part in export — classic theme, or templates never customized)'}`);
  lines.push(`  theme slug(s) from wp_theme terms: ${[...themes].join(', ') || 'none — ask the user if building a template'}`);
  lines.push(`  post types holding blocks: ${[...postTypes].map(([k, c]) => `${k} x${c}`).join(', ')}`);
  lines.push(`  third-party block namespaces: ${[...new Set(names.filter((n) => n.includes('/') && !n.startsWith('core/')).map((n) => n.split('/')[0]))].join(', ') || 'none'}`);
  lines.push(`  preset slugs used in content:`);
  for (const [k, c] of [...presets].sort()) lines.push(`    ${k}  x${c}`);
  const gs = beExtractGlobalStyles(xmlPath);
  lines.push(`  global styles posts (user customizations to theme.json): ${gs.length}`);
  for (const g of gs) lines.push(`    post_id=${g.postId} ${g.terms.map((t) => `${t.domain}=${t.nicename}`).join(', ')}  ${oneLine(g.json).slice(0, 600)}`);
  lines.push(`  highest wp:post_id: ${beMaxPostId(xmlPath)}  (pick new ids well above this)`);
  lines.push(`  attachments in export: ${beExtractAttachments(xmlPath).length}`);
  lines.push(`  cross-post refs (synced patterns, navigation, template parts) (${refs.length}):`);
  for (const r of refs.slice(0, 50)) lines.push(`    ${r}`);
  lines.push(`  image URLs referenced (${images.size}):`);
  for (const [u, c] of [...images].slice(0, 80)) lines.push(`    ${u}  x${c}`);
  lines.push('', `Total: ${items.length} items, ${total} blocks`);

  const output = lines.join('\n') + '\n';
  if (outPath) {
    fs.writeFileSync(outPath, output);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, c]) => `${k} x${c}`).join(', ');
    process.stdout.write(`Wrote catalog to ${outPath} (${items.length} items, ${total} blocks; WP ${header.wp_version || '?'}; FSE: ${fse ? 'yes' : 'no'})\nTop blocks: ${top}\n`);
  } else {
    process.stdout.write(output);
  }
}

main();
