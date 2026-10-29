import {Marked} from 'marked';
import crypto from 'node:crypto';

const marked = new Marked({gfm:true});
export const exerciseText = value => marked.parseInline(String(value).trim()).replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const comparePrompt = value => exerciseText(value).replace(/\*/g,'').replace(/^问：/,'').trim();

// Only three explicitly labelled exercise blocks leave the notes. The six
// teaching/acceptance sections, experiments, tables and code remain in place.
export function splitExercises(source) {
  const normalizedSource = source.replace(/\r\n?/g,'\n');
  const tokens = marked.lexer(normalizedSource), retained = [], removed = [], exercises = [];
  let section = '', reviewItems, answerItems;
  for(let i=0;i<tokens.length;i++) {
    const token = tokens[i];
    if(token.type==='heading' && token.depth===1 && /^4\\?\.[1-6]\s/.test(token.text)) section=token.text.replace(/\\/g,'').slice(0,3);
    if(token.type==='heading' && token.depth===1 && ['本章复习问题','复习题答案'].includes(token.text)) {
      const block=[token];
      while(i+1<tokens.length && !(tokens[i+1].type==='heading' && tokens[i+1].depth===1)) block.push(tokens[++i]);
      const list=block.find(t=>t.type==='list');
      if(!list || list.items.length!==33) throw new Error('Expected 33 original exercises in '+token.text);
      if(token.text==='本章复习问题')reviewItems=list.items; else answerItems=list.items;
      removed.push({kind:token.text,raw:block.map(t=>t.raw).join('')});
      continue;
    }
    if(token.type==='paragraph' && /^学完本节，你应该能回答/.test(token.text)) {
      const block=[token];
      while(tokens[i+1]?.type==='space') block.push(tokens[++i]);
      const list=tokens[++i];
      if(section!=='4.6' || list?.type!=='list' || !list.ordered || list.items.length!==5)throw new Error('Unexpected section exercises: '+section);
      block.push(list);
      list.items.forEach((item,n)=>exercises.push({key:`section-${section}-${n+1}`,section,number:n+1,promptMarkdown:item.text.trim(),raw:item.raw}));
      removed.push({kind:'本节回顾问题',section,raw:block.map(t=>t.raw).join('')});
      continue;
    }
    retained.push(token);
  }
  if(!reviewItems || !answerItems || exercises.length!==5 || removed.length!==3)throw new Error('Unexpected original exercise structure');
  reviewItems.forEach((item,n)=>{
    const answerLines=answerItems[n].text.trim().split('\n');
    if(comparePrompt(answerLines.shift())!==comparePrompt(item.text))throw new Error('Original answer title mismatch: '+(n+1));
    exercises.push({key:`review-${n+1}`,section:'本章复习问题',number:n+1,promptMarkdown:item.text.trim(),answerMarkdown:answerLines.join('\n').trim(),raw:item.raw,answerRaw:answerItems[n].raw});
  });
  retained.links=tokens.links;
  if(tokens.map(t=>t.raw).join('')!==normalizedSource)throw new Error('Source lexer did not account for all bytes');
  return {tokens:retained,retainedMarkdown:retained.map(t=>t.raw).join(''),exercises,removed,sourceSha256:crypto.createHash('sha256').update(source).digest('hex')};
}

