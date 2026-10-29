import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Marked, Renderer } from 'marked';
import { migrateExercises } from './第四章资源/exercise-migration.mjs';

// Build a self-contained offline page using the established chapter-one shell.
// Neither the source notes nor any chapter-one asset is changed by this build.
const out = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.dirname(out);
const assets = path.join(out, '第四章资源');
const read = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const sourceDir = path.join(workspace, 'lesson-notes/chapter-04');
const sourcePaths = [path.join(sourceDir, '第四章 学习笔记.md')];
const sources = sourcePaths.map(read);
const exerciseMigration = migrateExercises(sources[0]);
fs.writeFileSync(path.join(assets,'exercise-migration.json'),JSON.stringify(exerciseMigration.migration,null,2));
fs.writeFileSync(path.join(assets,'quiz-original.json'),JSON.stringify(exerciseMigration.originalQuestions,null,2));
const config = JSON.parse(read(path.join(assets, 'chapter-config.json')));
const { labels, introductions, pipelines, stageDetails, captions } = config;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain = value => value.replace(/<[^>]*>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const cleanTitle = value => value.replace(/\\([.\-+_()])/g, '$1').replace(/[`*]/g, '').trim();
const normalized = value => cleanTitle(value).replace(/[\s：:？?，,、。！!]/g, '').toLowerCase();
const lexer = new Marked({gfm: true});
const all = exerciseMigration.tokens;
const chapters = [], prelude = [];
for (const token of all) {
  if (token.type === 'heading' && token.depth === 1 && /^4\\?\.[1-6]\s/.test(token.text)) {
    chapters.push({title: cleanTitle(token.text), tokens: [], headings: [], codeCount: 0, tableCount: 0});
  } else if (chapters.length) chapters.at(-1).tokens.push(token);
  else if (!(token.type==='heading' && token.depth===1 && token.text==='第四章 学习笔记')) prelude.push(token);
}
if (chapters.length !== 6) throw new Error('Expected six sections');
chapters[0].tokens.unshift(...prelude, ...lexer.lexer('## 4.1 正文：组织本轮需要的信息\n'));

const searchIndex = [];
let codeId = 0;
for (const [i, chapter] of chapters.entries()) {
  chapter.id = `chapter-${i + 1}`;
  const renderer = new Renderer();
  renderer.heading = function({tokens, depth}) {
    const text = this.parser.parseInline(tokens);
    if (!plain(text).trim()) return '';
    depth = Math.max(2, depth);
    const id = `c${i + 1}-s${chapter.headings.length + 1}`;
    chapter.headings.push({id, depth, text: plain(text)});
    return `<h${depth} id="${id}">${text}</h${depth}>\n`;
  };
  renderer.paragraph = function({tokens}) {
    const codes = [];
    let html = this.parser.parseInline(tokens).replace(/<code>[\s\S]*?<\/code>/g, code => '\uE000' + (codes.push(code)-1) + '\uE001');
    html = html.replace(/\*\*([^*\n]+?)\*\*/g, (_, text) => '<strong>' + text.trim() + '</strong>');
    return '<p>' + html.replace(/\uE000(\d+)\uE001/g, (_, n) => codes[Number(n)]) + '</p>\n';
  };
  renderer.code = function({text, lang}) {
    chapter.codeCount++;
    const id = 'code-' + (++codeId), lines = text.split('\n').length;
    const label = (lang || 'Plain Text').replace(/^plaintext$/i, 'Plain Text');
    const isPlain = /^plain\s*text$/i.test(label);
    let content = `<pre><code id="${id}">${escape(text)}</code></pre>`;
    if (lines > 32 && !isPlain) content = `<details><summary>展开完整代码 · ${lines} 行</summary>${content}</details>`;
    return `<div class="code-block${isPlain ? ' plain-code' : ''}"><div class="code-tools"><span>${escape(label)} · ${lines} 行</span><button type="button" class="copy-code" data-copy="${id}" aria-label="复制 ${escape(label)} 代码">复制代码</button></div>${content}</div>\n`;
  };
  renderer.table = function(token) {
    chapter.tableCount++;
    return '<div class="table-wrap" role="region" aria-label="内容对照表" tabindex="0">' + Renderer.prototype.table.call(this, token) + '</div>\n';
  };
  renderer.html = ({text}) => escape(text);
  renderer.link = function({href, tokens}) {
    const text = this.parser.parseInline(tokens);
    if (!/^(https?:|mailto:|#)/i.test(href)) return text;
    return '<a href="' + escape(href) + '"' + (href.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"') + '>' + text + '</a>';
  };
  renderer.image = ({href, text}) => /^https?:/i.test(href) ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">原文图片：${escape(text)}</a>` : escape(text);
  const compiler = new Marked({gfm: true, renderer});
  compiler.walkTokens(chapter.tokens, token => {
    if (token.type === 'paragraph' && /\*{4}`[^`]+`\*{4}/.test(token.text)) token.tokens = compiler.lexer(token.text.replace(/\*{4}(`[^`]+`)\*{4}/g, '$1'))[0].tokens;
  });
  chapter.tokens.links = all.links;
  chapter.html = compiler.parser(chapter.tokens);
  searchIndex.push({chapter:chapter.id, target:chapter.id, title:chapter.title, label:`4.${i+1} · ${labels[i]}`, text:introductions[i]});
  for (const chunk of chapter.html.split(/(?=<h[23]\s)/)) {
    const heading = chunk.match(/^<h[23] id="([^"]+)">([\s\S]*?)<\/h[23]>/);
    const text = plain(chunk.replace(/<button[\s\S]*?<\/button>/g, '')).replace(/\s+/g, ' ').trim();
    if (text) searchIndex.push({chapter:chapter.id, target:heading?.[1] || chapter.id, title:heading ? plain(heading[2]) : labels[i], label:`4.${i+1} · ${labels[i]}`, text});
  }
}
function resolveHeading(ref, defaultNumber) {
  const match = ref.match(/^4\.([1-6])\s*[／/]?\s*(.*)$/);
  const chapter = chapters[Number(match?.[1] || defaultNumber.split('.')[1]) - 1];
  const title = normalized(match ? match[2] : ref);
  const heading = chapter.headings.find(h => normalized(h.text) === title);
  if (!heading) throw new Error('Unresolved source heading: ' + ref);
  return {id:heading.id, title:heading.text};
}
const quizBank = JSON.parse(read(path.join(assets, 'quiz-generated.json')));
for(const lesson of quizBank.lessons)lesson.questions.push(...exerciseMigration.originalQuestions.filter(q=>q.id.startsWith(lesson.number+'-')));
const totalQuestions=quizBank.lessons.reduce((sum,lesson)=>sum+lesson.questions.length,0);
const glossaryEntries = JSON.parse(read(path.join(assets, 'glossary.json')));
const termIds = new Set(), aliases = new Map();
for(const term of glossaryEntries){
  if(termIds.has(term.id))throw new Error('Duplicate term: '+term.id); termIds.add(term.id);
  for(const alias of term.aliases){const key=alias.toLowerCase();if(aliases.has(key)&&aliases.get(key)!==term.id)throw new Error('Alias collision: '+alias);aliases.set(key,term.id);}
}
for (const lesson of quizBank.lessons) for (const q of lesson.questions) q.reviewTargets = q.sourceRefs.map(ref => resolveHeading(ref, lesson.number));
for (const term of glossaryEntries) for (const source of term.sources) if (!source.url) source.target = resolveHeading(source.section, term.chapters[0]).id;
const totalCodes = chapters.reduce((s,c) => s+c.codeCount, 0), totalTables = chapters.reduce((s,c) => s+c.tableCount, 0);
const sourceCounts = {codes:0,tables:0};
for (const source of sources) lexer.walkTokens(lexer.lexer(source), t => {if(t.type==='code')sourceCounts.codes++;if(t.type==='table')sourceCounts.tables++;});
if (totalCodes!==sourceCounts.codes || totalTables!==sourceCounts.tables) throw new Error('Source coverage mismatch');
if (quizBank.lessons.length !== 6 || quizBank.lessons.some((l,i)=>l.number!==`4.${i+1}`||l.questions.length<10)) throw new Error('Expected six lessons with their existing ten questions and migrated exercises');

