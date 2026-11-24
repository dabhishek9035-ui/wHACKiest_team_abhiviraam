import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_CAPABILITIES, supportsVoice } from '../languages.js';
import { synthesizeSpeech } from '../tts.js';

test('voice capability table includes only verified Saaras and Bulbul overlap', () => {
  assert.equal(supportsVoice('en-IN'), true);
  assert.equal(supportsVoice('hi-IN'), true);
  assert.equal(supportsVoice('as-IN'), false);
  assert.equal(Object.keys(LANGUAGE_CAPABILITIES).length, 11);
});
test('unsupported language is explicit and does not require a Sarvam key', async () => {
  delete process.env.SARVAM_API_KEY;
  assert.deepEqual(await synthesizeSpeech('hello', 'as-IN'), { unsupported: true, reason: 'No configured Saaras/Bulbul voice path for as-IN.' });
});
