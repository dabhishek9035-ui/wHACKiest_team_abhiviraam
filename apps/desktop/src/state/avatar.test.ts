import { describe, expect, it } from "vitest";
import {
  bytesToDataUrl,
  commitAvatar,
  createMemoryAvatarPersistence,
  readAvatarFile,
  revertAvatar,
  sniffAvatarMime,
  validateAvatarChoice,
} from "./avatar";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function asFile(name: string, type: string, bytes: Uint8Array): File {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new File([copy], name, { type });
}

describe("avatar choice", () => {
  it("accepts png, jpg, and webp", () => {
    expect(sniffAvatarMime(PNG)).toBe("image/png");
    expect(sniffAvatarMime(JPEG)).toBe("image/jpeg");
    expect(sniffAvatarMime(WEBP)).toBe("image/webp");
    expect(validateAvatarChoice({ name: "pet.png", type: "image/png", size: PNG.length }).ok).toBe(
      true,
    );
    expect(validateAvatarChoice({ name: "pet.jpg", type: "image/jpeg", size: JPEG.length }).ok).toBe(
      true,
    );
    expect(
      validateAvatarChoice({ name: "pet.webp", type: "image/webp", size: WEBP.length }).ok,
    ).toBe(true);
  });

  it("rejects other types, empty files, and extension mismatches", () => {
    expect(validateAvatarChoice({ name: "pet.gif", type: "image/gif", size: 12 }).ok).toBe(false);
    expect(validateAvatarChoice({ name: "pet.png", type: "image/png", size: 0 }).ok).toBe(false);
    expect(validateAvatarChoice({ name: "pet.png", type: "image/jpeg", size: 12 }).ok).toBe(false);
  });

  it("uses the extension when the browser omits a specific mime", async () => {
    const read = await readAvatarFile(asFile("pet.jpeg", "application/octet-stream", JPEG));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.avatar.mime).toBe("image/jpeg");
  });

  it("does not accept a renamed file whose bytes are a different image", async () => {
    const read = await readAvatarFile(asFile("pet.png", "image/png", JPEG));
    expect(read.ok).toBe(false);
  });
});

describe("avatar persistence", () => {
  it("restores a saved image in a new store and clears it on reset", async () => {
    const first = createMemoryAvatarPersistence();
    await first.save({ mime: "image/png", bytes: PNG });
    const second = createMemoryAvatarPersistence(first.snapshot());
    const loaded = await second.load();
    expect(loaded?.mime).toBe("image/png");
    expect(Array.from(loaded?.bytes ?? [])).toEqual(Array.from(PNG));
    expect(bytesToDataUrl(PNG, "image/png").startsWith("data:image/png;base64,")).toBe(true);

    await second.reset();
    const third = createMemoryAvatarPersistence(second.snapshot());
    expect(await third.load()).toBeNull();
  });

  it("applies only after save and reset returns the default penguin", async () => {
    const store = createMemoryAvatarPersistence();
    const applied = await commitAvatar(store, { mime: "image/jpeg", bytes: JPEG });
    expect(applied.startsWith("data:image/jpeg;base64,")).toBe(true);
    const restored = createMemoryAvatarPersistence(store.snapshot());
    expect((await restored.load())?.mime).toBe("image/jpeg");
    const resetSrc = await revertAvatar(restored, "penguin://default");
    expect(resetSrc).toBe("penguin://default");
    expect(await createMemoryAvatarPersistence(restored.snapshot()).load()).toBeNull();
  });

  it("keeps the previous image when the new bytes are not an allowed image", async () => {
    const store = createMemoryAvatarPersistence();
    await store.save({ mime: "image/webp", bytes: WEBP });
    await expect(store.save({ mime: "image/png", bytes: JPEG })).rejects.toThrow(/PNG, JPG, or WebP/);
    const loaded = await store.load();
    expect(loaded?.mime).toBe("image/webp");
  });
});
