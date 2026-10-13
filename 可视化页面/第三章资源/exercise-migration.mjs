import {Marked} from 'marked';
import crypto from 'node:crypto';

const marked = new Marked({gfm:true});
export const exerciseText = value => marked.parseInline(String(value).trim()).replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');

// Select whole, explicitly labelled exercise blocks. Teaching questions, test
// fixtures, acceptance criteria, summaries and the reading appendix stay intact.
export function splitExercises(source) {
  const normalizedSource = source.replace(/\r\n?/g,'\n');
  const tokens = marked.lexer(normalizedSource);
  const retained = [], removed = [], exercises = [];
  let section = '', reviewItems, answerItems;
  for(let i=0;i<tokens.length;i++) {
    const token = tokens[i];
    if(token.type==='heading' && token.depth===1 && /^3\\?\.[1-7]\s/.test(token.text)) section=token.text.replace(/\\/g,'').slice(0,3);
    if(token.type==='heading' && token.depth===1 && ['本章复习问题','参考答案'].includes(token.text)) {
      const block=[token];
      while(i+1<tokens.length && !(tokens[i+1].type==='heading' && tokens[i+1].depth===1)) block.push(tokens[++i]);
      const list=block.find(t=>t.type==='list');
      if(!list || list.items.length!==20) throw new Error('Expected 20 original exercises in '+token.text);
      if(token.text==='本章复习问题')reviewItems=list.items;
      else answerItems=list.items;
      removed.push({kind:token.text,raw:block.map(t=>t.raw).join('')});
      continue;
    }
    if(token.type==='paragraph' && /^学完本节，你应该能回答/.test(token.text)) {
      const block=[token];
      while(tokens[i+1]?.type==='space') block.push(tokens[++i]);
      const list=tokens[++i];
      if(list?.type!=='list' || !list.ordered)throw new Error('Missing section exercise list: '+section);
      block.push(list);
      list.items.forEach((item,n)=>exercises.push({key:`section-${section}-${n+1}`,section,number:n+1,promptMarkdown:item.text.trim(),raw:item.raw}));
      removed.push({kind:'本节回顾问题',section,raw:block.map(t=>t.raw).join('')});
      continue;
    }
    retained.push(token);
  }
  if(!reviewItems || !answerItems || exercises.length!==33 || removed.length!==9)throw new Error('Unexpected original exercise structure');
  reviewItems.forEach((item,n)=>{
    const answerLines=answerItems[n].text.trim().split('\n');
    const answerPrompt=exerciseText(answerLines.shift());
    const prompt=exerciseText(item.text);
    if(answerPrompt!==prompt)throw new Error('Original answer title does not match question '+(n+1));
    exercises.push({key:`review-${n+1}`,section:'本章复习问题',number:n+1,promptMarkdown:item.text.trim(),answerMarkdown:answerLines.join('\n').trim(),raw:item.raw,answerRaw:answerItems[n].raw});
  });
  retained.links=tokens.links;
  // Lossless token accounting: no unlisted source span can disappear.
  if(tokens.map(t=>t.raw).join('')!==normalizedSource)throw new Error('Source lexer did not account for all bytes');
  return {tokens:retained,retainedMarkdown:retained.map(t=>t.raw).join(''),exercises,removed,sourceSha256:crypto.createHash('sha256').update(source).digest('hex')};
}

export function migrateExercises(source,spec) {
  const split=splitExercises(source);
  const originalQuestions=[], destinations=new Map(), items=[];
  const nextOrder=Object.fromEntries(Array.from({length:7},(_,n)=>[`3.${n+1}`,11]));
  const add = exercise => {
    const entry=spec[exercise.key];
    if(!entry)throw new Error('Missing original exercise specification: '+exercise.key);
    if(entry.mergeInto) {
      const question=destinations.get(entry.mergeInto);
      if(!question)throw new Error('Missing merge destination '+entry.mergeInto);
      const prompt=exerciseText(exercise.promptMarkdown);
      if(prompt!==question.prompt)(question.alternatePrompts??=[]).push(prompt);
      question.originalPrompts.push({sourceKey:exercise.key,promptMarkdown:exercise.promptMarkdown,sourceLabel:`${exercise.section} 节末第 ${exercise.number} 题`});
      destinations.set(exercise.key,question);
      items.push({...exercise,targetQuestionId:question.id,destination:question.id.split('-')[0],action:'merged',mergeInto:entry.mergeInto,reason:entry.reason});
      return;
    }
    const lesson=entry.lesson || exercise.section, order=nextOrder[lesson]++;
    const answer=exercise.answerMarkdown ? exerciseText(exercise.answerMarkdown) : entry.answer;
    if(!answer || !entry.rubric?.length || entry.rubric.reduce((sum,r)=>sum+r.score,0)!==10)throw new Error('Missing answer/rubric: '+exercise.key);
    const question={id:`${lesson}-${String(order).padStart(2,'0')}`,order,type:'short',level:entry.level,title:entry.title,prompt:exerciseText(exercise.promptMarkdown),referenceAnswer:answer,explanation:(exercise.answerMarkdown?'原笔记参考答案已完整保留。':'原笔记此题未单列答案，以下参考答案与评分要点根据对应教学正文整理。')+' '+entry.explanation,rubric:entry.rubric,sourceRefs:entry.sourceRefs,sourceKind:'original',sourceLabel:'原笔记练习',originalPrompts:[{sourceKey:exercise.key,promptMarkdown:exercise.promptMarkdown,sourceLabel:exercise.section==='本章复习问题'?`章末复习第 ${exercise.number} 题`:`${exercise.section} 节末第 ${exercise.number} 题`}],...(exercise.answerMarkdown?{originalAnswerMarkdown:exercise.answerMarkdown}:{})};
    originalQuestions.push(question);destinations.set(exercise.key,question);
    items.push({...exercise,targetQuestionId:question.id,destination:lesson,action:'added',reason:'开放回顾题与已有情境选择题、代码审查题或综合设计题的题干及作答范围不同，保留独立练习。'});
  };
  split.exercises.filter(e=>e.key.startsWith('review-')).forEach(add);
  split.exercises.filter(e=>e.key.startsWith('section-')).forEach(add);
  const unused=Object.keys(spec).filter(key=>!destinations.has(key));
  if(unused.length)throw new Error('Unknown original exercises: '+unused.join(','));
  return {...split,originalQuestions,migration:{chapter:3,sourceSha256:split.sourceSha256,originalPromptCount:53,originalAnswerCount:20,addedQuestionCount:originalQuestions.length,mergedPromptCount:items.filter(i=>i.action==='merged').length,generatedQuestionPolicy:'原有70题题干、答案、ID与节内前10题顺序不变；原题追加在对应知识小节，综合复盘归入3.7。',removedBlocks:split.removed,items}};
}
