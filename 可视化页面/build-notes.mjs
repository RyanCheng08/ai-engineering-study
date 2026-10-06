import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Marked, Renderer } from 'marked';

const out = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.dirname(out);
const sourcePath = path.join(workspace, '第一章 学习笔记.md');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain = value => value.replace(/<[^>]*>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const cleanTitle = value => value.replace(/\\([.\-+_])/g, '$1').replace(/[`*]/g,'').trim();
const lexer = new Marked({gfm:true});
const all = lexer.lexer(source);
const chapters = [];
for (const token of all) {
  if (token.type === 'heading' && token.depth === 1 && /^1\\?\.[1-7]/.test(token.text)) {
    chapters.push({title:cleanTitle(token.text), tokens:[], headings:[], codeCount:0, tableCount:0});
  } else if (chapters.length) chapters.at(-1).tokens.push(token);
}
if (chapters.length !== 7) throw new Error('Expected seven chapters; got '+chapters.length);

const labels = ['从 LLM 到 Agent','可控输入与输出','Streaming 流式输出','Prompt Engineering','Structured Output','LLM Gateway','统一模型调用服务'];
const introductions = [
  '建立 Agent 运行总图，理解 Prompt、Context、Harness、Loop 与 Graph 的职责边界。',
  '从模型 API、采样参数到输出验收，把模型调用接入可控的工程协议。',
  '沿事件转换链理解流式输出，区分传输、任务取消、故障重试与事件重放。',
  '定义岗位、可信边界与完成条件，再用模板、示例和版本测试组织 Prompt。',
  '通过字段结构与业务组合校验，把候选输出变成可供程序消费的业务对象。',
  '把契约、Prompt、能力检查、调用治理与 Trace 收口为统一模型入口。',
  '从单文件原型演进到可配置、可部署、可治理的统一模型调用服务。'
];
const pipelines = [
  [['Prompt','角色、目标与规则'],['Context','本轮模型可见信息'],['Harness','运行装配与约束'],['Loop','多轮决策与反馈'],['Graph','显式流程与并行']],
  [['输入','上下文与调用参数'],['Adapter','归一供应商差异'],['LLM','生成候选结果'],['本地校验','Schema 与业务规则'],['Loop','消费可用结果']],
  [['Provider chunk','供应商增量对象'],['Model Adapter','归一为模型事件'],['Agent Loop','生成运行事实'],['SSE Gateway','编码事件帧'],['Client','解析网络字节']],
  [['定义岗位','角色、目标和规则'],['校准边界','Few-shot 示例'],['组织任务','分析 → 处理 → 检查'],['工程治理','模板、注入、版本']],
  [['候选 JSON','模型返回'],['语法校验','可否解析'],['结构校验','字段、类型与枚举'],['业务校验','跨字段组合'],['合法对象','交给业务消费']],
  [['统一契约','LLMRequest'],['Prompt','模板与版本'],['模型路由','白名单与能力'],['Provider','协议适配与调用'],['结果出口','校验 / SSE / Trace']],
  [['API Layer','鉴权、限流、输入与 SSE'],['Registry / Router','能力、状态与候选端点'],['Gateway Service','预算、重试与唯一终态'],['Model Adapter','供应商协议适配'],['Evidence','用量、成本与 Trace']]
];
const stageDetails = [
  'Prompt：告诉模型角色、目标与行为约束。它不能替代代码中的权限检查。',
  'Context：决定这一轮模型看到了什么，包括任务、历史消息、工具结果与相关知识。',
  'Harness：装配模型、Context、Tools、Hooks 和运行策略，组织一次受控运行。',
  'Loop：将观察、模型决策、工具动作和环境反馈串成多轮过程，并判断何时停止。',
  'Graph：用节点和边显式组织任务依赖、并行调度与结果合并。'
];
const captions = [
  '这是原文用于工程理解的能力分层；成熟 Agent 往往同时具备这些能力。点击节点查看职责。',
  '输出可解析之后仍须验收字段和业务组合；模型结果不能直接驱动未经校验的动作。',
  'Adapter 输出 ModelStreamEvent，Loop / Harness 输出 RunEvent；SSE frame 与 HTTP chunk 不是同一单位。',
  '规则负责行为引导；身份、权限、Schema 与状态机等确定性约束由代码保证。',
  '失败 → 反馈具体校验错误 → 有界修复；修复次数耗尽后降级或失败。结构合法不等于事实正确。',
  '临时故障仅作有限重试与能力等价 fallback；Trace 记录模型、Prompt、用量、成本、延迟和尝试次数。',
  'Gateway 负责一次模型调用；任务状态、工具权限、业务验证和多轮决策由 Harness / Loop 负责。'
];

let codeId = 0;
let proseEmphasisRepairs = 0;
const searchIndex = [];
for (let i=0; i<chapters.length; i++) {
  const chapter = chapters[i];
  chapter.id = 'chapter-'+(i+1);
  const renderer = new Renderer();
  renderer.paragraph = function({tokens}) {
    const inlineCode = [];
    let html = this.parser.parseInline(tokens).replace(/<code>[\s\S]*?<\/code>/g, code => '\uE000'+(inlineCode.push(code)-1)+'\uE001');
    // CommonMark leaves some exported Chinese emphasis literal when a
    // closing punctuation mark is immediately followed by Chinese text.
    html = html.replace(/\*\*([^*\n]+?)\*\*/g, (_, text) => {
      proseEmphasisRepairs++;
      return '<strong>'+text.trim()+'</strong>';
    });
    html = html.replace(/\uE000(\d+)\uE001/g, (_, index) => inlineCode[Number(index)]);
    return '<p>'+html+'</p>\n';
  };
  renderer.heading = function({tokens, depth}) {
    const text = this.parser.parseInline(tokens);
    if (!plain(text).trim()) return '';
    const id = 'c'+(i+1)+'-s'+(chapter.headings.length+1);
    chapter.headings.push({id,depth,text:plain(text)});
    return '<h'+depth+' id="'+id+'">'+text+'</h'+depth+'>\n';
  };
  renderer.code = function({text,lang}) {
    chapter.codeCount++;
    const id = 'code-'+(++codeId);
    const label = (lang || 'Plain Text').replace(/^plaintext$/i,'Plain Text');
    const isPlain = /^plain\s*text$/i.test(label);
    const lines = text.split('\n').length;
    const content = '<pre><code id="'+id+'">'+escape(text)+'</code></pre>';
    const body = lines>32 && !isPlain ? '<details><summary>展开完整代码 · '+lines+' 行</summary>'+content+'</details>' : content;
    return '<div class="code-block'+(isPlain?' plain-code':'')+'"><div class="code-tools"><span>'+escape(label)+' · '+lines+' 行</span><button type="button" class="copy-code" data-copy="'+id+'" aria-label="复制 '+escape(label)+' 代码">复制代码</button></div>'+body+'</div>\n';
  };
  renderer.table = function(token) {
    chapter.tableCount++;
    return '<div class="table-wrap" role="region" aria-label="内容对照表" tabindex="0">'+Renderer.prototype.table.call(this, token)+'</div>\n';
  };
  renderer.html = ({text}) => escape(text);
  renderer.link = function({href,tokens}) {
    if (!/^(https?:|mailto:|#)/i.test(href)) return this.parser.parseInline(tokens);
    return '<a href="'+escape(href)+'"'+(href.startsWith('#')?'':' target="_blank" rel="noopener noreferrer"')+'>'+this.parser.parseInline(tokens)+'</a>';
  };
  renderer.image = ({href,text}) => href.startsWith('#')?'<span class="image-reference"><b>学习图示 · '+escape(text || 'Streaming 示意图')+'</b>原笔记图片需要授权，公开版请参考本节学习主线图。<br><a href="'+escape(href)+'">查看学习主线 →</a></span>':'<span class="image-reference"><b>原文图片 · '+escape(text || 'Streaming 示意图')+'</b>原图来自飞书，打开时可能需要登录及有效访问权限。<br><a href="'+escape(href)+'" target="_blank" rel="noopener noreferrer">查看原图 ↗</a></span>';
  const compiler = new Marked({gfm:true,renderer});
  // The source contains six exported emphasis runs around inline code.
  // Repair only prose tokens; fenced code and the source file stay intact.
  compiler.walkTokens(chapter.tokens, token => {
    if (token.type === 'paragraph' && /\*{4}`[^`]+`\*{4}/.test(token.text)) {
      token.tokens = compiler.lexer(token.text.replace(/\*{4}(`[^`]+`)\*{4}/g, '$1'))[0].tokens;
    }
  });
  chapter.tokens.links = all.links;
  chapter.html = compiler.parser(chapter.tokens);
  searchIndex.push({chapter:chapter.id,target:chapter.id,title:chapter.title,label:'1.'+(i+1)+' · '+labels[i],text:introductions[i]});
  const chunks = chapter.html.split(/(?=<h2\s)/);
  for (const chunk of chunks) {
    const title = chunk.match(/^<h2 id="([^"]+)">([\s\S]*?)<\/h2>/);
    const text = plain(chunk.replace(/<button[\s\S]*?<\/button>/g,'')).replace(/\s+/g,' ').trim();
    if (text) searchIndex.push({chapter:chapter.id,target:title?.[1] || chapter.id,title:title?plain(title[2]):labels[i],label:'1.'+(i+1)+' · '+labels[i],text});
  }
}

const totalCodes = chapters.reduce((s,c)=>s+c.codeCount,0);
const totalTables = chapters.reduce((s,c)=>s+c.tableCount,0);
if (totalCodes!==162 || totalTables!==35) throw new Error('Source coverage mismatch: '+totalCodes+' codes, '+totalTables+' tables');
const glossaryFiles = ['foundations.json','model-and-output.json','streaming-and-gateway.json'];
const glossaryEntries = glossaryFiles.flatMap(file=>JSON.parse(fs.readFileSync(path.join(out,'术语说明',file),'utf8').replace(/^\uFEFF/,'')));
const termIds=new Set(),aliasIds=new Map();
const requireText=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error('Missing glossary text: '+label)};
const normalized=value=>cleanTitle(value).replace(/\s+/g,' ').toLowerCase();
for(const term of glossaryEntries){
  requireText(term.id,'id');requireText(term.term,term.id+'.term');requireText(term.plain,term.id+'.plain');
  if(!/^[a-z0-9-]+$/.test(term.id)||termIds.has(term.id))throw new Error('Invalid or duplicate term ID: '+term.id);termIds.add(term.id);
  if(!Array.isArray(term.aliases)||!term.aliases.length)throw new Error('No aliases: '+term.id);
  for(const alias of term.aliases){requireText(alias,term.id+'.alias');const key=alias.toLowerCase();if(aliasIds.has(key)&&aliasIds.get(key)!==term.id)throw new Error('Alias collision: '+alias);aliasIds.set(key,term.id)}
  if(!Array.isArray(term.chapters)||!term.chapters.length||term.chapters.some(c=>!/^1\.[1-7]$/.test(c)))throw new Error('Invalid chapters: '+term.id);
  requireText(term.analogy?.title,term.id+'.analogy.title');requireText(term.analogy?.description,term.id+'.analogy.description');
  if(!Array.isArray(term.steps)||term.steps.length<2)throw new Error('Missing steps: '+term.id);
  term.steps.forEach(step=>{requireText(step.title,term.id+'.step.title');requireText(step.description,term.id+'.step.description')});
  requireText(term.example?.title,term.id+'.example.title');requireText(term.example?.explanation,term.id+'.example.explanation');
  if(!Array.isArray(term.pitfalls)||!term.pitfalls.length)throw new Error('Missing pitfalls: '+term.id);term.pitfalls.forEach(item=>requireText(item,term.id+'.pitfall'));
  if(!Array.isArray(term.sources)||!term.sources.length)throw new Error('Missing sources: '+term.id);
  term.sources.forEach(source=>{
    requireText(source.title,term.id+'.source.title');
    if(source.url){if(!/^https:\/\//.test(source.url))throw new Error('Invalid source URL: '+term.id)}
    else {
      requireText(source.section,term.id+'.source.section');
      const reference=source.section.match(/^1\.([1-7])\s+(.+)$/);
      const first=term.chapters.map(c=>chapters[Number(c.split('.')[1])-1]);
      const candidates=reference?[chapters[Number(reference[1])-1]]:[...first,...chapters.filter(c=>!first.includes(c))];
      const heading=candidates.flatMap(c=>c.headings).find(h=>normalized(h.text)===normalized(reference?.[2]||source.section));
      if(!heading)throw new Error('Unknown original heading: '+term.id+' / '+source.section);
      source.target=heading.id;
    }
  });
}
fs.writeFileSync(path.join(out,'术语说明','glossary.json'),JSON.stringify(glossaryEntries,null,2),'utf8');
const quizBank=JSON.parse(fs.readFileSync(path.join(out,'测试题','question-bank.json'),'utf8'));
const reviewTargets=JSON.parse(fs.readFileSync(path.join(out,'测试题','review-targets.json'),'utf8'));
const questionIds=new Set();
if(quizBank.lessons?.length!==7)throw new Error('Expected seven quiz lessons');
quizBank.lessons.forEach((lesson,i)=>{
  if(lesson.number!=='1.'+(i+1)||lesson.questions.length!==10)throw new Error('Invalid quiz lesson: '+lesson.number);
  lesson.questions.forEach((question,j)=>{
    if(question.id!==lesson.number+'-'+String(j+1).padStart(2,'0')||questionIds.has(question.id))throw new Error('Invalid quiz ID: '+question.id);
    questionIds.add(question.id);question.reviewTargets=reviewTargets[question.id];
    if(!question.reviewTargets?.length)throw new Error('No review targets: '+question.id);
    question.reviewTargets.forEach(target=>{
      const heading=chapters[i].headings.find(h=>h.id===target.id);
      if(!heading||normalized(heading.text)!==normalized(target.title))throw new Error('Invalid quiz review target: '+question.id+' / '+target.id);
    });
  });
});
const css = ['notes.css','glossary.css','learning-workspace.css','lesson-quiz.css'].map(file=>fs.readFileSync(path.join(out,file),'utf8')).join('\n');
const script = ['glossary.js','lesson-quiz.js','notes.js'].map(file=>fs.readFileSync(path.join(out,file),'utf8')).join('\n');
const chapterLinks = chapters.map((c,i)=>'<a class="chapter-link'+(i===0?' active':'')+'" data-chapter="'+(i+1)+'" href="#'+c.id+'"'+(i===0?' aria-current="page"':'')+'><span class="number">1.'+(i+1)+'</span><span class="chapter-link-copy"><span>'+labels[i]+'</span><small data-chapter-progress="'+(i+1)+'">自测 0 / 10</small></span></a>').join('');
const chapterMarkup = chapters.map((c,i)=>{
  const flow = pipelines[i].map(([label,description],j)=>i===0 ? '<button type="button" class="flow-step stage-button" data-stage="'+j+'" aria-pressed="'+(j===0?'true':'false')+'"><b>'+escape(label)+'</b><span>'+escape(description)+'</span></button>' : '<div class="flow-step"><b>'+((i===6)?'':(j+1)+' · ')+escape(label)+'</b><span>'+escape(description)+'</span></div>').join('');
  return '<article class="chapter paper" id="'+c.id+'" data-label="'+escape(labels[i])+'"'+(i===0?'':' hidden')+'><header class="chapter-head"><div class="eyebrow">SECTION 1.'+(i+1)+' / 07</div><h2>'+escape(c.title)+'</h2><p>'+introductions[i]+'</p><div class="meta"><span>'+c.headings.filter(h=>h.depth===2).length+' 个主题</span><span>'+c.codeCount+' 个代码块</span><span>'+c.tableCount+' 张表格</span></div></header><section class="visual-summary" aria-label="本节学习主线"><h3>学习主线 <span class="small">· 根据本节原文整理</span></h3><div class="'+(i===6?'layer-flow':'flow')+'">'+flow+'</div>'+(i===0?'<div class="stage-detail" id="stage-detail" aria-live="polite">'+stageDetails[0]+'</div>':'')+'<p class="caption">'+captions[i]+'</p></section><div class="markdown">'+c.html+'</div><footer class="chapter-bottom"><div class="chapter-selftest-callout"><span>读完本节，检验一下理解</span><a class="btn primary" href="#quiz-'+(i+1)+'">开始本节自测 · 10 题 →</a></div>'+(i>0?'<a href="#'+chapters[i-1].id+'">← 上一节<br>1.'+i+' '+labels[i-1]+'</a>':'<span class="small">第一章 · 从工程边界开始</span>')+(i<6?'<a href="#'+chapters[i+1].id+'">下一节 →<br>1.'+(i+2)+' '+labels[i+1]+'</a>':'<a href="index.html">返回页面入口 →</a>')+'</footer></article>';
}).join('\n');
const embedded = JSON.stringify({searchIndex,stageDetails,glossaryEntries,quizBank}).replace(/</g,'\\u003c');
const learningWorkspace='<section class="lesson-workspace" id="lesson-workspace" aria-label="本节学习与自测"><div class="workspace-title"><p class="eyebrow">LEARN & PRACTICE / 本节学习</p><h2 id="workspace-title">1.1 从 LLM 到 Agent</h2></div><nav class="lesson-mode-nav" role="tablist" aria-label="切换学习内容"><a id="mode-notes" role="tab" href="#chapter-1" aria-selected="true" aria-controls="notes-reader">学习笔记</a><a id="mode-quiz" role="tab" href="#quiz-1" aria-selected="false" aria-controls="lesson-quiz" tabindex="-1">本节自测 <small id="mode-quiz-progress">0 / 10</small></a></nav><p class="workspace-hint" id="workspace-hint">读完本节后，可在这里切到 10 道由浅入深的自测题。</p></section>';
const glossaryDialog = '<dialog class="term-dialog" id="term-dialog" aria-labelledby="term-dialog-title"><header class="term-head"><div><p class="eyebrow">LEARNING GLOSSARY / 点击即解释</p><h2 id="term-dialog-title">术语解释</h2></div><button class="term-close" type="button" id="term-close" aria-label="关闭术语解释">×</button></header><div class="term-body" id="term-body"></div></dialog>';
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="description" content="第一章学习笔记完整离线阅读页：七节原文、学习主线、全文检索、点击术语解释、70道同页自测、代码与表格。"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'"><title>第一章学习笔记 · AI 工程研习</title><style>${css}</style><noscript><style>.chapter[hidden]{display:block!important;margin-bottom:24px}.toc{display:none}.reading-layout{grid-template-columns:1fr}.search-open,.print-all-btn,#term-open,.lesson-workspace{display:none}</style></noscript></head><body>
<a class="skip" href="#main">跳转到正文</a>
<aside class="sidebar" id="sidebar"><a class="brand" href="index.html"><span>AI</span>工程研习</a><div class="small" style="padding-left:41px">个人履历与学习笔记</div><div class="sidebar-label">第一章 / 学习目录</div><nav class="chapter-nav" aria-label="章节导航">${chapterLinks}</nav><div class="side-footer"><a href="resume.html">查看个人简历 ↗</a><a href="index.html">返回页面入口 ↗</a><div style="margin-top:16px">全文离线阅读<br>源文件内容完整保留</div></div></aside><div class="backdrop" id="backdrop"></div>
<div class="reading-meter" aria-hidden="true"><span id="reading-progress"></span></div>
<div class="shell"><header class="topbar"><button type="button" class="btn menu-btn" id="menu-toggle" aria-label="打开章节目录" aria-expanded="false" aria-controls="sidebar">目录</button><div class="breadcrumb"><a href="index.html">页面入口</a> / 第一章 / <span id="crumb-current">从 LLM 到 Agent</span></div><div class="top-actions"><button type="button" class="btn search-open" id="search-open"><span>搜索笔记</span><kbd>Ctrl K</kbd></button><button type="button" class="btn" id="term-open" aria-haspopup="dialog" aria-controls="term-dialog">术语速查</button><button type="button" class="btn print-all-btn" id="print-all">打印全章</button><button type="button" class="btn" id="print-current">打印本节</button></div></header>
<main class="main" id="main"><header class="document-head"><div><div class="eyebrow">CHAPTER ONE / ENGINEERING NOTES</div><h1>第一章学习笔记</h1><p>从 LLM 到 Agent，从输入输出协议到统一模型服务。</p><div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:14px"><a class="btn primary" href="../讲解视频/成片/index.html">观看第一章讲解视频（1.2～1.7） ↗</a><span class="small">六节 · 约 148 分钟 · 中文合成旁白</span><a class="btn" id="document-quiz-link" href="#quiz-1">本页自测 · 每节 10 题 →</a></div></div><div class="document-stats"><div><b>07</b><span>学习节</span></div><div><b>${totalCodes}</b><span>代码块</span></div><div><b>${totalTables}</b><span>对照表</span></div></div></header>${learningWorkspace}<div class="reading-layout"><div class="reader"><div id="notes-reader" role="tabpanel" aria-labelledby="mode-notes">${chapterMarkup}</div><section id="lesson-quiz" role="tabpanel" hidden aria-labelledby="quiz-lesson-title"></section></div><aside class="toc" aria-label="本节主题目录"><div class="eyebrow">ON THIS PAGE / 本节主题</div><nav id="toc-links"></nav></aside></div><footer class="page-footer"><span>内容来源：第一章 学习笔记.md · 正文、代码与表格完整转换</span><a href="index.html">页面入口 ↗</a></footer></main></div>
<dialog class="search-dialog" id="search-dialog" aria-label="全文搜索"><div class="search-head"><input type="search" id="search-input" placeholder="搜索七节正文、术语或代码…" aria-label="搜索全部笔记"><button type="button" class="btn" id="search-close">关闭</button></div><div class="search-body" id="search-results"><p class="search-hint">输入关键词，搜索七节完整内容。</p></div></dialog><div class="toast" id="toast" role="status" hidden></div>
${glossaryDialog}
<div class="quiz-print-root" id="quiz-print-root"></div>
<script type="application/json" id="page-data">${embedded}</script><script>${script}</script></body></html>`;
fs.writeFileSync(path.join(out,'chapter-one.html'),html,'utf8');
const report = {source:'第一章 学习笔记.md',sha256:crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'),chapterCount:chapters.length,codeBlockCount:totalCodes,tableCount:totalTables,externalImageCount:1,proseEmphasisRepairs,glossaryCount:glossaryEntries.length,glossaryAliasCount:aliasIds.size,questionCount:questionIds.size,reviewTargetCount:Object.values(reviewTargets).reduce((sum,list)=>sum+list.length,0),chapters:chapters.map(c=>({title:c.title,codes:c.codeCount,tables:c.tableCount,headings:c.headings.length})),htmlBytes:Buffer.byteLength(html)};
fs.writeFileSync(path.join(out,'notes-build-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
