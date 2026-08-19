(() => {
  "use strict";

  const els = {
    loginPanel: document.getElementById("admin-login-panel"),
    adminPassword: document.getElementById("admin-password"),
    loginBtn: document.getElementById("login-btn"),
    loginStatus: document.getElementById("login-status"),
    adminContent: document.getElementById("admin-content"),

    sentenceList: document.getElementById("sentence-list"),
    newSentenceBtn: document.getElementById("new-sentence-btn"),

    editPanelTitle: document.getElementById("edit-panel-title"),
    editId: document.getElementById("edit-id"),
    editText: document.getElementById("edit-text"),
    wordEditorRows: document.getElementById("word-editor-rows"),
    addWordBtn: document.getElementById("add-word-btn"),
    saveSentenceBtn: document.getElementById("save-sentence-btn"),
    deleteSentenceBtn: document.getElementById("delete-sentence-btn"),
    editStatus: document.getElementById("edit-status"),

    currentAudioRow: document.getElementById("current-audio-row"),
    recordAudioBtn: document.getElementById("record-audio-btn"),
    recordAudioStatus: document.getElementById("record-audio-status"),
    audioPreviewRow: document.getElementById("audio-preview-row"),
    audioStatus: document.getElementById("audio-status"),
  };

  let authHeader = null; // "Basic xxxx"
  let sentences = [];
  let editingId = null; // null = new sentence
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let recording = false;

  function authFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers, { Authorization: authHeader });
    return fetch(url, Object.assign({}, options, { headers }));
  }

  // ---- ログイン ----
  async function login() {
    const password = els.adminPassword.value;
    if (!password) return;
    const candidate = "Basic " + btoa(`admin:${password}`);
    els.loginStatus.className = "status-msg";
    els.loginStatus.textContent = "確認中...";
    try {
      const res = await fetch("/api/admin/whoami", { headers: { Authorization: candidate } });
      if (!res.ok) throw new Error("パスワードが違います");
      authHeader = candidate;
      sessionStorage.setItem("adminAuthHeader", candidate);
      els.loginPanel.hidden = true;
      els.adminContent.hidden = false;
      await loadSentences();
    } catch (err) {
      els.loginStatus.className = "status-msg error";
      els.loginStatus.textContent = err.message;
    }
  }

  async function tryStoredAuth() {
    const stored = sessionStorage.getItem("adminAuthHeader");
    if (!stored) return;
    try {
      const res = await fetch("/api/admin/whoami", { headers: { Authorization: stored } });
      if (!res.ok) return;
      authHeader = stored;
      els.loginPanel.hidden = true;
      els.adminContent.hidden = false;
      await loadSentences();
    } catch (err) {
      // 無視してログインフォームを表示したままにする
    }
  }

  // ---- 例文一覧 ----
  async function loadSentences() {
    const res = await fetch("/api/sentences");
    sentences = await res.json();
    renderSentenceList();
    if (sentences.length > 0 && editingId === null) {
      selectSentence(sentences[0].id);
    } else if (sentences.length === 0) {
      startNewSentence();
    }
  }

  function renderSentenceList() {
    els.sentenceList.innerHTML = "";
    sentences.forEach((s) => {
      const li = document.createElement("li");
      li.className = s.id === editingId ? "active" : "";
      const label = document.createElement("span");
      label.textContent = `${s.id}: ${s.text}`;
      li.appendChild(label);
      if (s.audio_url) {
        const badge = document.createElement("span");
        badge.className = "audio-badge";
        badge.textContent = "🎙";
        li.appendChild(badge);
      }
      li.addEventListener("click", () => selectSentence(s.id));
      els.sentenceList.appendChild(li);
    });
  }

  // ---- 単語エディタ ----
  function createWordRow(word = {}) {
    const row = document.createElement("div");
    row.className = "word-editor-row";

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.placeholder = "単語 (例: can)";
    textInput.value = word.text || "";
    textInput.dataset.field = "text";

    const typeSelect = document.createElement("select");
    typeSelect.dataset.field = "type";
    ["content", "function"].forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t === "content" ? "内容語" : "機能語";
      if (word.type === t) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    const ipaStrongInput = document.createElement("input");
    ipaStrongInput.type = "text";
    ipaStrongInput.placeholder = "強形IPA (例: kæn)";
    ipaStrongInput.value = word.ipaStrong || "";
    ipaStrongInput.dataset.field = "ipaStrong";

    const ipaWeakInput = document.createElement("input");
    ipaWeakInput.type = "text";
    ipaWeakInput.placeholder = "弱形IPA (例: kən)";
    ipaWeakInput.value = word.ipaWeak || "";
    ipaWeakInput.dataset.field = "ipaWeak";

    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.placeholder = "補足ノート(任意)";
    noteInput.value = word.note || "";
    noteInput.dataset.field = "note";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "削除";
    removeBtn.addEventListener("click", () => row.remove());

    row.appendChild(textInput);
    row.appendChild(typeSelect);
    row.appendChild(ipaStrongInput);
    row.appendChild(ipaWeakInput);
    row.appendChild(noteInput);
    row.appendChild(removeBtn);
    return row;
  }

  function renderWordEditor(words) {
    els.wordEditorRows.innerHTML = "";
    words.forEach((w) => els.wordEditorRows.appendChild(createWordRow(w)));
  }

  function collectWords() {
    const rows = els.wordEditorRows.querySelectorAll(".word-editor-row");
    const words = [];
    rows.forEach((row) => {
      const text = row.querySelector('[data-field="text"]').value.trim();
      if (!text) return;
      const type = row.querySelector('[data-field="type"]').value;
      const ipaStrong = row.querySelector('[data-field="ipaStrong"]').value.trim();
      const ipaWeak = row.querySelector('[data-field="ipaWeak"]').value.trim();
      const note = row.querySelector('[data-field="note"]').value.trim();
      const word = { text, type };
      if (ipaStrong) word.ipaStrong = ipaStrong;
      if (ipaWeak) word.ipaWeak = ipaWeak;
      if (note) word.note = note;
      words.push(word);
    });
    return words;
  }

  // ---- 例文編集フォーム ----
  function selectSentence(id) {
    const sentence = sentences.find((s) => s.id === id);
    if (!sentence) return;
    editingId = id;
    els.editPanelTitle.textContent = `例文を編集: ${id}`;
    els.editId.value = sentence.id;
    els.editId.disabled = true;
    els.editText.value = sentence.text;
    renderWordEditor(sentence.words);
    els.deleteSentenceBtn.hidden = false;
    els.editStatus.textContent = "";
    renderSentenceList();
    renderCurrentAudio(sentence);
    resetRecorderUI(true);
  }

  function startNewSentence() {
    editingId = null;
    els.editPanelTitle.textContent = "新規例文を追加";
    els.editId.value = "";
    els.editId.disabled = false;
    els.editText.value = "";
    renderWordEditor([{ text: "", type: "content" }]);
    els.deleteSentenceBtn.hidden = true;
    els.editStatus.textContent = "";
    renderSentenceList();
    renderCurrentAudio(null);
    resetRecorderUI(false);
  }

  async function saveSentence() {
    const id = els.editId.value.trim();
    const text = els.editText.value.trim();
    const words = collectWords();

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      showEditStatus("例文IDは半角英数字・ハイフン・アンダースコアのみで入力してください", true);
      return;
    }
    if (!text) {
      showEditStatus("例文テキストを入力してください", true);
      return;
    }
    if (words.length === 0) {
      showEditStatus("単語を1つ以上入力してください", true);
      return;
    }

    els.saveSentenceBtn.disabled = true;
    showEditStatus("保存中...", false);

    try {
      let res;
      if (editingId === null) {
        res = await authFetch("/api/sentences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, text, words }),
        });
      } else {
        res = await authFetch(`/api/sentences/${encodeURIComponent(editingId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, words }),
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      showEditStatus("保存しました", false, true);
      await loadSentences();
      selectSentence(id);
    } catch (err) {
      showEditStatus("保存に失敗しました: " + err.message, true);
    } finally {
      els.saveSentenceBtn.disabled = false;
    }
  }

  async function deleteSentence() {
    if (editingId === null) return;
    if (!confirm(`例文「${editingId}」を削除します。よろしいですか?`)) return;
    try {
      const res = await authFetch(`/api/sentences/${encodeURIComponent(editingId)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      await loadSentences();
    } catch (err) {
      showEditStatus("削除に失敗しました: " + err.message, true);
    }
  }

  function showEditStatus(message, isError, isSuccess = false) {
    els.editStatus.textContent = message;
    els.editStatus.className = "status-msg" + (isError ? " error" : isSuccess ? " success" : "");
  }

  // ---- モデル音声(録音) ----
  function renderCurrentAudio(sentence) {
    els.currentAudioRow.innerHTML = "";
    if (sentence && sentence.audio_url) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = sentence.audio_url;
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "danger-btn";
      delBtn.textContent = "登録済み音声を削除";
      delBtn.addEventListener("click", deleteAudio);
      els.currentAudioRow.appendChild(audio);
      els.currentAudioRow.appendChild(delBtn);
    } else {
      const span = document.createElement("span");
      span.className = "hint";
      span.textContent = "モデル音声は未登録です(TTSが使われます)。";
      els.currentAudioRow.appendChild(span);
    }
  }

  function resetRecorderUI(canRecord) {
    stopRecordingIfActive();
    recordedBlob = null;
    els.audioPreviewRow.innerHTML = "";
    els.audioStatus.textContent = "";
    els.recordAudioBtn.disabled = !canRecord;
    els.recordAudioStatus.textContent = canRecord ? "未録音" : "例文を保存してから録音できます";
  }

  function stopRecordingIfActive() {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
    }
    recording = false;
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        renderAudioPreview();
        recording = false;
        els.recordAudioBtn.textContent = "● 録音開始";
        els.recordAudioBtn.classList.remove("recording");
        els.recordAudioStatus.textContent = "録音完了。プレビューを確認してアップロードしてください。";
      };
      mediaRecorder.start();
      recording = true;
      els.recordAudioBtn.textContent = "■ 録音停止";
      els.recordAudioBtn.classList.add("recording");
      els.recordAudioStatus.textContent = "録音中...";
    } catch (err) {
      els.recordAudioStatus.textContent = "マイクにアクセスできませんでした: " + err.message;
    }
  }

  function renderAudioPreview() {
    els.audioPreviewRow.innerHTML = "";
    if (!recordedBlob) return;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = URL.createObjectURL(recordedBlob);
    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.textContent = "この録音をアップロード";
    uploadBtn.addEventListener("click", uploadAudio);
    els.audioPreviewRow.appendChild(audio);
    els.audioPreviewRow.appendChild(uploadBtn);
  }

  async function uploadAudio() {
    if (!recordedBlob || editingId === null) return;
    const form = new FormData();
    const ext = (recordedBlob.type.split("/")[1] || "webm").split(";")[0];
    form.append("file", recordedBlob, `model-audio.${ext}`);

    els.audioStatus.className = "status-msg";
    els.audioStatus.textContent = "アップロード中...";
    try {
      const res = await authFetch(`/api/sentences/${encodeURIComponent(editingId)}/audio`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      els.audioStatus.className = "status-msg success";
      els.audioStatus.textContent = "アップロードしました。";
      await loadSentences();
      selectSentence(editingId);
    } catch (err) {
      els.audioStatus.className = "status-msg error";
      els.audioStatus.textContent = "アップロードに失敗しました: " + err.message;
    }
  }

  async function deleteAudio() {
    if (editingId === null) return;
    if (!confirm("登録済みのモデル音声を削除します。よろしいですか?")) return;
    try {
      const res = await authFetch(`/api/sentences/${encodeURIComponent(editingId)}/audio`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      await loadSentences();
      selectSentence(editingId);
    } catch (err) {
      els.audioStatus.className = "status-msg error";
      els.audioStatus.textContent = "削除に失敗しました: " + err.message;
    }
  }

  // ---- イベント登録 ----
  els.loginBtn.addEventListener("click", login);
  els.adminPassword.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  els.newSentenceBtn.addEventListener("click", startNewSentence);
  els.addWordBtn.addEventListener("click", () => {
    els.wordEditorRows.appendChild(createWordRow({ type: "content" }));
  });
  els.saveSentenceBtn.addEventListener("click", saveSentence);
  els.deleteSentenceBtn.addEventListener("click", deleteSentence);
  els.recordAudioBtn.addEventListener("click", toggleRecording);

  tryStoredAuth();
})();
