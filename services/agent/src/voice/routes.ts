import type { VoiceService } from '@pengu/contracts';
import { LANGUAGE_CAPABILITIES, supportsVoice } from './languages.js';
import { transcribeAudio } from './stt.js';
import { synthesizeSpeech } from './tts.js';

export async function transcribe(input: { audio: Buffer; mime: string; languageHint?: string }) {
  if (input.languageHint && !supportsVoice(input.languageHint)) return { unsupported: true as const, reason: `Unsupported speech language: ${input.languageHint}` };
  const result = await transcribeAudio(input.audio, input.mime, input.languageHint);
  return { text: result.text, language: result.language, confidence: result.confidence };
}
export async function synthesize(input: { text: string; language: string }) { return synthesizeSpeech(input.text, input.language); }
export function createVoiceService(): VoiceService {
  return {
    async transcribe(input) {
      const result = await transcribe({
        audio: Buffer.from(input.audio, 'base64'),
        mime: input.mime,
        languageHint: input.languageHint,
      });
      if ('unsupported' in result && result.unsupported) {
        throw new Error(result.reason);
      }
      return result;
    },
    async synthesize(input) {
      return synthesize(input);
    },
  };
}
export { LANGUAGE_CAPABILITIES };
