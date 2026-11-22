import { supportsVoice } from './languages.js';
export async function synthesizeSpeech(text: string, language: string): Promise<{ audioBase64: string; mime: string } | { unsupported: true; reason: string }> {
  if (!supportsVoice(language)) return { unsupported: true, reason: `No configured Saaras/Bulbul voice path for ${language}.` };
  if (!text.trim()) throw new Error('text is required');
  if (text.length > 2500) throw new Error('Bulbul REST accepts at most 2500 characters per request');
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error('SARVAM_API_KEY is required for speech synthesis');
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST', headers: { 'api-subscription-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, language_code: language, model: 'bulbul:v3', speaker: 'shubh', speech_sample_rate: 22050, output_audio_codec: 'wav' }),
    signal: AbortSignal.timeout(90_000)
  });
  if (!response.ok) throw new Error(`Sarvam TTS failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { audios?: string[] };
  const audioBase64 = data.audios?.[0];
  if (!audioBase64) throw new Error('Sarvam TTS response did not include audio');
  return { audioBase64, mime: 'audio/wav' };
}
