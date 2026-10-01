/*
 * Glass Lab — vérifie que src/core reste pur : aucun accès au DOM, au navigateur ni à Three.js.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, section } from './harness.js';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');
// Identifiant global du navigateur (ni propriété « .x », ni clé d'objet « x: »)
const FORBIDDEN = /(?<![.\w$])(document|window|navigator|localStorage|sessionStorage|requestAnimationFrame|cancelAnimationFrame|HTMLElement|addEventListener|self|globalThis|performance|AudioContext|WebGLRenderingContext|THREE)\b(?!\s*:)/;

/** Retire commentaires et chaînes, pour ne tester que le code. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

section('Pureté de src/core');

test('aucun fichier de src/core n’importe le DOM ni Three.js', () => {
  const files = readdirSync(CORE).filter((f) => f.endsWith('.js'));
  assert(files.length >= 7, 'fichiers manquants dans src/core : ' + files.join(', '));
  for (const f of files) {
    const src = readFileSync(join(CORE, f), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const spec of imports) assert(/^\.\/[\w-]+\.js$/.test(spec), `${f} importe « ${spec} » (seuls les modules de src/core sont autorisés)`);
    assert(!/\bimport\s*\(/.test(src) && !/\brequire\s*\(/.test(src), f + ' : import dynamique interdit');
    const m = codeOnly(src).match(FORBIDDEN);
    assert(!m, `${f} utilise « ${m && m[0]} »`);
  }
});

