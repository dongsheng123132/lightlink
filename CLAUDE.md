# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LightLink is a phone-to-phone optical communication web app. Two phones face each other — one uses screen flashes (green #00ff88 by default) to send Morse-coded signals, the other uses its camera to receive and decode them. No network or Bluetooth needed.

## Development

This is a static site with no build step, no framework, and no dependencies — just HTML/CSS/JS.

**Local dev server:**
```bash
python3 -m http.server 8080
```
Note: Camera API (`getUserMedia`) requires HTTPS or localhost. Non-localhost HTTP won't work on mobile. For mobile testing, use mkcert + https-server or deploy to Vercel.

**Deploy to Vercel:**
```bash
npx vercel --prod
```

The `vercel.json` sets `Permissions-Policy: camera=(*), microphone=(*)` headers and outputs from the root directory with no build command.

## Architecture

All logic lives in a single `app.js` file with three classes:

- **`SignalSender`** — Drives `#signal-display` element on/off to flash Morse code. Handles SOS handshake pattern and text-to-Morse encoding with configurable speed profiles (slow/medium/fast) and signal colors.
- **`SignalReceiver`** — Captures camera frames via Canvas 2D, computes green-weighted brightness on the center 60% region, uses an adaptive threshold with hysteresis to detect on/off transitions, records pulse durations, detects SOS patterns, and decodes Morse messages (including preamble detection and end markers).
- **`App`** — Orchestrates UI, manages connection state (SOS handshake flow: both sides must send+receive SOS to become "connected"), handles quick message buttons and text input, and wires sender/receiver callbacks.

## Communication Protocol

1. **Handshake**: SOS (`···---···`) sent by both sides. Auto-reply on receipt. Connection established when both sent and received.
2. **Preamble**: 5 rapid half-dot flashes before each message for clock synchronization.
3. **Data**: Standard Morse code (A-Z, 0-9, punctuation). Supports three speed profiles defined in `SPEED_PROFILES`.
4. **End marker**: A double-length dash signals transmission complete.
5. **Decoding**: Receiver estimates unit time from the 25th percentile of ON-pulse durations, classifies dots vs dashes at the 2x boundary, and uses 2x/5x thresholds for character/word gaps.

## Key Technical Details

- Signal analysis runs in `requestAnimationFrame` loop at camera framerate
- Adaptive threshold smoothed with 0.95/0.05 exponential weighting over last 60 brightness samples
- Sensitivity setting (1-10) shifts the threshold ratio between 0.3 and 0.7
- Only English/numbers supported directly; Chinese mapped via quick message dictionary (`QUICK_MESSAGES`)
- PWA manifest configured for standalone portrait mode
- UI is Chinese (zh-CN), mobile-first dark theme
