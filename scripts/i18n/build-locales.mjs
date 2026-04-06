#!/usr/bin/env node
/**
 * Build localized homepage HTML for all languages.
 *
 * Reads cdn/en/index.html as the EN template, extracts translatable strings,
 * and generates cdn/{lang}/index.html for each non-English language
 * using strings from translations.mjs.
 *
 * Run: node scripts/i18n/build-locales.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LANGUAGES, TRANSLATIONS } from './translations.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CDN = path.join(ROOT, 'cdn');

function loadTemplate() {
  return fs.readFileSync(path.join(CDN, 'en', 'index.html'), 'utf8');
}

/**
 * Render the language switcher HTML for the nav bar.
 * Current language is marked with class="active".
 */
function renderLangSwitcher(currentLang, t) {
  const items = LANGUAGES.map(l => {
    const href = l.code === 'en' ? '/' : `/${l.code}/`;
    const active = l.code === currentLang ? ' class="active"' : '';
    return `          <a href="${href}"${active}>${l.flag} ${l.name}</a>`;
  }).join('\n');

  return `      <div class="lang-switcher">
        <button type="button" aria-label="${t.changeLanguage}" class="lang-toggle">
          🌐 ${currentLang.toUpperCase()}
        </button>
        <div class="lang-menu">
          <div class="lang-menu-grid">
${items}
          </div>
        </div>
      </div>`;
}

/**
 * Render hreflang link tags for SEO.
 */
function renderHreflangs() {
  return LANGUAGES.map(l => {
    const href = l.code === 'en' ? 'https://cloudcdn.pro/' : `https://cloudcdn.pro/${l.code}/`;
    return `  <link rel="alternate" hreflang="${l.hreflang}" href="${href}">`;
  }).join('\n') + '\n  <link rel="alternate" hreflang="x-default" href="https://cloudcdn.pro/">';
}

/**
 * Apply a translation dictionary to the template by replacing marker comments.
 *
 * Markers in the template:
 *   <!-- i18n:key --> text <!-- /i18n:key -->
 *   aria-label="<!-- i18n:key -->text"
 *   data-i18n="key"  (for JS messages)
 *
 * This build script processes the first form for text content and replaces
 * attribute values via explicit regex.
 */
