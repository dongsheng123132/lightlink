// ============================================================
// LightLink - 手机间光通信
// Protocol: SOS Handshake → Morse Code / Binary Light Comm
// ============================================================

// ====== MORSE CODE TABLE ======
const MORSE_TABLE = {
  'A': '.-',    'B': '-...',  'C': '-.-.',  'D': '-..',
  'E': '.',     'F': '..-.',  'G': '--.',   'H': '....',
  'I': '..',    'J': '.---',  'K': '-.-',   'L': '.-..',
  'M': '--',    'N': '-.',    'O': '---',   'P': '.--.',
  'Q': '--.-',  'R': '.-.',   'S': '...',   'T': '-',
  'U': '..-',   'V': '...-',  'W': '.--',   'X': '-..-',
  'Y': '-.--',  'Z': '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...',
  '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--',
  '/': '-..-.', '@': '.--.-.', ' ': '/'
};
const REVERSE_MORSE = {};
for (const [ch, code] of Object.entries(MORSE_TABLE)) {
  if (ch !== ' ') REVERSE_MORSE[code] = ch;
}

// Quick message dictionary (short code → display)
const QUICK_MESSAGES = {
  'HI': '你好 (HI)', 'OK': '收到 (OK)', 'HELP': '帮助 (HELP)',
  'YES': '是 (YES)', 'NO': '否 (NO)', 'SOS': 'SOS'
};

// ====== SPEED PROFILES ======
const SPEED_PROFILES = {
  slow:   { dot: 200, dash: 600, gap: 200, charGap: 600, wordGap: 1400 },
  medium: { dot: 120, dash: 360, gap: 120, charGap: 360, wordGap: 840 },
  fast:   { dot: 70,  dash: 210, gap: 70,  charGap: 210, wordGap: 490 }
};

// Signal colors
const SIGNAL_COLORS = {
  green: 'on-green', white: 'on-white', cyan: 'on-cyan'
};

// ====== SIGNAL SENDER ======
class SignalSender {
  constructor(displayEl) {
    this.display = displayEl;
    this.sending = false;
    this.aborted = false;
    this.speed = SPEED_PROFILES.medium;
    this.colorClass = SIGNAL_COLORS.green;
  }

  setSpeed(profile) { this.speed = SPEED_PROFILES[profile] || SPEED_PROFILES.medium; }
  setColor(color) { this.colorClass = SIGNAL_COLORS[color] || SIGNAL_COLORS.green; }

  async flashOn(duration) {
    if (this.aborted) return;
    this.display.className = this.colorClass;
    await this._wait(duration);
    this.display.className = '';
  }

  async _wait(ms) {
    return new Promise(resolve => {
      const id = setTimeout(resolve, ms);
      this._currentTimeout = id;
    });
  }

  stop() {
    this.aborted = true;
    this.sending = false;
    clearTimeout(this._currentTimeout);
    this.display.className = '';
  }

  // Send SOS: ···---···
  async sendSOS() {
    if (this.sending) return;
    this.sending = true;
    this.aborted = false;
    const { dot, dash, gap, charGap } = this.speed;

    for (let repeat = 0; repeat < 2 && !this.aborted; repeat++) {
      // S: ···
      for (let i = 0; i < 3 && !this.aborted; i++) {
        await this.flashOn(dot);
        if (i < 2) await this._wait(gap);
      }
      if (this.aborted) break;
      await this._wait(charGap);
      // O: ---
      for (let i = 0; i < 3 && !this.aborted; i++) {
        await this.flashOn(dash);
        if (i < 2) await this._wait(gap);
      }
      if (this.aborted) break;
      await this._wait(charGap);
      // S: ···
      for (let i = 0; i < 3 && !this.aborted; i++) {
        await this.flashOn(dot);
        if (i < 2) await this._wait(gap);
      }
      if (repeat < 1) await this._wait(charGap * 3); // pause between repeats
    }
    this.sending = false;
  }

