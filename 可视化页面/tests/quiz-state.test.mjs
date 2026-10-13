import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the production scripts. The small DOM below models their event and
// text APIs only; visual layout and native file pickers need browser checks.
const quizSource = readFileSync(new URL('../lesson-quiz.js', import.meta.url), 'utf8');
const notesSource = readFileSync(new URL('../notes.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const blankAnswer = () => ({choice: [], written: '', revealed: false, studyOnly: false, rubricSelected: [], selfConfirmed: false});
const blankRecord = () => ({version: 1, selected: 0, positions: {}, answers: {}});
const fixtureBank = {
  lessons: [12, 3].map((count, section) => ({
    number: `1.${section + 1}`, title: `Section ${section + 1}`,
    questions: Array.from({length: count}, (_, index) => {
      const common = {id: `1.${section + 1}-${String(index + 1).padStart(2, '0')}`, order: index + 1, level: 1,
        title: `Question ${index + 1}`, prompt: 'Explain the choice.', referenceAnswer: 'Expected answer', explanation: 'Evidence', sourceRefs: []};
      if (index === 1) return {...common, type: 'short', rubric: [{point: 'First criterion', score: 3}, {point: 'Second criterion', score: 7}]};
      return {...common, type: 'single', options: [{key: 'A', text: 'Correct'}, {key: 'B', text: 'Incorrect'}], answer: ['A']};
    })
  }))
};

function harness({record, migration, notes = false, redirects = {}} = {}) {
  const nodes = new Map(), events = [], blobs = [], timers = new Map();
  const storage = new Map(record ? [['chapter-one-quiz-v1', JSON.stringify(record)]] : []);
  let nextTimer = 0;
  class Element {
    constructor(id = '') {
      this.id = id; this.hidden = false; this.disabled = false; this.dataset = {}; this.style = {};
      this.textContent = ''; this.innerHTML = ''; this.value = ''; this.children = [];
      this.attributes = new Map(); this.listeners = new Map();
      const classes = new Set();
      this.classList = {add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)),
        contains: x => classes.has(x), toggle: (x, force) => {const on = force ?? !classes.has(x); on ? classes.add(x) : classes.delete(x); return on;}};
    }
    addEventListener(name, fn) {this.listeners.set(name, [...(this.listeners.get(name) || []), fn]);}
    dispatchEvent(event) {for (const fn of this.listeners.get(event.type) || []) fn(event); return true;}
    setAttribute(key, value) {this.attributes.set(key, String(value));}
    getAttribute(key) {return this.attributes.get(key) ?? null;}
    hasAttribute(key) {return this.attributes.has(key);}
    removeAttribute(key) {this.attributes.delete(key);}
    querySelector(selector) {return selector.startsWith('#') ? node(selector.slice(1)) : null;}
    querySelectorAll() {return [];}
    append(...children) {this.children.push(...children);}
    appendChild(child) {this.append(child);}
    replaceChildren(...children) {this.children = children;}
    insertAdjacentHTML(_position, html) {this.innerHTML += html;}
    contains(element) {return this.id === 'lesson-quiz' ? !!element?.quizChild : element === this;}
    closest(selector) {return selector === 'article.chapter' && this.id.startsWith('chapter-') ? this : null;}
    getBoundingClientRect() {return {top: 0, bottom: 100, left: 0, right: 100};}
    focus() {document.activeElement = this;}
    scrollIntoView() {}
    click() {this.dispatchEvent({type: 'click', target: this});}
    remove() {}
  }
  const node = id => {if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id);};
  const host = node('lesson-quiz'); host.hidden = true;
  node('page-data').textContent = JSON.stringify({quizBank: fixtureBank, searchIndex: [], stageDetails: [], exerciseRedirects: redirects});
  const chapters = fixtureBank.lessons.map((l, index) => {const n = node(`chapter-${index + 1}`); n.dataset.label = l.title; n.offsetHeight = 1000; return n;});
  const navLinks = chapters.map((_, index) => {const n = new Element(); n.dataset.chapter = String(index + 1); return n;});
  const document = new Element('document');
  document.body = new Element('body'); document.activeElement = document.body; document.visibilityState = 'visible';
  document.getElementById = id => id ? node(id) : null;
  document.querySelectorAll = selector => selector === 'article.chapter' ? chapters : selector === '.chapter-link' ? navLinks : [];
  document.querySelector = () => null;
  document.createElement = () => new Element();
  const originalDispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = event => {events.push(event); return originalDispatch(event);};
  const window = new Element('window');
  window.name = migration ? JSON.stringify({kind: 'chapter-one-quiz-migration', version: 1, record: migration}) : '';
  window.matchMedia = () => ({matches: false, addEventListener() {}});
  window.scrollTo = () => {}; window.scrollY = 0; window.innerHeight = 700;
  const location = {hash: ''};
  const context = vm.createContext({window, document, location, navigator: {},
    history: {replaceState(_state, _unused, url) {location.hash = url;}},
    requestAnimationFrame: fn => fn(),
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    setTimeout: fn => {timers.set(++nextTimer, fn); return nextTimer;}, clearTimeout: id => timers.delete(id),
    Blob, URL: {createObjectURL(blob) {blobs.push(blob); return 'blob:test';}, revokeObjectURL() {}}});
  // Expose closure references only in this test VM; production API stays unchanged.
  const hooks = `globalThis.__test = {sanitize, fileSnapshot, handleFileCandidate, importFile, exportRecord,
    get state() {return state;}, get candidate() {return fileCandidate;}, get collectionView() {return collectionView;},
    attachFileStore(store) {fileStore = store;}};`;
  const inject = (source, extra) => {const at = source.lastIndexOf('})();'); assert.ok(at >= 0); return source.slice(0, at) + extra + source.slice(at);};
  vm.runInContext(inject(quizSource, hooks), context, {filename: 'lesson-quiz.js'});
  if (notes) vm.runInContext(inject(notesSource, 'globalThis.__route = showHash;'), context, {filename: 'notes.js'});
  return {api: window.ChapterQuiz, hooks: context.__test, nodes, node, events, storage, blobs,
    route(hash) {location.hash = hash; context.__route();}, get hash() {return location.hash;},
    action(action) {
      const button = new Element(); button.quizChild = true; button.dataset.quizAction = action;
      button.closest = () => button; host.dispatchEvent({type: 'click', target: button});
    },
    favoriteOpen(id) {
      const button = new Element(); button.quizChild = true; button.dataset.quizFavoriteOpen = id;
      button.closest = () => button; host.dispatchEvent({type: 'click', target: button});
    }
  };
}

