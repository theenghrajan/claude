#!/usr/bin/env node
'use strict';
// Smallest end-to-end check of wxr-helpers: build a WXR, validate it, and prove the validator
// catches the three failures that matter (attr/HTML mismatch, hotlinked Figma image, broken nesting).
// Run: node selftest.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./wxr-helpers');

const header = { site_title: 'Test', site_url: 'https://site.test', language: 'en-US', wxr_version: '1.2', base_site_url: 'https://site.test', base_blog_url: 'https://site.test', author_login: 'admin', author_email: '', author_display_name: 'admin', author_first_name: '', author_last_name: '' };
const base = { author_login: 'admin', site_url: header.site_url, pub_date: 'Fri, 25 Sep 2026 00:00:00 +0000', post_date: '2026-09-25 00:00:00' };
const tmp = path.join(os.tmpdir(), `f2be-selftest-${process.pid}.xml`);

function build(blocks, attachments = []) {
  const content = H.beSerialize(blocks);
  const items = [H.beRenderItem({ ...base, post_id: 9001, post_name: 't', title: 'T', content, ...H.beItemDefaults('wp_block') })];
  attachments.forEach((u, i) => items.push(H.beRenderAttachmentItem({ ...base, post_id: 9100 + i, post_name: `img-${i}`, title: 'img', source_url: u, ext: 'png' })));
  fs.writeFileSync(tmp, H.beRenderWxrDocument(header, items.join('\n'), base.pub_date));
  return () => H.beValidateWxrFile(tmp);
}

// Lossless round-trip of real core markup.
const mined = '<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group"><!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">Hi</h3>\n<!-- /wp:heading --></div>\n<!-- /wp:group -->';
assert.strictEqual(H.beSerialize(H.beParse(mined)), mined);

// A valid build passes, including a Figma image backed by an attachment.
const figma = 'https://www.figma.com/api/mcp/asset/abc';
const hero = H.beStyle(H.beGroup([H.beHeading('Roofing'), H.beImage(figma, 'Roof'), H.beButtons([H.beButton('Call', 'tel:123')])]), { color: { background: '#0B1F3A' } });
H.beAddClass(hero, 'f2b-hero');
assert.strictEqual(build([hero, ...H.beFaq([{ q: 'Q?', a: 'A' }])], [figma])()[0].postType, 'wp_block');

// Attr changed without the HTML -> caught.
const h = H.beHeading('x');
H.beSetAttr(h, 'level', 3);
assert.throws(build([h]), /level 3 but the HTML is <h2>/);
const g = H.beGroup([H.bePara('x')]);
H.beSetAttr(g, 'style', { color: { background: '#fff' } });
assert.throws(build([g]), /background-color:#fff/);

// Figma image with no attachment -> caught.
assert.throws(build([H.beImage(figma, '')]), /no attachment item/);

// Column outside columns -> caught.
assert.throws(build([H.beColumn([H.bePara('x')])]), /must sit directly inside columns/);

// Clone of a mined image drops the old media id + wp-image-N class.
const img = H.beClone(H.beParse('<!-- wp:image {"id":42} -->\n<figure class="wp-block-image"><img src="https://site.test/a.jpg" alt="" class="wp-image-42"/></figure>\n<!-- /wp:image -->').children[0]);
H.beSetImage(img, figma, 'New');
assert.ok(!('id' in img.attrs) && !/wp-image-42|a\.jpg/.test(H.beSerialize([img])));

fs.unlinkSync(tmp);
console.log('selftest ok');