function render(template, lang, t) {
  const langInfo = LANGUAGES.find(l => l.code === lang);
  let html = template;

  // <html lang="..." dir="...">
  html = html.replace(/<html lang="en">/, `<html lang="${langInfo.hreflang}"${langInfo.dir === 'rtl' ? ' dir="rtl"' : ''}>`);

  // <title>
  html = html.replace(/<title>[^<]+<\/title>/, `<title>${t.title}</title>`);

  // <meta name="description" content="...">
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escAttr(t.description)}">`);

  // og:title, og:description, twitter:*
  html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escAttr(t.title)}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escAttr(t.description)}">`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${escAttr(t.title)}">`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${escAttr(t.description)}">`);

  // Canonical
  const canonicalHref = lang === 'en' ? 'https://cloudcdn.pro/' : `https://cloudcdn.pro/${lang}/`;
  html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonicalHref}">`);

  // Inject hreflang alternates after canonical
  if (!html.includes('hreflang="en"')) {
    html = html.replace(/<link rel="canonical"[^>]*>/, match => match + '\n' + renderHreflangs());
  }

  // Skip link
  html = html.replace(/>Skip to Concierge</, `>${escHtml(t.skipToConcierge)}<`);

  // Nav links
  html = html.replace(/<li><a href="\/">Home<\/a><\/li>/, `<li><a href="${lang === 'en' ? '/' : '/' + lang + '/'}">${escHtml(t.navHome)}</a></li>`);
  html = html.replace(/<li><a href="\/api-reference">API<\/a><\/li>/, `<li><a href="/api-reference">${escHtml(t.navApi)}</a></li>`);
  html = html.replace(/<li><a href="\/dashboard\/">Dashboard<\/a><\/li>/, `<li><a href="/dashboard/">${escHtml(t.navDashboard)}</a></li>`);
  html = html.replace(/<li><a href="\/dist\/">Downloads<\/a><\/li>/, `<li><a href="/dist/">${escHtml(t.navDownloads)}</a></li>`);

  // Login CTA
  html = html.replace(/>Login</, `>${escHtml(t.navLogin)}<`);

  // Nav toggle aria-label
  html = html.replace(/aria-label="Toggle menu"/, `aria-label="${escAttr(t.navToggleMenu)}"`);

  // Inject language switcher before nav-hamburger
  const langSwitcher = renderLangSwitcher(lang, t);
  if (!html.includes('class="lang-switcher"')) {
    html = html.replace(
      /<button class="nav-hamburger"/,
      `${langSwitcher}\n      <button class="nav-hamburger"`
    );
  }

  // Hero tagline
  html = html.replace(
    /<p class="tagline">[^<]+<\/p>/,
    `<p class="tagline">${escHtml(t.tagline)}</p>`
  );

  // Stat labels
  html = html.replace(/<div class="stat-label">Edge Locations<\/div>/, `<div class="stat-label">${escHtml(t.statEdgeLocations)}</div>`);
  html = html.replace(/<div class="stat-label">Global TTFB<\/div>/, `<div class="stat-label">${escHtml(t.statGlobalTtfb)}</div>`);
  html = html.replace(/<div class="stat-label">Uptime SLA<\/div>/, `<div class="stat-label">${escHtml(t.statUptime)}</div>`);

  // Status text
  html = html.replace(/All systems operational/, escHtml(t.statusOperational));

  // Concierge widget
  html = html.replace(/aria-label="Open CloudCDN Concierge"/, `aria-label="${escAttr(t.conciergeOpen)}"`);
  html = html.replace(/<h3>CloudCDN Concierge<\/h3>/, `<h3>${escHtml(t.conciergeTitle)}</h3>`);
  html = html.replace(/<p>AI-powered edge assistant<\/p>/, `<p>${escHtml(t.conciergeSubtitle)}</p>`);
  html = html.replace(/aria-label="New conversation" title="New conversation"/, `aria-label="${escAttr(t.conciergeNewChat)}" title="${escAttr(t.conciergeNewChat)}"`);
  html = html.replace(/aria-label="Close chat" title="Close \(Esc\)"/, `aria-label="${escAttr(t.conciergeClose)}" title="${escAttr(t.conciergeCloseTitle)}"`);
  html = html.replace(/data-msg="How do I set up CloudCDN\?">Setup guide/, `data-msg="${escAttr(t.quickMsgSetup)}">${escHtml(t.quickReplySetup)}`);
  html = html.replace(/data-msg="Compare your pricing plans">Pricing/, `data-msg="${escAttr(t.quickMsgPricing)}">${escHtml(t.quickReplyPricing)}`);
  html = html.replace(/data-msg="Is CloudCDN free for open source\?">Free for OSS\?/, `data-msg="${escAttr(t.quickMsgFreeOss)}">${escHtml(t.quickReplyFreeOss)}`);
  html = html.replace(/data-msg="What image formats do you support\?">Formats/, `data-msg="${escAttr(t.quickMsgFormats)}">${escHtml(t.quickReplyFormats)}`);
  html = html.replace(/Hi! I'm the CloudCDN Concierge\. Ask me about pricing, setup, performance, or anything about our edge CDN\./, escHtml(t.conciergeGreeting));
  html = html.replace(/placeholder="Ask anything about CloudCDN\.\.\."/, `placeholder="${escAttr(t.chatInputPlaceholder)}"`);
  html = html.replace(/aria-label="Type your question"/, `aria-label="${escAttr(t.chatInputLabel)}"`);
  html = html.replace(/aria-label="Send message"/, `aria-label="${escAttr(t.chatSend)}"`);
  html = html.replace(/<div class="chat-footer-meta">Powered by Cloudflare Workers AI<\/div>/, `<div class="chat-footer-meta">${escHtml(t.chatPoweredBy)}</div>`);

  // Update the auth link text for localized login
  html = html.replace(
    /el\.textContent = 'Logout';/,
    `el.textContent = '${escJs(t.navLogout)}';`
  );

  return html;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function main() {
  const template = loadTemplate();

  // First, re-render the EN template itself (ensures it's idempotent)
  const enT = TRANSLATIONS.en;
  const enHtml = render(template, 'en', enT);
  fs.mkdirSync(path.join(CDN, 'en'), { recursive: true });
  fs.writeFileSync(path.join(CDN, 'en', 'index.html'), enHtml);
  console.log('✓ Updated EN: cdn/en/index.html');

  // Then render all other languages
  for (const lang of LANGUAGES) {
    if (lang.code === 'en') continue;
    const t = TRANSLATIONS[lang.code];
    if (!t) {
      console.warn(`⚠ Skipping ${lang.code} — no translations defined`);
      continue;
    }
    const localized = render(template, lang.code, t);
    const outDir = path.join(CDN, lang.code);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), localized);
    console.log(`✓ Generated ${lang.code}: cdn/${lang.code}/index.html`);
  }

  console.log(`\n${LANGUAGES.length} languages built.`);
}

main();