function legacyWithAnswers() {
  const record = blankRecord(); record.positions['1.1'] = 9;
  record.answers['1.1-01'] = {...blankAnswer(), choice: ['A'], revealed: true};
  record.answers['1.1-02'] = {...blankAnswer(), written: '我的分析：先取证，再执行。', revealed: true, rubricSelected: [1], selfConfirmed: true};
  return record;
}

test('original v1 storage without favorites retains choices, text, scores and position after bank grows beyond ten', () => {
  const old = legacyWithAnswers(), h = harness({record: old});
  assert.deepEqual(plain(h.hooks.state.answers), old.answers);
  assert.deepEqual(plain(h.hooks.state.favorites), []);
  assert.equal(h.api.summary('1.1').position, 9);
  assert.equal(h.api.summary('1.1').count, 12);
  assert.equal(h.api.summary('1.1').completed, 2);
  assert.equal(h.api.summary('1.1').objective, 10);
  assert.equal(h.api.summary('1.1').subjective, 7);
  h.api.show('1.1');
  assert.equal(h.node('quiz-completion').textContent, '2 / 12');
  assert.equal(h.node('quiz-total').textContent, '17 / 120');
  assert.equal(h.node('quiz-progress').getAttribute('aria-valuemax'), '12');
  assert.match(h.node('quiz-card').innerHTML, /10 \/ 12/);
});

test('valid favorites round-trip through sanitizer without trusting imported score metadata', () => {
  const h = harness(), raw = {...legacyWithAnswers(), favorites: ['1.1-12', '1.2-01'], scores: [{total: 9999}]};
  const clean = h.hooks.sanitize(raw);
  assert.deepEqual(plain(clean.favorites), raw.favorites);
  assert.equal(clean.scores, undefined);
  raw.favorites.push('1.1-01');
  assert.deepEqual(plain(clean.favorites), ['1.1-12', '1.2-01']);
});

