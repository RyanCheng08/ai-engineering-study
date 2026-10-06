/* Embedded chapter quiz. The parent page owns every route and hash change. */
(() => {
  'use strict';
  const host = document.getElementById('lesson-quiz');
  if (!host) return;
  const KEY = 'chapter-one-quiz-v1';
  const LEVELS = ['', '基础', '理解', '应用', '分析', '综合'];
  const TYPES = {single: '单选题', multiple: '多选题', short: '分析 / 设计题'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const emptyAnswer = () => ({choice: [], written: '', revealed: false, studyOnly: false, rubricSelected: [], selfConfirmed: false});
  const emptyState = () => ({version: 1, selected: 0, positions: {}, answers: {}});
  let BANK;
  try {
    BANK = JSON.parse(document.getElementById('page-data')?.textContent || '{}').quizBank;
    if (!BANK || !Array.isArray(BANK.lessons) || !BANK.lessons.length) throw new Error('missing quizBank');
    if (BANK.lessons.some(l => !Array.isArray(l.questions) || !l.questions.length)) throw new Error('empty lesson');
  } catch {
    host.innerHTML = '<h2 id="quiz-lesson-title">本节自测暂时无法载入</h2><p>请重新生成学习笔记页面，检查 page-data 中的 quizBank。</p>';
    window.ChapterQuiz = {show() {host.hidden = false;}, hide() {host.hidden = true;}, summary() {return null;}};
    return;
  }
  const lessons = BANK.lessons;
  const byNumber = new Map(lessons.map(l => [l.number, l]));
  const questions = lessons.flatMap(l => l.questions);
  const byQuestion = new Map(questions.map(q => [q.id, q]));
  let state = emptyState(), activeNumber = null, activeIndex = 0, mounted = false;
  let saveTimer, dirty = false, storageAvailable = true, loadNotice = '';
  let fileStore = null, fileCandidate = null, fileBusy = false;
  let fileStatus = {phase: 'disconnected', name: '', detail: ''};
  const el = id => host.querySelector('#quiz-' + id);
  const dispatch = (name, detail) => document.dispatchEvent(new CustomEvent('chapterquiz:' + name, {detail}));

  // The same validator protects storage, file imports, and the legacy-page bridge.
  // Exported scores are descriptive metadata; they never become authoritative.
  function sanitize(raw) {
    const fail = message => {throw new Error(message);};
    if (!isObject(raw) || raw.version !== 1) fail('记录版本不支持，需为 version: 1。');
    const allowed = ['version', 'selected', 'positions', 'answers', 'updatedAt', 'course', 'exportedAt', 'scores'];
    if (Object.keys(raw).some(k => !allowed.includes(k))) fail('记录含有不支持的顶层字段。');
    if (!Number.isInteger(raw.selected) || raw.selected < 0 || raw.selected >= lessons.length) fail('selected 小节位置无效。');
    if (!isObject(raw.positions) || !isObject(raw.answers)) fail('positions 与 answers 必须是对象。');
    for (const key of ['updatedAt', 'exportedAt']) {
      if (own(raw, key) && (typeof raw[key] !== 'string' || raw[key].length > 100 || !Number.isFinite(Date.parse(raw[key])))) fail(key + ' 时间无效。');
    }
    if (own(raw, 'course') && (typeof raw.course !== 'string' || raw.course.length > 200)) fail('course 字段无效。');
    if (own(raw, 'scores') && !Array.isArray(raw.scores)) fail('scores 元数据必须为数组。');
    const clean = emptyState();
    clean.selected = raw.selected;
    if (raw.updatedAt) clean.updatedAt = raw.updatedAt;
    for (const [number, index] of Object.entries(raw.positions)) {
      const l = byNumber.get(number);
      if (!l || !Number.isInteger(index) || index < 0 || index >= l.questions.length) fail('题目位置无效：' + number);
      clean.positions[number] = index;
    }
    const keys = ['choice', 'written', 'revealed', 'studyOnly', 'rubricSelected', 'selfConfirmed'];
    for (const [id, a] of Object.entries(raw.answers)) {
      const q = byQuestion.get(id);
      if (!q || !isObject(a) || Object.keys(a).length !== keys.length || keys.some(k => !own(a, k))) fail('作答字段无效：' + id);
      if (!Array.isArray(a.choice) || new Set(a.choice).size !== a.choice.length || a.choice.some(k => typeof k !== 'string' || !q.options?.some(o => o.key === k))) fail('选项无效：' + id);
      if (q.type === 'single' && a.choice.length > 1 || q.type === 'short' && a.choice.length) fail('作答类型与选项不符：' + id);
      if (typeof a.written !== 'string' || a.written.length > 30000) fail('文字答案过长或类型错误：' + id);
      if (q.type !== 'short' && a.written !== '') fail('选择题不应含文字答案：' + id);
      if (['revealed', 'studyOnly', 'selfConfirmed'].some(k => typeof a[k] !== 'boolean')) fail('作答状态必须是布尔值：' + id);
      if (!Array.isArray(a.rubricSelected) || new Set(a.rubricSelected).size !== a.rubricSelected.length || a.rubricSelected.some(i => !Number.isInteger(i) || i < 0 || i >= (q.rubric?.length || 0))) fail('自评要点无效：' + id);
      if (a.studyOnly && !a.revealed || a.selfConfirmed && (!a.revealed || a.studyOnly || q.type !== 'short')) fail('作答状态互相矛盾：' + id);
      if (!a.revealed && (a.rubricSelected.length || a.selfConfirmed) || a.studyOnly && a.rubricSelected.length) fail('未提交或学习模式不可带自评分：' + id);
      if (a.revealed && !a.studyOnly && (q.type === 'short' ? !a.written.trim() : !a.choice.length)) fail('已提交记录缺少答案：' + id);
      clean.answers[id] = {choice: [...a.choice], written: a.written, revealed: a.revealed, studyOnly: a.studyOnly, rubricSelected: [...a.rubricSelected], selfConfirmed: a.selfConfirmed};
    }
    return clean;
  }
  function hasWork(a) {return !!a && (a.revealed || a.choice.length > 0 || a.written.trim().length > 0);}
  function mergeMigration(current, legacy) {
    const result = sanitize(current);
    const currentTime = Date.parse(current.updatedAt || ''), legacyTime = Date.parse(legacy.updatedAt || '');
    const legacyNewer = Number.isFinite(legacyTime) && (!Number.isFinite(currentTime) || legacyTime > currentTime);
    for (const [id, incoming] of Object.entries(legacy.answers)) {
      const present = result.answers[id];
      if (!present || !hasWork(present) && hasWork(incoming) || hasWork(present) && hasWork(incoming) && legacyNewer) result.answers[id] = incoming;
    }
    for (const [number, index] of Object.entries(legacy.positions)) if (!own(result.positions, number) || legacyNewer) result.positions[number] = index;
    if (legacyNewer) result.selected = legacy.selected;
    return result;
  }
  let migration = null;
  try {
    const name = window.name;
    if (typeof name === 'string' && name.length < 12000000 && name.startsWith('{')) {
      const bridge = JSON.parse(name);
      if (isObject(bridge) && bridge.kind === 'chapter-one-quiz-migration') {
        window.name = typeof bridge.previousName === 'string' && bridge.previousName.length <= 4096 ? bridge.previousName : '';
        if (bridge.version !== 1) throw new Error('迁移版本不支持。');
        migration = sanitize(bridge.record);
      }
    }
  } catch (error) {loadNotice = '旧页记录未能迁移：' + error.message + ' 可在旧页导出后重新导入。';}
  try {
    const text = localStorage.getItem(KEY);
    if (text !== null) state = sanitize(JSON.parse(text));
  } catch (error) {
    storageAvailable = false;
    loadNotice += (loadNotice ? ' ' : '') + '当前浏览器未能读取有效作答记录；本次作答可导出保存。';
  }
  if (migration) {
    state = mergeMigration(state, migration);
    try {state.updatedAt = new Date().toISOString(); localStorage.setItem(KEY, JSON.stringify(state)); storageAvailable = true;}
    catch {storageAvailable = false;}
    loadNotice += (loadNotice ? ' ' : '') + '已合并旧页作答记录，已有其他题的进度已保留。';
  }

  const lesson = () => byNumber.get(activeNumber);
  const question = () => lesson().questions[activeIndex];
  const answer = q => state.answers[q.id] || (state.answers[q.id] = emptyAnswer());
  const equalKeys = (a, b) => a.length === b.length && a.every(k => b.includes(k));
  function score(q) {
    const a = state.answers[q.id];
    if (!a?.revealed || a.studyOnly) return null;
    if (q.type !== 'short') return equalKeys(a.choice, q.answer) ? 10 : 0;
    if (!a.selfConfirmed) return null;
    return a.rubricSelected.reduce((sum, index) => sum + q.rubric[index].score, 0);
  }
  function summary(number) {
    const l = byNumber.get(String(number));
    if (!l) return null;
    let completed = 0, objective = 0, subjective = 0, learning = 0;
    for (const q of l.questions) {
      if (state.answers[q.id]?.studyOnly) learning++;
      const value = score(q);
      if (value === null) continue;
      completed++;
      if (q.type === 'short') subjective += value; else objective += value;
    }
    const overallCompleted = questions.filter(q => score(q) !== null).length;
    return {number: l.number, completed, objective, subjective, total: objective + subjective, learning, count: l.questions.length, maxScore: l.questions.length * 10, overallCompleted, overallCount: questions.length, position: state.positions[l.number] || 0};
  }
  function progress(reason) {
    dispatch('progress', {chapterNumber: activeNumber || lessons[state.selected].number, reason, summary: summary(activeNumber || lessons[state.selected].number), lessons: lessons.map(l => summary(l.number)), storageAvailable});
  }
  function statusText() {
    return !storageAvailable ? '浏览器保存失败，请连接作答文件或导出记录。' : dirty ? '输入等待保存…' : '浏览器内已保存，可关闭后继续。';
  }
  function persist(reason = 'save', remember = true) {
    clearTimeout(saveTimer);
    if (remember && activeNumber) {state.selected = lessons.indexOf(lesson()); state.positions[activeNumber] = activeIndex;}
    state.updatedAt = new Date().toISOString();
    try {localStorage.setItem(KEY, JSON.stringify(state)); storageAvailable = true; dirty = false;}
    catch {storageAvailable = false; dirty = true;}
    if (fileStore) fileStore.save(fileSnapshot());
    if (mounted) {el('saved').textContent = statusText(); el('saved').classList.toggle('quiz-warning', !storageAvailable);}
    renderFilePanel();
    progress(reason);
  }
  function scheduleSave() {dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(() => persist('draft'), 350); if(mounted) el('saved').textContent = statusText(); renderFilePanel();}
  function announce(text) {if (mounted) el('announce').textContent = text;}
  function focus(id) {const target=el(id);target?.focus({preventScroll:true});if(target&&['result','question-title'].includes(id))target.scrollIntoView({block:'start',behavior:'smooth'});}

  function fileSnapshot() {
    return JSON.parse(JSON.stringify({...state, course: '第一章 1.1～1.7 递进测试'}));
  }
  function renderFilePanel() {
    if (!mounted || !el('file-status')) return;
    const supported = !!fileStore?.supported;
    const phase = fileStatus.phase;
    const messages = {
      unsupported: '当前浏览器不支持文件自动保存。请在桌面 Chrome / Edge 中打开本站，或使用“导出作答记录”和“导入作答记录”。',
      disconnected: '未连接作答文件。首次选择文件后，选项和文字答案会自动写入这个文件。',
      permission: '需要重新授权文件访问。点击“恢复文件连接”后继续自动保存。',
      ready: '文件已连接，等待保存。', saving: '正在写入作答文件…',
      saved: '作答文件已保存。', error: '文件保存未完成，请重试；当前作答仍保留在页面中。'
    };
    let text = messages[phase] || messages.disconnected;
    if (fileStatus.name) text += ' 文件：' + fileStatus.name + '。';
    if (phase === 'saved' && fileStatus.savedAt) text += ' 保存时间：' + new Date(fileStatus.savedAt).toLocaleTimeString('zh-CN') + '。';
    if (storageAvailable && dirty && ['ready', 'saved'].includes(phase)) text += ' 最新输入等待保存。';
    if (fileStatus.detail && ['error', 'permission'].includes(phase)) text += ' ' + fileStatus.detail;
    if (fileStatus.remembered === false && ['ready','saving','saved'].includes(phase)) text += ' 本次连接未能记忆，重新打开网页后需再次选择文件。';
    el('file-status').textContent = text;
    el('file-status').classList.toggle('quiz-warning', ['error', 'permission'].includes(phase));
    const pending = !!fileCandidate;
    el('file-conflict').hidden = !pending;
    if (pending) el('file-conflict-text').textContent = '文件“' + fileCandidate.name + '”和当前浏览器记录不同。选择使用哪一份；选择前不会覆盖文件。';
    for (const button of host.querySelectorAll('[data-quiz-action="file-new"],[data-quiz-action="file-open"]')) button.disabled = !supported || fileBusy || pending;
    el('file-reconnect').hidden = phase !== 'permission';
    el('file-save').hidden = !['ready', 'saving', 'saved', 'error'].includes(phase);
    el('file-disconnect').hidden = !fileStatus.name;
    for (const id of ['file-reconnect','file-save','file-disconnect','file-use','file-current','file-cancel']) el(id).disabled = fileBusy;
  }
  async function acceptFileCandidate(useFile) {
    const candidate = fileCandidate;
    if (!candidate || !fileStore) return;
    fileBusy = true; renderFilePanel();
    try {
      if (await fileStore.acceptCandidate() !== true) throw new Error('文件连接已变化，请重新选择作答文件。');
      if (useFile && candidate.record) {
        try {localStorage.setItem(KEY + '-before-file-restore', JSON.stringify(state));} catch {}
        state = sanitize(candidate.record);
        if (activeNumber) activeIndex = state.positions[activeNumber] || 0;
      }
      fileCandidate = null;
      persist('file-connect', false);
      if (mounted && activeNumber) {
        render();
        if (!host.hidden) dispatch('position', {chapterNumber: activeNumber, questionId: question().id});
        transferStatus(useFile ? '已从作答文件恢复记录，后续作答会自动保存到文件。' : '已连接作答文件，后续作答会自动保存到文件。');
      }
    } catch (error) {
      if (mounted) transferStatus('文件连接失败：' + error.message, true);
    } finally {fileBusy = false; renderFilePanel();}
  }
  async function handleFileCandidate(candidate) {
    if (!candidate) {renderFilePanel(); return;}
    fileCandidate = candidate;
    const record = candidate.record;
    const currentHasWork = Object.values(state.answers).some(hasWork);
    const sameAnswers = !record || questions.every(q => JSON.stringify(state.answers[q.id] || emptyAnswer()) === JSON.stringify(record.answers[q.id] || emptyAnswer()));
    if (!record || sameAnswers) await acceptFileCandidate(false);
    else if (!currentHasWork) await acceptFileCandidate(true);
    else {renderFilePanel(); if(mounted && !host.hidden) focus('file-conflict');}
  }
  async function fileAction(action) {
    if (!fileStore || fileBusy) return;
    if (action === 'file-use' || action === 'file-current') {await acceptFileCandidate(action === 'file-use'); return;}
    if (action === 'file-cancel') {fileStore.cancelCandidate(); fileCandidate = null; renderFilePanel(); return;}
    if (action === 'file-save') {persist('file-manual'); return;}
    if (action === 'file-disconnect') {
      fileBusy = true; renderFilePanel();
      try {await fileStore.disconnect(); fileCandidate = null;} finally {fileBusy = false; renderFilePanel();}
      return;
    }
    fileBusy = true; renderFilePanel();
    try {
      // Call the picker immediately within this user gesture.
      const candidate = await (action === 'file-new' ? fileStore.chooseNew() : action === 'file-open' ? fileStore.chooseExisting() : fileStore.reconnect());
      fileBusy = false;
      await handleFileCandidate(candidate);
    } catch (error) {
      if (error.name !== 'AbortError' && mounted) transferStatus('未能连接作答文件：' + error.message, true);
    } finally {fileBusy = false; renderFilePanel();}
  }

  function mount() {
    if (mounted) return;
    host.innerHTML = '<header class="quiz-header"><div><p class="quiz-eyebrow">第一章 / 逐节自测 · 由浅入深</p><h2 id="quiz-lesson-title" tabindex="-1"></h2><p class="quiz-intro">01—02 基础 · 03—04 理解 · 05—06 应用 · 07—08 分析 · 09—10 综合</p></div><div class="quiz-header-actions"><a class="quiz-btn" id="quiz-return">← 返回学习笔记</a><button class="quiz-btn" type="button" data-quiz-action="resume" id="quiz-resume">继续上次题</button></div></header>' +
      '<div class="quiz-stats"><div><b id="quiz-completion"></b><span>本节已完成</span></div><div><b id="quiz-objective"></b><span>选择题 · 自动评分</span></div><div><b id="quiz-subjective"></b><span>分析设计 · 要点自评</span></div><div><b id="quiz-total"></b><span>本节总分</span></div></div><p class="quiz-overall" id="quiz-overall"></p>' +
      '<nav class="quiz-question-nav" id="quiz-question-nav" aria-label="本节题号导航"></nav><p class="quiz-legend"><span class="quiz-dot quiz-passed"></span>答对 / 已自评 <span class="quiz-dot quiz-failed"></span>需复习 <span class="quiz-dot quiz-learning"></span>已看答案，不计分 <span class="quiz-dot quiz-pending"></span>待作答</p>' +
      '<div class="quiz-progress" id="quiz-progress" role="progressbar" aria-label="本节完成进度" aria-valuemin="0"><span id="quiz-progress-fill"></span></div><article class="quiz-card" id="quiz-card"></article>' +
      '<nav class="quiz-bottom-nav" aria-label="题目翻页"><button class="quiz-btn" type="button" data-quiz-action="previous" id="quiz-previous">← 上一题</button><button class="quiz-btn quiz-primary" type="button" data-quiz-action="next" id="quiz-next">下一题 →</button><button class="quiz-btn" type="button" data-quiz-action="next-lesson" id="quiz-next-lesson">下一节自测 →</button></nav>' +
      '<div class="quiz-tools" aria-label="作答记录与学习资料"><a class="quiz-btn" href="第一章测试题-题目版.txt" download>70 题 · 题目 TXT</a><a class="quiz-btn" href="第一章测试题-答案解析.txt" download>答案与评分 TXT</a><button class="quiz-btn" type="button" data-quiz-action="print-questions">打印本节题目</button><button class="quiz-btn" type="button" data-quiz-action="print-answers">打印本节答案</button><button class="quiz-btn" type="button" data-quiz-action="export">导出作答记录</button><button class="quiz-btn" type="button" data-quiz-action="import">导入作答记录</button><input id="quiz-import-file" type="file" accept=".json,application/json" hidden></div>' +
      '<section class="quiz-file-panel" aria-labelledby="quiz-file-title"><h3 id="quiz-file-title">作答文件 · 自动保存</h3><p id="quiz-file-status" role="status"></p><div class="quiz-file-actions"><button class="quiz-btn" type="button" data-quiz-action="file-new">新建作答文件</button><button class="quiz-btn" type="button" data-quiz-action="file-open">连接已有文件</button><button class="quiz-btn" id="quiz-file-reconnect" type="button" data-quiz-action="file-reconnect" hidden>恢复文件连接</button><button class="quiz-btn" id="quiz-file-save" type="button" data-quiz-action="file-save" hidden>立即保存 / 重试</button><button class="quiz-btn" id="quiz-file-disconnect" type="button" data-quiz-action="file-disconnect" hidden>断开文件</button></div><div class="quiz-file-conflict" id="quiz-file-conflict" tabindex="-1" hidden><p id="quiz-file-conflict-text"></p><button class="quiz-btn" id="quiz-file-use" type="button" data-quiz-action="file-use">使用文件记录</button><button class="quiz-btn" id="quiz-file-current" type="button" data-quiz-action="file-current">用当前记录覆盖文件</button><button class="quiz-btn" id="quiz-file-cancel" type="button" data-quiz-action="file-cancel">取消连接</button></div><p class="quiz-footnote">作答文件保存在本机，不上传 GitHub。首次需选定文件并授权；重新打开网页后，浏览器可能要求恢复授权。关闭网页前请确认“作答文件已保存”。</p></section>' +
      '<p class="quiz-saved" id="quiz-saved"></p><p class="quiz-transfer-status" id="quiz-transfer-status" role="status" tabindex="-1" hidden></p><p class="quiz-footnote">多选须全部选对且无错选才得 10 分。短答按评分要点自评，页面不自动判断文字答案。直接看答案不计分；重新作答后可参加测试。</p><p class="quiz-sr-only" id="quiz-announce" role="status" aria-live="polite" aria-atomic="true"></p>';
    mounted = true;
    renderFilePanel();
    if (loadNotice) {el('transfer-status').hidden = false; el('transfer-status').textContent = loadNotice;}
  }
  function stateClass(q) {
    const s = score(q), a = state.answers[q.id];
    return s === null ? a?.studyOnly ? 'quiz-learning' : 'quiz-pending' : q.type === 'short' || s === 10 ? 'quiz-passed' : 'quiz-failed';
  }
  function resultText(q, a) {
    if (a.studyOnly) return '学习模式 · 本题不计分。重新作答后可参加测试。';
    const s = score(q);
    if (q.type === 'short') return s === null ? '已提交 · 对照参考答案勾选要点，再确认自评。' : '已确认自评 · ' + s + ' / 10 分。';
    return s === 10 ? '回答正确 · 10 / 10 分。' : '需要复习 · 0 / 10 分。';
  }
  function render(focusId) {
    mount();
    const l = lesson(), q = question(), a = answer(q), stats = summary(l.number);
    el('lesson-title').textContent = l.number + ' ' + l.title + ' · 自测';
    el('return').href = '#chapter-' + l.number.split('.')[1];
    const resume = l.questions[state.positions[l.number] || 0];
    el('resume').textContent = '继续上次题 · ' + String(resume.order).padStart(2, '0');
    el('resume').disabled = resume.id === q.id;
    el('resume').hidden = resume.id === q.id;
    el('completion').textContent = stats.completed + ' / ' + stats.count;
    const objectives = l.questions.filter(item => item.type !== 'short').length * 10;
    el('objective').textContent = stats.objective + ' / ' + objectives;
    el('subjective').textContent = stats.subjective + ' / ' + (stats.maxScore - objectives);
    el('total').textContent = stats.total + ' / ' + stats.maxScore;
    el('overall').textContent = '全章已完成 ' + stats.overallCompleted + ' / ' + stats.overallCount + ' 题' + (stats.overallCompleted === stats.overallCount ? ' · 已完成全部自测，可按错题与低分自评继续复习。' : ' · 按题号从浅到深练习，解析可跳回原文对应位置。');
    el('question-nav').innerHTML = l.questions.map((item, index) => '<button type="button" class="quiz-qnum ' + stateClass(item) + (index === activeIndex ? ' quiz-current' : '') + '" data-quiz-question="' + index + '" aria-label="第 ' + item.order + ' 题：' + esc(item.title) + '，' + (score(item) === null ? state.answers[item.id]?.studyOnly ? '已看答案，不计分' : '尚未完成' : '已完成，' + score(item) + '分') + '"' + (index === activeIndex ? ' aria-current="step"' : '') + '>' + String(item.order).padStart(2, '0') + '</button>').join('');
    el('progress').setAttribute('aria-valuemax', String(stats.count));
    el('progress').setAttribute('aria-valuenow', String(stats.completed));
    el('progress').setAttribute('aria-valuetext', '完成 ' + stats.completed + ' / ' + stats.count + ' 题');
    el('progress-fill').style.width = (stats.completed / stats.count * 100) + '%';
    let html = '<div class="quiz-tags"><span>' + LEVELS[q.level] + ' · ' + q.level + '/5</span><span>' + TYPES[q.type] + '</span><small>' + String(q.order).padStart(2, '0') + ' / ' + l.questions.length + ' · 10 分</small></div><h3 id="quiz-question-title" tabindex="-1">' + esc(q.title) + '</h3><p class="quiz-prompt">' + esc(q.prompt) + '</p>' + (q.code ? '<pre class="quiz-code"><code>' + esc(q.code) + '</code></pre>' : '');
    if (q.type === 'short') {
      html += '<label class="quiz-answer-label" for="quiz-written">你的答案</label><textarea id="quiz-written" maxlength="30000" placeholder="写下判断、原因、处理步骤与验证方法……"' + (a.revealed ? ' disabled' : '') + '>' + esc(a.written) + '</textarea><p class="quiz-hint">提交后显示参考答案与评分要点；文字答案不自动判分。</p>';
    } else {
      html += '<fieldset class="quiz-options"><legend class="quiz-sr-only">' + (q.type === 'multiple' ? '选择所有正确选项' : '选择一个正确选项') + '</legend>' + q.options.map(o => {
        const chosen = a.choice.includes(o.key), correct = a.revealed && q.answer.includes(o.key), wrong = a.revealed && chosen && !correct;
        return '<label class="quiz-option' + (chosen ? ' quiz-chosen' : '') + (correct ? ' quiz-correct' : '') + (wrong ? ' quiz-incorrect' : '') + '"><input id="quiz-option-' + esc(o.key) + '" type="' + (q.type === 'multiple' ? 'checkbox' : 'radio') + '" name="quiz-option" value="' + esc(o.key) + '"' + (chosen ? ' checked' : '') + (a.revealed ? ' disabled' : '') + '><span><b>' + esc(o.key) + '.</b>' + esc(o.text) + '</span>' + (a.revealed ? '<small>' + (correct ? '正确项' : wrong ? '所选错误项' : '') + '</small>' : '') + '</label>';
      }).join('') + '</fieldset><p class="quiz-hint">' + (q.type === 'multiple' ? '多选题：全部选对且无错选得 10 分，漏选或错选得 0 分。' : '单选题：正确得 10 分，错误得 0 分。') + '</p>';
    }
    html += '<div class="quiz-actions">' + (!a.revealed ? '<button type="button" class="quiz-btn quiz-primary" data-quiz-action="submit">' + (q.type === 'short' ? '提交并查看参考答案' : '提交并查看解析') + '</button><button type="button" class="quiz-btn" data-quiz-action="study">直接看答案（不计分）</button>' : '<button type="button" class="quiz-btn" data-quiz-action="retry">重新作答</button>') + '<button type="button" class="quiz-btn quiz-muted" data-quiz-action="clear">清空本题</button></div><p id="quiz-error" class="quiz-error" role="alert" hidden></p>';
    if (a.revealed) {
      html += '<section class="quiz-feedback" aria-label="答案、解析与评分"><p id="quiz-result" class="quiz-result' + (score(q) === 0 && q.type !== 'short' ? ' quiz-wrong' : '') + '" tabindex="-1">' + resultText(q, a) + '</p><h4>' + (q.type === 'short' ? '参考答案' : '正确答案：' + esc(q.answer.join('、'))) + '</h4><p class="quiz-feedback-body">' + esc(q.referenceAnswer) + '</p><h4>解析与易错点</h4><p class="quiz-feedback-body">' + esc(q.explanation) + '</p>';
      if (q.type === 'short') html += '<h4>评分要点 · 共 10 分</h4><p class="quiz-hint">' + (a.studyOnly ? '学习模式不计分。如需自评，请重新作答并提交自己的答案。' : '只勾选自己的答案确实做到的要点；未勾选也可确认，得 0 分。') + '</p><fieldset class="quiz-rubric"><legend class="quiz-sr-only">自评要点</legend>' + q.rubric.map((r, index) => '<label><input id="quiz-rubric-' + index + '" type="checkbox" data-quiz-rubric="' + index + '"' + (a.rubricSelected.includes(index) ? ' checked' : '') + (a.studyOnly || a.selfConfirmed ? ' disabled' : '') + '><span>' + esc(r.point) + '</span><b>' + r.score + ' 分</b></label>').join('') + '</fieldset>' + (!a.studyOnly ? '<button type="button" class="quiz-btn quiz-primary" data-quiz-action="self-confirm"' + (a.selfConfirmed ? ' disabled' : '') + '>' + (a.selfConfirmed ? '自评已确认' : '确认自评') + '</button>' : '');
      const targets = Array.isArray(q.reviewTargets) ? q.reviewTargets.filter(t => typeof t.id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(t.id) && typeof t.title === 'string') : [];
      html += '<div class="quiz-sources"><h4>回原文复习</h4>' + (targets.length ? targets.map(t => '<a href="#' + esc(t.id) + '">' + esc(t.title) + ' →</a>').join('') : '<p>' + (q.sourceRefs || []).map(esc).join('；') + '</p><a href="#chapter-' + l.number.split('.')[1] + '">回到 ' + esc(l.number) + ' 学习笔记 →</a>') + '</div></section>';
    }
    el('card').innerHTML = html;
    el('previous').disabled = activeIndex === 0;
    el('next').disabled = activeIndex === l.questions.length - 1;
    el('next').textContent = activeIndex === l.questions.length - 1 ? '本节最后一题' : '下一题 →';
    el('next-lesson').hidden = lessons.indexOf(l) === lessons.length - 1;
    el('saved').textContent = statusText();
    el('saved').classList.toggle('quiz-warning', !storageAvailable);
    if (focusId) focus(focusId);
  }
  function navigateQuestion(index) {
    if (!Number.isInteger(index) || index < 0 || index >= lesson().questions.length || index === activeIndex) return;
    activeIndex = index; state.positions[activeNumber] = index;
    persist('position'); render('question-title');
    dispatch('position', {chapterNumber: activeNumber, questionId: question().id});
    announce('第 ' + question().order + ' 题，' + question().title + '。');
  }
  function transferStatus(text, error = false) {
    el('transfer-status').hidden = false;
    el('transfer-status').textContent = text;
    el('transfer-status').classList.toggle('quiz-error', error);
  }
  function exportRecord() {
    persist('export');
    const data = {...state, course: '第一章 1.1～1.7 递进测试', exportedAt: new Date().toISOString(), scores: lessons.map(l => ({number: l.number, title: l.title, ...summary(l.number)}))};
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json;charset=utf-8'}));
    const link = document.createElement('a'); link.id = 'quiz-download-progress'; link.href = url; link.download = '第一章-作答记录.json'; link.hidden = true;
    host.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    transferStatus('已导出作答记录。导入时会从原始选择与自评要点重新计算分数。');
  }
  async function importFile(file) {
    if (!file) return;
    try {
      if (file.size > 10000000) throw new Error('文件超过 10 MB，请选择本页面导出的 JSON 记录。');
      const imported = sanitize(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      // Import is an explicit replacement. A bad file cannot partially change state.
      state = imported; clearTimeout(saveTimer); dirty = false;
      persist('import', false); render();
      transferStatus('已导入作答记录，分数已重新计算。当前小节继续显示；点击“继续上次题”恢复导入的位置。');
      focus('transfer-status'); announce('作答记录已导入。');
    } catch (error) {transferStatus('导入失败：' + error.message + ' 当前记录未改变。', true); focus('transfer-status');}
    finally {el('import-file').value = '';}
  }
  host.addEventListener('input', event => {
    if (host.hidden || !activeNumber || event.target.id !== 'quiz-written') return;
    const q = question(), a = answer(q);
    if (q.type !== 'short' || a.revealed) return;
    a.written = event.target.value; scheduleSave();
    if (el('error')) el('error').hidden = true;
  });
  host.addEventListener('change', event => {
    if (event.target.id === 'quiz-import-file') {void importFile(event.target.files?.[0]); return;}
    if (host.hidden || !activeNumber) return;
    const q = question(), a = answer(q), input = event.target;
    if (input.name === 'quiz-option' && !a.revealed && q.type !== 'short') {
      a.choice = q.type === 'single' ? [input.value] : [...host.querySelectorAll('input[name="quiz-option"]:checked')].map(x => x.value);
      host.querySelectorAll('.quiz-option').forEach(label => label.classList.toggle('quiz-chosen', label.querySelector('input').checked));
      el('error').hidden = true; persist('choice');
    }
    if (input.matches('[data-quiz-rubric]') && q.type === 'short' && a.revealed && !a.studyOnly && !a.selfConfirmed) {
      a.rubricSelected = [...host.querySelectorAll('[data-quiz-rubric]:checked')].map(x => Number(x.dataset.quizRubric)); persist('rubric');
    }
  });
  host.addEventListener('click', event => {
    const button = event.target.closest('button[data-quiz-action],button[data-quiz-question]');
    if (!button || !host.contains(button) || button.disabled || host.hidden || !activeNumber) return;
    if (button.dataset.quizQuestion !== undefined) {navigateQuestion(Number(button.dataset.quizQuestion)); return;}
    const action = button.dataset.quizAction, q = question(), a = answer(q);
    if (action?.startsWith('file-')) {void fileAction(action); return;}
    if (action === 'previous') {navigateQuestion(activeIndex - 1); return;}
    if (action === 'next') {navigateQuestion(activeIndex + 1); return;}
    if (action === 'resume') {navigateQuestion(state.positions[activeNumber] || 0); return;}
    if (action === 'next-lesson') {
      const next = lessons[lessons.indexOf(lesson()) + 1];
      if (next) {persist('navigate'); dispatch('navigate', {chapterNumber: next.number, questionId: next.questions[state.positions[next.number] || 0].id});}
      return;
    }
    if (action === 'export') {exportRecord(); return;}
    if (action === 'import') {el('import-file').click(); return;}
    if (action === 'print-questions' || action === 'print-answers') {dispatch('print', {chapterNumber: activeNumber, answers: action === 'print-answers', all: false}); return;}
    if (action === 'submit') {
      if (a.revealed) return;
      if (q.type === 'short' ? !a.written.trim() : !a.choice.length) {
        el('error').textContent = q.type === 'short' ? '请先写下答案，或点击“直接看答案”进入学习模式。' : '请先选择答案。';
        el('error').hidden = false; return;
      }
      a.revealed = true; a.studyOnly = false; persist('submit'); render('result'); announce(resultText(q, a)); return;
    }
    if (action === 'study') {a.revealed = true; a.studyOnly = true; a.selfConfirmed = false; a.rubricSelected = []; persist('study'); render('result'); announce(resultText(q, a)); return;}
    if (action === 'retry') {a.revealed = false; a.studyOnly = false; a.selfConfirmed = false; a.rubricSelected = []; persist('retry'); render(q.type === 'short' ? 'written' : 'option-' + q.options[0].key); announce('已恢复作答，保留你之前的答案。'); return;}
    if (action === 'clear') {delete state.answers[q.id]; persist('clear'); render(q.type === 'short' ? 'written' : 'option-' + q.options[0].key); announce('本题答案与分数已清空。'); return;}
    if (action === 'self-confirm' && q.type === 'short' && a.revealed && !a.studyOnly && !a.selfConfirmed) {a.selfConfirmed = true; persist('score'); render('result'); announce(resultText(q, a));}
  });
  window.addEventListener('pagehide', () => {if (dirty) persist('draft');});
  document.addEventListener('visibilitychange', () => {if(document.visibilityState === 'hidden' && dirty) persist('draft');});
  window.ChapterQuiz = Object.freeze({
    show(chapterNumber, questionId) {
      const l = byNumber.get(String(chapterNumber));
      if (!l) return null;
      const requested = typeof questionId === 'string' ? l.questions.findIndex(q => q.id === questionId) : -1;
      const index = requested >= 0 ? requested : state.positions[l.number] || 0;
      const changed = host.hidden || activeNumber !== l.number || activeIndex !== index || !mounted;
      if (dirty && activeNumber !== l.number) persist('draft');
      activeNumber = l.number; activeIndex = index; state.selected = lessons.indexOf(l); host.hidden = false;
      if(requested>=0&&state.positions[l.number]!==index){state.positions[l.number]=index;persist('open-position');}
      if (changed) render();
      return summary(l.number);
    },
    hide() {if (dirty) persist('draft'); host.hidden = true;},
    summary
  });
  if (window.QuizFileStore) {
    fileStore = window.QuizFileStore.create({validate: sanitize, onStatus(status) {fileStatus = status; renderFilePanel();}});
    fileBusy = true;
    void fileStore.initialize().then(handleFileCandidate).catch(error => {
      fileStatus = {phase: 'error', detail: '文件连接未能恢复：' + error.message}; renderFilePanel();
    }).finally(() => {fileBusy = false; renderFilePanel();});
  } else {fileStatus = {phase: 'unsupported'}; renderFilePanel();}
})();
