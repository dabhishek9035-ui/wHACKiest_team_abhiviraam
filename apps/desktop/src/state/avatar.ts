// owner: M2
// purpose: choose, preview, apply, persist and reset the pet image
// public interface: PNG/JPG/WebP validation plus a Tauri app-data store
// consumed by: AvatarPicker, PetWindow

import { invoke, isTauri } from "@tauri-apps/api/core";

export const AVATAR_MAX_BYTES = 2_000_000;

export const AVATAR_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

export type AvatarMime = (typeof AVATAR_MIMES)[number];

export interface StoredAvatar {
  mime: AvatarMime;
  bytes: Uint8Array;
}

export interface AvatarPersistence {
  load(): Promise<StoredAvatar | null>;
  save(avatar: StoredAvatar): Promise<void>;
  reset(): Promise<void>;
}

export type AvatarChoice =
  | { ok: true; mime: AvatarMime }
  | { ok: false; message: string };

export type AvatarRead =
  | { ok: true; avatar: StoredAvatar }
  | { ok: false; message: string };

interface AvatarFileLike {
  name: string;
  type: string;
  size: number;
}

const EXT_MIME: Record<string, AvatarMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function isAvatarMime(value: string): value is AvatarMime {
  return (AVATAR_MIMES as readonly string[]).includes(value);
}

export function sniffAvatarMime(bytes: Uint8Array): AvatarMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function extensionMime(name: string): AvatarMime | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

function declaredMime(type: string): AvatarMime | null | "generic" {
  const value = type.toLowerCase().split(";")[0]?.trim() ?? "";
  if (value === "" || value === "application/octet-stream") return "generic";
  if (value === "image/jpg" || value === "image/jpeg" || value === "image/pjpeg") {
    return "image/jpeg";
  }
  if (value === "image/png" || value === "image/webp") return value;
  return null;
}

export function validateAvatarChoice(file: AvatarFileLike): AvatarChoice {
  if (file.size <= 0) return { ok: false, message: "That file is empty." };
  if (file.size > AVATAR_MAX_BYTES) {
    return { ok: false, message: "Choose an image smaller than 2 MB." };
  }
  const fromExt = extensionMime(file.name);
  const fromType = declaredMime(file.type);
  if (fromType === null) {
    return { ok: false, message: "Choose a PNG, JPG, or WebP image." };
  }
  if (fromType === "generic") {
    if (!fromExt) return { ok: false, message: "Choose a PNG, JPG, or WebP image." };
    return { ok: true, mime: fromExt };
  }
  if (fromExt && fromExt !== fromType) {
    return { ok: false, message: "The file type does not match its extension." };
  }
  return { ok: true, mime: fromType };
}

export async function readAvatarFile(file: File): Promise<AvatarRead> {
  const choice = validateAvatarChoice(file);
  if (!choice.ok) return choice;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffAvatarMime(bytes);
  if (sniffed !== choice.mime) {
    return { ok: false, message: "That file is not a PNG, JPG, or WebP image." };
  }
  return { ok: true, avatar: { mime: sniffed, bytes } };
}

export function bytesToDataUrl(bytes: Uint8Array, mime: AvatarMime): string {
  let binary = "";
  const chunk = 0x1000;
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    binary += String.fromCharCode(...slice);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

interface AvatarDto {
  mime: string;
  bytes: number[];
}

function fromDto(dto: AvatarDto): StoredAvatar | null {
  if (!isAvatarMime(dto.mime)) return null;
  const bytes = Uint8Array.from(dto.bytes);
  if (sniffAvatarMime(bytes) !== dto.mime) return null;
  return { mime: dto.mime, bytes };
}

export function createMemoryAvatarPersistence(initial: StoredAvatar | null = null): AvatarPersistence & {
  snapshot(): StoredAvatar | null;
} {
  let current = initial
    ? { mime: initial.mime, bytes: new Uint8Array(initial.bytes) }
    : null;
  return {
    snapshot() {
      return current ? { mime: current.mime, bytes: new Uint8Array(current.bytes) } : null;
    },
    async load() {
      return current ? { mime: current.mime, bytes: new Uint8Array(current.bytes) } : null;
    },
    async save(avatar) {
      const sniffed = sniffAvatarMime(avatar.bytes);
      if (sniffed !== avatar.mime) {
        throw new Error("That file is not a PNG, JPG, or WebP image.");
      }
      current = { mime: avatar.mime, bytes: new Uint8Array(avatar.bytes) };
    },
    async reset() {
      current = null;
    },
  };
}

const DESKTOP_REQUIRED =
  "Apply saves the image in the Pengu application data folder. Open the desktop window to store it.";

export function createTauriAvatarPersistence(): AvatarPersistence {
  return {
    async load() {
      if (!isTauri()) return null;
      const dto = await invoke<AvatarDto | null>("load_avatar");
      if (!dto) return null;
      return fromDto(dto);
    },
    async save(avatar) {
      if (!isTauri()) throw new Error(DESKTOP_REQUIRED);
      const sniffed = sniffAvatarMime(avatar.bytes);
      if (sniffed !== avatar.mime) {
        throw new Error("That file is not a PNG, JPG, or WebP image.");
      }
      await invoke("save_avatar", {
        bytes: Array.from(avatar.bytes),
        mime: avatar.mime,
      });
    },
    async reset() {
      if (!isTauri()) throw new Error(DESKTOP_REQUIRED);
      await invoke("reset_avatar");
    },
  };
}

export async function commitAvatar(
  persistence: AvatarPersistence,
  pending: StoredAvatar,
): Promise<string> {
  await persistence.save(pending);
  return bytesToDataUrl(pending.bytes, pending.mime);
}

export async function revertAvatar(
  persistence: AvatarPersistence,
  defaultSrc: string,
): Promise<string> {
  await persistence.reset();
  return defaultSrc;
}

export async function loadAppliedAvatarSrc(
  persistence: AvatarPersistence,
  defaultSrc: string,
): Promise<{ src: string; notice: string | null }> {
  try {
    const stored = await persistence.load();
    if (!stored) return { src: defaultSrc, notice: null };
    return { src: bytesToDataUrl(stored.bytes, stored.mime), notice: null };
  } catch {
    return {
      src: defaultSrc,
      notice: "The saved image could not be read. Showing the default penguin.",
    };
  }
}