// Compile chapter-specific copies into the single HTML; original assets stay intact.
const scripts = ['glossary.js','quiz-file-store.js','lesson-quiz.js','notes.js'].map(file => {
  let js = read(path.join(out,file)).replaceAll('chapter-one','chapter-four').replaceAll('第一章','第四章').replaceAll('1.1～1.7','4.1～4.6').replaceAll('全部七节','全部六节').replaceAll("'1.'", "'4.'").replaceAll('^1\\.', '^4\\.').replaceAll('[1-7]','[1-6]');
  if (file === 'glossary.js') {
    js = js.replace('搜索 temperature、top_p 或中文关键词…', '搜索上下文、记忆、RAG、来源…');
    js = js.replace("['plain','白话解释']", "['plain','先听大白话']").replace("['steps','分步演示']", "['steps','走一遍流程']").replace("['example','小例子']", "['example','本章例子']");
    js = js.replace("if(activeView==='analogy')", "if(activeView==='plain')panel+='<div class=\"term-card\"><h3>放到生活里：'+esc(term.analogy.title)+'</h3><p>'+esc(term.analogy.description)+'</p></div><h3>回到本章</h3><p>'+esc(term.example.explanation)+'</p>';\n    if(activeView==='analogy')");
    js = js.replace("term.plain].join(' ')", "term.plain,term.analogy.description,term.example.explanation].join(' ')");
  }
  return js;
}).join('\n');
const css = ['notes.css','glossary.css','learning-workspace.css','lesson-quiz.css'].map(file=>read(path.join(out,file))).join('\n') + '\n.chapter-appendices{margin-top:18px;padding:14px 18px;background:var(--tint);border:1px solid var(--line);border-radius:10px;display:flex;gap:10px 20px;flex-wrap:wrap;font-size:12px}.term-card{margin-top:16px}.flow-step{min-width:0;overflow-wrap:anywhere}.term-trigger{overflow-wrap:anywhere}@media(max-width:760px){.topbar{flex-wrap:wrap}.top-actions{flex-wrap:wrap;gap:6px}.top-actions .btn{font-size:11px;padding:6px 8px}.search-open{gap:8px}.document-stats{flex-wrap:wrap}}';
const chapterMarkup = chapters.map((c,i)=>{
  const flow = pipelines[i].map(([label,description],j)=> i===0 ? `<button type="button" class="flow-step stage-button" data-stage="${j}" aria-pressed="${j===0}"><b>${escape(label)}</b><span>${escape(description)}</span></button>` : `<div class="flow-step"><b>${j+1} · ${escape(label)}</b><span>${escape(description)}</span></div>`).join('');
  return `<article class="chapter paper" id="${c.id}" data-label="${escape(labels[i])}"${i?' hidden':''}><header class="chapter-head"><div class="eyebrow">SECTION 4.${i+1} / 06</div><h2>${escape(c.title)}</h2><p>${introductions[i]}</p><div class="meta"><span>${c.headings.filter(h=>h.depth===2).length} 个主题</span><span>${c.codeCount} 个代码块</span><span>${c.tableCount} 张表格</span></div></header><section class="visual-summary" aria-label="本节学习主线"><h3>学习主线 <span class="small">· 根据本节原文整理</span></h3><div class="flow">${flow}</div>${i===0?`<div class="stage-detail" id="stage-detail" aria-live="polite">${stageDetails[0]}</div>`:''}<p class="caption">${captions[i]}</p></section><div class="markdown">${c.html}</div><footer class="chapter-bottom"><div class="chapter-selftest-callout"><span>读完本节，检验一下理解</span><a class="btn primary" href="#quiz-${i+1}">开始本节自测 · ${quizBank.lessons[i].questions.length} 题 →</a></div>${i?`<a href="#chapter-${i}">← 上一节<br>4.${i} ${labels[i-1]}</a>`:'<span class="small">第四章 · 为每轮决策准备可靠信息</span>'}${i<5?`<a href="#chapter-${i+2}">下一节 →<br>4.${i+2} ${labels[i+1]}</a>`:'<a href="index.html">返回页面入口 →</a>'}</footer></article>`;
}).join('\n');
const chapterLinks = chapters.map((c,i)=>`<a class="chapter-link${i?'':' active'}" data-chapter="${i+1}" href="#${c.id}"${i?'':' aria-current="page"'}><span class="number">4.${i+1}</span><span class="chapter-link-copy"><span>${labels[i]}</span><small data-chapter-progress="${i+1}">自测 0 / ${quizBank.lessons[i].questions.length}</small></span></a>`).join('');
let html = read(path.join(out, 'chapter-one.html'));
html = html.slice(0, html.indexOf('<script type="application/json" id="page-data">'));
html = html.replace(/<style>[\s\S]*?<\/style>/, ()=>'<style>'+css+'</style>');
html = html.replace(/(<nav class="chapter-nav"[^>]*>)[\s\S]*?<\/nav>/, (_, start)=>start+chapterLinks+'</nav>');
html = html.replace(/(<div id="notes-reader"[^>]*>)[\s\S]*?(<section id="lesson-quiz")/, (_, start, end)=>start+'<!--CHAPTER_CONTENT--></div>'+end);
html = html.replaceAll('第一章', '第四章').replaceAll('CHAPTER ONE', 'CHAPTER FOUR').replaceAll('七节', '六节').replaceAll('70道', totalQuestions+'道');
html = html.replace('从 LLM 到 Agent，从输入输出协议到统一模型服务。', '从上下文、工作记忆到 RAG 与 Wiki：让信息适用、能核对，并服务于受控执行。');
html = html.replace(/<a class="btn primary" href="\.\.\/讲解视频[\s\S]*?<\/span>/, `<span class="small">正文与附录 · 原题与自测共 ${totalQuestions} 题 · 点击术语看生活类比</span>`);
html = html.replace('1.1 从 LLM 到 Agent', '4.1 Context：组织本轮信息').replace('id="crumb-current">从 LLM 到 Agent', 'id="crumb-current">Context：组织本轮信息');
html = html.replace(/<div class="document-stats">[\s\S]*?<\/header>/, `<div class="document-stats"><div><b>06</b><span>学习节</span></div><div><b>${totalQuestions}</b><span>原题与自测</span></div><div><b>${glossaryEntries.length}</b><span>生活化术语</span></div></div></header>`);
const appendixLinks = chapters[5].headings.filter(h=>/^(本章总结|附录)/.test(h.text)).map(h=>`<a href="#${h.id}">${escape(h.text.split('：')[0])}</a>`).join('');
html = html.replace('<section class="lesson-workspace"', '<nav class="chapter-appendices" aria-label="总结与附录">'+appendixLinks+'</nav><section class="lesson-workspace"');
html = html.replace('<a href="resume.html">查看个人简历 ↗</a>', '<a href="chapter-three.html">← 第三章学习笔记</a><a href="chapter-two.html">第二章学习笔记</a><a href="chapter-one.html">第一章学习笔记</a>');
html = html.replace('内容来源：第四章 学习笔记.md · 正文、代码与表格完整转换', `内容来源：第四章学习笔记 · 原有练习与答案已并入自测 · ${totalCodes} 个代码块 / ${totalTables} 张表格 · 完整离线阅读`);
html = html.replace('<!--CHAPTER_CONTENT-->', ()=>chapterMarkup);
const embedded = JSON.stringify({searchIndex,stageDetails,glossaryEntries,quizBank,exerciseRedirects:{}}).replace(/</g, '\\u003c');
html += `<script type="application/json" id="page-data">${embedded}</script><script>${scripts}</script></body></html>`;
fs.writeFileSync(path.join(out, 'chapter-four.html'), html);
for (const answers of [false,true]) {
  const blocks = ['第四章 · '+(answers?'答案与评分解析':'自测题目')+`\n原有练习与新增自测共${totalQuestions}题。开放题按要点自评，每题10分。`];
  for(const lesson of quizBank.lessons){
    blocks.push('\n'+lesson.number+' '+lesson.title+' · '+lesson.questions.length+'题 · '+lesson.questions.length*10+'分');
    for(const q of lesson.questions){blocks.push('\n'+q.id+' '+q.title+(q.sourceLabel?'【'+q.sourceLabel+'】':'')+'\n'+q.prompt+(q.alternatePrompts?.length?'\n原笔记中的同题表述：\n'+q.alternatePrompts.join('\n'):'')+(q.code?'\n'+q.code:'')+(q.options?'\n'+q.options.map(o=>o.key+'. '+o.text).join('\n'):''));if(answers)blocks.push('参考答案：'+q.referenceAnswer+'\n解析：'+q.explanation+(q.rubric?'\n评分：'+q.rubric.map(r=>r.score+'分 '+r.point).join('\n'):''));}
  }
  fs.writeFileSync(path.join(out,'第四章测试题-'+(answers?'答案解析':'题目版')+'.txt'),blocks.join('\n'));
}
const report = {sources:sourcePaths.map(file=>({path:path.relative(workspace,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})),chapterCount:6,originalPromptCount:exerciseMigration.migration.originalPromptCount,addedOriginalQuestions:exerciseMigration.originalQuestions.length,mergedOriginalPrompts:exerciseMigration.migration.mergedPromptCount,codeBlockCount:totalCodes,tableCount:totalTables,questionCount:quizBank.lessons.flatMap(l=>l.questions).length,glossaryCount:glossaryEntries.length,htmlBytes:Buffer.byteLength(html),chapters:chapters.map(c=>({title:c.title,headings:c.headings,codeCount:c.codeCount,tableCount:c.tableCount}))};
fs.writeFileSync(path.join(assets, 'build-report.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,chapters:report.chapters.map(c=>({title:c.title,codeCount:c.codeCount,tableCount:c.tableCount}))},null,2));
