#!/usr/bin/env node
// Pre-publish checks for the Data Arts Working Group section. Run after
// build.mjs and before every commit that touches data_arts/:
//
//   node data_arts/_tools/check.mjs
//
// Fails loudly (exit 1) on:
//   - generated files that are stale (rerun build.mjs)
//   - unsafe HTML in an issue body (scripts, event handlers, iframes outside
//     YouTube/Vimeo, forms, javascript:/data: URLs)
//   - images without alt text, or local links/images that point nowhere
//   - images over 500 KB, issues over 4 MB, or photos that still carry
//     EXIF/GPS metadata
//   - file or folder names that aren't lowercase with underscores
//     (data_arts/issues/001/assets/vis_poster.jpg, never vis-poster.jpg)
//   - text that looks private: email addresses, phone numbers, SSN or card
//     numbers, links into Google Drive/Docs, or "confidential"-style markers.
//     An issue can allow a specific string by listing it in issue.json "allow".

import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadSection, loadIssues, renderIssue, renderHome, renderFeed, renderLandingBlock,
} from './build.mjs';

const SECTION_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT_DIR = dirname(SECTION_DIR);

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const MAX_IMAGE = 500 * 1024;
const MAX_ISSUE = 4 * 1024 * 1024;

// ---------- 1. generated files are current ----------

const section = loadSection();
const issues = loadIssues();

function same(path, expected, label) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== expected) {
    err(label, 'out of date; run node data_arts/_tools/build.mjs');
  }
}

issues.forEach((it, i) => {
  same(join(it.dir, 'index.html'), renderIssue(section, it, issues[i - 1], issues[i + 1]), `issues/${it.slug}/index.html`);
});
same(join(SECTION_DIR, 'index.html'), renderHome(section, issues), 'data_arts/index.html');
same(join(SECTION_DIR, 'feed.xml'), renderFeed(section, issues), 'data_arts/feed.xml');
{
  const landing = readFileSync(join(ROOT_DIR, 'index.html'), 'utf8');
  if (!landing.includes(renderLandingBlock(section, issues))) {
    err('index.html', 'Data Arts block is out of date; run node data_arts/_tools/build.mjs');
  }
}

// ---------- 2. issue bodies are safe HTML ----------