const reviewSections = [1,1,1,1,1,1,1,1,1,1,2,2,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,5,5,5,5,6,6];
const reviewHeadings = [
 '一、Prompt 写清楚以后，为什么还要管理 Context？',
 '四、Context Prioritization：先判断有效，再分配空间',
 '五、Context Budget：先留输出，再算完整输入',
 '五、Context Budget：先留输出，再算完整输入',
 '5.2 关键内容放不下，就停止发送',
 '六、Context Compression：缩短内容，保留核对依据',
 '6.1 工具结果不能只截开头',
 '八、Context Debug Report：查清模型实际收到了什么',
 '十二、LiteLLM：接回 Gateway，分清缓存与重试',
 '十、长上下文的成本与延迟：统计整个任务',
 '七、Agent State、执行记录和工作记忆怎样分工？',
 '原稿 JSONL 演示证明了什么？',
 '四、OKF：先解决知识组织，再选择检索技术',
 '二、长期记忆保存什么？先筛选，再写入',
 '4.1 元数据组织了记录，不能单独证明内容正确',
 '5.5 “自动记住”具体怎样发生？',
 '5.3 全新会话验证外部读取',
 '3.1 解析要保留关系，不只是提取字符',
 '3.3 分块同时看完整性和粒度',
 '2.3 Embedding 配置要匹配，维度相同还不够',
 '4.5 Elasticsearch 是检索系统，与 BM25 不在同一层',
 '4.6 Hybrid Search：两路分数不能直接相加',
 '4.8 查询处理：原意不变，重新查库',
 '5.1 Rerank 能改排序，不能补回候选之外的内容',
 '5.6 Citation 至少分三层检查',
 '5.6 Citation 至少分三层检查',
 '6.7 本次结果支持什么选择？',
 '三、知识页至少回答三个问题',
 '6.3 页面更新后，索引和缓存也要同步',
 '八、权限贯穿读取、生成、发布和使用',
 '6.2 按结论含义改，区分规则与实现',
 '2.2 两件工具继续走 Tool Runtime',
 '四、用真实业务 Run 验证接入',
];
const sectionAnswers = [
 {heading:'2.1 六处修改分别负责什么',answer:'记忆模块负责记录组织、索引、搜索、读取、写入、摘要与格式校验。Runtime 负责执行入口的白名单、RBAC、参数契约、审批、路径与访问范围检查以及审计。写入是否发生、是否成功，以真实工具回执更新；模块不能自行绕过统一治理。'},
 {heading:'2.3 先写入，再用新进程召回',answer:'新进程 recall 成功只证明持久记录能够跨进程读回。新业务会话还可能没有加载摘要、没有提供工具，或者读取结果没有装配进模型输入。因此还要核对启动加载记录、工具调用与回执，以及实际模型请求中的对应内容。'},
 {heading:'3.3 把查询封装为 `rag_query`',answer:'只读表示不修改知识库和工作区，不代表资料对所有身份公开。rag_query 仍需检查 rag:read、角色和项目访问范围，防止未授权读取或跨项目泄漏。请求继续经过 Registry、白名单与 RBAC、Runtime、后端及结果回写与审计。'},
 {heading:'四、用真实业务 Run 验证接入',answer:'不能仅凭回答中出现熟悉的数值或文件名判断查过资料。沿本次 Trace 检查模型提出 rag_query、Runtime 校验与授权、后端返回，以及来源编号、结果回写和下一轮实际请求。没有调用记录时应检查工具快照、使用指引和装配过程，不能伪造查询成功。'},
 {heading:'五、记忆、资料与源码冲突时，先说清各自证明什么',answer:'已批准规则说明应当实现的业务目标，当前源码和配置调用链说明现有实现，当前测试回执只证明对应版本与测试范围。先分别记录来源、版本和状态，再核对是资料滞后、记忆过期还是实现偏离规则。不能靠改文档掩盖代码问题，也不能因为当前代码如此就自行改写已批准要求。'},
];

// Self-assessment points retain the answer's own complete sentences. They are
// learning aids, not a claim that the original notes supplied a grading scheme.
function rubricFromAnswer(answer) {
  const sentences = answer.replace(/^答：/,'').match(/[^。]+(?:。|$)/g) || [answer];
  const points = sentences.length>3 ? [...sentences.slice(0,2),sentences.slice(2).join('')] : sentences;
  return points.map((point,i)=>({point:point.trim(),score:Math.floor(10/points.length)+(i<10%points.length?1:0)}));
}

export function migrateExercises(source) {
  const split=splitExercises(source), originalQuestions=[], items=[];
  const nextOrder=Object.fromEntries(Array.from({length:6},(_,n)=>[`4.${n+1}`,11]));
  for(const exercise of [...split.exercises.filter(e=>e.key.startsWith('review-')),...split.exercises.filter(e=>e.key.startsWith('section-'))]) {
    const original = exercise.key.startsWith('review-');
    const section = original ? reviewSections[exercise.number-1] : 6;
    const lesson=`4.${section}`, order=nextOrder[lesson]++;
    const supplement=original?null:sectionAnswers[exercise.number-1];
    const answer=original?exerciseText(exercise.answerMarkdown):supplement.answer;
    const heading=original?reviewHeadings[exercise.number-1]:supplement.heading;
    const prompt=exerciseText(exercise.promptMarkdown);
    const question={id:`${lesson}-${String(order).padStart(2,'0')}`,order,type:'short',level:section===6?4:2,title:prompt,prompt,
      referenceAnswer:answer,explanation:original?'原笔记参考答案已完整保留。评分要点按原答案拆分，供自评使用；原笔记未提供单独分值。':'原笔记此题未单列答案，以下参考答案与评分要点根据对应教学正文整理。可沿下方链接回看完整依据。',
      rubric:rubricFromAnswer(answer),sourceRefs:[`${lesson}／${heading}`],sourceKind:'original',sourceLabel:'原笔记练习',
      originalPrompts:[{sourceKey:exercise.key,promptMarkdown:exercise.promptMarkdown,sourceLabel:original?`章末复习第 ${exercise.number} 题`:`${exercise.section} 节末第 ${exercise.number} 题`}],
      ...(original?{originalAnswerMarkdown:exercise.answerMarkdown}:{})};
    originalQuestions.push(question);
    items.push({...exercise,targetQuestionId:question.id,destination:lesson,action:'added',reason:'原题按知识归属追加到自测；不合并、不遗漏原问句与原参考答案。'});
  }
  return {...split,originalQuestions,migration:{chapter:4,sourceSha256:split.sourceSha256,originalPromptCount:38,originalAnswerCount:33,addedQuestionCount:38,mergedPromptCount:0,generatedQuestionPolicy:'每节10道补充自测，原题从各节第11题追加；33份原答案完整保留，4.6节末5题根据正文补充答案并标注。',removedBlocks:split.removed,items}};
}
