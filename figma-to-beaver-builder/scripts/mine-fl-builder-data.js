#!/usr/bin/env node
'use strict';
/**
 * Mine every fl-builder-template's `_fl_builder_data` tree out of a
 * WordPress WXR export and print a human-readable catalog: every real
 * row/column-group/column/module node found, plus a summary of module
 * kinds (settings->type) and instance counts.
 *
 * This is a reading aid for deciding which real node to clone as a
 * template in a build-*.js script — it is not machine-parsed by anything.
 * Node.js port of the original mine-fl-builder-data.php (this machine has
 * no PHP CLI); output format is equivalent, not byte-identical, to the
 * historical PHP var_export() dump.
 *
 * Usage:
 *   node mine-fl-builder-data.js <export.xml> --out <catalog.txt>
 */

const fs = require('fs');
const path = require('path');
const { flExtractAllTemplates, stdClass } = require('./wxr-helpers');

function dumpValue(value, indent) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);

  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  const isStd = value instanceof stdClass;
  const keys = Object.keys(value);
  const open = isStd ? '(object) array(' : 'array (';
  if (keys.length === 0) return open + '\n' + pad + '),';

  let out = open + '\n';
  for (const k of keys) {
    const v = value[k];
    const nested = v !== null && typeof v === 'object';
    out += padIn + `'${k}' => ` + (nested ? '\n' + padIn : '') + dumpValue(v, indent + 1) + '\n';
  }
  out += pad + ')';
  return out;
}

function settingsKeysLabel(settings) {
  if (typeof settings === 'string') return "N/A (settings type=string)";
  return String(Object.keys(settings).length);
}

function main() {
  const args = process.argv.slice(2);
  const xmlPath = args[0];
  const outIdx = args.indexOf('--out');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

  if (!xmlPath) {
    process.stderr.write('Usage: node mine-fl-builder-data.js <export.xml> --out <catalog.txt>\n');
    process.exit(1);
  }

  const templates = flExtractAllTemplates(xmlPath);
  if (!templates.length) {
    process.stderr.write(`No fl-builder-template items found in ${xmlPath}\n`);
    process.exit(1);
  }

  const lines = [];
  const kindCounts = new Map();
  let totalNodeIds = 0;

  for (const t of templates) {
    const ids = Object.keys(t.tree);
    totalNodeIds += ids.length;

    lines.push('================================================================');
    lines.push(`TEMPLATE: ${t.title}  (post_id=${t.postId}, post_name=${t.postName}, nodes=${ids.length})`);
    lines.push('================================================================');
    lines.push('');

    for (const id of ids) {
      const node = t.tree[id];
      const settings = node.settings;
      lines.push(
        `#### node=${node.node}  type=${node.type}  parent=${node.parent === null ? 'NULL' : `'${node.parent}'`}  position=${node.position}  settingsKeys=${settingsKeysLabel(settings)} ####`
      );
      lines.push(dumpValue(node, 0));
      lines.push('');

      if (settings && typeof settings === 'object' && typeof settings.type === 'string') {
        kindCounts.set(settings.type, (kindCounts.get(settings.type) || 0) + 1);
      }
    }
  }

  lines.push('================================================================');
  lines.push('SUMMARY: distinct module kinds found (settings->type)');
  lines.push('================================================================');
  const sortedKinds = [...kindCounts.keys()].sort();
  for (const kind of sortedKinds) {
    lines.push(`  ${kind.padEnd(30)} x${kindCounts.get(kind)}`);
  }
  lines.push('');
  lines.push(`Total existing node ids across scanned templates: ${totalNodeIds}`);

  const output = lines.join('\n') + '\n';

  if (outPath) {
    fs.writeFileSync(outPath, output);
    process.stdout.write(`Wrote catalog to ${outPath} (${templates.length} templates, ${totalNodeIds} nodes)\n`);
  } else {
    process.stdout.write(output);
  }
}

main();
