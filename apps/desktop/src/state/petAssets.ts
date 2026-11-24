// owner: M2
// purpose: State-to-asset mapping for the default animated Pengu pixel pet (GIFs and PNGs).
// public interface: PENGU_DEFAULT_SRC, PENGU_DRAGGED_SRC, PET_STATE_ASSETS, resolvePetSprite.
// consumed by: PetWindow, petAssets.test.ts

import penguAlertPng from "../assets/pengu/pengu_alert.png";
import penguDraggedPng from "../assets/pengu/pengu_dragged.png";
import penguHappyGif from "../assets/pengu/pengu_happy.gif";
import penguIdleGif from "../assets/pengu/pengu_idle.gif";
import penguSadPng from "../assets/pengu/pengu_sad.png";
import penguThinkingGif from "../assets/pengu/pengu_thinking.gif";
import penguWaveGif from "../assets/pengu/pengu_wave.gif";
import penguWorkingGif from "../assets/pengu/pengu_working.gif";
import type { PetState } from "./store";

export const PENGU_DEFAULT_SRC: string = penguIdleGif;
export const PENGU_DRAGGED_SRC: string = penguDraggedPng;

export const PET_STATE_ASSETS: Record<PetState, string> = {
  idle: penguIdleGif,
  listening: penguWaveGif,
  thinking: penguThinkingGif,
  executing: penguWorkingGif,
  awaiting_approval: penguAlertPng,
  completed: penguHappyGif,
  failed: penguSadPng,
};

export function resolvePetSprite(
  state: PetState,
  customAvatarSrc: string | null,
  isDragging: boolean,
): string {
  if (customAvatarSrc !== null) return customAvatarSrc;
  if (isDragging) return PENGU_DRAGGED_SRC;
  return PET_STATE_ASSETS[state];
}
