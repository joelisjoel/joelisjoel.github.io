#!/usr/bin/env node
// Builds the Data Arts Working Group section of joelisjoel.org.
//
// Sources (hand- or agent-written):
//   data_arts/section.json              section title, tagline, intro, site URL
//   data_arts/issues/NNN/issue.json     one issue's metadata
//   data_arts/issues/NNN/body.html      that issue's article body (an HTML fragment)
//   data_arts/issues/NNN/assets/        that issue's images
//
// Generated (never edit by hand; rerun this script):
//   data_arts/issues/NNN/index.html     the issue page
//   data_arts/index.html                section home: latest issue + archive
//   data_arts/issues.json               machine-readable list of issues
//   data_arts/feed.xml                  RSS feed
//   index.html (repo root)              the block between the data_arts markers
//
// Usage: node data_arts/_tools/build.mjs
// No dependencies. Output is deterministic: rerunning without source
// changes produces no diff.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT_DIR = dirname(SECTION_DIR);
const ISSUES_DIR = join(SECTION_DIR, 'issues');

const MARK_START = '<!-- data_arts:start';
const MARK_END = '<!-- data_arts:end -->';

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23161a24'/%3E%3Ctext x='16' y='23' font-family='sans-serif' font-size='19' font-weight='800' text-anchor='middle' fill='%23FFD93D'%3EJ%3C/text%3E%3C/svg%3E";

// ---------- helpers ----------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const slugFor = (n) => String(n).padStart(3, '0');

export function prettyDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

function rfc822(iso) {
  // Issues go out Fridays at 9am Pacific; 17:00 UTC is close enough for a feed.
  return new Date(`${iso}T17:00:00Z`).toUTCString();
}

function fail(msg) {
  console.error(`build: ${msg}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`);
  }
}

// Writes only when content changed, so mtimes stay put on no-op builds.
function put(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  writeFileSync(path, content);
  console.log(`wrote ${path.slice(ROOT_DIR.length + 1)}`);
  return true;
}

// ---------- load ----------

export function loadSection() {
  const s = readJson(join(SECTION_DIR, 'section.json'));
  for (const k of ['title', 'short_title', 'tagline', 'intro', 'site']) {
    if (!s[k]) fail(`section.json is missing "${k}"`);
  }
  s.site = s.site.replace(/\/+$/, '');
  return s;
}

