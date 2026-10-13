// Exact, reviewable source slicing. Markdown sources are always read-only.
export function partitionSources(sources) {
  const main = sources[0];
  const spans = [];
  const take = (key, startMarker, endMarker, questionKeys) => {
    const start = main.indexOf(startMarker);
    if (start < 0 || main.indexOf(startMarker, start + 1) >= 0) throw new Error('Ambiguous migration marker: ' + key);
    const end = endMarker ? main.indexOf(endMarker, start + startMarker.length) : main.length;
    if (end < start) throw new Error('Missing migration end: ' + key);
    spans.push({key, sourceIndex:0, start, end, raw:main.slice(start,end), questionKeys});
  };
  take('section-2.1-outcome', '学完本节，你应该能讲清：模型为什么提出动作，为什么要有 Runtime 受控执行。', '\n\n', ['review-1']);
  take('section-2.5-oral', '### 1\\. 口头验收', '### 2\\. 代码验收', ['project-oral']);
  take('appendix-four', '# 附录四：本章复习问题', null, Array.from({length:20},(_,i)=>'review-'+(i+1)).filter(key=>!['review-16','review-20'].includes(key)));
  let retained = main;
  for (const span of [...spans].sort((a,b)=>b.start-a.start)) retained = retained.slice(0,span.start)+retained.slice(span.end);
  spans.push({key:'companion-exercises-and-answers',sourceIndex:1,start:0,end:sources[1].length,raw:sources[1],questionKeys:[...Array.from({length:20},(_,i)=>'review-'+(i+1)),'project-oral','project-code','project-review']});
  return {retainedSources:[retained],spans};
}

export function markdownText(text) {
  return text.replace(/\*\*/g,'').replace(/`/g,'').replace(/\\([._+\-()])/g,'$1').trim();
}

export function originalItems(sources) {
  const answer = sources[1];
  const part = answer.slice(answer.indexOf('### 一、复习题与参考答案'), answer.indexOf('### 二、八项安全测试'));
  const matches = [...part.matchAll(/^(\d+)\. \*\*(.+?)\n([\s\S]*?)(?=^\d+\. \*\*|$(?![\s\S]))/gm)];
  if (matches.length !== 20) throw new Error('Expected twenty original review answers, got '+matches.length);
  const appendix = sources[0].slice(sources[0].indexOf('# 附录四：本章复习问题'));
  const prompts = new Map([...appendix.matchAll(/^(\d+)\. (.+)$/gm)].map(m=>[Number(m[1]),m[2].trim()]));
  const items = matches.map(m=>({key:'review-'+m[1],originalNumber:Number(m[1]),promptMarkdown:prompts.get(Number(m[1])) || '**'+m[2].trim(),answerPromptMarkdown:'**'+m[2].trim(),answerMarkdown:m[3].trim(),raw:m[0].trim(),sourceFile:1,mainAppendixPresent:prompts.has(Number(m[1]))}));
  const projects = [...answer.slice(answer.indexOf('### 三、阶段二项目')).matchAll(/^\*\*(.+?)\*\*\n([\s\S]*?)(?=^\*\*|$(?![\s\S]))/gm)];
  if (projects.length !== 3) throw new Error('Expected three original project questions');
  projects.forEach((m,i)=>items.push({key:['project-oral','project-code','project-review'][i],originalNumber:['口头题','代码题','审查题'][i],promptMarkdown:m[1].trim(),answerPromptMarkdown:m[1].trim(),answerMarkdown:m[2].trim(),raw:m[0].trim(),sourceFile:1,mainAppendixPresent:false}));
  return items;
}
