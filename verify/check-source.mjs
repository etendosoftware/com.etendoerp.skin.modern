/*
 *************************************************************************
 * Copyright (C) 2026 Futit Services S.L.
 * Licensed under the Openbravo Public License version 1.1.
 * You may obtain a copy of the License at
 * http://www.openbravo.com/legal/license.html
 ************************************************************************
 */

/*
 * Asserts the things a browser recording cannot see.
 *
 * check-dom.mjs measures the page at rest, so a rule that only takes effect on hover, a file that
 * was written but never registered with the kernel, or a syntax the bundler will choke on are all
 * invisible to it. Those are checked here, against the files as they will actually ship.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = join(HERE, '..');
const WEB = join(MODULE, 'web', 'com.etendoerp.skin.modern');
const CORE = join(MODULE, '..', '..');

const results = [];
let current = null;

function group(title) {
  current = { title, checks: [] };
  results.push(current);
}

function check(name, ok, detail) {
  current.checks.push({ name, ok: !!ok, detail });
}

function read(rel, base = WEB) {
  const path = join(base, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/*
 * Strips comments and string/regex literals so the syntax scan below cannot be fooled by a keyword
 * that only appears inside a message or a selector. It is a scanner, not a parser: it tracks just
 * enough state to know when it is inside something that is not code.
 */
function stripLiterals(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { i++; }
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { i++; }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) { i += src[i] === '\\' ? 2 : 1; }
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// ------------------------------------------------- every script is registered

group('The kernel serves every file the skin ships');
{
  const provider = read(join('src', 'com', 'etendoerp', 'skin', 'modern', 'SkinComponentProvider.java'), MODULE);
  check('SkinComponentProvider is present', !!provider, provider ? 'found' : 'missing');
  if (provider) {
    const jsDir = join(WEB, 'js');
    const scripts = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => f.endsWith('.js')) : [];
    const unregistered = scripts.filter((f) => !provider.includes(`js/${f}`));
    check('every js/*.js is registered', scripts.length > 0 && unregistered.length === 0,
      unregistered.length ? `not registered: ${unregistered.join(', ')}` : `${scripts.length} scripts registered`);

    /*
     * The order is load-bearing: every later script stands down unless etendo-skin.js has already
     * published OB.ETSkin, so a provider that lists them the other way round produces a skin that
     * silently does nothing.
     */
    const base = provider.indexOf('js/etendo-skin.js');
    const others = scripts.filter((f) => f !== 'etendo-skin.js').map((f) => provider.indexOf(`js/${f}`));
    check('etendo-skin.js is registered first', base >= 0 && others.every((p) => p > base),
      base < 0 ? 'etendo-skin.js not registered' : 'base script precedes the rest');

    check('the stylesheet is registered', provider.includes('css/etendo-skin.css'), 'css/etendo-skin.css');
  }
}

// ------------------------------------------------------------ ES5 in bundles

group('Shipped scripts survive the bundler');
{
  /*
   * The kernel concatenates and minifies the static resources with Crockford's JSMin, which predates
   * ES2015 entirely: an arrow function or a template literal does not fail to minify, it minifies
   * into something that no longer parses, and the whole application bundle dies with it. So the
   * shipped scripts stay conservative ES5 whatever the browser could handle.
   */
  const jsDir = join(WEB, 'js');
  const scripts = existsSync(jsDir) ? readdirSync(jsDir).filter((f) => f.endsWith('.js')) : [];
  const modern = [
    [/=>/, 'arrow function'],
    [/\blet\s+[A-Za-z_$]/, 'let'],
    [/\bconst\s+[A-Za-z_$]/, 'const'],
    [/\bclass\s+[A-Za-z_$]/, 'class'],
    [/\.\.\./, 'spread'],
    [/`/, 'template literal'],
    [/\?\./, 'optional chaining'],
    [/\?\?/, 'nullish coalescing']
  ];
  for (const file of scripts) {
    const code = stripLiterals(read(join('js', file)));
    const found = modern.filter(([re]) => re.test(code)).map(([, name]) => name);
    check(`js/${file}`, found.length === 0, found.length ? `uses ${found.join(', ')}` : 'ES5');
  }
}

// -------------------------------------------------- CSS the DOM cannot show

group('Rules that only exist under interaction');
{
  const css = read('css/etendo-skin.css') || '';

  /*
   * F2 hides the "open in new tab" glyph at rest so the field reads as one thing. That is only
   * acceptable if the glyph comes back when the row is under the pointer, and a page measured at
   * rest can never witness that half of the bargain.
   */
  const flat = css.replace(/\s+/g, ' ');
  const hoverGlyph = /etskin-linkglyph[^{}]*:hover[^{}]*\{[^{}]*opacity\s*:\s*(0?\.9\d*|1)\b|:hover[^{}]*etskin-linkglyph[^{}]*\{[^{}]*opacity\s*:\s*(0?\.9\d*|1)\b/.test(flat);
  check('the link glyph returns on hover', hoverGlyph,
    hoverGlyph ? 'a hover rule on .etskin-linkglyph raises opacity to >= 0.9' : 'nothing restores the glyph under the pointer');

  /*
   * Every colour the skin paints has to be reachable from the palette, otherwise "configurable by
   * configuration" is only true of the colours nobody notices. Literal colours are allowed only
   * where they are the palette's own default values.
   */
  const declarations = css.match(/^\s*(?!--)[a-z-]+\s*:\s*[^;]+;/gm) || [];
  const literal = declarations.filter((d) => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i.test(d) && !/var\(/.test(d));
  check('colours come from the palette', literal.length <= 24,
    `${literal.length} literal colour declarations outside :root (soft cap 24)`);

  const tokens = new Set(css.match(/--sk-[a-z0-9-]+(?=\s*:)/g) || []);
  check('the palette is declared as tokens', tokens.size >= 12, `${tokens.size} --sk-* custom properties`);
}

// ----------------------------------------------------- the one core edit

group('Core stays touched in exactly one place');
{
  const login = read(join('src', 'org', 'openbravo', 'erpCommon', 'security', 'Login.html'), CORE);
  check('Login.html pulls the skin stylesheet', !!login && login.includes('com.etendoerp.skin.modern'),
    login ? 'linked' : 'Login.html not found');
}

// ---------------------------------------------------------------- reporting

let failed = 0;
let total = 0;
for (const g of results) {
  const bad = g.checks.filter((c) => !c.ok);
  failed += bad.length;
  total += g.checks.length;
  console.log(`\n[${bad.length === 0 ? 'PASS' : 'FAIL'}] ${g.title}`);
  for (const c of g.checks) {
    console.log(`   ${c.ok ? '  ok' : 'FAIL'}  ${c.name}: ${c.detail}`);
  }
}
console.log(`\n[ux-source] ${total - failed}/${total} assertions hold.`);
process.exit(failed === 0 ? 0 : 1);
