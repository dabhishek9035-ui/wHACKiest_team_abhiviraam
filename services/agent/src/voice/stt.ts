const API = 'https://api.sarvam.ai/speech-to-text';
export async function transcribeAudio(audio: Buffer, mime: string, languageHint?: string) {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error('SARVAM_API_KEY is required for speech recognition');
  if (!audio.length || audio.length > 20 * 1024 * 1024) throw new Error('Audio must be between 1 byte and 20 MB');
  const extension = mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('flac') ? 'flac' : undefined;
  if (!extension) throw new Error(`Unsupported audio MIME type: ${mime}`);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `recording.${extension}`);
  form.append('model', 'saaras:v4');
  form.append('mode', 'transcribe');
  if (languageHint) form.append('language_code', languageHint);
  const response = await fetch(API, { method: 'POST', headers: { 'api-subscription-key': key }, body: form, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Sarvam STT failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { transcript?: string; language_code?: string | null; language_probability?: number | null };
  if (!data.transcript) throw new Error('Sarvam STT response did not include a transcript');
  return { text: data.transcript, language: data.language_code ?? languageHint ?? 'unknown', confidence: data.language_probability ?? undefined };
}
