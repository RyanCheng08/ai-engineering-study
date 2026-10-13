/**
 * Static verification only: does not execute page scripts or alter the sources.
 * Run npm ci in the course directory first (Node.js 20 or later).
 * Usage: node verify-chapter-three.mjs [path/to/chapter-three.html]
 * A nonzero exit status means at least one check failed. The JSON report is stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Marked} from 'marked';
import {Script} from 'node:vm';
import {splitExercises,exerciseText} from './exercise-migration.mjs';

const resourceDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.dirname(resourceDir);
const workspace = path.dirname(outputDir);
const htmlPath = path.resolve(process.argv[2] || path.join(outputDir, 'chapter-three.html'));
const sourceDir = path.join(workspace, 'lesson-notes', 'chapter-03');
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
check(articles.length === 7, '应有 7 个 article.chapter，实际 ' + articles.length);
articles.forEach((article, index) => {
  check(article.attrs.id === 'chapter-' + (index + 1), '章节 ID 顺序错误：' + article.attrs.id);
  const title = normalize(article.html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
  check(title.startsWith('3.' + (index + 1)), '章节标题编号错误：' + title);
});
const headings = new Map();
for (const match of markup.matchAll(/<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/gi)) {
  const attributes = attrs('<h2 ' + match[1] + '>');
  if (attributes.id) headings.set(attributes.id, normalize(match[2]));
}
const routedAnchor = id => {
  const match=String(id).match(/^quiz-([1-7])(?:-(\d+))?$/);
  if(!match)return false;
  const lesson=data.quizBank?.lessons?.[Number(match[1])-1];
  return !!lesson && (!match[2] || Number(match[2])>=1 && Number(match[2])<=lesson.questions.length);
};
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
check(sourceFiles.length === 1, 'chapter-03 应包含一份源 Markdown，实际 ' + sourceFiles.length);
const expectedCodes = [];
const expectedTables = [];
const sourceReport = [];
const sourceHeadings = new Set();
const sourceProse = [];
const sourceExercises = [];
const removedExerciseBlocks = [];
for (const file of sourceFiles) {
  const bytes = fs.readFileSync(path.join(sourceDir, file));
  const source = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const separated=splitExercises(source);
  const tokens = separated.tokens;
  sourceExercises.push(...separated.exercises);
  removedExerciseBlocks.push(...separated.removed);
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
  sourceReport.push({file, sha256: sha256(bytes), codeBlocks: fileCodes.length, tables: fileTables.length});
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

const allQuestions = [];
const questionIds = new Set();
const typeCounts = {};
const lessons = data.quizBank?.lessons || [];
check(lessons.length === 7, '题库应有 7 节');
check(textExists(data.quizBank?.title), '题库缺少标题 title');
lessons.forEach((lesson, index) => {
  const number = '3.' + (index + 1);
  check(lesson.number === number, '题库节编号错误：' + lesson.number);
  check(textExists(lesson.title), number + ' 缺少标题');
  check(lesson.questions?.length > 10, number + ' 应保留原有 10 道自测并追加原笔记练习');
  (lesson.questions || []).forEach((question, order) => {
    const label = question.id || number + ' 第 ' + (order + 1) + ' 题';
    allQuestions.push(question);
    check(question.id === number + '-' + String(order + 1).padStart(2, '0'), '题目 ID/顺序错误：' + label);
    check(!questionIds.has(question.id), '重复题目 ID：' + label); questionIds.add(question.id);
    check(question.order === order + 1, 'order 与题目顺序不符：' + label);
    check(order<10 ? question.level===Math.floor(order/2)+1 : Number.isInteger(question.level)&&question.level>=1&&question.level<=5, '题目 level 无效或原题难度发生变化：' + label);
    check(['single', 'multiple', 'short'].includes(question.type), '题型无效：' + label);
    typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
    for (const key of ['title', 'prompt', 'referenceAnswer', 'explanation']) check(textExists(question[key]), label + ' 缺少 ' + key);
    check(Array.isArray(question.sourceRefs) && question.sourceRefs.length > 0, label + ' 缺少来源 sourceRefs');
    for (const source of question.sourceRefs || []) {
      check(textExists(source), label + ' 来源为空');
      check(!/^1\.[1-7](?:[／/\s]|$)/.test(source), label + ' 来源误指第一章：' + source);
      const match = String(source).match(/^3\.([1-7])[／/]\s*(.+)$/);
      check(!!match, label + ' 来源格式应为 3.N／原文标题：' + source);
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
      check(/^c[1-7]-/.test(target.id), label + ' 回看目标不在第三章：' + target.id);
    }
  });
});
// Original generated questions keep their IDs and all content, so saved progress
// remains attached to the same question. Migrated source exercises are appended.
const generatedLessons=['3.1-3.3','3.4-3.5','3.6-3.7'].flatMap(group=>JSON.parse(read(path.join(resourceDir,'quiz-'+group+'.json'))));
const generatedQuestions=generatedLessons.flatMap(lesson=>lesson.questions);
check(generatedQuestions.length===70,'原有生成题源数据应为70题');
for(const before of generatedQuestions) {
  const after=allQuestions.find(q=>q.id===before.id);
  check(!!after,'原有自测题丢失：'+before.id);
  for(const key of Object.keys(before).filter(k=>k!=='reviewTargets'))check(JSON.stringify(after?.[key])===JSON.stringify(before[key]),'原有题目的字段发生改变：'+before.id+' / '+key);
}
const migration=JSON.parse(read(path.join(resourceDir,'exercise-migration.json')));
const originalQuestions=allQuestions.filter(q=>q.sourceKind==='original');
check(sourceExercises.length===53,'源笔记应有20道章末题和33道节末题');
check(sourceExercises.filter(e=>e.answerMarkdown).length===20,'源笔记应有20份章末参考答案');
check(migration.items?.length===sourceExercises.length,'迁移清单未覆盖所有原题');
const originalKeys=new Set();
for(const exercise of sourceExercises) {
  const entries=(migration.items||[]).filter(item=>item.key===exercise.key);
  check(entries.length===1,'原题迁移记录必须唯一：'+exercise.key);
  const entry=entries[0];
  const question=originalQuestions.find(q=>q.id===entry?.targetQuestionId);
  check(!!question,'原题未迁入自测：'+exercise.key);
  check(question?.sourceLabel==='原笔记练习','原题来源标签丢失：'+exercise.key);
  const origin=question?.originalPrompts?.find(item=>item.sourceKey===exercise.key);
  check(origin?.promptMarkdown===exercise.promptMarkdown,'原题Markdown未完整保留：'+exercise.key);
  const displayPrompts=[question?.prompt,...(question?.alternatePrompts||[])];
  check(displayPrompts.includes(exerciseText(exercise.promptMarkdown)),'原问句未显示在题干或同题表述：'+exercise.key);
  check(entry?.promptMarkdown===exercise.promptMarkdown && entry?.raw===exercise.raw,'迁移清单原题内容与源文件不同：'+exercise.key);
  check(textExists(entry?.reason),'迁移清单缺少保留或合并依据：'+exercise.key);
  if(entry?.action==='merged')check(textExists(entry.mergeInto),'合并题缺少原题去向：'+exercise.key);
  else check(entry?.action==='added','迁移动作无效：'+exercise.key);
  if(exercise.answerMarkdown) {
    check(question?.originalAnswerMarkdown===exercise.answerMarkdown,'章末原答案Markdown有丢失：'+exercise.key);
    check(question?.referenceAnswer===exerciseText(exercise.answerMarkdown),'章末原答案展示文本有丢失：'+exercise.key);
    check(entry?.answerRaw===exercise.answerRaw,'迁移清单原答案有丢失：'+exercise.key);
  }
  originalKeys.add(exercise.key);
}
for(const question of originalQuestions) {
  check(question.order>10,'迁入原题占用了已有自测ID：'+question.id);
  check(question.originalPrompts?.length>0,'迁入原题缺少来源问句：'+question.id);
  for(const origin of question.originalPrompts||[])check(originalKeys.has(origin.sourceKey),'题库存在源文件没有的原题：'+origin.sourceKey);
}
check(originalQuestions.length===new Set((migration.items||[]).map(item=>item.targetQuestionId)).size,'原题题数与迁移目标数量不一致');
check(allQuestions.length===70+originalQuestions.length,'题库总题数与保留题和迁入题之和不符');
check(migration.addedQuestionCount===originalQuestions.length,'迁移清单新增题数不符');
check(migration.mergedPromptCount===(migration.items||[]).filter(item=>item.action==='merged').length,'迁移清单合并计数不符');
check(JSON.stringify(migration.removedBlocks)===JSON.stringify(removedExerciseBlocks),'被移走的内容必须精确等于9个显式练习块');
check(!/学完本节，你应该能回答/.test(markup),'原节末练习引导仍出现在笔记正文');
check(![...headings.values()].some(h=>['本章复习问题','参考答案'].includes(h)),'原章末题或答案标题仍出现在笔记正文');
check(headings.get('c7-s38')==='附录：源码与工程阅读路线','附录原锚点应保留');
for(const legacy of ['c7-s37','c7-s39']) {
  check(!ids.has(legacy),'已移走练习的旧锚点被其它内容复用：'+legacy);
  check(routedAnchor(data.exerciseRedirects?.[legacy]),'旧练习锚点缺少有效自测重定向：'+legacy);
}

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
  check(Array.isArray(term.chapters) && term.chapters.length > 0 && term.chapters.every(chapter => /^3\.[1-7]$/.test(chapter)), term.id + ' 适用章节无效');
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
        const title = source.section.replace(/^3\.[1-7]\s+/, '');
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
check(Array.isArray(data.searchIndex) && data.searchIndex.length >= 7, '搜索索引为空或未覆盖七节');
for (const tag of tags.filter(tag => 'data-stage' in tag.attrs)) {
  check(textExists(data.stageDetails?.[Number(tag.attrs['data-stage'])]), '流程节点缺少说明：' + tag.attrs['data-stage']);
}

// Check runnable JS separately from source prose, which legitimately discusses chapter one.
const executableScripts = scripts.filter(script => !script.attrs.type || /^(?:text|application)\/javascript$/.test(script.attrs.type));
executableScripts.forEach((script, index) => {
  try {new Script(script.text, {filename: 'chapter-three-inline-' + index + '.js'}); checks++;}
  catch (error) {check(false, '内嵌 JavaScript 语法错误：' + error.message);}
  check(!/chapter-one|chapter-two|第一章|第二章|五节|50\s*题/.test(script.text), '内嵌脚本残留第一章文案、文件名或存储 key');
  check(!/["']1\.["']|\^1\\\.|\[1-5\]/.test(script.text), '内嵌脚本残留其他章节题号或五节路由');
});
const scriptText = executableScripts.map(script => script.text).join('\n');
check(/chapter-three-quiz-v1/.test(scriptText), '缺少第三章独立作答存储 key');
check(/chapter-three-quiz-files-v1/.test(scriptText), '缺少第三章独立作答文件数据库名');
check(!/<(?:video|audio|iframe)\b/i.test(markup), '第三章不应包含视频/音频播放器或嵌入框');
for (const tag of tags.filter(tag => tag.name === 'a')) {
  const href = tag.attrs.href || '';
  check(!/讲解视频|成片|\.mp4(?:$|[?#])|\.webm(?:$|[?#])/i.test(href), '第三章残留视频入口：' + href);
  check(!/chapter-one/i.test(href) || /^chapter-one\.html(?:#.*)?$/.test(href), '残留第一章自测或资源链接：' + href);
}
check(!scripts.some(script => script.attrs.src), '存在外部脚本依赖');
check(!tags.some(tag => tag.name === 'link' && tag.attrs.rel === 'stylesheet'), '存在外部样式依赖');
for (const file of ['第三章测试题-题目版.txt', '第三章测试题-答案解析.txt']) {
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
  generatedQuestionCount:generatedQuestions.length,
  originalPromptCount:sourceExercises.length,
  migratedOriginalQuestionCount:originalQuestions.length,
  mergedOriginalPromptCount:migration.mergedPromptCount,
  preservedOriginalAnswerCount:sourceExercises.filter(e=>e.answerMarkdown).length,
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