const UNSAFE = [
  [/<\s*script\b/i, 'contains <script>'],
  [/<\s*(object|embed|applet|form|input|button|textarea|select|base|meta|link|style)\b/i, 'contains a disallowed tag'],
  [/\son[a-z]+\s*=/i, 'contains an inline event handler (on...=)'],
  [/javascript\s*:/i, 'contains a javascript: URL'],
  [/(src|href)\s*=\s*["']?\s*data:/i, 'contains a data: URL'],
  [/\bstyle\s*=/i, 'contains an inline style attribute'],
];

const IFRAME_OK = /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)/;

for (const it of issues) {
  const where = `issues/${it.slug}/body.html`;
  for (const [re, msg] of UNSAFE) if (re.test(it.body)) err(where, msg);
  for (const m of it.body.matchAll(/<\s*iframe\b[^>]*>/gi)) {
    const src = (m[0].match(/\ssrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!IFRAME_OK.test(src)) err(where, `iframe from a source that is not YouTube/Vimeo: ${src || '(none)'}`);
  }
  for (const m of it.body.matchAll(/<\s*img\b[^>]*>/gi)) {
    const alt = (m[0].match(/\salt\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (!alt || !alt.trim()) err(where, `image without alt text: ${m[0].slice(0, 80)}`);
  }
  for (const m of it.body.matchAll(/<\s*a\b[^>]*\shref\s*=\s*["']http:\/\//gi)) {
    err(where, `plain http:// link (use https): ${m[0].slice(0, 100)}`);
  }
}

// ---------- 3. local links and images resolve ----------

function localRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = m[1].trim();
    if (/^(https?:|mailto:|#|data:)/i.test(ref)) continue;
    refs.push(ref.split('#')[0].split('?')[0]);
  }
  return refs.filter(Boolean);
}

function checkRefs(pagePath) {
  if (!existsSync(pagePath)) return;
  const html = readFileSync(pagePath, 'utf8');
  for (const ref of localRefs(html)) {
    let target = resolve(dirname(pagePath), decodeURI(ref));
    if (!target.startsWith(ROOT_DIR)) {
      err(relative(ROOT_DIR, pagePath), `link leaves the site: ${ref}`);
      continue;
    }
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target)) err(relative(ROOT_DIR, pagePath), `broken local link: ${ref}`);
  }
}

checkRefs(join(SECTION_DIR, 'index.html'));
checkRefs(join(ROOT_DIR, 'index.html'));
for (const it of issues) {
  checkRefs(join(it.dir, 'index.html'));
  if (it.cover && !existsSync(join(it.dir, it.cover.src))) err(`issues/${it.slug}`, `cover image missing: ${it.cover.src}`);
}

// ---------- 4. assets: size and metadata ----------

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function head(path, n = 128 * 1024) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(Math.min(n, statSync(path).size));
  readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  return buf;
}

for (const it of issues) {
  let total = 0;
  for (const f of walk(it.dir)) {
    const size = statSync(f).size;
    total += size;
    const rel = relative(ROOT_DIR, f);
    if (/\.(jpe?g|png|webp|gif|avif)$/i.test(f)) {
      if (size > MAX_IMAGE) err(rel, `image is ${Math.round(size / 1024)} KB; keep under ${MAX_IMAGE / 1024} KB (use _tools/prep_image.py)`);
      const buf = head(f);
      if (/\.jpe?g$/i.test(f) && buf.includes(Buffer.from('Exif\0\0'))) err(rel, 'JPEG still has EXIF metadata (may include GPS); run _tools/prep_image.py');
      if (/\.png$/i.test(f) && buf.includes(Buffer.from('eXIf'))) err(rel, 'PNG has an eXIf chunk; run _tools/prep_image.py');
      if (/\.webp$/i.test(f) && buf.includes(Buffer.from('EXIF'))) err(rel, 'WebP has EXIF metadata; run _tools/prep_image.py');
    } else if (!/\.(html|json)$/i.test(f)) {
      err(rel, 'unexpected file type in an issue folder (only html, json and images belong here)');
    }
  }
  if (total > MAX_ISSUE) err(`issues/${it.slug}`, `issue is ${(total / 1048576).toFixed(1)} MB; keep under ${MAX_ISSUE / 1048576} MB`);
}

// ---------- 4b. file names: lowercase, digits and underscores only ----------

const NAME_OK = /^[a-z0-9_]+(\.[a-z0-9]+)*$/;
for (const f of walk(SECTION_DIR)) {
  const bad = relative(SECTION_DIR, f).split(/[\\/]/).filter((seg) => !NAME_OK.test(seg));
  if (bad.length) err(relative(ROOT_DIR, f), `file names use lowercase letters, digits and underscores (no hyphens or spaces): ${bad.join(', ')}`);
}

// ---------- 5. nothing that looks private ----------

const PRIVATE = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'email address'],
  [/(?<![\d-])(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?![\d-])/g, 'phone number'],
  [/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g, 'SSN-like number'],
  [/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, 'long account/card-like number'],
  [/https?:\/\/(?:docs|drive|sheets|slides)\.google\.com\/[^\s"'<]*/gi, 'link into Google Drive/Docs'],
  [/\b(confidential|privileged|internal only|do not (?:share|forward|distribute)|not for (?:publication|distribution))\b/gi, 'private-document marker'],
];

for (const it of issues) {
  const allow = new Set((it.allow || []).map((s) => s.toLowerCase()));
  const text = `${it.title}\n${it.dek}\n${it.cover?.alt || ''}\n${it.cover?.caption || ''}\n${it.body}`;
  for (const [re, label] of PRIVATE) {
    for (const m of text.matchAll(re)) {
      if (!allow.has(m[0].toLowerCase())) err(`issues/${it.slug}`, `${label}: "${m[0]}" (remove it, or add it to issue.json "allow" if it is meant to be public)`);
    }
  }
}

// ---------- report ----------

if (errors.length) {
  console.error(`check: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`check: ok (${issues.length} issue(s))`);
