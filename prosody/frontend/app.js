(() => {
  "use strict";

  const SAMPLE_INTERVAL_MS = 50;

  const els = {
    browserWarning: document.getElementById("browser-warning"),
    studentId: document.getElementById("student-id"),
    sentenceSelect: document.getElementById("sentence-select"),
    playModelBtn: document.getElementById("play-model-btn"),
    prosodyDisplay: document.getElementById("prosody-display"),
    recordBtn: document.getElementById("record-btn"),
    recordStatus: document.getElementById("record-status"),
    canvas: document.getElementById("amplitude-canvas"),
    wordSegments: document.getElementById("word-segments"),
    recognizedText: document.getElementById("recognized-text"),
    feedbackList: document.getElementById("feedback-list"),
    submitBtn: document.getElementById("submit-btn"),
    submitStatus: document.getElementById("submit-status"),
  };

  let currentSentence = null;
  let amplitudeData = []; // [{t, rms}]
  let recognizedText = "";
  let lastResult = null; // payload ready to submit

  // ---- ブラウザ対応チェック ----
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!isChrome || !SpeechRecognitionCtor || !navigator.mediaDevices) {
    els.browserWarning.hidden = false;
  }

  // ---- 例文選択・表示 ----
  function populateSentenceSelect() {
    SENTENCES.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.text;
      els.sentenceSelect.appendChild(opt);
    });
  }

  function renderProsody(sentence) {
    els.prosodyDisplay.innerHTML = "";
    sentence.words.forEach((w) => {
      const block = document.createElement("div");
      block.className = `word-block ${w.type}`;

      const textEl = document.createElement("div");
      textEl.className = w.type === "content" ? "word-text-content" : "word-text-function";
      textEl.textContent = w.text;
      block.appendChild(textEl);

      const beat = document.createElement("div");
      beat.className = "beat-marker";
      block.appendChild(beat);

      if (w.ipaWeak) {
        const ipaRow = document.createElement("div");
        ipaRow.className = "ipa-row";
        const strong = document.createElement("span");
        strong.className = "strong-form";
        strong.textContent = `/${w.ipaStrong}/`;
        const weak = document.createElement("span");
        weak.className = "weak-form";
        weak.textContent = `/${w.ipaWeak}/`;
        ipaRow.appendChild(strong);
        ipaRow.appendChild(weak);
        block.appendChild(ipaRow);
      }

      if (w.note) {
        const note = document.createElement("span");
        note.className = "note";
        note.textContent = w.note;
        block.appendChild(note);
      }

      els.prosodyDisplay.appendChild(block);
    });
  }

  function renderWordSegments(sentence) {
    els.wordSegments.innerHTML = "";
    sentence.words.forEach((w) => {
      const seg = document.createElement("div");
      seg.className = `word-segment ${w.type}`;
      seg.textContent = w.text;
      els.wordSegments.appendChild(seg);
    });
  }

  function loadSentence(id) {
    currentSentence = SENTENCES.find((s) => s.id === id) || SENTENCES[0];
    renderProsody(currentSentence);
    renderWordSegments(currentSentence);
    resetRecordingState();
  }

  function resetRecordingState() {
    amplitudeData = [];
    recognizedText = "";
    lastResult = null;
    drawAmplitude([]);
    els.recognizedText.textContent = "";
    els.feedbackList.innerHTML = "";
    els.recordStatus.textContent = "未録音";
    updateSubmitState();
  }

  // ---- モデル音声(TTS) ----
  function playModelAudio() {
    if (!currentSentence || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(currentSentence.text);
    utter.lang = "en-US";
    utter.rate = 0.9;
    window.speechSynthesis.speak(utter);
  }

  // ---- 録音・RMS解析・音声認識 ----
  let audioContext = null;
  let analyser = null;
  let mediaStream = null;
  let rafId = null;
  let recording = false;
  let recordStartTime = 0;
  let lastSampleTime = 0;
  let recognition = null;

  async function startRecording() {
    if (!currentSentence) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      els.recordStatus.textContent = "マイクにアクセスできませんでした: " + err.message;
      return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    amplitudeData = [];
    recognizedText = "";
    recordStartTime = performance.now();
    lastSampleTime = 0;
    recording = true;

    els.recordBtn.textContent = "■ 録音停止";
    els.recordBtn.classList.add("recording");
    els.recordStatus.textContent = "録音中...";

    sampleLoop();
    startRecognition();
  }

  function sampleLoop() {
    if (!recording) return;
    const now = performance.now() - recordStartTime;
    if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
      const buffer = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const normalized = (buffer[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      amplitudeData.push(rms);
      lastSampleTime = now;
      drawAmplitude(amplitudeData);
    }
    rafId = requestAnimationFrame(sampleLoop);
  }

  function startRecognition() {
    if (!SpeechRecognitionCtor) return;
    recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      recognizedText = transcript.trim();
    };
    recognition.onerror = () => {};
    try {
      recognition.start();
    } catch (e) {
      // already started / not available
    }
  }

  function stopRecording() {
    recording = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* noop */ }
    }

    els.recordBtn.textContent = "● 録音開始";
    els.recordBtn.classList.remove("recording");
    els.recordStatus.textContent = `録音完了(${amplitudeData.length}サンプル)`;

    // 音声認識のonresultが非同期で少し遅れる場合があるため少し待ってから結果反映
    setTimeout(() => {
      els.recognizedText.textContent = recognizedText || "(認識結果なし)";
      renderFeedback(currentSentence, recognizedText);
      updateSubmitState();
    }, 400);
  }

  function toggleRecording() {
    if (!els.studentId.value.trim()) {
      alert("先に学籍番号(匿名ID)を入力してください。");
      els.studentId.focus();
      return;
    }
    if (recording) {
      stopRecording();
    } else {
      resetRecordingState();
      startRecording();
    }
  }

  // ---- 振幅グラフ描画 ----
  function drawAmplitude(data) {
    const canvas = els.canvas;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "#e5e8ec";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (data.length < 2) return;

    const smoothed = smooth(data, 3);
    const max = Math.max(...smoothed, 0.05);
    const step = w / (smoothed.length - 1);

    ctx.strokeStyle = "#1a4d8f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    smoothed.forEach((v, i) => {
      const x = i * step;
      const y = h - (v / max) * (h - 10) - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = "rgba(26,77,143,0.08)";
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
  }

  function smooth(data, windowSize) {
    const out = [];
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(data.length, i + windowSize + 1);
      let sum = 0;
      for (let j = start; j < end; j++) sum += data[j];
      out.push(sum / (end - start));
    }
    return out;
  }

  // ---- フィードバック(音声認識結果 vs 目標文) ----
  function normalizeWord(text) {
    return text.toLowerCase().replace(/[^a-z']/g, "");
  }

  function renderFeedback(sentence, transcript) {
    els.feedbackList.innerHTML = "";
    if (!SpeechRecognitionCtor) {
      const li = document.createElement("li");
      li.className = "feedback-function-info";
      li.textContent = "この端末では音声認識が利用できないため、フィードバックは表示できません。";
      els.feedbackList.appendChild(li);
      return;
    }

    const recognizedWords = new Set(
      transcript.split(/\s+/).map(normalizeWord).filter(Boolean)
    );

    sentence.words.forEach((w) => {
      const target = normalizeWord(w.text);
      if (!target) return;
      const found = recognizedWords.has(target);
      const li = document.createElement("li");

      if (found) {
        li.className = "feedback-ok";
        li.textContent = `✓ "${w.text}" — 認識されました`;
      } else if (w.type === "content") {
        li.className = "feedback-content-warn";
        li.textContent = `⚠ "${w.text}"(内容語)が認識されませんでした — 発音が不明瞭な可能性があります`;
      } else {
        li.className = "feedback-function-info";
        li.textContent = `ℹ "${w.text}"(機能語)が認識されませんでした — 弱形として自然に発音された可能性があります`;
      }
      els.feedbackList.appendChild(li);
    });
  }

  // ---- 送信 ----
  function updateSubmitState() {
    const hasData = amplitudeData.length > 0 && currentSentence && els.studentId.value.trim();
    els.submitBtn.disabled = !hasData;
  }

  async function submitResult() {
    if (!currentSentence || amplitudeData.length === 0) return;
    const payload = {
      student_id: els.studentId.value.trim(),
      sentence_id: currentSentence.id,
      sample_interval_ms: SAMPLE_INTERVAL_MS,
      amplitude: amplitudeData,
      recognized_text: recognizedText || "",
      timestamp: new Date().toISOString(),
    };

    els.submitBtn.disabled = true;
    els.submitStatus.className = "hint";
    els.submitStatus.textContent = "送信中...";

    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      els.submitStatus.className = "success";
      els.submitStatus.textContent = "送信しました。ご協力ありがとうございます。";
    } catch (err) {
      els.submitStatus.className = "error";
      els.submitStatus.textContent = "送信に失敗しました: " + err.message;
      els.submitBtn.disabled = false;
    }
  }

  // ---- イベント登録 ----
  els.sentenceSelect.addEventListener("change", (e) => loadSentence(e.target.value));
  els.playModelBtn.addEventListener("click", playModelAudio);
  els.recordBtn.addEventListener("click", toggleRecording);
  els.submitBtn.addEventListener("click", submitResult);
  els.studentId.addEventListener("input", updateSubmitState);

  // ---- 初期化 ----
  populateSentenceSelect();
  loadSentence(SENTENCES[0].id);
})();