  // Send text as Morse code
  async sendText(text, onProgress) {
    if (this.sending) return;
    this.sending = true;
    this.aborted = false;
    const upper = text.toUpperCase();
    const { dot, dash, gap, charGap, wordGap } = this.speed;

    // Send preamble (sync signal): 5 rapid flashes
    for (let i = 0; i < 5 && !this.aborted; i++) {
      await this.flashOn(dot / 2);
      await this._wait(dot / 2);
    }
    await this._wait(charGap * 2); // longer pause before data

    for (let ci = 0; ci < upper.length && !this.aborted; ci++) {
      const ch = upper[ci];
      if (onProgress) onProgress(ci, upper.length, ch);

      if (ch === ' ') {
        await this._wait(wordGap);
        continue;
      }

      const morse = MORSE_TABLE[ch];
      if (!morse) continue;

      for (let si = 0; si < morse.length && !this.aborted; si++) {
        const sym = morse[si];
        if (sym === '.') await this.flashOn(dot);
        else if (sym === '-') await this.flashOn(dash);
        else if (sym === '/') await this._wait(wordGap);
        if (si < morse.length - 1) await this._wait(gap);
      }
      if (ci < upper.length - 1 && upper[ci + 1] !== ' ') {
        await this._wait(charGap);
      }
    }

    // End marker: long flash
    if (!this.aborted) {
      await this._wait(charGap * 2);
      await this.flashOn(dash * 2);
    }

    this.sending = false;
    if (onProgress) onProgress(upper.length, upper.length, '');
  }
}

// ====== SIGNAL RECEIVER ======
class SignalReceiver {
  constructor(videoEl, canvasEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    this.running = false;
    this.stream = null;
    this.sensitivity = 5;

    // Brightness tracking
    this.brightnessHistory = [];
    this.maxHistoryLen = 200;
    this.adaptiveMin = 255;
    this.adaptiveMax = 0;
    this.threshold = 128;
    this.signalState = false; // true = bright (signal ON)
    this.lastTransitionTime = 0;

    // Pulse detection
    this.pulses = []; // {state: 'on'|'off', duration: ms, startTime: ms}
    this.maxPulses = 500;

    // Callbacks
    this.onBrightness = null; // (value: 0-255) => void
    this.onSignalChange = null; // (isOn: boolean) => void
    this.onSOSDetected = null; // () => void
    this.onMessageDecoded = null; // (text: string) => void

    // SOS detection state
    this.sosCheckInterval = null;

    // Message decoding state
    this.decodeTimeout = null;
    this.preambleDetected = false;
  }

