/**
 * owner: M1 (Ronit Kapar)
 * purpose: Frozen Voice API contract implemented by M3 (services/agent/src/voice) and mounted by M1 (Section 7.5).
 */

export interface TranscribeInput {
  audio: string; // base64-encoded audio payload
  mime: string;
  languageHint?: string;
}

export interface TranscribeOutput {
  text: string;
  language: string;
  confidence?: number;
}

export interface SynthesizeInput {
  text: string;
  language: string;
}

export interface SynthesizeAudioOutput {
  audioBase64: string;
  mime: string;
}

export interface SynthesizeUnsupportedOutput {
  unsupported: true;
  reason: string;
}

export type SynthesizeOutput =
  | SynthesizeAudioOutput
  | SynthesizeUnsupportedOutput;

export interface VoiceLanguageCapability {
  code: string;
  name: string;
  sttSupported: boolean;
  ttsSupported: boolean;
}

export interface VoiceService {
  transcribe(input: TranscribeInput): Promise<TranscribeOutput>;
  synthesize(input: SynthesizeInput): Promise<SynthesizeOutput>;
}

export function isSynthesizeUnsupported(
  output: SynthesizeOutput
): output is SynthesizeUnsupportedOutput {
  return "unsupported" in output && output.unsupported === true;
}
