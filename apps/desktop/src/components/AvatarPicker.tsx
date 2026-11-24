// owner: M2
// purpose: choose a PNG, JPG, or WebP, preview it, then apply or reset
// public interface: preview stays off the pet until Apply; Reset restores the default penguin
// consumed by: Workspace

import { useState } from "react";
import {
  bytesToDataUrl,
  commitAvatar,
  readAvatarFile,
  revertAvatar,
  type AvatarPersistence,
  type StoredAvatar,
} from "../state/avatar";

interface AvatarPickerProps {
  defaultSrc: string;
  appliedSrc: string;
  persistence: AvatarPersistence;
  onApplied: (src: string) => void;
}

export function AvatarPicker({
  defaultSrc,
  appliedSrc,
  persistence,
  onApplied,
}: AvatarPickerProps) {
  const [pending, setPending] = useState<StoredAvatar | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function errorText(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    return fallback;
  }

  async function onChoose(file: File | undefined) {
    if (!file) return;
    const read = await readAvatarFile(file);
    if (!read.ok) {
      setPending(null);
      setPreviewSrc(null);
      setMessage(read.message);
      return;
    }
    setPending(read.avatar);
    setPreviewSrc(bytesToDataUrl(read.avatar.bytes, read.avatar.mime));
    setMessage("Preview only. The pet image changes after you apply it.");
  }

  async function onApply() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      onApplied(await commitAvatar(persistence, pending));
      setPending(null);
      setPreviewSrc(null);
      setMessage("Applied. This image is restored the next time Pengu opens.");
    } catch (error) {
      setMessage(errorText(error, "The image could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    if (busy) return;
    setBusy(true);
    try {
      onApplied(await revertAvatar(persistence, defaultSrc));
      setPending(null);
      setPreviewSrc(null);
      setMessage("Reset to the default penguin.");
    } catch (error) {
      setMessage(errorText(error, "The image could not be reset."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="avatar-picker" aria-label="Avatar">
      <div className="panel-head">
        <span>Avatar</span>
      </div>
      <p className="avatar-note">PNG, JPG, or WebP. Preview before applying.</p>
      <div className="avatar-row">
        <figure>
          <img src={appliedSrc} alt="Current avatar" />
          <figcaption>Current</figcaption>
        </figure>
        {previewSrc ? (
          <figure>
            <img src={previewSrc} alt="Preview of the selected avatar" />
            <figcaption>Preview</figcaption>
          </figure>
        ) : null}
      </div>
      <div className="avatar-actions">
        <label className="file-button">
          Choose image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void onChoose(file);
            }}
          />
        </label>
        <button type="button" onClick={() => void onApply()} disabled={!pending || busy}>
          Apply
        </button>
        <button type="button" onClick={() => void onReset()} disabled={busy}>
          Reset to penguin
        </button>
      </div>
      {message ? <p className="avatar-message">{message}</p> : null}
    </section>
  );
}