for (const [label, favorites] of [
  ['unknown question', ['1.1-99']], ['duplicate question', ['1.1-01', '1.1-01']],
  ['string instead of array', '1.1-01'], ['null', null], ['numeric member', [1]],
  ['object member', [{id: '1.1-01'}]], ['question from another chapter', ['2.1-01']]
]) test(`reject invalid favorites: ${label}`, () => {
  const h = harness();
  assert.throws(() => h.hooks.sanitize({...blankRecord(), favorites}), /收藏题号无效或重复/);
});

test('favorite button persists immediately, remains unscored, and toggles off without touching a submitted answer', () => {
  const h = harness({record: legacyWithAnswers()}); h.api.show('1.1', '1.1-12');
  const before = plain(h.api.summary('1.1'));
  h.action('favorite');
  assert.deepEqual(plain(h.hooks.state.favorites), ['1.1-12']);
  assert.deepEqual(plain(h.api.summary('1.1')), before);
  const saved = JSON.parse(h.storage.get('chapter-one-quiz-v1'));
  assert.deepEqual(saved.favorites, ['1.1-12']);
  const reopened = harness({record: saved});
  assert.deepEqual(plain(reopened.hooks.state.favorites), ['1.1-12']);
  h.api.show('1.1', '1.1-01');
  const answer = plain(h.hooks.state.answers['1.1-01']);
  h.action('favorite'); h.action('favorite');
  assert.deepEqual(plain(h.hooks.state.answers['1.1-01']), answer);
  assert.equal(h.api.summary('1.1').total, 17);
});

test('clear and retry actions retain favorites while clearing only the intended answer or score', () => {
  const h = harness({record: {...legacyWithAnswers(), favorites: ['1.1-01', '1.1-02']}});
  h.api.show('1.1', '1.1-01'); h.action('clear');
  assert.deepEqual(plain(h.hooks.state.favorites), ['1.1-01', '1.1-02']);
  assert.deepEqual(plain(h.hooks.state.answers['1.1-01']), blankAnswer());
  assert.equal(h.api.summary('1.1').total, 7);
  h.api.show('1.1', '1.1-02'); h.action('retry');
  assert.equal(h.hooks.state.answers['1.1-02'].written, '我的分析：先取证，再执行。');
  assert.deepEqual(plain(h.hooks.state.favorites), ['1.1-01', '1.1-02']);
  assert.equal(h.api.summary('1.1').completed, 0);
});

test('JSON export and automatic-save snapshot both include favorites and preserve original answer data', async () => {
  const record = {...legacyWithAnswers(), favorites: ['1.1-11', '1.2-01']};
  const h = harness({record}); h.api.show('1.1'); h.action('export');
  assert.equal(h.blobs.length, 1);
  const exported = JSON.parse(await h.blobs[0].text());
  const snapshot = h.hooks.fileSnapshot();
  assert.deepEqual(exported.favorites, record.favorites);
  assert.deepEqual(plain(snapshot.favorites), record.favorites);
  assert.deepEqual(exported.answers, plain(snapshot.answers));
  assert.equal(exported.scores[0].total, 17);
  snapshot.favorites.push('1.1-01');
  assert.deepEqual(plain(h.hooks.state.favorites), record.favorites);
  const imported = harness(); imported.api.show('1.1');
  await imported.hooks.importFile({size: 300, text: async () => JSON.stringify(exported)});
  assert.deepEqual(plain(imported.hooks.state.favorites), record.favorites);
  assert.deepEqual(plain(imported.hooks.state.answers), exported.answers);
  assert.equal(imported.api.summary('1.1').total, 17);
});

test('legacy import remains accepted and a malformed favorites import is atomic', async () => {
  const h = harness({record: {...legacyWithAnswers(), favorites: ['1.1-01']}}); h.api.show('1.1');
  const before = plain(h.hooks.state);
  await h.hooks.importFile({size: 300, text: async () => JSON.stringify({...blankRecord(), favorites: ['bogus']})});
  assert.deepEqual(plain(h.hooks.state), before);
  assert.match(h.node('quiz-transfer-status').textContent, /导入失败/);
  await h.hooks.importFile({size: 300, text: async () => '\uFEFF' + JSON.stringify(legacyWithAnswers())});
  assert.deepEqual(plain(h.hooks.state.favorites), []);
  assert.equal(h.api.summary('1.1').total, 17);
  assert.match(h.node('quiz-transfer-status').textContent, /已导入/);
});