  async start(facingMode = 'user') {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();

      this.canvas.width = 160;
      this.canvas.height = 120;
      this.running = true;
      this.pulses = [];
      this.brightnessHistory = [];
      this.adaptiveMin = 255;
      this.adaptiveMax = 0;
      this.preambleDetected = false;

      this._analyzeLoop();
      this.sosCheckInterval = setInterval(() => this._checkSOS(), 500);
      return true;
    } catch (err) {
      console.error('Camera error:', err);
      return false;
    }
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    clearInterval(this.sosCheckInterval);
    clearTimeout(this.decodeTimeout);
  }

  setSensitivity(val) { this.sensitivity = val; }

  _analyzeLoop() {
    if (!this.running) return;

    const now = performance.now();
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);

    // Analyze center region for green channel brightness
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const rx = Math.floor(cw * 0.2);
    const ry = Math.floor(ch * 0.2);
    const rw = Math.floor(cw * 0.6);
    const rh = Math.floor(ch * 0.6);

    const imageData = this.ctx.getImageData(rx, ry, rw, rh);
    const data = imageData.data;

    // Calculate green-weighted brightness
    let totalBrightness = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      // Weighted: green channel is primary signal
      totalBrightness += data[i] * 0.2 + data[i + 1] * 0.6 + data[i + 2] * 0.2;
    }
    const brightness = totalBrightness / pixelCount;

    // Update adaptive threshold
    this.brightnessHistory.push({ brightness, time: now });
    if (this.brightnessHistory.length > this.maxHistoryLen) {
      this.brightnessHistory.shift();
    }

    // Use recent history for adaptive threshold
    const recentWindow = this.brightnessHistory.slice(-60);
    const values = recentWindow.map(h => h.brightness);
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Smooth adaptive range
    this.adaptiveMin = this.adaptiveMin * 0.95 + min * 0.05;
    this.adaptiveMax = this.adaptiveMax * 0.95 + max * 0.05;

    const range = this.adaptiveMax - this.adaptiveMin;
    // Sensitivity affects threshold position (higher sensitivity = lower threshold)
    const thresholdRatio = 0.3 + (10 - this.sensitivity) * 0.04;
    this.threshold = this.adaptiveMin + range * thresholdRatio;

    // Determine signal state with hysteresis
    const hysteresis = range * 0.1;
    const prevState = this.signalState;

    if (range > 5) { // Only detect if there's meaningful variation
      if (brightness > this.threshold + hysteresis) {
        this.signalState = true;
      } else if (brightness < this.threshold - hysteresis) {
        this.signalState = false;
      }
    }

    // Report brightness
    if (this.onBrightness) {
      this.onBrightness(brightness);
    }

    // Detect transitions
    if (prevState !== this.signalState) {
      if (this.onSignalChange) this.onSignalChange(this.signalState);

      const duration = now - this.lastTransitionTime;
      if (this.lastTransitionTime > 0 && duration > 10 && duration < 5000) {
        this.pulses.push({
          state: prevState ? 'on' : 'off',
          duration,
          startTime: this.lastTransitionTime
        });
        if (this.pulses.length > this.maxPulses) this.pulses.shift();

        // Try to decode message after a silence
        this._scheduleMessageDecode();
      }
      this.lastTransitionTime = now;
    }

    requestAnimationFrame(() => this._analyzeLoop());
  }

  _scheduleMessageDecode() {
    clearTimeout(this.decodeTimeout);
    const speed = this._estimateUnitTime();
    const timeout = speed ? speed * 10 : 2000;

    this.decodeTimeout = setTimeout(() => {
      this._tryDecodeMessage();
    }, timeout);
  }

  // Estimate Morse unit time from pulse durations
  _estimateUnitTime() {
    const onPulses = this.pulses.filter(p => p.state === 'on').map(p => p.duration);
    if (onPulses.length < 3) return null;

    // Sort and find the shorter cluster (dots)
    const sorted = [...onPulses].sort((a, b) => a - b);
    // Use the 25th percentile as dot estimate
    const dotEstimate = sorted[Math.floor(sorted.length * 0.25)];
    return dotEstimate;
  }

  _checkSOS() {
    // Look for SOS pattern in recent pulses: ···---···
    // Need at least 9 ON pulses
    const recentOnPulses = this.pulses
      .filter(p => p.state === 'on')
      .slice(-20);

    if (recentOnPulses.length < 9) return;

    const unit = this._estimateUnitTime();
    if (!unit || unit < 20) return;

    // Look for pattern: 3 short, 3 long, 3 short
    for (let start = 0; start <= recentOnPulses.length - 9; start++) {
      const chunk = recentOnPulses.slice(start, start + 9);
      const isDot = d => d < unit * 2;
      const isDash = d => d >= unit * 2 && d < unit * 6;

      const s1 = chunk.slice(0, 3).every(p => isDot(p.duration));
      const o = chunk.slice(3, 6).every(p => isDash(p.duration));
      const s2 = chunk.slice(6, 9).every(p => isDot(p.duration));

      if (s1 && o && s2) {
        if (this.onSOSDetected) this.onSOSDetected();
        // Clear pulses to avoid re-detection
        this.pulses = [];
        return;
      }
    }
  }

  _tryDecodeMessage() {
    if (this.pulses.length < 5) return;

    const unit = this._estimateUnitTime();
    if (!unit || unit < 20) return;

    // Check for preamble (5+ rapid ON pulses)
    let dataStart = 0;
    const onPulses = this.pulses.filter(p => p.state === 'on');
    if (onPulses.length >= 5) {
      const firstFive = onPulses.slice(0, 5);
      const avgDur = firstFive.reduce((s, p) => s + p.duration, 0) / 5;
      if (avgDur < unit * 0.8) {
        // Found preamble, skip it
        const preambleEnd = firstFive[4].startTime + firstFive[4].duration;
        dataStart = this.pulses.findIndex(p => p.startTime > preambleEnd);
        if (dataStart < 0) return;
      }
    }

    // Decode Morse from pulses (skip preamble)
    const dataPulses = this.pulses.slice(dataStart);
    if (dataPulses.length < 3) return;

    // Check for end marker (long flash at the end)
    const lastOn = [...dataPulses].reverse().find(p => p.state === 'on');
    if (!lastOn || lastOn.duration < unit * 4) return; // No end marker yet

    // Remove end marker
    const endMarkerIdx = dataPulses.lastIndexOf(lastOn);
    const msgPulses = dataPulses.slice(0, endMarkerIdx);

    if (msgPulses.length < 2) return;

    // Convert pulses to Morse string
    let morseStr = '';
    for (const pulse of msgPulses) {
      if (pulse.state === 'on') {
        morseStr += pulse.duration < unit * 2 ? '.' : '-';
      } else {
        // OFF pulse: determine gap type
        if (pulse.duration > unit * 5) {
          morseStr += ' / '; // word gap
        } else if (pulse.duration > unit * 2) {
          morseStr += ' '; // character gap
        }
        // Intra-character gap: no separator needed
      }
    }

    // Decode Morse to text
    const text = this._morseToText(morseStr.trim());
    if (text && text.length > 0) {
      if (this.onMessageDecoded) this.onMessageDecoded(text);
      this.pulses = []; // Clear after successful decode
    }
  }

  _morseToText(morse) {
    const words = morse.split(' / ');
    return words.map(word => {
      return word.split(' ').map(code => {
        return REVERSE_MORSE[code] || '';
      }).join('');
    }).join(' ').trim();
  }

  clearPulses() {
    this.pulses = [];
    this.brightnessHistory = [];
    this.adaptiveMin = 255;
    this.adaptiveMax = 0;
  }
}

