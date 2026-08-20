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
    submitStatus: document.getElementById("submit-status"),
    pronunciationPanel: document.getElementById("pronunciation-panel"),
    pronunciationStatus: document.getElementById("pronunciation-status"),
    pronunciationOverall: document.getElementById("pronunciation-overall"),
    pronunciationWords: document.getElementById("pronunciation-words"),
  };

  let SENTENCES = [];
  let currentSentence = null;
  let amplitudeData = []; // [{t, rms}]
  let recognizedText = "";
  let lastResult = null; // payload ready to submit
  let pronunciationAssessmentEnabled = false;

  // ---- ブラウザ対応チェック ----
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!isChrome || !SpeechRecognitionCtor || !navigator.mediaDevices) {
    els.browserWarning.hidden = false;
  }

  // ---- 例文選択・表示 ----
  async function fetchSentences() {
    const res = await fetch("/api/sentences");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

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
    els.submitStatus.className = "hint";
    els.submitStatus.textContent = "";
    if (pronunciationAssessmentEnabled) {
      els.pronunciationStatus.textContent = "";
      els.pronunciationOverall.innerHTML = "";
      els.pronunciationWords.innerHTML = "";
    }
  }

  // ---- モデル音声(録音済み音声があればそれを再生、なければTTSにフォールバック) ----
  function playModelAudio() {
    if (!currentSentence) return;
    if (currentSentence.audio_url) {
      new Audio(currentSentence.audio_url).play();
      return;
    }
    if (!window.speechSynthesis) return;
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

  // 発音評価(有効時のみ)用の生PCMキャプチャ
  let pcmProcessor = null;
  let pcmSilentGain = null;
  let pcmChunks = [];
  let pcmSampleRate = 0;

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

    if (pronunciationAssessmentEnabled) {
      pcmChunks = [];
      pcmSampleRate = audioContext.sampleRate;
      pcmProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      pcmSilentGain = audioContext.createGain();
      pcmSilentGain.gain.value = 0; // マイク音声をスピーカーに戻さないためのミュート
      pcmProcessor.onaudioprocess = (e) => {
        pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(pcmProcessor);
      pcmProcessor.connect(pcmSilentGain);
      pcmSilentGain.connect(audioContext.destination);
    }

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

    let pcmForAssessment = null;
    let pcmRateForAssessment = 0;
    if (pcmProcessor) {
      pcmProcessor.disconnect();
      pcmSilentGain.disconnect();
      pcmForAssessment = pcmChunks;
      pcmRateForAssessment = pcmSampleRate;
      pcmProcessor = null;
      pcmSilentGain = null;
      pcmChunks = [];
    }

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
      submitResult();
      if (pronunciationAssessmentEnabled && pcmForAssessment && pcmForAssessment.length > 0) {
        runPronunciationAssessment(pcmForAssessment, pcmRateForAssessment);
      }
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

  // ---- 送信(録音完了時に自動実行) ----
  async function submitResult() {
    if (!currentSentence || amplitudeData.length === 0) return;
    const studentId = els.studentId.value.trim();
    if (!studentId) return;

    const payload = {
      student_id: studentId,
      sentence_id: currentSentence.id,
      sample_interval_ms: SAMPLE_INTERVAL_MS,
      amplitude: amplitudeData,
      recognized_text: recognizedText || "",
      timestamp: new Date().toISOString(),
    };

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
    }
  }

  // ---- 発音評価(Azure AI Speech, ベータ機能。有効時のみ) ----
  function downsampleTo16k(chunks, sourceSampleRate) {
    let totalLength = 0;
    chunks.forEach((c) => { totalLength += c.length; });
    const merged = new Float32Array(totalLength);
    let offset = 0;
    chunks.forEach((c) => { merged.set(c, offset); offset += c.length; });

    const targetSampleRate = 16000;
    if (sourceSampleRate === targetSampleRate) return merged;

    const ratio = sourceSampleRate / targetSampleRate;
    const outLength = Math.floor(merged.length / ratio);
    const out = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const srcIndex = i * ratio;
      const i0 = Math.floor(srcIndex);
      const i1 = Math.min(i0 + 1, merged.length - 1);
      const frac = srcIndex - i0;
      out[i] = merged[i0] * (1 - frac) + merged[i1] * frac;
    }
    return out;
  }

  function encodeWav16kMono(chunks, sourceSampleRate) {
    const samples = downsampleTo16k(chunks, sourceSampleRate);
    const sampleRate = 16000;
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);

    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  function scoreLabel(score) {
    if (score === null || score === undefined) return "-";
    return Math.round(score);
  }

  function renderPronunciationResult(result) {
    els.pronunciationOverall.innerHTML = "";
    els.pronunciationWords.innerHTML = "";

    if (!result.recognized || !result.overall) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "発話を認識できませんでした。もう一度録音してみてください。";
      els.pronunciationOverall.appendChild(p);
      return;
    }

    const o = result.overall;
    const summary = document.createElement("div");
    summary.className = "pron-score-row";
    summary.innerHTML = `
      <span class="pron-score-item">総合 <strong>${scoreLabel(o.pron_score)}</strong>/100</span>
      <span class="pron-score-item">正確さ <strong>${scoreLabel(o.accuracy_score)}</strong>/100</span>
      <span class="pron-score-item">流暢さ <strong>${scoreLabel(o.fluency_score)}</strong>/100</span>
      <span class="pron-score-item">完全性 <strong>${scoreLabel(o.completeness_score)}</strong>/100</span>
    `;
    els.pronunciationOverall.appendChild(summary);

    result.words.forEach((w) => {
      const li = document.createElement("li");
      let cls = "pron-word-ok";
      if (w.error_type === "Omission") cls = "pron-word-omission";
      else if (w.error_type === "Mispronunciation") cls = "pron-word-mispronunciation";
      else if (w.error_type === "Insertion") cls = "pron-word-insertion";
      else if (typeof w.accuracy_score === "number" && w.accuracy_score < 60) cls = "pron-word-mispronunciation";

      li.className = cls;
      const scoreText = typeof w.accuracy_score === "number" ? `(${scoreLabel(w.accuracy_score)}点)` : "";
      li.textContent = `${w.word} ${scoreText}${w.comment ? " — " + w.comment : ""}`;
      els.pronunciationWords.appendChild(li);
    });
  }

  async function runPronunciationAssessment(chunks, sourceSampleRate) {
    if (!currentSentence) return;
    els.pronunciationStatus.className = "hint";
    els.pronunciationStatus.textContent = "発音を解析中...(数秒かかります)";
    els.pronunciationOverall.innerHTML = "";
    els.pronunciationWords.innerHTML = "";

    try {
      const wavBlob = encodeWav16kMono(chunks, sourceSampleRate);
      const form = new FormData();
      form.append("file", wavBlob, "speech.wav");

      const res = await fetch(
        `/api/pronunciation-assessment?sentence_id=${encodeURIComponent(currentSentence.id)}`,
        { method: "POST", body: form }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const result = await res.json();
      els.pronunciationStatus.textContent = "";
      renderPronunciationResult(result);
    } catch (err) {
      els.pronunciationStatus.className = "error";
      els.pronunciationStatus.textContent = "発音評価に失敗しました: " + err.message;
    }
  }

  // ---- イベント登録 ----
  els.sentenceSelect.addEventListener("change", (e) => loadSentence(e.target.value));
  els.playModelBtn.addEventListener("click", playModelAudio);
  els.recordBtn.addEventListener("click", toggleRecording);

  // ---- 初期化 ----
  async function init() {
    try {
      const configRes = await fetch("/api/config");
      if (configRes.ok) {
        const config = await configRes.json();
        pronunciationAssessmentEnabled = !!config.pronunciation_assessment_enabled;
      }
    } catch (err) {
      // 取得失敗時は発音評価機能を無効のまま扱う
    }
    els.pronunciationPanel.hidden = !pronunciationAssessmentEnabled;

    try {
      SENTENCES = await fetchSentences();
    } catch (err) {
      els.prosodyDisplay.textContent = "例文の読み込みに失敗しました: " + err.message;
      return;
    }
    if (SENTENCES.length === 0) {
      els.prosodyDisplay.textContent = "例文が登録されていません。管理者画面で例文を追加してください。";
      return;
    }
    populateSentenceSelect();
    loadSentence(SENTENCES[0].id);
  }
  init();
})();
