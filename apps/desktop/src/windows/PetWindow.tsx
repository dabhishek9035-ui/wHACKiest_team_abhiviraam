// owner: M2
// purpose: floating pet window
// public interface: single tap opens the composer, double tap opens the workspace, drag does not tap

import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { StatusBadge } from "../components/StatusBadge";
import { createTauriAvatarPersistence, loadAppliedAvatarSrc } from "../state/avatar";
import { PENGU_DEFAULT_SRC, resolvePetSprite } from "../state/petAssets";
import { getPetState, subscribePetState, type PetState } from "../state/store";
import { Composer } from "./Composer";
import { DOUBLE_TAP_MS, resolvePointerRelease, isDrag, type Point } from "./petGesture";
import { Workspace } from "./Workspace";
import { useAgent } from "../state/useAgent";

export type PetPanel = "pet" | "composer" | "workspace";

const PANEL_SIZE: Record<PetPanel, { width: number; height: number }> = {
  pet: { width: 220, height: 280 },
  composer: { width: 360, height: 600 },
  workspace: { width: 560, height: 760 },
};

async function fitWindow(panel: PetPanel): Promise<void> {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  const next = PANEL_SIZE[panel];
  const scale = await win.scaleFactor();
  const current = (await win.outerSize()).toLogical(scale);
  const origin = (await win.outerPosition()).toLogical(scale);
  const bottom = origin.y + current.height;
  const monitor = await currentMonitor();
  const workAreaPosition = monitor?.workArea.position.toLogical(monitor.scaleFactor);
  const workAreaSize = monitor?.workArea.size.toLogical(monitor.scaleFactor);
  const width = Math.min(next.width, workAreaSize?.width ?? next.width);
  const height = Math.min(next.height, workAreaSize?.height ?? next.height);
  const targetX = origin.x + (current.width - width) / 2;
  const targetY = bottom - height;
  const x = workAreaPosition && workAreaSize
    ? Math.max(workAreaPosition.x, Math.min(targetX, workAreaPosition.x + workAreaSize.width - width))
    : targetX;
  const y = workAreaPosition && workAreaSize
    ? Math.max(workAreaPosition.y, Math.min(targetY, workAreaPosition.y + workAreaSize.height - height))
    : targetY;
  await win.setSize(new LogicalSize(width, height));
  await win.setPosition(
    new LogicalPosition(Math.round(x), Math.round(y)),
  );
}

function clearTimer(timer: { current: number | null }) {
  if (timer.current !== null) {
    window.clearTimeout(timer.current);
    timer.current = null;
  }
}

export function PetWindow() {
  const agent = useAgent();
  const persistence = useMemo(() => createTauriAvatarPersistence(), []);
  const [panel, setPanel] = useState<PetPanel>("pet");
  const [customAvatarSrc, setCustomAvatarSrc] = useState<string | null>(null);
  const [avatarNotice, setAvatarNotice] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [petState, setPetState] = useState<PetState>(getPetState);
  const start = useRef<Point | null>(null);
  const dragged = useRef(false);
  const lastTapAt = useRef<number | null>(null);
  const singleTimer = useRef<number | null>(null);

  useEffect(() => subscribePetState(setPetState), []);

  useEffect(() => {
    const audioEvent = [...agent.events].reverse().find((event) => event.type === "tts.audio");
    if (!audioEvent || !audioEvent.base64 || !audioEvent.mime) return;
    const audio = new Audio(`data:${String(audioEvent.mime)};base64,${String(audioEvent.base64)}`);
    void audio.play().catch(() => undefined);
  }, [agent.events]);

  useEffect(() => {
    let cancelled = false;
    void loadAppliedAvatarSrc(persistence, PENGU_DEFAULT_SRC).then((loaded) => {
      if (cancelled) return;
      setCustomAvatarSrc(loaded.src === PENGU_DEFAULT_SRC ? null : loaded.src);
      setAvatarNotice(loaded.notice);
    });
    return () => {
      cancelled = true;
    };
  }, [persistence]);

  useEffect(() => {
    return () => clearTimer(singleTimer);
  }, []);

  function show(next: PetPanel) {
    setPanel(next);
    void fitWindow(next).catch(() => {
      // The browser preview has no Tauri window. The panel still changes.
    });
  }

  function markDrag() {
    dragged.current = true;
    setIsDragging(true);
    lastTapAt.current = null;
    clearTimer(singleTimer);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    start.current = { x: event.screenX, y: event.screenY };
    dragged.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some pointers cannot be captured. Move and release still reach this button.
    }
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!start.current || dragged.current || event.buttons !== 1) return;
    const current = { x: event.screenX, y: event.screenY };
    if (!isDrag(start.current, current)) return;
    markDrag();
    if (!isTauri()) return;
    void getCurrentWindow()
      .startDragging()
      .catch(() => {
        // Drag is unavailable outside the Tauri window.
      });
  }

  function onPointerUp() {
    const wasDrag = dragged.current;
    start.current = null;
    dragged.current = false;
    setIsDragging(false);
    const release = resolvePointerRelease(wasDrag, lastTapAt.current, Date.now());
    if (release === "drag") {
      lastTapAt.current = null;
      clearTimer(singleTimer);
      return;
    }
    if (release === "double") {
      clearTimer(singleTimer);
      lastTapAt.current = null;
      show("workspace");
      return;
    }

    const now = Date.now();
    lastTapAt.current = now;
    clearTimer(singleTimer);
    singleTimer.current = window.setTimeout(() => {
      lastTapAt.current = null;
      singleTimer.current = null;
      show("composer");
    }, DOUBLE_TAP_MS);
  }

  function onPointerCancel() {
    markDrag();
    start.current = null;
    dragged.current = false;
    setIsDragging(false);
  }

  const displayedPetSrc = resolvePetSprite(petState, customAvatarSrc, isDragging);

  return (
    <div className={`pet-shell panel-${panel}`}>
      {panel === "composer" ? <Composer onClose={() => show("pet")} send={agent.send} events={agent.events} /> : null}
      {panel === "workspace" ? (
        <Workspace
          onClose={() => show("pet")}
          defaultAvatarSrc={PENGU_DEFAULT_SRC}
          appliedAvatarSrc={customAvatarSrc ?? PENGU_DEFAULT_SRC}
          persistence={persistence}
          onAvatarApplied={(src) => {
            setCustomAvatarSrc(src === PENGU_DEFAULT_SRC ? null : src);
            setAvatarNotice(null);
          }}
          events={agent.events}
          send={agent.send}
          status={agent.status}
        />
      ) : null}
      <div className={`pet-stack state-${petState}`}>
        <StatusBadge state={petState} />
        {avatarNotice ? <p className="avatar-notice">{avatarNotice}</p> : null}
        <button
          type="button"
          className="pet-hit"
          aria-label="Pengu"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <img src={displayedPetSrc} alt="" draggable={false} />
        </button>
      </div>
    </div>
  );
}
