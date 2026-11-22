import { LANGUAGE_CAPABILITIES, supportsVoice } from './languages.js';
import { transcribeAudio } from './stt.js';
import { synthesizeSpeech } from './tts.js';

export async function transcribe(input: { audio: Buffer; mime: string; languageHint?: string }) {
  if (input.languageHint && !supportsVoice(input.languageHint)) return { unsupported: true as const, reason: `Unsupported speech language: ${input.languageHint}` };
  const result = await transcribeAudio(input.audio, input.mime, input.languageHint);
  return { text: result.text, language: result.language, confidence: result.confidence };
}
export async function synthesize(input: { text: string; language: string }) { return synthesizeSpeech(input.text, input.language); }
export { LANGUAGE_CAPABILITIES };
