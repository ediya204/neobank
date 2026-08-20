import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const sourcePath = path.join(projectRoot, 'docs', 'PARTNER_API_GUIDE.md');
const chineseSourcePath = path.join(projectRoot, 'docs', 'PARTNER_API_GUIDE.zh-CN.md');
const publicDirectory = path.join(projectRoot, 'public');
const publicGuideDirectory = path.join(publicDirectory, 'portal');
const publicMarkdownPath = path.join(publicGuideDirectory, 'api-guide.md');
const publicChineseMarkdownPath = path.join(publicGuideDirectory, 'api-guide.zh-CN.md');
const publicHtmlPath = path.join(publicGuideDirectory, 'api-guide.html');

const [markdown, chineseMarkdown] = await Promise.all([
  fs.readFile(sourcePath, 'utf8'),
  fs.readFile(chineseSourcePath, 'utf8'),
]);

function plainText(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(plainText).join('');
  if (React.isValidElement(value)) return plainText(value.props.children);
  return '';
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~[\](){}:;,.!?'"\\/]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function renderGuide(source, idPrefix) {
  const headingCounts = new Map();
  const uniqueSlug = (value) => {
    const base = `${idPrefix}-${slugify(value) || 'section'}`;
    const count = headingCounts.get(base) ?? 0;
    headingCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
  const tocCounts = new Map();
  const toc = source
    .split('\n')
    .map((line) => {
      const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      const label = match[2]
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .trim();
      const base = `${idPrefix}-${slugify(label) || 'section'}`;
      const count = tocCounts.get(base) ?? 0;
      tocCounts.set(base, count + 1);
      return { depth: match[1].length, label, id: count === 0 ? base : `${base}-${count + 1}` };
    })
    .filter(Boolean);
  const heading = (level) => function MarkdownHeading({ children }) {
    const id = uniqueSlug(plainText(children));
    return React.createElement(
      `h${level}`,
      { id },
      React.createElement('a', { className: 'heading-anchor', href: `#${id}` }, children)
    );
  };
  const content = renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkGfm],
      components: {
        h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4),
        a({ children, href = '' }) {
          const external = /^https?:\/\//.test(href);
          return React.createElement('a', external ? { href, target: '_blank', rel: 'noreferrer' } : { href }, children);
        },
        table({ children }) {
          return React.createElement('div', { className: 'table-scroll', tabIndex: 0 }, React.createElement('table', null, children));
        },
      },
      children: source,
    })
  );
  const tocMarkup = toc
    .filter((item) => item.depth === 2)
    .map((item) => `<li><a href="#${item.id}">${item.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</a></li>`)
    .join('');
  return { content, tocMarkup };
}

const englishGuide = renderGuide(markdown, 'en');
const chineseGuide = renderGuide(chineseMarkdown, 'zh');

