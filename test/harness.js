/*
 * Glass Lab — mini-harnais de tests (Node, sans librairie).
 */
const results = { passed: 0, failed: 0 };

export function section(name) {
  console.log('\n' + name);
}

export function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log('  ok  ' + name);
  } catch (e) {
    results.failed++;
    console.log('  ÉCHEC  ' + name + '\n        ' + e.message);
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion échouée');
}

export function near(a, b, tol, msg) {
  assert(Math.abs(a - b) <= tol, (msg || '') + ` (attendu ${b}, obtenu ${a}, tolérance ${tol})`);
}

export { results };
