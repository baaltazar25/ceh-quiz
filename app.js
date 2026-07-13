(() => {
  "use strict";

  const STORAGE_KEY = "cehQuizState_v1";

  const el = (id) => document.getElementById(id);
  const views = {
    loading: el("loadingView"),
    home: el("homeView"),
    quiz: el("quizView"),
    result: el("resultView"),
  };

  let questions = [];
  let questionById = new Map();
  let session = null;
  let timerHandle = null;
  let deferredInstallPrompt = null;

  const defaultState = {
    version: 1,
    progress: {},
    wrongIds: [],
    bookmarks: [],
    settings: {
      examCount: 125,
      examMinutes: 240,
      shuffleAnswers: true,
    },
  };

  let state = loadState();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        ...structuredClone(defaultState),
        ...saved,
        settings: { ...defaultState.settings, ...(saved?.settings || {}) },
        progress: saved?.progress || {},
        wrongIds: Array.isArray(saved?.wrongIds) ? saved.wrongIds : [],
        bookmarks: Array.isArray(saved?.bookmarks) ? saved.bookmarks : [],
      };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showView(name) {
    Object.entries(views).forEach(([key, node]) => {
      node.classList.toggle("hidden", key !== name);
    });
    el("homeBtn").classList.toggle("hidden", name === "home" || name === "loading");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function uniqueNumbers(items) {
    return [...new Set(items.map(Number).filter(Number.isFinite))];
  }

  function persistSettingsFromUI() {
    state.settings.examCount = clampNumber(el("examCount").value, 1, questions.length, 125);
    state.settings.examMinutes = clampNumber(el("examMinutes").value, 0, 1440, 240);
    state.settings.shuffleAnswers = el("shuffleAnswers").checked;
    saveState();
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function updateDashboard() {
    const progressEntries = Object.values(state.progress);
    const answered = progressEntries.filter((item) => item.attempts > 0).length;
    const correct = progressEntries.filter((item) => item.lastResult === true).length;

    el("totalQuestions").textContent = questions.length;
    el("answeredStat").textContent = answered;
    el("correctStat").textContent = correct;
    el("wrongStat").textContent = state.wrongIds.length;
    el("bookmarkStat").textContent = state.bookmarks.length;
    el("bankStatus").textContent = `${questions.length} questions · local JSON`;

    el("examCount").max = questions.length;
    el("examCount").value = Math.min(state.settings.examCount, questions.length);
    el("examMinutes").value = state.settings.examMinutes;
    el("shuffleAnswers").checked = state.settings.shuffleAnswers;
  }

  function startMode(mode) {
    persistSettingsFromUI();

    let queue = [];
    if (mode === "training") {
      // Generate a fresh random order for every practice session.
      queue = shuffle(questions.map((question) => question.id));
    } else if (mode === "exam") {
      const count = Math.min(state.settings.examCount, questions.length);
      queue = shuffle(questions.map((question) => question.id)).slice(0, count);
    } else if (mode === "wrong") {
      queue = state.wrongIds.filter((id) => questionById.has(id));
      if (!queue.length) {
        showMessage("Wrong queue is empty", "Answer some questions incorrectly first.");
        return;
      }
      queue = shuffle(queue);
    } else if (mode === "bookmarks") {
      queue = state.bookmarks.filter((id) => questionById.has(id));
      if (!queue.length) {
        showMessage("No bookmarks yet", "Tap ☆ while viewing a question to save it.");
        return;
      }
    }

    session = {
      mode,
      queue,
      index: 0,
      currentSelection: null,
      revealed: false,
      responses: {},
      optionOrders: {},
      startedAt: Date.now(),
      deadline: mode === "exam" && state.settings.examMinutes > 0
        ? Date.now() + state.settings.examMinutes * 60_000
        : null,
    };

    if (mode === "exam") startTimer();
    else stopTimer();

    showView("quiz");
    renderQuestion();
  }

  function renderQuestion() {
    const question = currentQuestion();
    if (!question) {
      finishSession();
      return;
    }

    session.currentSelection = session.responses[question.id] || null;
    session.revealed = false;

    const position = session.index + 1;
    el("modeBadge").textContent = session.mode.toUpperCase();
    el("questionMeta").textContent =
      `${position}/${session.queue.length} · Q#${question.id} · PDF p.${question.sourcePage}`;
    el("progressBar").style.width = `${(position / session.queue.length) * 100}%`;
    el("questionText").textContent = question.question;

    const image = el("questionImage");
    if (question.image) {
      image.src = question.image;
      image.classList.remove("hidden");
    } else {
      image.removeAttribute("src");
      image.classList.add("hidden");
    }

    updateBookmarkButton(question.id);

    el("feedbackBox").className = "feedback hidden";
    el("feedbackBox").replaceChildren();
    el("nextBtn").classList.add("hidden");
    el("finishExamBtn").classList.add("hidden");

    renderAnswers(question);
  }

  function renderAnswers(question) {
    const container = el("answersList");
    container.replaceChildren();

    let optionOrder = session.optionOrders[question.id];
    if (!optionOrder) {
      optionOrder = Object.keys(question.answers);
      if (state.settings.shuffleAnswers) optionOrder = shuffle(optionOrder);
      session.optionOrders[question.id] = optionOrder;
    }

    const answerEntries = optionOrder.map((key) => [key, question.answers[key]]);

    for (const [key, text] of answerEntries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-btn";
      button.dataset.answer = key;

      const keyNode = document.createElement("span");
      keyNode.className = "answer-key";
      keyNode.textContent = key;

      const textNode = document.createElement("span");
      textNode.className = "answer-text";
      textNode.textContent = text;

      button.append(keyNode, textNode);

      if (session.currentSelection === key) button.classList.add("selected");

      if (session.revealed) {
        button.disabled = true;
        if (key === question.correctAnswer) button.classList.add("correct");
        if (key === session.currentSelection && key !== question.correctAnswer) {
          button.classList.add("wrong");
        }
      } else {
        button.addEventListener("click", () => selectAnswer(key));
      }

      container.append(button);
    }
  }

  function selectAnswer(answerKey) {
    const question = currentQuestion();
    if (!question || session.revealed) return;

    session.currentSelection = answerKey;
    session.responses[question.id] = answerKey;

    session.revealed = true;
    if (session.mode !== "exam") {
      recordAttempt(question, answerKey);
    }

    renderAnswers(question);
    renderFeedback(question, answerKey);

    const isLastExamQuestion =
      session.mode === "exam" && session.index === session.queue.length - 1;

    if (isLastExamQuestion) {
      el("finishExamBtn").classList.remove("hidden");
    } else {
      el("nextBtn").classList.remove("hidden");
    }
  }

  function recordAttempt(question, answerKey) {
    const isCorrect = answerKey === question.correctAnswer;
    const current = state.progress[question.id] || {
      attempts: 0,
      correctCount: 0,
      wrongCount: 0,
      lastAnswer: null,
      lastResult: null,
    };

    current.attempts += 1;
    current.correctCount += isCorrect ? 1 : 0;
    current.wrongCount += isCorrect ? 0 : 1;
    current.lastAnswer = answerKey;
    current.lastResult = isCorrect;
    current.updatedAt = new Date().toISOString();
    state.progress[question.id] = current;

    const wrongSet = new Set(state.wrongIds);
    if (isCorrect) wrongSet.delete(question.id);
    else wrongSet.add(question.id);
    state.wrongIds = [...wrongSet].sort((a, b) => a - b);

    saveState();
    return isCorrect;
  }

  function renderFeedback(question, answerKey) {
    const box = el("feedbackBox");
    const correct = answerKey === question.correctAnswer;
    box.className = `feedback ${correct ? "good" : "bad"}`;

    const title = document.createElement("strong");
    title.textContent = correct ? "✓ Correct" : "✕ Wrong";

    const answer = document.createElement("div");
    answer.className = "feedback-answer";
    answer.textContent =
      `Correct answer: ${question.correctAnswer} — ${question.answers[question.correctAnswer]}`;

    const explanation = document.createElement("div");
    explanation.className = "feedback-explanation";

    const explanationLabel = document.createElement("strong");
    explanationLabel.textContent = "Why: ";

    const explanationText = document.createElement("span");
    explanationText.textContent =
      question.explanation || "No explanation is available for this question.";

    explanation.append(explanationLabel, explanationText);

    const detail = document.createElement("small");
    detail.textContent =
      `PDF answer marker: ${question.answerSource} Answer · source page ${question.sourcePage}`;

    box.append(title, answer, explanation, detail);
  }

  function nextQuestion() {
    if (!session) return;
    const question = currentQuestion();

    if (session.mode === "exam" && question && !session.currentSelection) {
      session.responses[question.id] = null;
    }

    if (session.index >= session.queue.length - 1) {
      finishSession();
      return;
    }

    session.index += 1;
    renderQuestion();
  }

  function finishSession() {
    if (!session) return;
    stopTimer();

    const results = [];
    for (const id of session.queue) {
      const question = questionById.get(id);
      const answer = session.responses[id] || null;

      if (session.mode === "exam") {
        recordAttempt(question, answer);
      }

      const correct = answer === question.correctAnswer;
      results.push({ id, answer, correct });
    }

    const correctCount = results.filter((item) => item.correct).length;
    const wrongCount = results.length - correctCount;
    const score = results.length ? Math.round((correctCount / results.length) * 1000) / 10 : 0;

    el("resultScore").textContent = `${score}%`;
    el("resultSummary").textContent =
      `${correctCount} correct · ${wrongCount} wrong · ${results.length} questions`;

    el("reviewWrongBtn").classList.toggle("hidden", state.wrongIds.length === 0);
    session = null;
    updateDashboard();
    showView("result");
  }

  function startTimer() {
    stopTimer();
    el("timerBox").classList.remove("hidden");
    updateTimer();
    timerHandle = window.setInterval(updateTimer, 1000);
  }

  function updateTimer() {
    if (!session?.deadline) {
      el("timerBox").classList.add("hidden");
      return;
    }

    const remaining = Math.max(0, session.deadline - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    el("timerBox").textContent = hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    if (remaining <= 0) finishSession();
  }

  function stopTimer() {
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
    el("timerBox").classList.add("hidden");
  }

  function currentQuestion() {
    if (!session) return null;
    return questionById.get(session.queue[session.index]) || null;
  }

  function updateBookmarkButton(questionId) {
    const active = state.bookmarks.includes(questionId);
    el("bookmarkBtn").textContent = active ? "★" : "☆";
    el("bookmarkBtn").classList.toggle("active", active);
  }

  function toggleBookmark() {
    const question = currentQuestion();
    if (!question) return;
    const set = new Set(state.bookmarks);
    if (set.has(question.id)) set.delete(question.id);
    else set.add(question.id);
    state.bookmarks = [...set].sort((a, b) => a - b);
    saveState();
    updateBookmarkButton(question.id);
  }

  function goHome() {
    stopTimer();
    session = null;
    updateDashboard();
    showView("home");
  }

  function exportProgress() {
    persistSettingsFromUI();
    const blob = new Blob(
      [JSON.stringify(state, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ceh-quiz-progress-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importProgress(file) {
    try {
      const imported = JSON.parse(await file.text());
      if (!imported || typeof imported !== "object") throw new Error("Invalid JSON");
      state = {
        ...structuredClone(defaultState),
        ...imported,
        settings: { ...defaultState.settings, ...(imported.settings || {}) },
        progress: imported.progress || {},
        wrongIds: uniqueNumbers(imported.wrongIds || []),
        bookmarks: uniqueNumbers(imported.bookmarks || []),
      };
      saveState();
      updateDashboard();
      showMessage("Progress imported", "Local progress has been replaced with the imported backup.");
    } catch (error) {
      showMessage("Import failed", String(error.message || error));
    }
  }

  function resetProgress() {
    const approved = window.confirm("Delete all local CEH Quiz progress on this device?");
    if (!approved) return;
    state = structuredClone(defaultState);
    saveState();
    updateDashboard();
  }

  function showMessage(title, message) {
    el("installDialog").querySelector("h3").textContent = title;
    el("installDialogText").textContent = message;
    el("installDialog").showModal();
  }

  function setupInstallUX() {
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;

    if (isiOS && !standalone) el("iosInstallHint").classList.remove("hidden");

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
    });

    el("installBtn").addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        return;
      }

      if (isiOS) {
        showMessage(
          "Install on iPhone",
          "In Safari: tap Share, then Add to Home Screen."
        );
      } else {
        showMessage(
          "Install PWA",
          "Use the browser menu and choose Install app / Add to Home Screen."
        );
      }
    });
  }

  async function init() {
    try {
      const response = await fetch("questions.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      questions = await response.json();
      questionById = new Map(questions.map((question) => [question.id, question]));

      updateDashboard();
      setupInstallUX();
      showView("home");

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("service-worker.js").catch(console.error);
      }
    } catch (error) {
      el("loadingView").replaceChildren();
      const title = document.createElement("h2");
      title.textContent = "Question bank failed to load";
      const detail = document.createElement("p");
      detail.textContent = String(error.message || error);
      el("loadingView").append(title, detail);
    }
  }

  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => startMode(button.dataset.mode));
  });

  el("homeBtn").addEventListener("click", goHome);
  el("bookmarkBtn").addEventListener("click", toggleBookmark);
  el("nextBtn").addEventListener("click", nextQuestion);
  el("finishExamBtn").addEventListener("click", finishSession);
  el("resultHomeBtn").addEventListener("click", goHome);
  el("reviewWrongBtn").addEventListener("click", () => {
    showView("home");
    startMode("wrong");
  });
  el("exportProgressBtn").addEventListener("click", exportProgress);
  el("importProgressInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importProgress(file);
    event.target.value = "";
  });
  el("resetProgressBtn").addEventListener("click", resetProgress);

  init();
})();
