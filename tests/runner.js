let passed = 0;
let failed = 0;
const failures = [];
const pending = [];

export function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(
        result.then(() => { passed++; }).catch((e) => recordFail(name, e))
      );
      return;
    }
    passed++;
  } catch (e) {
    recordFail(name, e);
  }
}

export async function flushTests() {
  await Promise.all(pending);
}

function recordFail(name, e) {
  failed++;
  failures.push({ name, message: e.message || String(e) });
}

export async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    recordFail(name, e);
  }
}

export function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertOk(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

export function assertApprox(actual, expected, msg = '') {
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`${msg} expected ~${expected}, got ${actual}`);
  }
}

export function summary() {
  return { passed, failed, failures, total: passed + failed };
}

export function renderResults(container) {
  const { passed, failed, failures, total } = summary();
  container.innerHTML = `
    <h1>תוצאות בדיקות</h1>
    <p class="${failed ? 'fail' : 'pass'}">${passed}/${total} עברו${failed ? ` · ${failed} נכשלו` : ''}</p>
    ${failures.length ? `<ul>${failures.map((f) => `<li class="fail"><strong>${f.name}</strong>: ${f.message}</li>`).join('')}</ul>` : ''}`;
}
