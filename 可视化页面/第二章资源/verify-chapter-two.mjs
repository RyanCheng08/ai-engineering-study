/**
 * Static verification only: does not execute page scripts or alter the sources.
 * Run npm ci in the course directory first (Node.js 20 or later).
 * Usage: node verify-chapter-two.mjs [path/to/chapter-two.html]
 * A nonzero exit status means at least one check failed. The JSON report is stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Marked} from 'marked';
import {Script} from 'node:vm';
import {partitionSources,originalItems,markdownText} from './exercise-source.mjs';

const resourceDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.dirname(resourceDir);
const workspace = path.dirname(outputDir);
const htmlPath = path.resolve(process.argv[2] || path.join(outputDir, 'chapter-two.html'));
const sourceDir = path.join(workspace, 'lesson-notes', 'chapter-02');
const marked = new Marked({gfm: true});
const errors = [];
const warnings = [];
let checks = 0;
const check = (condition, message) => {checks++; if (!condition) errors.push(message);};
const read = file => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const textExists = value => typeof value === 'string' && value.trim().length > 0;
const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'};
const decode = text => String(text).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw, name) => {
  if (name.startsWith('#')) {
    const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
  }
  return entities[name.toLowerCase()] ?? raw;
});
const normalize = text => decode(String(text).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const normalizeHeading = text => normalize(text).replace(/\\([.\-+_()])/g, '$1').replace(/[`*]/g, '').toLowerCase();
// Exported Markdown contains stray emphasis markers; those are presentation,
// whereas every character of the rendered prose must otherwise be retained.
const semanticText = text => normalize(text).replace(/[\s*]/g, '');
const attrs = tag => {
  const result = {};
  for (const match of tag.matchAll(/\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
};
const codeBlocks = html => [...html.matchAll(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi)]
  .map(match => decode(match[1]).replace(/\r\n?/g, '\n'));
const tables = html => [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match =>
  [...match[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row =>
    [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell => normalize(cell[1]))));

if (!fs.existsSync(htmlPath)) {
  console.error('HTML 尚未生成：' + htmlPath);
  process.exit(1);
}
const html = read(htmlPath);
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .map(match => ({attrs: attrs('<script ' + match[1] + '>'), text: match[2]}));
const pageData = scripts.filter(script => script.attrs.id === 'page-data');
check(pageData.length === 1, '应恰有一个 #page-data 数据块');
let data = {};
try {data = JSON.parse(pageData[0]?.text || '{}');}
catch (error) {errors.push('page-data 不是有效 JSON：' + error.message);}
check(['searchIndex', 'stageDetails', 'glossaryEntries', 'quizBank'].every(key => key in data), 'page-data 缺少必要数据');

// Remove raw script/style content first: HTML-looking strings inside JS are not DOM.
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');
const tags = [...markup.matchAll(/<[a-z][^>]*>/gi)].map(match => ({name: match[0].match(/^<([\w-]+)/)[1].toLowerCase(), attrs: attrs(match[0])}));
const ids = new Set();
for (const tag of tags.filter(tag => 'id' in tag.attrs)) {
  check(textExists(tag.attrs.id), 'HTML 存在空 ID');
  check(!ids.has(tag.attrs.id), 'HTML ID 重复：' + tag.attrs.id);
  ids.add(tag.attrs.id);
}
const articles = [...markup.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)]
  .map(match => ({attrs: attrs('<article ' + match[1] + '>'), html: match[2]}))
  .filter(article => article.attrs.class?.split(/\s+/).includes('chapter'));
check(articles.length === 5, '应有 5 个 article.chapter，实际 ' + articles.length);
articles.forEach((article, index) => {
  check(article.attrs.id === 'chapter-' + (index + 1), '章节 ID 顺序错误：' + article.attrs.id);
  const title = normalize(article.html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  check(title.startsWith('2.' + (index + 1)), '章节标题编号错误：' + title);
});
const headings = new Map();
for (const match of markup.matchAll(/<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/gi)) {
  const attributes = attrs('<h2 ' + match[1] + '>');
  if (attributes.id) headings.set(attributes.id, normalize(match[2]));
}
const routedAnchor = id => /^quiz-([1-5])(?:-(?:0[1-9]|[1-9]\d+))?$/.test(id);
let localLinks = 0;
for (const tag of tags) {
  for (const attribute of ['href', 'src']) {
    const href = tag.attrs[attribute];
    if (!href || /^(https?:|mailto:|data:|blob:)/i.test(href)) continue;
    localLinks++;
    if (href.startsWith('#')) {
      let target = href.slice(1);
      try {target = decodeURIComponent(target);} catch {}
      check(ids.has(target) || routedAnchor(target), '无效页内锚点：' + href);
    } else {
      let destination = href.split(/[?#]/)[0];
      try {destination = decodeURIComponent(destination);} catch {}
      check(fs.existsSync(path.resolve(path.dirname(htmlPath), destination)), '本地资源不存在：' + href);
    }
  }
  for (const attribute of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
    const value = tag.attrs[attribute];
    if (!value) continue;
    for (const target of value.split(/\s+/)) {
      // The quiz heading is created on first entering the quiz route.
      check(ids.has(target) || target === 'quiz-lesson-title', attribute + ' 目标不存在：' + target);
    }
  }
  if (tag.attrs['data-copy']) check(ids.has(tag.attrs['data-copy']), '复制代码目标不存在：' + tag.attrs['data-copy']);
}

// Compare every fenced block and every table, preserving source order and duplicates.
const sourceFiles = fs.readdirSync(sourceDir).filter(file => file.endsWith('.md'))
  .sort((a, b) => Number(a.includes('附录四')) - Number(b.includes('附录四')) || a.localeCompare(b, 'zh-CN'));
check(sourceFiles.length === 2, 'chapter-02 应包含两份源 Markdown，实际 ' + sourceFiles.length);
const expectedCodes = [];
const expectedTables = [];
const sourceReport = [];
const sourceHeadings = new Set();
const sourceProse = [];
const originalSources=sourceFiles.map(file=>read(path.join(sourceDir,file)));
const migration=JSON.parse(read(path.join(resourceDir,'exercise-migration.json')));
const {retainedSources,spans:removedSpans}=partitionSources(originalSources);
check(JSON.stringify(migration.removedSpans.map(s=>({key:s.key,start:s.start,end:s.end,raw:s.raw})))===JSON.stringify(removedSpans.map(s=>({key:s.key,start:s.start,end:s.end,raw:s.raw}))), '迁移清单源片段与原 Markdown 不符');
for (const [sourceIndex,file] of sourceFiles.entries()) {
  const bytes = fs.readFileSync(path.join(sourceDir, file));
  check(migration.sourceFiles[sourceIndex]?.sha256===sha256(Buffer.from(originalSources[sourceIndex])), '迁移清单源文件哈希过期：'+file);
  const source = (retainedSources[sourceIndex] || '').replace(/\r\n?/g, '\n');
  const tokens = marked.lexer(source);
  const fileCodes = [];
  const fileTables = [];
  marked.walkTokens(tokens, token => {
    if (token.type === 'code') fileCodes.push(token.text);
    if (token.type === 'table') fileTables.push(tables(marked.parser([token]))[0]);
    if (token.type === 'heading') sourceHeadings.add(normalizeHeading(marked.parseInline(token.text)));
    if (token.type === 'paragraph' || token.type === 'text' && Array.isArray(token.tokens)) {
      const prose = semanticText(marked.parseInline(token.text));
      if (prose) sourceProse.push({file, text: prose});
    }
  });
  expectedCodes.push(...fileCodes);
  expectedTables.push(...fileTables);
  sourceReport.push({file, sha256: sha256(bytes), retainedCodeBlocks: fileCodes.length, retainedTables: fileTables.length, migratedToQuiz:sourceIndex===1});
}
const actualCodes = codeBlocks(markup);
const actualTables = tables(markup);
check(actualCodes.length === expectedCodes.length, '代码块总数不一致：源文件 ' + expectedCodes.length + '，HTML ' + actualCodes.length);
expectedCodes.forEach((code, index) => check(actualCodes[index] === code, '第 ' + (index + 1) + ' 个代码块内容/顺序与源文件不一致'));
check(actualTables.length === expectedTables.length, '表格总数不一致：源文件 ' + expectedTables.length + '，HTML ' + actualTables.length);
expectedTables.forEach((table, index) => check(JSON.stringify(actualTables[index]) === JSON.stringify(table), '第 ' + (index + 1) + ' 张表格内容/顺序与源文件不一致'));
const renderedProse = semanticText(markup);
sourceProse.forEach((item, index) => check(renderedProse.includes(item.text), '原文段落/列表项未完整保留：' + item.file + '，第 ' + (index + 1) + ' 项：' + item.text.slice(0, 90)));
const renderedHeadings = new Set([...markup.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(match => normalizeHeading(match[1])));
sourceHeadings.forEach(heading => check(renderedHeadings.has(heading), '源文件标题未保留：' + heading));
for(const title of ['附录四：本章复习问题','配套练习题与参考答案','一、复习题与参考答案','三、阶段二项目：题目与验收答案','1. 口头验收']) check(!renderedHeadings.has(normalizeHeading(title)), '已迁移练习标题仍在笔记中：'+title);
check(!renderedProse.includes(semanticText('学完本节，你应该能讲清：模型为什么提出动作，为什么要有 Runtime 受控执行。')), '2.1 原口头问题仍出现在笔记中');

const allQuestions = [];
const questionIds = new Set();
const typeCounts = {};
const lessons = data.quizBank?.lessons || [];
check(lessons.length === 5, '题库应有 5 节');
check(textExists(data.quizBank?.title), '题库缺少标题 title');
lessons.forEach((lesson, index) => {
  const number = '2.' + (index + 1);
  check(lesson.number === number, '题库节编号错误：' + lesson.number);
  check(textExists(lesson.title), number + ' 缺少标题');
  check(lesson.questions?.length === migration.questionsPerLesson[index], number + ' 题数与迁移清单不符');
  (lesson.questions || []).forEach((question, order) => {
    const label = question.id || number + ' 第 ' + (order + 1) + ' 题';
    allQuestions.push(question);
    check(question.id === number + '-' + String(order + 1).padStart(2, '0'), '题目 ID/顺序错误：' + label);
    check(!questionIds.has(question.id), '重复题目 ID：' + label); questionIds.add(question.id);
    check(question.order === order + 1, 'order 与题目顺序不符：' + label);
    check(order<10 ? question.level === Math.floor(order / 2) + 1 : Number.isInteger(question.level)&&question.level>=1&&question.level<=5, 'level 应为 1～5；原有10题保持每两题递进：' + label);
    check(order<10 ? question.sourceKind!=='original' : question.sourceKind==='original', '原题只能追加在既有10题之后：'+label);
    check(['single', 'multiple', 'short'].includes(question.type), '题型无效：' + label);
    typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
    for (const key of ['title', 'prompt', 'referenceAnswer', 'explanation']) check(textExists(question[key]), label + ' 缺少 ' + key);
    check(Array.isArray(question.sourceRefs) && question.sourceRefs.length > 0, label + ' 缺少来源 sourceRefs');
    for (const source of question.sourceRefs || []) {
      check(textExists(source), label + ' 来源为空');
      check(!/^1\.[1-7](?:[／/\s]|$)/.test(source), label + ' 来源误指第一章：' + source);
      const match = String(source).match(/^2\.([1-5])[／/]\s*(.+)$/);
      check(!!match, label + ' 来源格式应为 2.N／原文标题：' + source);
      if (match) {
        const sourceArticle = articles[Number(match[1]) - 1];
        const sourceTitles = [...(sourceArticle?.html || '').matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map(m => normalizeHeading(m[1]));
        check(sourceTitles.includes(normalizeHeading(match[2])), label + ' 来源标题不存在于相应章节：' + source);
      }
    }
    if (question.type === 'short') {
      check(Array.isArray(question.rubric) && question.rubric.length > 0, label + ' 缺少自评评分要点');
      let total = 0;
      for (const criterion of question.rubric || []) {
        check(textExists(criterion.point), label + ' 自评要点为空');
        check(Number.isFinite(criterion.score) && criterion.score > 0, label + ' 自评分数非法');
        total += criterion.score;
      }
      check(total === 10, label + ' 自评分值之和不是 10：' + total);
    } else {
      const options = question.options || [];
      check(options.length >= 2, label + ' 选项不足');
      const keys = new Set();
      const texts = new Set();
      options.forEach(option => {
        check(/^[A-Z]$/.test(option.key) && !keys.has(option.key), label + ' 选项 key 无效或重复：' + option.key);
        check(textExists(option.text) && !texts.has(option.text.trim()), label + ' 选项内容为空或重复');
        keys.add(option.key); texts.add(String(option.text).trim());
      });
      const answer = question.answer || [];
      check(Array.isArray(answer) && answer.length > 0 && new Set(answer).size === answer.length && answer.every(key => keys.has(key)), label + ' 答案包含不存在/重复选项或为空');
      check(question.type !== 'single' || answer.length === 1, label + ' 单选题必须恰有一个答案');
      check(question.type !== 'multiple' || answer.length >= 2, label + ' 多选题应有至少两个答案');
    }
    check(Array.isArray(question.reviewTargets) && question.reviewTargets.length > 0, label + ' 缺少回看锚点');
    for (const target of question.reviewTargets || []) {
      check(headings.has(target.id), label + ' 回看锚点不存在：' + target.id);
      check(normalizeHeading(headings.get(target.id) || '') === normalizeHeading(target.title || ''), label + ' 回看标题不匹配：' + target.id);
      check(/^c[1-5]-/.test(target.id), label + ' 回看目标不在第二章：' + target.id);
    }
  });
});
check(allQuestions.length === 73, '题库总题数应为 73，实际 ' + allQuestions.length);
const originals=originalItems(originalSources);
check(originals.length===23 && allQuestions.filter(q=>q.sourceKind==='original').length===23, '20复习题与3项目题必须全部进入自测');
for(const item of originals){
 const matches=allQuestions.filter(q=>q.originalKey===item.key);
 check(matches.length===1, '原题必须恰好迁移一次：'+item.key);
 const q=matches[0]||{};
 check(q.prompt===markdownText(item.promptMarkdown), '原题题干未完整保留：'+item.key);
 check(q.referenceAnswer===markdownText(item.answerMarkdown), '原参考答案未完整保留：'+item.key);
 check(q.originalPromptMarkdown===item.promptMarkdown && q.originalAnswerMarkdown===item.answerMarkdown, '原题Markdown留档不符：'+item.key);
 const entry=migration.items.find(x=>x.key===item.key);
 check(entry?.newQuestionId===q.id && entry?.sourceRaw===item.raw, '原题迁移去向或原片段不符：'+item.key);
}
for(const span of removedSpans){
 check(span.questionKeys.length>0 && span.questionKeys.every(key=>allQuestions.some(q=>q.originalKey===key)), '移除片段存在未进入题库的原题：'+span.key);
 const blocks=[];marked.walkTokens(marked.lexer(span.raw),token=>{if(token.type==='code')blocks.push(token.text);});
 blocks.forEach(code=>check(allQuestions.some(q=>q.code===code),'迁移代码块未保留在原题中：'+span.key));
}
const oral=allQuestions.find(q=>q.originalKey==='project-oral');
check(oral?.originalAdditionalPrompts?.includes(removedSpans.find(s=>s.key==='section-2.5-oral').raw), '原口头验收提示未完整留档');
check(allQuestions.find(q=>q.originalKey==='review-1')?.alternatePrompts?.includes(markdownText(removedSpans.find(s=>s.key==='section-2.1-outcome').raw)), '2.1原问题的关联问法未展示');
check(allQuestions.find(q=>q.originalKey==='project-code')?.explanation?.includes('未提供唯一完整实现'), '项目代码题应明确原答案不完整');

const termIds = new Set();
const aliases = new Map();
const terms = data.glossaryEntries || [];
check(terms.length > 0, '术语库为空');
for (const term of terms) {
  check(/^[a-z0-9-]+$/.test(term.id) && !termIds.has(term.id), '术语 ID 无效或重复：' + term.id); termIds.add(term.id);
  for (const key of ['term', 'plain']) check(textExists(term[key]), term.id + ' 缺少 ' + key);
  check(Array.isArray(term.aliases) && term.aliases.length > 0, term.id + ' 缺少别名');
  for (const alias of term.aliases || []) {
    check(textExists(alias), term.id + ' 别名为空');
    const key = normalizeHeading(alias);
    check(!aliases.has(key) || aliases.get(key) === term.id, '术语别名碰撞：' + alias + ' / ' + term.id + ' / ' + aliases.get(key));
    aliases.set(key, term.id);
  }
  check(Array.isArray(term.chapters) && term.chapters.length > 0 && term.chapters.every(chapter => /^2\.[1-5]$/.test(chapter)), term.id + ' 适用章节无效');
  check(textExists(term.analogy?.title) && textExists(term.analogy?.description), term.id + ' 缺少生活类比');
  check(Array.isArray(term.steps) && term.steps.length >= 2, term.id + ' 缺少分步演示');
  for (const step of term.steps || []) check(textExists(step.title) && textExists(step.description), term.id + ' 分步讲解字段不全');
  check(textExists(term.example?.title) && textExists(term.example?.explanation), term.id + ' 缺少实例解释');
  check(Array.isArray(term.pitfalls) && term.pitfalls.length > 0 && term.pitfalls.every(textExists), term.id + ' 缺少易错点/类比边界');
  check(Array.isArray(term.sources) && term.sources.length > 0, term.id + ' 缺少来源');
  for (const source of term.sources || []) {
    check(textExists(source.title), term.id + ' 来源标题为空');
    if (source.url) check(/^https:\/\//.test(source.url), term.id + ' 来源 URL 无效');
    else {
      check(headings.has(source.target), term.id + ' 来源锚点不存在：' + source.target);
      if (source.section) {
        const title = source.section.replace(/^2\.[1-5]\s+/, '');
        check(normalizeHeading(headings.get(source.target) || '') === normalizeHeading(title), term.id + ' 来源标题与锚点不符：' + source.section);
      }
    }
  }
}
for (const item of data.searchIndex || []) {
  check(ids.has(item.target), '搜索目标不存在：' + item.target);
  check(articles.some(article => article.attrs.id === item.chapter), '搜索所属章节不存在：' + item.chapter);
  check(textExists(item.title) && textExists(item.text), '搜索索引缺少标题或内容：' + item.target);
}
check(Array.isArray(data.searchIndex) && data.searchIndex.length >= 5, '搜索索引为空或未覆盖五节');
for (const tag of tags.filter(tag => 'data-stage' in tag.attrs)) {
  check(textExists(data.stageDetails?.[Number(tag.attrs['data-stage'])]), '流程节点缺少说明：' + tag.attrs['data-stage']);
}

// Check runnable JS separately from source prose, which legitimately discusses chapter one.
const executableScripts = scripts.filter(script => !script.attrs.type || /^(?:text|application)\/javascript$/.test(script.attrs.type));
executableScripts.forEach((script, index) => {
  try {new Script(script.text, {filename: 'chapter-two-inline-' + index + '.js'}); checks++;}
  catch (error) {check(false, '内嵌 JavaScript 语法错误：' + error.message);}
  check(!/chapter-one|第一章|七节|70\s*题/.test(script.text), '内嵌脚本残留第一章文案、文件名或存储 key');
  check(!/["']1\.["']|\^1\\\.|\[1-7\]/.test(script.text), '内嵌脚本残留第一章题号或七节路由');
});
const scriptText = executableScripts.map(script => script.text).join('\n');
check(/chapter-two-quiz-v1/.test(scriptText), '缺少第二章独立作答存储 key');
check(/chapter-two-quiz-files-v1/.test(scriptText), '缺少第二章独立作答文件数据库名');
check(!/<(?:video|audio|iframe)\b/i.test(markup), '第二章不应包含视频/音频播放器或嵌入框');
for (const tag of tags.filter(tag => tag.name === 'a')) {
  const href = tag.attrs.href || '';
  check(!/讲解视频|成片|\.mp4(?:$|[?#])|\.webm(?:$|[?#])/i.test(href), '第二章残留视频入口：' + href);
  check(!/chapter-one/i.test(href) || /^chapter-one\.html(?:#.*)?$/.test(href), '残留第一章自测或资源链接：' + href);
}
check(!scripts.some(script => script.attrs.src), '存在外部脚本依赖');
check(!tags.some(tag => tag.name === 'link' && tag.attrs.rel === 'stylesheet'), '存在外部样式依赖');
for (const file of ['第二章测试题-题目版.txt', '第二章测试题-答案解析.txt']) {
  check(scriptText.includes('href="' + file + '"'), '自测页面缺少下载入口：' + file);
  check(fs.existsSync(path.join(outputDir, file)), '自测下载文件不存在：' + file);
}
if (!/<meta\b[^>]*Content-Security-Policy/i.test(html)) warnings.push('页面未声明 Content-Security-Policy');

const report = {
  passed: errors.length === 0,
  html: path.relative(workspace, htmlPath),
  htmlSha256: sha256(fs.readFileSync(htmlPath)),
  checks,
  chapterCount: articles.length,
  codeBlocks: actualCodes.length,
  tables: actualTables.length,
  sourceProseSegments: sourceProse.length,
  sourceHeadings: sourceHeadings.size,
  questionCount: allQuestions.length,
  originalQuestions: originals.length,
  migratedSourceSpans: removedSpans.length,
  questionTypes: typeCounts,
  glossaryCount: terms.length,
  glossaryAliases: aliases.size,
  searchEntries: data.searchIndex?.length || 0,
  localLinks,
  sourceFiles: sourceReport,
  errors,
  warnings,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = errors.length ? 1 : 0;
