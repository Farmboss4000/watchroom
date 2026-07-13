// Unit tests for the pure logic in lib.mjs. Run with: node test.mjs
// (No dependencies required — this does not touch Firebase or the network.)
import assert from 'node:assert/strict';
import { normalizeBill, parseJsonObject, buildPrompt, CATEGORIES } from './lib.mjs';

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

check('strips currency + commas from amount', () => {
    assert.equal(normalizeBill({ amount: '$1,489.99' }).amount, 1489.99);
});
check('bad amount → 0', () => {
    assert.equal(normalizeBill({ amount: 'n/a' }).amount, 0);
});
check('keeps valid ISO dates, drops bad ones', () => {
    const b = normalizeBill({ billDate: '2026-07-01', dueDate: 'July 15' });
    assert.equal(b.billDate, '2026-07-01');
    assert.equal(b.dueDate, '');
});
check('maps known category case-insensitively', () => {
    assert.equal(normalizeBill({ category: 'electric' }).category, 'Electric');
});
check('unknown category → Other; empty stays empty', () => {
    assert.equal(normalizeBill({ category: 'Widgets' }).category, 'Other');
    assert.equal(normalizeBill({ category: '' }).category, '');
});
check('trims text fields', () => {
    assert.equal(normalizeBill({ vendor: '  Xcel Energy  ' }).vendor, 'Xcel Energy');
});
check('parseJsonObject extracts JSON from noisy text', () => {
    assert.deepEqual(parseJsonObject('sure!\n{"vendor":"ACME"}\nthanks'), { vendor: 'ACME' });
});
check('parseJsonObject throws when no JSON', () => {
    assert.throws(() => parseJsonObject('no json here'));
});
check('buildPrompt includes the category list', () => {
    assert.ok(buildPrompt(CATEGORIES).includes('Electric'));
});

console.log(`\n${passed} tests passed.`);
