# Voice input for the assistant chat

Add a microphone button to the assistant so you can dictate a message instead of typing it. The audio is transcribed by one of your own AI connections, the text lands in the chat input, and you send it as usual. Replies stay text-only.

## How it will work

1. Tap the mic button next to the paperclip in the chat (bubble and full page).
2. It records while you speak, showing a live timer and a stop button.
3. On stop, the recording is sent to the server, transcribed, and the resulting text is placed in the input box so you can correct it before sending.
4. Optional convenience: a small "send right away" toggle for hands-free entry.

## Which connection transcribes

Transcription becomes a third AI action alongside "Chat" and "Read statement", so in Settings → AI you pick which connection handles it, with the same fallback behaviour. It calls the OpenAI-compatible `/audio/transcriptions` endpoint of that connection, so a self-hosted Whisper / faster-whisper server or a commercial endpoint both work.

Because the transcription model name differs from the chat model, each connection gets an optional "Transcription model" field (e.g. `whisper-1`, `Systran/faster-whisper-large-v3`). If it is empty, that connection is not offered for voice. If no connection can transcribe, the mic button is hidden and its tooltip points to Settings.

## Technical details

- `src/components/VoiceRecorder.tsx` (new): captures mic audio with the Web Audio API, downsamples to 16 kHz mono and encodes a complete WAV blob (avoids the headerless-chunk and Safari fragmented-MP4 problems of MediaRecorder). Guards against empty/near-silent recordings and clips longer than ~2 minutes.
- `src/components/AssistantChat.tsx`: mic button, recording state (timer, stop, cancel), inserts the transcript into the existing `input` state; permission-denied and transcription errors surface via `toast`.
- `src/utils/ai.functions.ts`: new auth-protected `transcribeAudio` server function (base64 WAV + optional endpoint id).
- `src/utils/ai.server.ts`: `runTranscription()` — resolves the endpoint through the existing action-binding/fallback logic for the new `transcribe` action, posts `multipart/form-data` (`file`, `model`, optional `language`) to `${base_url}/audio/transcriptions`, rejects oversized uploads (~10 MB) and returns `text`. Provider errors are surfaced verbatim like the chat path.
- `src/lib/ai/types.ts`: add `transcribe` to `AI_ACTIONS`, add `transcribe_model` to `AIEndpoint`.
- Migration: add `transcribe_model text` to `ai_endpoints`; extend the action constraint to include `transcribe`.
- `src/components/AISettingsCard.tsx`: transcription-model input per connection plus the new action binding row.
- Audit: write a `transcribe` entry to `ai_audit_logs` (endpoint, model, clip duration, usage if reported); extend the kind constraint and the filter in `AIAuditLogCard.tsx`.
- i18n keys for all new labels (de/en) and a short Help page paragraph under the AI section.
- Bump the `package.json` version.

## Not included

- Spoken replies (TTS) and hands-free conversation mode — can be layered on top later.