test('a connected file differing only in favorites cannot silently overwrite either record', async () => {
  const h = harness({record: {...blankRecord(), favorites: ['1.1-01']}});
  const calls = {accepted: 0, saved: []};
  h.hooks.attachFileStore({acceptCandidate: async () => {calls.accepted++; return true;}, save: record => calls.saved.push(record)});
  const candidate = {name: 'progress.json', record: h.hooks.sanitize({...blankRecord(), favorites: ['1.2-01']})};
  await h.hooks.handleFileCandidate(candidate);
  assert.equal(calls.accepted, 0); assert.equal(calls.saved.length, 0);
  assert.equal(h.hooks.candidate, candidate);
  assert.deepEqual(plain(h.hooks.state.favorites), ['1.1-01']);
  h.api.show('1.1');
  assert.equal(h.node('quiz-file-conflict').hidden, false);
  assert.match(h.node('quiz-file-conflict-text').textContent, /选择前不会覆盖文件/);
});

test('a file can restore favorites into a completely empty browser; equal sets in different order do not conflict', async () => {
  const h = harness(), calls = {accepted: 0, saved: []};
  h.hooks.attachFileStore({acceptCandidate: async () => {calls.accepted++; return true;}, save: record => calls.saved.push(plain(record))});
  await h.hooks.handleFileCandidate({name: 'saved.json', record: h.hooks.sanitize({...blankRecord(), favorites: ['1.1-01', '1.2-01']})});
  assert.equal(calls.accepted, 1);
  assert.deepEqual(plain(h.hooks.state.favorites), ['1.1-01', '1.2-01']);
  assert.deepEqual(calls.saved[0].favorites, ['1.1-01', '1.2-01']);
  await h.hooks.handleFileCandidate({name: 'saved.json', record: h.hooks.sanitize({...blankRecord(), favorites: ['1.2-01', '1.1-01']})});
  assert.equal(calls.accepted, 2); assert.equal(h.hooks.candidate, null);
});

test('legacy window-name migration merges favorites without losing existing work', () => {
  const h = harness({record: {...legacyWithAnswers(), favorites: ['1.1-01']}, migration: {...blankRecord(), favorites: ['1.2-01']}});
  assert.deepEqual(plain(h.hooks.state.favorites), ['1.1-01', '1.2-01']);
  assert.equal(h.api.summary('1.1').total, 17);
});

test('notes router opens appended questions, follows migrated exercise anchors and keeps dynamic counts', () => {
  const h = harness({notes: true, redirects: {'c1-old-exercise': 'quiz-1-12'}});
  h.route('#quiz-1-11');
  assert.match(h.node('quiz-card').innerHTML, /11 \/ 12/);
  assert.equal(h.node('mode-quiz-progress').textContent, '0 / 12');
  h.action('next');
  assert.equal(h.hash, '#quiz-1-12');
  h.route('#c1-old-exercise');
  assert.equal(h.hash, '#quiz-1-12');
  assert.match(h.node('quiz-card').innerHTML, /12 \/ 12/);
});

test('collection links dispatch valid routes across sections and a direct unsaved question exits collection mode', () => {
  const h = harness({notes: true, record: {...blankRecord(), favorites: ['1.1-11', '1.2-01']}});
  h.route('#quiz-1-11'); h.action('view-favorites');
  assert.equal(h.hooks.collectionView, true);
  assert.match(h.node('quiz-favorites').innerHTML, /1\.2-01/);
  h.favoriteOpen('1.2-01');
  assert.equal(h.hash, 'quiz-2-01');
  h.route('#quiz-2-01');
  assert.equal(h.hooks.collectionView, true);
  h.route('#quiz-1-12');
  assert.equal(h.hooks.collectionView, false);
  assert.equal(h.node('quiz-card').hidden, false);
  assert.match(h.node('quiz-card').innerHTML, /12 \/ 12/);
});