// ====== APP ======
class App {
  constructor() {
    // State
    this.connected = false;
    this.sending = false;
    this.sosReceived = false;
    this.sosSent = false;

    // Elements
    this.introScreen = document.getElementById('intro-screen');
    this.mainScreen = document.getElementById('main-screen');
    this.cameraVideo = document.getElementById('camera-video');
    this.analysisCanvas = document.getElementById('analysis-canvas');
    this.brightnessFill = document.getElementById('brightness-fill');
    this.signalDot = document.getElementById('signal-dot');
    this.connStatus = document.getElementById('conn-status');
    this.modeLabel = document.getElementById('mode-label');
    this.messagesEl = document.getElementById('messages');
    this.msgInput = document.getElementById('msg-input');
    this.btnSend = document.getElementById('btn-send');
    this.signalDisplay = document.getElementById('signal-display');
    this.signalStatus = document.getElementById('signal-status');
    this.progressEl = document.getElementById('sending-progress');
    this.progressFill = document.getElementById('progress-fill');
    this.progressText = document.getElementById('progress-text');
    this.settingsModal = document.getElementById('settings-modal');

    // Components
    this.sender = new SignalSender(this.signalDisplay);
    this.receiver = new SignalReceiver(this.cameraVideo, this.analysisCanvas);

    // Settings
    this.currentSpeed = 'medium';
    this.currentCamera = 'user';
    this.currentColor = 'green';

    this._bindEvents();
  }

