/*
 * Glass Lab — lance tous les tests : node test/run.js
 * La vérification de pureté de src/core passe en premier : elle lit les sources sans les exécuter,
 * donc elle signale un accès au DOM ou un import de Three.js même si le module ne se charge plus.
 */
import { results, section } from './harness.js';

const FILES = ['purity', 'physics', 'geometry', 'quality', 'shotgen', 'rally', 'stats'];

for (const f of FILES) {
  try {
    await import(`./${f}.test.js`);
  } catch (e) {
    section(f);
    results.failed++;
    console.log(`  ÉCHEC  ${f}.test.js ne se charge pas\n        ${e.message.split('\n')[0]}`);
  }
}

console.log(`\n${results.passed} réussi(s), ${results.failed} échec(s)`);
if (results.failed) process.exit(1);
