#!/usr/bin/env node
'use strict';
/**
 * Mine every Divi layout out of a WordPress WXR export and print a
 * human-readable catalog:
 *   - per item: an outline of every section/row/column/module with its
 *     element PATH (what build scripts pass to dvGetByPath) and full attrs;
 *   - a summary of module kinds and instance counts;
 *   - per module kind, every attribute key seen and how often (this site's
 *     real "settings field list" — only write attrs that appear here or in
 *     real Divi/plugin source);
 *   - builder versions, formats, presets, global-module links, image URLs,
 *     and which Divi attribute-encoding tokens (%22 %91 %93 %92) occur.
 *
 * A reading aid for picking real nodes to clone; nothing machine-parses it.
 *
 * Usage:
 *   node mine-divi-data.js <export.xml> --out <catalog.txt> [--max-text 400]
 */

const fs = require('fs');
const {
  dvExtractAllLayouts, dvExtractAttachments, dvMaxPostId, dvDecodeAttr, dvWalk, nodeName,
} = require('./wxr-helpers');

function main() {
  const args = process.argv.slice(2);
  const xmlPath = args[0];
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const maxIdx = args.indexOf('--max-text');
  const maxText = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : 400;

  if (!xmlPath) {
    process.stderr.write('Usage: node mine-divi-data.js <export.xml> --out <catalog.txt> [--max-text 400]\n');
    process.exit(1);
  }

  const layouts = dvExtractAllLayouts(xmlPath);
  if (!layouts.length) {
    process.stderr.write(`No Divi layouts (et_pb_* shortcodes or wp:divi/* blocks) found in ${xmlPath}\n`);
    process.exit(1);
  }

  const lines = [];
  const kindCounts = new Map();
  const attrKeys = new Map(); // kind -> Map(key -> count)
  const versions = new Map();
  const formats = new Map();
  const postTypes = new Map();
  const presets = new Map();
  const globals = [];
  const imageUrls = new Map();
  const encTokens = { '%22': 0, '%91': 0, '%93': 0, '%92': 0, '%5c': 0 };
  let totalNodes = 0;

  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

  for (const l of layouts) {
    bump(formats, l.format);
    bump(postTypes, l.postType);
    for (const tok of Object.keys(encTokens)) encTokens[tok] += l.content.split(tok).length - 1;
    const terms = l.terms.map((t) => `${t.domain}=${t.nicename}`).join(', ');

    lines.push('================================================================');
    lines.push(`LAYOUT: ${l.title}  (post_id=${l.postId}, post_type=${l.postType}, status=${l.status}, format=${l.format})`);
    if (terms) lines.push(`  terms: ${terms}`);
    const etMeta = Object.entries(l.meta).filter(([k]) => /^_et_|^_wp_page_template$/.test(k) && k !== '_et_pb_old_content');
    if (etMeta.length) lines.push(`  meta: ${etMeta.map(([k, v]) => `${k}=${oneLine(v).slice(0, 80)}`).join(' | ')}`);
    lines.push(`  build-script handle: layouts.find(l => l.postId === ${l.postId}).tree`);
    lines.push('================================================================');

    dvWalk(l.tree, (n, p) => {
      totalNodes++;
      const kind = nodeName(n);
      bump(kindCounts, kind);
      if (!attrKeys.has(kind)) attrKeys.set(kind, new Map());
      const depth = '  '.repeat(p.length - 1);

      const attrs = n.kind === 'shortcode' ? n.attrs : flattenJson(n.attrs);
      for (const k of Object.keys(attrs)) bump(attrKeys.get(kind), k);

      const v = attrs._builder_version || attrs.builderVersion;
      if (v) bump(versions, `${kind.startsWith('divi/') ? 'block' : 'shortcode'} ${v}`);
      const preset = attrs._module_preset || attrs['modulePreset'];
      if (preset && preset !== 'default') bump(presets, `${kind}:${preset}`);
      if (attrs.global_module || attrs.globalModule) globals.push(`${l.postId} ${p.join('.')} ${kind} -> global_module=${attrs.global_module || attrs.globalModule}`);

      lines.push(`${depth}#### path=${p.join('.')}  ${kind}  (post_id=${l.postId})`);
      for (const [k, raw] of Object.entries(attrs)) {
        const val = n.kind === 'shortcode' ? dvDecodeAttr(raw) : typeof raw === 'string' ? raw : JSON.stringify(raw);
        lines.push(`${depth}    ${k} = ${JSON.stringify(val)}`);
        const um = /https?:\/\/[^\s"'<>]+\.(png|jpe?g|gif|webp|svg|avif)/i.exec(val);
        if (um) bump(imageUrls, `${kind}.${k}  ${um[0]}`);
      }
      const text = (n.children || []).filter((c) => c.kind === 'text').map((c) => c.text).join('');
      if (text.trim()) {
        const t = oneLine(text);
        lines.push(`${depth}    [content] ${JSON.stringify(t.length > maxText ? t.slice(0, maxText) + ' …' : t)}`);
      }
    });
    lines.push('');
  }

  lines.push('================================================================');
  lines.push('SUMMARY: module kinds (instances)');
  lines.push('================================================================');
  for (const k of [...kindCounts.keys()].sort()) lines.push(`  ${k.padEnd(36)} x${kindCounts.get(k)}`);

  lines.push('');
  lines.push('================================================================');
  lines.push('ATTRIBUTE KEYS SEEN PER KIND (key xcount) — the only attrs proven on this site');
  lines.push('================================================================');
  for (const k of [...attrKeys.keys()].sort()) {
    const keys = [...attrKeys.get(k).entries()].sort((a, b) => b[1] - a[1]);
    if (!keys.length) continue;
    lines.push(`  ${k}:`);
    lines.push('    ' + keys.map(([key, c]) => `${key} x${c}`).join(', '));
  }

  lines.push('');
  lines.push('================================================================');
  lines.push('SITE FACTS');
  lines.push('================================================================');
  lines.push(`  formats: ${[...formats].map(([k, c]) => `${k} x${c}`).join(', ')}`);
  lines.push(`  post types holding Divi content: ${[...postTypes].map(([k, c]) => `${k} x${c}`).join(', ')}`);
  lines.push(`  builder versions: ${[...versions].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `${k} x${c}`).join(', ') || 'n/a'}`);
  lines.push(`  attr-encoding tokens seen: ${Object.entries(encTokens).map(([k, c]) => `${k} x${c}`).join(', ')}`);
  lines.push(`  highest wp:post_id in export: ${dvMaxPostId(xmlPath)}  (pick new ids well above this)`);
  lines.push(`  attachments in export: ${dvExtractAttachments(xmlPath).length}`);
  lines.push(`  module presets in use (_module_preset): ${presets.size ? [...presets].map(([k, c]) => `${k} x${c}`).join(', ') : 'none'}`);
  lines.push(`  global-module links (${globals.length}):`);
  for (const g of globals.slice(0, 50)) lines.push(`    ${g}`);
  lines.push(`  image URLs referenced (${imageUrls.size}):`);
  for (const [u, c] of [...imageUrls].slice(0, 80)) lines.push(`    ${u}  x${c}`);
  lines.push('');
  lines.push(`Total: ${layouts.length} layouts, ${totalNodes} nodes`);

  const output = lines.join('\n') + '\n';
  if (outPath) {
    fs.writeFileSync(outPath, output);
    const kinds = [...kindCounts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, c]) => `${k} x${c}`).join(', ');
    process.stdout.write(`Wrote catalog to ${outPath} (${layouts.length} layouts, ${totalNodes} nodes; formats: ${[...formats.keys()].join(', ')})\nTop kinds: ${kinds}\n`);
  } else {
    process.stdout.write(output);
  }
}

/** Flatten Divi 5 block JSON attrs into dot-path keys so they list like shortcode attrs. */
function flattenJson(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  const keys = Object.keys(obj);
  if (!keys.length && prefix) out[prefix] = {};
  for (const k of keys) flattenJson(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

main();