export function loadIssues() {
  if (!existsSync(ISSUES_DIR)) return [];
  const dirs = readdirSync(ISSUES_DIR)
    .filter((d) => /^\d{3}$/.test(d) && statSync(join(ISSUES_DIR, d)).isDirectory())
    .sort();
  const issues = dirs.map((slug) => {
    const dir = join(ISSUES_DIR, slug);
    const meta = readJson(join(dir, 'issue.json'));
    for (const k of ['number', 'title', 'dek', 'date']) {
      if (meta[k] === undefined || meta[k] === '') fail(`issues/${slug}/issue.json is missing "${k}"`);
    }
    if (slugFor(meta.number) !== slug) fail(`issues/${slug}: "number" is ${meta.number}, folder says ${slug}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date) || Number.isNaN(Date.parse(meta.date))) {
      fail(`issues/${slug}: "date" must be YYYY-MM-DD`);
    }
    if (meta.cover && (!meta.cover.src || !meta.cover.alt)) fail(`issues/${slug}: cover needs "src" and "alt"`);
    const bodyPath = join(dir, 'body.html');
    if (!existsSync(bodyPath)) fail(`issues/${slug}/body.html is missing`);
    return { ...meta, slug, dir, body: readFileSync(bodyPath, 'utf8').trim() };
  });
  issues.forEach((it, i) => {
    if (it.number !== i + 1) fail(`issue numbers must run 1, 2, 3...; found ${it.number} at position ${i + 1}`);
  });
  return issues;
}

// ---------- render ----------

function head({ title, description, canonical, css, ogType, ogImage, feedHref }) {
  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="alternate" type="application/rss+xml" title="Data Arts Working Group" href="${esc(feedHref)}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
${ogImage ? `  <meta property="og:image" content="${esc(ogImage)}">\n  <meta name="twitter:card" content="summary_large_image">\n` : ''}  <link rel="icon" href="${FAVICON}">
  <link rel="stylesheet" href="${css}">
</head>
`;
}

export function renderIssue(section, issue, prev, next) {
  const url = `${section.site}/data_arts/issues/${issue.slug}/`;
  const ogImage = issue.cover ? `${url}${issue.cover.src}` : null;
  const cover = issue.cover
    ? `
      <figure class="cover">
        <img src="${esc(issue.cover.src)}" alt="${esc(issue.cover.alt)}"${issue.cover.width ? ` width="${issue.cover.width}" height="${issue.cover.height}"` : ''}>
${issue.cover.caption ? `        <figcaption>${esc(issue.cover.caption)}</figcaption>\n` : ''}      </figure>`
    : '';
  const prevLink = prev
    ? `<a href="../${prev.slug}/" rel="prev">&larr; Issue ${prev.number}: ${esc(prev.title)}</a>`
    : '<span></span>';
  const nextLink = next
    ? `<a href="../${next.slug}/" rel="next">Issue ${next.number}: ${esc(next.title)} &rarr;</a>`
    : `<a href="../../">All issues &rarr;</a>`;

  return `${head({
    title: `${issue.title} · ${section.title}`,
    description: issue.dek,
    canonical: url,
    css: '../../style.css',
    ogType: 'article',
    ogImage,
    feedHref: '../../feed.xml',
  })}
<body>
  <main class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../../../">Joel's projects</a><span>/</span><a href="../../">${esc(section.short_title)}</a></nav>

    <article>
      <header class="issue-head">
        <div class="kicker">Issue ${issue.number} · <time datetime="${issue.date}">${prettyDate(issue.date)}</time></div>
        <h1>${esc(issue.title)}</h1>
        <p class="dek">${esc(issue.dek)}</p>
      </header>
${cover}
      <div class="prose">
${issue.body}
      </div>
    </article>

    <nav class="issue-nav" aria-label="More issues">
      ${prevLink}
      ${nextLink}
    </nav>

    <footer>
      ${esc(section.title)} · a new issue every Friday · <a href="../../">All issues</a> · <a href="../../feed.xml">RSS</a>
    </footer>
  </main>
</body>

</html>
`;
}

export function renderHome(section, issues) {
  const latest = issues[issues.length - 1];
  const latestBlock = latest
    ? `    <h2 class="section">Latest issue</h2>
    <a class="card latest" href="issues/${latest.slug}/">
${latest.cover ? `      <img src="issues/${latest.slug}/${esc(latest.cover.src)}" alt="${esc(latest.cover.alt)}" loading="lazy">\n` : ''}      <span class="latest-body">
        <span class="kicker">Issue ${latest.number} · ${prettyDate(latest.date)}</span>
        <span class="latest-title">${esc(latest.title)}</span>
        <span class="latest-dek">${esc(latest.dek)}</span>
        <span class="cta">Read issue ${latest.number} &rarr;</span>
      </span>
    </a>
`
    : `    <h2 class="section">Latest issue</h2>
    <div class="card empty">The first issue is on its way. New issues every Friday.</div>
`;
  const archive = issues.length > 1
    ? `
    <h2 class="section">All issues</h2>
    <ol class="archive" reversed>
${[...issues].reverse().map((it) => `      <li>
        <a href="issues/${it.slug}/">
          <span class="num">${it.number}</span>
          <span class="archive-title">${esc(it.title)}</span>
          <span class="archive-meta">${prettyDate(it.date)} · ${esc(it.dek)}</span>
        </a>
      </li>`).join('\n')}
    </ol>
`
    : '';

  return `${head({
    title: section.title,
    description: section.tagline,
    canonical: `${section.site}/data_arts/`,
    css: 'style.css',
    ogType: 'website',
    ogImage: latest?.cover ? `${section.site}/data_arts/issues/${latest.slug}/${latest.cover.src}` : null,
    feedHref: 'feed.xml',
  })}
<body>
  <main class="page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../">Joel's projects</a><span>/</span>${esc(section.short_title)}</nav>

    <header class="masthead">
      <h1>Data Arts <span>Working Group</span></h1>
      <p class="tagline">${esc(section.tagline)}</p>
      <div class="intro">
        ${section.intro}
      </div>
    </header>

${latestBlock}${archive}
    <footer>
      New issues every Friday. Follow along with <a href="feed.xml">RSS</a>, or head back to <a href="../">Joel's projects</a>.
    </footer>
  </main>
</body>

</html>
`;
}

export function renderFeed(section, issues) {
  const items = [...issues].reverse().map((it) => {
    const url = `${section.site}/data_arts/issues/${it.slug}/`;
    return `    <item>
      <title>${esc(`Issue ${it.number}: ${it.title}`)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${rfc822(it.date)}</pubDate>
      <description>${esc(it.dek)}</description>
    </item>`;
  });
  const last = issues[issues.length - 1];
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(section.title)}</title>
    <link>${section.site}/data_arts/</link>
    <atom:link href="${section.site}/data_arts/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(section.tagline)}</description>
    <language>en-us</language>
${last ? `    <lastBuildDate>${rfc822(last.date)}</lastBuildDate>\n` : ''}${items.join('\n')}${items.length ? '\n' : ''}  </channel>
</rss>
`;
}

export function renderLandingBlock(section, issues) {
  const latest = issues[issues.length - 1];
  const card = latest
    ? `    <a class="card issue-card" href="data_arts/issues/${latest.slug}/">
      <span class="tag">Issue ${latest.number} · ${prettyDate(latest.date)}</span>
      <span class="title">${esc(latest.title)}</span>
      <span class="sub">${esc(latest.dek)}</span>
      <span class="more">Read issue ${latest.number} &rarr;</span>
    </a>`
    : `    <a class="card issue-card" href="data_arts/">
      <span class="tag">Weekly · Fridays</span>
      <span class="title">${esc(section.title)}</span>
      <span class="sub">${esc(section.tagline)}</span>
      <span class="more">Visit &rarr;</span>
    </a>`;
  return `${MARK_START} (generated by data_arts/_tools/build.mjs: edit that, not this) -->
    <h2>${esc(section.title)}</h2>
${card}
    <p class="issue-links"><a href="data_arts/">All issues</a> · <a href="data_arts/feed.xml">RSS</a> · New issues every Friday</p>
    ${MARK_END}`;
}

// ---------- main ----------

function main() {
  const section = loadSection();
  const issues = loadIssues();

  issues.forEach((it, i) => {
    put(join(it.dir, 'index.html'), renderIssue(section, it, issues[i - 1], issues[i + 1]));
  });
  put(join(SECTION_DIR, 'index.html'), renderHome(section, issues));
  put(join(SECTION_DIR, 'feed.xml'), renderFeed(section, issues));
  put(join(SECTION_DIR, 'issues.json'), `${JSON.stringify(issues.map((it) => ({
    number: it.number,
    title: it.title,
    dek: it.dek,
    date: it.date,
    url: `${section.site}/data_arts/issues/${it.slug}/`,
    ...(it.source ? { source: it.source } : {}),
  })), null, 2)}\n`);

  const landingPath = join(ROOT_DIR, 'index.html');
  const landing = readFileSync(landingPath, 'utf8');
  const a = landing.indexOf(MARK_START);
  const b = landing.indexOf(MARK_END);
  if (a < 0 || b < a) fail('index.html (repo root) has no data_arts:start / data_arts:end markers');
  put(landingPath, landing.slice(0, a) + renderLandingBlock(section, issues) + landing.slice(b + MARK_END.length));

  console.log(`build: ${issues.length} issue(s); latest ${issues.length ? `#${issues[issues.length - 1].number}` : 'none'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