  _bindEvents() {
    // Intro
    document.getElementById('btn-start').addEventListener('click', () => this._startApp());

    // Quick actions
    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const msg = btn.dataset.msg;
        if (action === 'sos') this._handleSOS();
        else if (msg) this._handleSendMessage(msg);
      });
    });

    // Text input
    this.msgInput.addEventListener('input', () => {
      this.btnSend.disabled = !this.msgInput.value.trim();
    });
    this.msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.msgInput.value.trim()) {
        this._handleSendMessage(this.msgInput.value.trim());
      }
    });
    this.btnSend.addEventListener('click', () => {
      if (this.msgInput.value.trim()) {
        this._handleSendMessage(this.msgInput.value.trim());
      }
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => {
      this.settingsModal.hidden = false;
    });
    document.getElementById('btn-close-settings').addEventListener('click', () => {
      this._applySettings();
      this.settingsModal.hidden = true;
    });
    document.getElementById('sensitivity-range').addEventListener('input', (e) => {
      document.getElementById('sensitivity-value').textContent = e.target.value;
    });

    // Receiver callbacks
    this.receiver.onBrightness = (val) => {
      const pct = Math.min(100, (val / 255) * 100);
      this.brightnessFill.style.width = pct + '%';
    };
    this.receiver.onSignalChange = (isOn) => {
      this.signalDot.classList.toggle('active', isOn);
    };
    this.receiver.onSOSDetected = () => {
      if (!this.sosReceived) {
        this.sosReceived = true;
        this._addSystemMessage('检测到 SOS 信号!');
        this._checkConnection();

        // Auto-respond with SOS if not already sent
        if (!this.sosSent) {
          this._addSystemMessage('自动回复 SOS...');
          setTimeout(() => this._handleSOS(), 500);
        }
      }
    };
    this.receiver.onMessageDecoded = (text) => {
      // Look up quick message display
      const display = QUICK_MESSAGES[text] || text;
      this._addMessage(display, 'received');
      this._vibrate();
    };
  }

  async _startApp() {
    this.introScreen.classList.remove('active');
    this.mainScreen.classList.add('active');

    // Start camera
    const ok = await this.receiver.start(this.currentCamera);
    if (!ok) {
      this._addSystemMessage('无法访问摄像头。请检查权限设置。');
      return;
    }
    this._addSystemMessage('摄像头已启动。请点击 SOS 建立连接。');
    this.modeLabel.textContent = '接收中...';
  }

  _applySettings() {
    this.currentSpeed = document.getElementById('speed-select').value;
    this.currentColor = document.getElementById('color-select').value;
    const newCamera = document.getElementById('camera-select').value;
    const sensitivity = parseInt(document.getElementById('sensitivity-range').value);

    this.sender.setSpeed(this.currentSpeed);
    this.sender.setColor(this.currentColor);
    this.receiver.setSensitivity(sensitivity);

    // Switch camera if changed
    if (newCamera !== this.currentCamera) {
      this.currentCamera = newCamera;
      this.receiver.stop();
      this.receiver.start(this.currentCamera);
    }
  }

  async _handleSOS() {
    if (this.sender.sending) return;

    this.sosSent = true;
    this._updateStatus('connecting', 'SOS 发送中...');
    this._addMessage('SOS', 'sent');
    this.signalStatus.textContent = 'SOS 信号发送中...';
    document.getElementById('signal-area').classList.add('sending-active');

    await this.sender.sendSOS();

    document.getElementById('signal-area').classList.remove('sending-active');
    this.signalStatus.textContent = '信号区域';
    this._checkConnection();
  }

  _checkConnection() {
    if (this.sosSent && this.sosReceived && !this.connected) {
      this.connected = true;
      this._updateStatus('connected', '已连接');
      this._addSystemMessage('连接已建立! 现在可以发送消息了。');
      this._vibrate([100, 50, 100]);
      this.receiver.clearPulses();
    } else if (this.sosSent && !this.sosReceived) {
      this._updateStatus('connecting', '等待对方响应...');
    } else if (!this.sosSent && this.sosReceived) {
      this._updateStatus('connecting', '已收到 SOS，回复中...');
    }
  }

  async _handleSendMessage(text) {
    if (this.sender.sending) return;

    const displayText = QUICK_MESSAGES[text] || text;
    this._addMessage(displayText, 'sent');
    this.msgInput.value = '';
    this.btnSend.disabled = true;

    this._updateStatus(this.connected ? 'connected' : 'connecting', '发送中...');
    this.progressEl.classList.add('active');

    await this.sender.sendText(text, (current, total, char) => {
      const pct = total > 0 ? (current / total) * 100 : 0;
      this.progressFill.style.width = pct + '%';
      this.progressText.textContent = current < total ? `发送: ${char} (${current + 1}/${total})` : '发送完成';
    });

    this.progressEl.classList.remove('active');
    this.progressFill.style.width = '0%';
    this.progressText.textContent = '';
    this._updateStatus(this.connected ? 'connected' : 'disconnected',
                       this.connected ? '已连接' : '等待中');
  }

  _addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `msg msg-${type}`;
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.innerHTML = `${this._escapeHtml(text)}<div class="msg-time">${time}</div>`;
    this.messagesEl.appendChild(div);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'system-msg';
    div.textContent = text;
    this.messagesEl.appendChild(div);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _updateStatus(state, label) {
    this.connStatus.className = `status-${state}`;
    this.connStatus.textContent = state === 'connected' ? '已连接' :
                                   state === 'connecting' ? '连接中' : '未连接';
    if (label) this.modeLabel.textContent = label;
  }

  _vibrate(pattern = [50]) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ====== INIT ======
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
