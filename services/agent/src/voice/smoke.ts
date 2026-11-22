import { transcribe, synthesize } from './routes.js';
const lang = process.argv[2] ?? 'en-IN';
const audioPath = process.argv[3];
if (!audioPath) throw new Error('Usage: npm run voice:smoke -- <en-IN|hi-IN> <path-to-audio-file-under-30-seconds>');
const fs = await import('node:fs/promises');
const audio = await fs.readFile(audioPath);
const stt = await transcribe({ audio, mime: audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/webm', languageHint: lang });
console.log(JSON.stringify({ stt }, null, 2));
if ('text' in stt) {
  const tts = await synthesize({ text: `You said: ${stt.text}`, language: stt.language ?? lang });
  console.log(JSON.stringify({ tts: 'audioBase64' in tts ? { returned: true, mime: tts.mime, bytes: Buffer.from(tts.audioBase64, 'base64').length } : tts }, null, 2));
}
