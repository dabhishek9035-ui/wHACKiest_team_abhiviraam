export const LANGUAGE_CAPABILITIES = {
  'en-IN': { label: 'English (India)', stt: true, tts: true },
  'hi-IN': { label: 'Hindi', stt: true, tts: true },
  'bn-IN': { label: 'Bengali', stt: true, tts: true },
  'gu-IN': { label: 'Gujarati', stt: true, tts: true },
  'kn-IN': { label: 'Kannada', stt: true, tts: true },
  'ml-IN': { label: 'Malayalam', stt: true, tts: true },
  'mr-IN': { label: 'Marathi', stt: true, tts: true },
  'od-IN': { label: 'Odia', stt: true, tts: true },
  'pa-IN': { label: 'Punjabi', stt: true, tts: true },
  'ta-IN': { label: 'Tamil', stt: true, tts: true },
  'te-IN': { label: 'Telugu', stt: true, tts: true }
} as const;
export type SupportedLanguage = keyof typeof LANGUAGE_CAPABILITIES;
export function supportsVoice(language: string) { return Object.hasOwn(LANGUAGE_CAPABILITIES, language); }