const documentHtml = `<!doctype html>
<html lang="en" data-language="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="VA BaaS Partner API integration guide, request examples, security requirements, and error handling." />
    <meta name="color-scheme" content="light" />
    <title>Partner API Guide · VA BaaS</title>
    <link rel="icon" href="/favicon/favicon.ico" />
    <style>
      @font-face {
        font-family: "Circular";
        src: url("/fonts/CircularStd-Book.otf") format("opentype");
        font-display: swap;
        font-weight: 400;
      }
      @font-face {
        font-family: "Circular";
        src: url("/fonts/CircularStd-Medium.otf") format("opentype");
        font-display: swap;
        font-weight: 500;
      }
      @font-face {
        font-family: "Circular";
        src: url("/fonts/CircularStd-Bold.otf") format("opentype");
        font-display: swap;
        font-weight: 700;
      }
      :root {
        --ink: oklch(22% 0.022 248);
        --ink-soft: oklch(48% 0.025 248);
        --paper: oklch(98.5% 0.007 244);
        --surface: oklch(100% 0.004 244);
        --line: oklch(90% 0.012 244);
        --accent: oklch(52% 0.14 242);
        --accent-soft: oklch(94% 0.035 242);
        --code: oklch(21% 0.025 247);
        --code-ink: oklch(91% 0.018 231);
        --success: oklch(46% 0.11 161);
        --space-xs: 0.5rem;
        --space-sm: 0.75rem;
        --space-md: 1rem;
        --space-lg: 1.5rem;
        --space-xl: 2rem;
        --space-2xl: 3rem;
        --space-3xl: 4.5rem;
      }
      * { box-sizing: border-box; }
      html {
        scroll-behavior: smooth;
        scroll-padding-top: 6rem;
      }
      body {
        margin: 0;
        background:
          linear-gradient(90deg, transparent 0 49.8%, oklch(89% 0.015 244 / 0.24) 50%, transparent 50.2%) top / 3rem 3rem,
          var(--paper);
        color: var(--ink);
        font: 400 1rem/1.6 "Circular", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-kerning: normal;
        text-rendering: optimizeLegibility;
      }
      a { color: var(--accent); text-underline-offset: 0.18em; }
      a:hover { text-decoration-thickness: 0.12em; }
      a:focus-visible, button:focus-visible, [tabindex]:focus-visible {
        outline: 3px solid color-mix(in oklch, var(--accent), white 28%);
        outline-offset: 3px;
      }
      .skip-link {
        position: fixed;
        z-index: 20;
        top: 0.75rem;
        left: 0.75rem;
        padding: 0.75rem 1rem;
        transform: translateY(-160%);
        border-radius: 0.5rem;
        background: var(--ink);
        color: var(--surface);
      }
      .skip-link:focus { transform: translateY(0); }
      .masthead {
        position: sticky;
        z-index: 10;
        top: 0;
        border-bottom: 1px solid var(--line);
        background: color-mix(in oklch, var(--paper), transparent 7%);
        backdrop-filter: blur(14px);
      }
      .masthead-inner {
        width: min(91rem, 100%);
        min-height: 4.5rem;
        margin: 0 auto;
        padding: 0.75rem clamp(1rem, 3vw, 3rem);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-lg);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-width: 0;
        color: var(--ink);
        font-weight: 700;
        text-decoration: none;
      }
      .brand img { width: 7.4rem; max-height: 2.25rem; object-fit: contain; object-position: left center; }
      .brand span {
        padding-left: var(--space-sm);
        border-left: 1px solid var(--line);
        color: var(--ink-soft);
        font-size: 0.875rem;
        font-weight: 500;
        white-space: nowrap;
      }
      .masthead-links { display: flex; align-items: center; gap: var(--space-sm); }
      .language-switcher {
        display: inline-flex;
        padding: 0.2rem;
        border: 1px solid var(--line);
        border-radius: 0.6rem;
        background: var(--surface);
      }
      .language-switcher button {
        min-height: 2.25rem;
        padding: 0.45rem 0.7rem;
        border: 0;
        border-radius: 0.4rem;
        background: transparent;
        color: var(--ink-soft);
        font: inherit;
        font-size: 0.875rem;
        font-weight: 700;
        cursor: pointer;
      }
      .language-switcher button[aria-pressed="true"] { background: var(--ink); color: var(--surface); }
      .action {
        min-height: 2.75rem;
        padding: 0.65rem 0.9rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--line);
        border-radius: 0.55rem;
        background: var(--surface);
        color: var(--ink);
        font-size: 0.875rem;
        font-weight: 500;
        text-decoration: none;
        transition: border-color 160ms ease-out, transform 160ms ease-out;
      }
      .action:hover { border-color: var(--accent); transform: translateY(-1px); }
      .action.primary { border-color: var(--ink); background: var(--ink); color: var(--surface); }
      .layout {
        width: min(91rem, 100%);
        margin: 0 auto;
        padding: clamp(2rem, 4vw, 4.5rem) clamp(1rem, 3vw, 3rem) var(--space-3xl);
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-2xl);
      }
      .rail { display: none; }
      .rail-label {
        margin: 0 0 var(--space-sm);
        color: var(--ink-soft);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }
      .toc { margin: 0; padding: 0; list-style: none; }
      .toc li { margin: 0.1rem 0; }
      .toc a {
        padding: 0.45rem 0;
        display: block;
        color: var(--ink-soft);
        font-size: 0.875rem;
        line-height: 1.35;
        text-decoration: none;
      }
      .toc a:hover { color: var(--ink); }
      .mobile-toc {
        margin-bottom: var(--space-xl);
        border-block: 1px solid var(--line);
      }
      .mobile-toc summary {
        min-height: 3.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: 700;
        cursor: pointer;
      }
      .mobile-toc summary::after { content: "+"; color: var(--accent); font-size: 1.25rem; }
      .mobile-toc[open] summary::after { content: "−"; }
      .mobile-toc .toc { padding: 0 0 var(--space-md); columns: 2; column-gap: var(--space-lg); }
      main {
        min-width: 0;
        max-width: 54rem;
      }
      [data-language-panel][hidden], [data-language-toc][hidden] { display: none !important; }
      article > h1:first-child {
        max-width: 14ch;
        margin: 0 0 var(--space-md);
        font-size: clamp(2.45rem, 7vw, 4.8rem);
        line-height: 0.98;
        letter-spacing: -0.045em;
      }
      article h1, article h2, article h3, article h4 {
        color: var(--ink);
        font-weight: 700;
        text-wrap: balance;
      }
      article h2 {
        margin: var(--space-3xl) 0 var(--space-lg);
        padding-top: var(--space-md);
        border-top: 1px solid var(--line);
        font-size: clamp(1.7rem, 4vw, 2.25rem);
        line-height: 1.15;
        letter-spacing: -0.025em;
      }
      article h3 {
        margin: var(--space-2xl) 0 var(--space-md);
        font-size: 1.35rem;
        line-height: 1.25;
      }
      article h4 { margin: var(--space-xl) 0 var(--space-sm); font-size: 1rem; }
      .heading-anchor { color: inherit; text-decoration: none; }
      .heading-anchor:hover::after { content: " #"; color: var(--accent); font-weight: 400; }
      article p, article li { max-width: 72ch; }
      article > p:first-of-type {
        max-width: 58ch;
        color: var(--ink-soft);
        font-size: 1.2rem;
        line-height: 1.55;
      }
      article ul, article ol { padding-left: 1.35rem; }
      article li { padding-left: 0.25rem; margin: 0.35rem 0; }
      article strong { color: var(--ink); font-weight: 700; }
      article hr { margin: var(--space-2xl) 0; border: 0; border-top: 1px solid var(--line); }
      article blockquote {
        margin: var(--space-xl) 0;
        padding: 1.1rem 1.25rem;
        border-left: 3px solid var(--accent);
        background: var(--accent-soft);
        color: color-mix(in oklch, var(--ink), var(--accent) 18%);
      }
      article blockquote > :first-child { margin-top: 0; }
      article blockquote > :last-child { margin-bottom: 0; }
      code {
        border-radius: 0.28rem;
        background: oklch(93% 0.015 244);
        color: oklch(38% 0.11 245);
        padding: 0.1em 0.34em;
        font: 500 0.875em/1.5 ui-monospace, "SFMono-Regular", Consolas, monospace;
        font-variant-ligatures: none;
      }
      pre {
        position: relative;
        margin: var(--space-lg) 0 var(--space-xl);
        padding: 1.35rem;
        overflow: auto;
        border: 1px solid oklch(30% 0.03 247);
        border-radius: 0.75rem;
        background: var(--code);
        color: var(--code-ink);
        box-shadow: 0 0.8rem 2.5rem oklch(18% 0.02 247 / 0.09);
      }
      pre code { padding: 0; background: transparent; color: inherit; font-size: 0.85rem; }
      .copy-code {
        position: absolute;
        top: 0.65rem;
        right: 0.65rem;
        min-width: 4rem;
        min-height: 2rem;
        border: 1px solid oklch(45% 0.03 247);
        border-radius: 0.4rem;
        background: oklch(27% 0.025 247);
        color: var(--code-ink);
        font: 500 0.75rem/1 "Circular", sans-serif;
        cursor: pointer;
      }
      .copy-code:hover { border-color: oklch(70% 0.07 239); }
      .table-scroll {
        width: 100%;
        margin: var(--space-lg) 0 var(--space-xl);
        overflow-x: auto;
        border-block: 1px solid var(--line);
      }
      table {
        width: 100%;
        min-width: 35rem;
        border-collapse: collapse;
        font-size: 0.9rem;
        font-variant-numeric: tabular-nums;
      }
      th, td { padding: 0.8rem 0.65rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
      th { color: var(--ink); font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; }
      td { color: var(--ink-soft); }
      tbody tr:last-child td { border-bottom: 0; }
      .meta-note {
        margin-top: var(--space-3xl);
        padding-top: var(--space-lg);
        border-top: 1px solid var(--line);
        color: var(--ink-soft);
        font-size: 0.875rem;
      }
      @media (min-width: 64rem) {
        .layout { grid-template-columns: 13.5rem minmax(0, 1fr); gap: clamp(3rem, 6vw, 7rem); }
        .rail { display: block; }
        .rail-inner { position: sticky; top: 7rem; max-height: calc(100vh - 8.5rem); overflow: auto; }
        .mobile-toc { display: none; }
      }
      @media (max-width: 42rem) {
        .brand img { width: 2.2rem; height: 2.2rem; object-fit: cover; object-position: left; }
        .brand span { display: none; }
        .masthead-links .action { display: none; }
        .mobile-toc .toc { columns: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        html { scroll-behavior: auto; }
        *, *::before, *::after { transition-duration: 0.01ms !important; }
      }
      @media print {
        .masthead, .rail, .mobile-toc, .copy-code { display: none !important; }
        .layout { display: block; width: 100%; padding: 0; }
        main { max-width: none; }
        pre { white-space: pre-wrap; box-shadow: none; }
        article h2 { break-after: avoid; }
      }
    </style>
  </head>
  <body>
    <a class="skip-link" href="#guide" data-copy-en="Skip to API guide" data-copy-zh="跳到 API 指南">Skip to API guide</a>
    <header class="masthead">
      <div class="masthead-inner">
        <a class="brand" href="/portal/api" aria-label="Return to SSC Digital Bank Partner Portal">
          <img src="/logo/logo_full.svg" alt="SSC Digital Bank" />
          <span data-copy-en="Partner API · v1" data-copy-zh="合作伙伴 API · v1">Partner API · v1</span>
        </a>
        <nav class="masthead-links" aria-label="API resources">
          <div class="language-switcher" role="group" aria-label="Language / 语言">
            <button type="button" data-set-language="en" aria-pressed="true">EN</button>
            <button type="button" data-set-language="zh" aria-pressed="false">中文</button>
          </div>
          <a class="action" data-download-guide href="/portal/api-guide.md" download>Download Markdown</a>
          <a class="action primary" href="/api/browser/v1/portal/openapi.yaml">OpenAPI 3.1</a>
        </nav>
      </div>
    </header>
    <div class="layout">
      <aside class="rail" aria-label="Guide navigation">
        <div class="rail-inner">
          <p class="rail-label" data-copy-en="On this page" data-copy-zh="本页目录">On this page</p>
          <ol class="toc" data-language-toc="en">${englishGuide.tocMarkup}</ol>
          <ol class="toc" data-language-toc="zh" hidden>${chineseGuide.tocMarkup}</ol>
        </div>
      </aside>
      <main id="guide">
        <details class="mobile-toc">
          <summary data-copy-en="On this page" data-copy-zh="本页目录">On this page</summary>
          <ol class="toc" data-language-toc="en">${englishGuide.tocMarkup}</ol>
          <ol class="toc" data-language-toc="zh" hidden>${chineseGuide.tocMarkup}</ol>
        </details>
        <article data-language-panel="en">${englishGuide.content}</article>
        <article data-language-panel="zh" lang="zh-CN" hidden>${chineseGuide.content}</article>
        <p class="meta-note" data-copy-en="Keep credentials in a server-side secret store. Never place a Cloudflare Access Client Secret in browser or mobile application code." data-copy-zh="请将凭证保存在服务端密钥存储中，切勿把 Cloudflare Access Client Secret 放进浏览器或移动应用代码。">
          Keep credentials in a server-side secret store. Never place a Cloudflare Access Client Secret in browser or mobile application code.
        </p>
      </main>
    </div>
    <script>
      const languageButtons = document.querySelectorAll('[data-set-language]');
      const setLanguage = (language) => {
        const normalized = language === 'zh' || language === 'cn' || language?.startsWith('zh') ? 'zh' : 'en';
        document.documentElement.lang = normalized === 'zh' ? 'zh-CN' : 'en';
        document.documentElement.dataset.language = normalized;
        document.querySelectorAll('[data-language-panel], [data-language-toc]').forEach((element) => {
          element.hidden = element.dataset.languagePanel !== normalized && element.dataset.languageToc !== normalized;
        });
        document.querySelectorAll('[data-copy-en]').forEach((element) => {
          element.textContent = element.dataset[normalized === 'zh' ? 'copyZh' : 'copyEn'];
        });
        languageButtons.forEach((button) => {
          button.setAttribute('aria-pressed', String(button.dataset.setLanguage === normalized));
        });
        const download = document.querySelector('[data-download-guide]');
        if (download) {
          download.href = normalized === 'zh' ? '/portal/api-guide.zh-CN.md' : '/portal/api-guide.md';
          download.textContent = normalized === 'zh' ? '下载 Markdown' : 'Download Markdown';
        }
        try { window.localStorage.setItem('i18nextLng', normalized === 'zh' ? 'cn' : 'en'); } catch {}
      };
      languageButtons.forEach((button) => button.addEventListener('click', () => setLanguage(button.dataset.setLanguage)));
      let savedLanguage = '';
      try { savedLanguage = window.localStorage.getItem('i18nextLng') ?? ''; } catch {}
      const queryLanguage = new URLSearchParams(window.location.search).get('lang') ?? '';
      setLanguage(queryLanguage || savedLanguage || navigator.language);

      document.querySelectorAll('pre').forEach((block) => {
        const code = block.querySelector('code')?.textContent ?? block.textContent ?? '';
        const button = document.createElement('button');
        button.className = 'copy-code';
        button.type = 'button';
        button.textContent = 'Copy';
        button.setAttribute('aria-label', 'Copy code example');
        button.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(code);
            button.textContent = 'Copied';
            window.setTimeout(() => { button.textContent = 'Copy'; }, 1600);
          } catch {
            button.textContent = 'Select text';
          }
        });
        block.appendChild(button);
      });
    </script>
  </body>
</html>`;

await fs.mkdir(publicGuideDirectory, { recursive: true });
await Promise.all([
  fs.writeFile(publicMarkdownPath, markdown, 'utf8'),
  fs.writeFile(publicChineseMarkdownPath, chineseMarkdown, 'utf8'),
  fs.writeFile(publicHtmlPath, documentHtml, 'utf8'),
]);

console.log(
  `Synced ${path.relative(projectRoot, sourcePath)} to ${path.relative(
    projectRoot,
    publicMarkdownPath
  )}, ${path.relative(projectRoot, publicChineseMarkdownPath)}, and ${path.relative(projectRoot, publicHtmlPath)}.`
);
