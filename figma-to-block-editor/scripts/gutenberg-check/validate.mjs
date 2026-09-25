#!/usr/bin/env node
// Optional: run WordPress's REAL block validator (@wordpress/blocks + core block-library, in jsdom)
// over every item of a built WXR file — the same check the editor does when it opens the post.
// One-time setup: cd scripts/gutenberg-check && npm install   (~470 MB)
// Usage: node validate.mjs <built.wxr.xml>
// ponytail: validates against the LATEST core markup; a site on an older WP may differ — pin
// @wordpress/block-library to that release's version if the catalog shows an old WP.
import 'global-jsdom/register';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
window.matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = window.matchMedia;

const file = process.argv[2];
if (!file) { console.error('Usage: node validate.mjs <built.wxr.xml>'); process.exit(1); }

// Silence the block library's console chatter; keep the validator's own messages for the report.
const log = console.log;
const messages = [];
for (const k of ['info', 'warn', 'error', 'log']) console[k] = (...a) => messages.push(a.map(String).join(' '));
const { registerCoreBlocks } = require('@wordpress/block-library');
const { parse } = require('@wordpress/blocks');
const { beExtractAllContent } = require('../wxr-helpers.js');
registerCoreBlocks();

let invalid = 0;
const skipped = new Set();
for (const item of beExtractAllContent(file)) {
  const walk = (blocks, trail) => blocks.forEach((b, i) => {
    const at = [...trail, i].join('.');
    if (b.name === 'core/missing') skipped.add(b.attributes.originalName);
    else if (!b.isValid) {
      invalid++;
      log(`INVALID ${b.name} at path=${at} in "${item.title}" (post_id ${item.postId})`);
      for (const issue of b.validationIssues || []) log('   ', (issue.args || []).slice(1, 4).map(String).join(' | ').slice(0, 300));
    }
    walk(b.innerBlocks, [...trail, i]);
  });
  walk(parse(item.content), []);
}
if (skipped.size) log(`Not checked (not core blocks; validate in the editor): ${[...skipped].join(', ')}`);
log(invalid ? `${invalid} invalid block(s)` : 'All core blocks valid');
process.exit(invalid ? 1 : 0);
