# Pengu desktop UI (M2)

React + TypeScript UI used inside the Tauri pet window. M2 owns this folder.

## Run the UI mock

From this folder, run `npm run dev` and open the printed local address with `?mock=1` appended. The mock responds to typed requests, demonstrates an approval preview when the request includes “send”, and returns a sample pending task for the restore view. Avatar persistence requires the Tauri desktop app.

## Run against the local agent

Start the agent on `127.0.0.1:7777`, set `PENGU_WS_TOKEN` for the Tauri process, then start the desktop app. The UI reads the token through a Tauri command and connects to the local WebSocket. In a browser, set `VITE_PENGU_MOCK=1` to use the mock; the browser does not receive an authentication secret.

## M2 status

The pet shell, tap/double-tap and drag handling, avatar choose/preview/apply/reset, typed composer, chat, activity, approval review, history, pending restore controls, microphone capture, transcript display and TTS playback are implemented. The event adapter follows `00_GLOBAL_PROMPT.md` section 7.1. Live end-to-end behavior requires the M1 WebSocket server and its auth handshake, M3 voice routes, and M4 persisted task list to be implemented and running.
