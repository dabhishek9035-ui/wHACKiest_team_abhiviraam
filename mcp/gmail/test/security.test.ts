import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256, signApproval, verifyApproval } from '../src/security.js';

test('canonical JSON sorts object keys and preserves array order', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, x: null } }), '{"a":{"x":null,"y":true},"z":1}');
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});
test('approval signature binds exact tool, args hash, approval id and expiry', () => {
  const secret = 'unit-test-only-secret-with-32-characters';
  const payload = { approvalId: 'a1', tool: 'gmail_send_draft', argsHash: sha256('action'), expiresAt: Date.now() + 30_000 };
  const signature = signApproval(payload, secret);
  assert.equal(verifyApproval(payload, signature, secret), true);
  assert.equal(verifyApproval({ ...payload, tool: 'gmail_get_draft' }, signature, secret), false);
  assert.equal(verifyApproval({ ...payload, argsHash: sha256('edited') }, signature, secret), false);
  assert.equal(verifyApproval({ ...payload, expiresAt: Date.now() - 1 }, signature, secret), false);
  assert.equal(verifyApproval(payload, signature, `${secret}-wrong`), false);
});
