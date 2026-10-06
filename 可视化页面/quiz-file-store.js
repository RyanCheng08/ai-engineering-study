/* Local quiz-file connection. Selection never writes or activates a file. */
(() => {
  'use strict';
  const MAX_BYTES = 10000000;
  const DB_NAME = 'chapter-one-quiz-files-v1';
  const STORE = 'handles';
  const KEY = 'current';
  const TYPES = [{description: '第一章作答记录 JSON', accept: {'application/json': ['.json']}}];

  function create({validate, onStatus = () => {}} = {}) {
    if (typeof validate !== 'function') throw new TypeError('validate 必须是同步校验函数。');
    const supported = window.isSecureContext === true &&
      typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
    let active = null, rememberedHandle = null, candidate = null;
    let remembered = false, needsPermission = false, generation = 0, selection = 0, revision = 0;
    let pending = null, running = false, drainPromise = null;
    let dbPromise = null, memoryTail = Promise.resolve();

    function status(phase, detail, extra = {}) {
      const payload = {phase, name: active?.name || rememberedHandle?.name || '', detail,
        remembered, ...extra};
      try {onStatus(payload);} catch { /* A UI callback cannot break the storage queue. */ }
    }
    function errorText(error) {return error?.message || String(error);}
    function normalize(raw) {
      const clean = validate(raw);
      if (!clean || typeof clean !== 'object' || Array.isArray(clean) || typeof clean.then === 'function') {
        throw new TypeError('校验函数必须同步返回有效记录对象。');
      }
      return clean;
    }
    function unsupported() {
      status('unsupported', '当前浏览器未提供本机文件保存接口，请使用导出作答记录。');
      return null;
    }
    function openDatabase() {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          let request;
          try {
            if (!window.indexedDB) throw new Error('浏览器未提供 IndexedDB。');
            request = window.indexedDB.open(DB_NAME, 1);
          } catch (error) {reject(error); return;}
          let finished = false;
          const fail = error => {if (!finished) {finished = true; reject(error);}};
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
          };
          request.onerror = () => fail(request.error || new Error('无法打开文件记忆数据库。'));
          request.onblocked = () => fail(new Error('文件记忆数据库被其他页面占用。'));
          request.onsuccess = () => {
            const db = request.result;
            if (finished) {db.close(); return;}
            finished = true;
            db.onversionchange = () => {db.close(); dbPromise = null;};
            resolve(db);
          };
        });
        dbPromise.catch(() => {dbPromise = null;});
      }
      return dbPromise;
    }
    // Put/delete/get share a queue so a late remembered-handle write cannot undo
    // a disconnect or overwrite the handle of a newer accepted connection.
    function memory(operation, handle) {
      const task = memoryTail.catch(() => {}).then(async () => {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
          let transaction, request, result;
          try {
            transaction = db.transaction(STORE, operation === 'get' ? 'readonly' : 'readwrite');
            const store = transaction.objectStore(STORE);
            request = operation === 'get' ? store.get(KEY) :
              operation === 'put' ? store.put(handle, KEY) : store.delete(KEY);
          } catch (error) {reject(error); return;}
          request.onsuccess = () => {result = request.result;};
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error('无法记忆文件连接。'));
        });
      });
      memoryTail = task.catch(() => {});
      return task;
    }
    function beginSelection() {candidate = null; return ++selection;}
    async function readCandidate(handle, token) {
      if (token !== selection) return null;
      if (!handle || handle.kind !== 'file' || typeof handle.getFile !== 'function' ||
          typeof handle.createWritable !== 'function' || typeof handle.queryPermission !== 'function') {
        throw new TypeError('选择的对象不是可用的文件句柄。');
      }
      const file = await handle.getFile();
      if (token !== selection) return null;
      if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_BYTES) {
        throw new Error('文件超过 10 MB 或大小无效，请选择有效的 JSON 作答记录。');
      }
      let record = null;
      if (file.size !== 0) {
        const text = await file.text();
        if (token !== selection) return null;
        // Whitespace-only/BOM-only nonempty files are invalid, never new files.
        record = normalize(JSON.parse(text.replace(/^\uFEFF/, '')));
      }
      const permission = await handle.queryPermission({mode: 'readwrite'});
      if (token !== selection) return null;
      candidate = {handle, name: handle.name || file.name || '第一章-作答记录.json', record, permission};
      return {record, name: candidate.name};
    }
    function selectionError(error, token, name = '') {
      if (token !== selection || error?.name === 'AbortError') return null;
      candidate = null;
      status('error', '文件未连接：' + errorText(error), {name: name || active?.name || ''});
      throw error;
    }
    async function initialize() {
      if (!supported) return unsupported();
      const token = beginSelection();
      let handle;
      try {handle = await memory('get');}
      catch (error) {
        if (token === selection) status('disconnected', '无法读取文件记忆，仍可手动选择文件：' + errorText(error), {remembered: false});
        return null;
      }
      if (token !== selection) return null;
      if (!handle) {status('disconnected', '尚未连接本机作答文件。', {remembered: false}); return null;}
      rememberedHandle = handle;
      remembered = true;
      try {
        const permission = await handle.queryPermission({mode: 'readwrite'});
        if (token !== selection) return null;
        if (permission !== 'granted') {
          needsPermission = true;
          status('permission', '已记忆文件；请点击重新连接以确认读写权限。', {name: handle.name, remembered: true});
          return null;
        }
        needsPermission = false;
        const result = await readCandidate(handle, token);
        if (result) status('disconnected', '已读取记忆文件，确认恢复后才会保存。', {name: result.name, remembered: true});
        return result;
      } catch (error) {return selectionError(error, token, handle.name);}
    }
    async function chooseNew() {
      if (!supported) return unsupported();
      const token = beginSelection();
      let handle;
      try {
        // The picker is the first async operation: preserve user activation.
        handle = await window.showSaveFilePicker({suggestedName: '第一章-作答记录.json', types: TYPES});
        return await readCandidate(handle, token);
      } catch (error) {return selectionError(error, token, handle?.name);}
    }
    async function chooseExisting() {
      if (!supported) return unsupported();
      const token = beginSelection();
      let handle;
      try {
        [handle] = await window.showOpenFilePicker({multiple: false, types: TYPES});
        return await readCandidate(handle, token);
      } catch (error) {return selectionError(error, token, handle?.name);}
    }
    async function reconnect() {
      if (!supported) return unsupported();
      const token = beginSelection();
      const handle = rememberedHandle || active?.handle;
      if (!handle || typeof handle.requestPermission !== 'function') {
        status('disconnected', '没有可重新连接的文件，请先选择本机作答文件。');
        return null;
      }
      try {
        // This must be called directly from the reconnect-button gesture.
        const permission = await handle.requestPermission({mode: 'readwrite'});
        if (token !== selection) return null;
        if (permission !== 'granted') {
          needsPermission = true;
          status('permission', '尚未获得文件读写权限；文件没有被修改。', {name: handle.name});
          return null;
        }
        needsPermission = false;
        return await readCandidate(handle, token);
      } catch (error) {return selectionError(error, token, handle.name);}
    }
    async function acceptCandidate() {
      if (!candidate) return false;
      const accepted = candidate;
      candidate = null; ++selection;
      const acceptedGeneration = ++generation;
      active = {handle: accepted.handle, name: accepted.name};
      rememberedHandle = accepted.handle; remembered = false; needsPermission = accepted.permission !== 'granted'; pending = null;
      let memoryError = '';
      try {await memory('put', accepted.handle); remembered = acceptedGeneration === generation;}
      catch (error) {memoryError = errorText(error);}
      if (acceptedGeneration !== generation || active?.handle !== accepted.handle) return false;
      const detail = memoryError ? '仅本次会话连接有效，浏览器未能记忆文件：' + memoryError : '已连接本机作答文件，后续保存会写入此文件。';
      status(accepted.permission === 'granted' ? 'ready' : 'permission',
        accepted.permission === 'granted' ? detail : detail + ' 请点击重新连接以确认读写权限。');
      return true;
    }
    function cancelCandidate() {
      candidate = null; ++selection;
      if (!active) status(rememberedHandle && needsPermission ? 'permission' : 'disconnected',
        rememberedHandle && needsPermission ? '已记忆文件，请点击重新连接以确认读写权限。' : '未启用候选文件，原文件没有被修改。');
    }
    async function disconnect() {
      const disconnectedGeneration = ++generation;
      ++selection; candidate = null; active = null; pending = null; rememberedHandle = null; remembered = false; needsPermission = false;
      status(supported ? 'disconnected' : 'unsupported', '已断开文件连接；用户文件没有被删除。');
      try {await memory('delete');}
      catch (error) {
        if (disconnectedGeneration === generation) status('disconnected', '本次会话已断开，但浏览器未能清除文件记忆：' + errorText(error));
      }
      return true;
    }
    const currentJob = job => job.generation === generation && active?.handle === job.handle;
    async function abort(writer) {
      if (writer && typeof writer.abort === 'function') {try {await writer.abort();} catch {}}
    }
    async function drain() {
      let success = false;
      try {
      while (pending) {
        const job = pending; pending = null;
        if (!currentJob(job)) continue;
        let writer;
        try {
          status('saving', '正在将最新作答快照写入本机文件。');
          const permission = await job.handle.queryPermission({mode: 'readwrite'});
          if (!currentJob(job)) continue;
          if (permission !== 'granted') {
            needsPermission = true;
            const error = new Error('请点击重新连接，确认文件读写权限后重试保存。');
            error.name = 'NotAllowedError'; throw error;
          }
          needsPermission = false;
          writer = await job.handle.createWritable();
          if (!currentJob(job)) {await abort(writer); continue;}
          await writer.write(job.text);
          if (!currentJob(job)) {await abort(writer); continue;}
          await writer.close();
          if (currentJob(job)) {
            success = true;
            if (!pending) status('saved', '最新作答快照已保存到本机文件。', {savedAt: new Date().toISOString()});
          }
        } catch (error) {
          await abort(writer);
          if (!currentJob(job)) continue;
          success = false;
          if (!pending || pending.revision < job.revision) pending = job;
          const failedRevision = pending.revision;
          if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') needsPermission = true;
          status(error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'permission' : 'error',
            '文件保存未完成，最新快照仍待保存：' + errorText(error));
          // A fresh save requested inside the callback is an explicit retry.
          if (pending && pending.revision > failedRevision) continue;
          break;
        }
      }
      return success;
      } finally {
        // Clear this before the async function resolves: a saved callback may
        // enqueue its next save in a microtask before an outer .finally runs.
        running = false;
      }
    }
    function startDrain() {
      if (!running) {
        running = true;
        // Defer the first step until drainPromise exists, including for callers
        // that enqueue another save from the saving-status callback.
        drainPromise = Promise.resolve().then(drain);
      }
      return drainPromise;
    }
    function save(snapshot) {
      if (!supported) {unsupported(); return Promise.resolve(false);}
      if (!active) {
        status(rememberedHandle && needsPermission ? 'permission' : 'disconnected',
          rememberedHandle && needsPermission ? '已记忆文件，请点击重新连接以确认读写权限。' : '尚未确认本机文件，当前记录不会写入文件。');
        return Promise.resolve(false);
      }
      let text;
      try {
        const clone = JSON.parse(JSON.stringify(snapshot));
        text = JSON.stringify(normalize(clone), null, 2) + '\n';
        if (new Blob([text]).size > MAX_BYTES) throw new Error('记录超过 10 MB，未写入文件。');
      } catch (error) {status('error', '作答快照无效：' + errorText(error)); return Promise.resolve(false);}
      const handle = active.handle, savedGeneration = generation;
      pending = {handle, generation: savedGeneration, revision: ++revision, text};
      return startDrain().then(success => success && generation === savedGeneration && active?.handle === handle);
    }
    status(supported ? 'disconnected' : 'unsupported', supported ? '尚未连接本机作答文件。' : '当前浏览器不支持本机文件保存，请使用导出作答记录。');
    return Object.freeze({supported, initialize, chooseNew, chooseExisting, reconnect,
      acceptCandidate, cancelCandidate, disconnect, save});
  }
  window.QuizFileStore = Object.freeze({create});
})();
