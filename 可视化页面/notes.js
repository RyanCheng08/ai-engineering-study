(() => {
  'use strict';
  const { searchIndex, stageDetails, quizBank } = JSON.parse(document.getElementById('page-data').textContent);
  const chapters = Array.from(document.querySelectorAll('article.chapter'));
  const navLinks = Array.from(document.querySelectorAll('.chapter-link'));
  const sidebar = document.getElementById('sidebar');
  const menuButton = document.getElementById('menu-toggle');
  const mobileMedia = window.matchMedia('(max-width:760px)');
  const toc = document.getElementById('toc-links');
  let current = chapters[0];
  let mode='notes';
  const noteScroll=new Map();
  const notesPane=document.getElementById('notes-reader');
  const quizPane=document.getElementById('lesson-quiz');
  const modeNotes=document.getElementById('mode-notes'),modeQuiz=document.getElementById('mode-quiz');
  const number=()=> '1.'+current.id.split('-')[1];
  let scrollQueued = false;
  let toastTimer;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function setMenu(open) { sidebar.classList.toggle('open',open); sidebar.inert=mobileMedia.matches&&!open; menuButton.setAttribute('aria-expanded',String(open)); }
  mobileMedia.addEventListener('change',()=>setMenu(false));
  menuButton.addEventListener('click',()=>setMenu(!sidebar.classList.contains('open')));
  document.getElementById('backdrop').addEventListener('click',()=>setMenu(false));
  function rebuildToc() {
    toc.replaceChildren();
    current.querySelectorAll('.markdown>h2').forEach(heading=>{
      const anchor=document.createElement('a'); anchor.href='#'+heading.id; anchor.textContent=heading.textContent; toc.append(anchor);
    });
    document.getElementById('crumb-current').textContent=current.dataset.label;
    navLinks.forEach(link=>{
      const index=link.dataset.chapter;
      link.href=mode==='quiz'?'#quiz-'+index:'#chapter-'+index;
      const active=index===current.id.split('-')[1]; link.classList.toggle('active',active);
      if (active) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
    });
  }
  function refreshProgress(){
    chapters.forEach((chapter,i)=>{
      const stats=window.ChapterQuiz?.summary('1.'+(i+1));
      const label=document.querySelector('[data-chapter-progress="'+(i+1)+'"]');
      if(label)label.textContent='自测 '+(stats?.completed||0)+' / 10';
    });
    const stats=window.ChapterQuiz?.summary(number());
    document.getElementById('mode-quiz-progress').textContent=(stats?.completed||0)+' / 10';
    if(mode==='quiz')updateReading();
  }
  function updateMode(){
    document.body.dataset.learningMode=mode;document.body.dataset.currentChapter=current.id;
    document.getElementById('workspace-title').textContent=number()+' '+current.dataset.label;
    modeNotes.href='#'+current.id;modeQuiz.href='#quiz-'+current.id.split('-')[1];
    document.getElementById('document-quiz-link').href=modeQuiz.href;
    [modeNotes,modeQuiz].forEach(link=>{const active=link===(mode==='notes'?modeNotes:modeQuiz);link.setAttribute('aria-selected',String(active));link.tabIndex=active?0:-1});
    document.getElementById('workspace-hint').textContent=mode==='notes'?'读完本节后，可在这里切到 10 道由浅入深的自测题。':'先独立作答，再看解析；点击知识点即可回看笔记。';
    document.getElementById('print-current').textContent=mode==='quiz'?'打印本节题目':'打印本节';
    document.getElementById('print-all').textContent=mode==='quiz'?'打印全章题目':'打印全章';
    refreshProgress();
  }
  [modeNotes,modeQuiz].forEach(link=>link.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    const next=event.key==='Home'?modeNotes:event.key==='End'?modeQuiz:link===modeNotes?modeQuiz:modeNotes;next.click();next.focus();
  }));
  function showHash(initial=false) {
    let id;
    try { id=decodeURIComponent(location.hash.slice(1)); } catch { id=''; }
    const quizRoute=id.match(/^quiz-([1-7])(?:-(0[1-9]|10))?$/);
    const target=quizRoute?null:document.getElementById(id);
    const chapter=quizRoute?chapters[Number(quizRoute[1])-1]:target?.closest('article.chapter') || chapters.find(c=>c.id===id) || (target ? current : chapters[0]);
    const previous=current,previousMode=mode;
    const oldFocus=document.activeElement,focusLeavesPane=notesPane.contains(oldFocus)||quizPane.contains(oldFocus);
    if(mode==='notes'&&!initial)noteScroll.set(current.id,window.scrollY);
    mode=quizRoute?'quiz':'notes';current=chapter;
    notesPane.hidden=mode==='quiz';quizPane.hidden=mode!=='quiz';chapters.forEach(c=>c.hidden=c!==chapter||mode==='quiz');
    if(mode==='quiz')window.ChapterQuiz?.show(number(),quizRoute[2]?number()+'-'+quizRoute[2]:undefined);else window.ChapterQuiz?.hide();
    rebuildToc();updateMode();setMenu(false);
    requestAnimationFrame(()=>{
      if(mode==='quiz'){
        if(previousMode!=='quiz'||previous!==chapter||initial)document.getElementById('lesson-workspace').scrollIntoView({block:'start',behavior:initial?'instant':'smooth'});
      }
      else if(target && target!==chapter) { const collapsed=target.closest('details'); if(collapsed)collapsed.open=true; target.scrollIntoView({block:'start',behavior:initial?'instant':'smooth'}); }
      else if(previousMode==='quiz'&&previous===chapter&&noteScroll.has(chapter.id))window.scrollTo({top:noteScroll.get(chapter.id),behavior:'instant'});
      else window.scrollTo({top:0,behavior:initial?'instant':'smooth'});
      const keepVisibleFocus=oldFocus===modeNotes||oldFocus===modeQuiz||sidebar.contains(oldFocus);
      if(!initial&&(target&&target!==chapter||focusLeavesPane||previousMode!==mode&&!keepVisibleFocus)){
        const focusTarget=mode==='quiz'?document.getElementById('quiz-question-title'):target&&target!==chapter?target:current.querySelector('.chapter-head h2');
        if(focusTarget){if(!focusTarget.hasAttribute('tabindex'))focusTarget.tabIndex=-1;focusTarget.focus({preventScroll:true})}
      }
      updateReading();
    });
  }
  window.addEventListener('hashchange',()=>showHash());
  function updateReading() {
    scrollQueued=false;
    if(mode==='quiz'){document.getElementById('reading-progress').style.width=(window.ChapterQuiz?.summary(number())?.completed||0)*10+'%';return}
    const rect=current.getBoundingClientRect();
    const readingEdge=document.getElementById('lesson-workspace').getBoundingClientRect().bottom+15;
    const range=Math.max(1,current.offsetHeight-window.innerHeight+readingEdge);
    const progress=Math.max(0,Math.min(1,(readingEdge-rect.top)/range));
    document.getElementById('reading-progress').style.width=(progress*100).toFixed(2)+'%';
    const headings=Array.from(current.querySelectorAll('.markdown>h2'));
    let active=headings[0];
    headings.forEach(h=>{if(h.getBoundingClientRect().top<readingEdge)active=h});
    Array.from(toc.children).forEach(a=>a.classList.toggle('active',a.hash==='#'+active?.id));
  }
  document.addEventListener('chapterquiz:progress',refreshProgress);
  document.addEventListener('chapterquiz:navigate',event=>{
    const match=event.detail?.chapterNumber?.match(/^1\.([1-7])$/);if(!match)return;
    const q=event.detail.questionId?.match(/^1\.[1-7]-(0[1-9]|10)$/)?.[1];location.hash='quiz-'+match[1]+(q?'-'+q:'');
  });
  document.addEventListener('chapterquiz:position',event=>{
    if(mode!=='quiz'||event.detail?.chapterNumber!==number())return;
    const order=event.detail.questionId?.match(/^1\.[1-7]-(0[1-9]|10)$/)?.[1];if(!order)return;
    try{history.replaceState(null,'','#quiz-'+current.id.split('-')[1]+'-'+order)}catch{}
  });
  window.addEventListener('scroll',()=>{if(!scrollQueued){scrollQueued=true;requestAnimationFrame(updateReading)}},{passive:true});
  document.querySelectorAll('[data-stage]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('[data-stage]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    document.getElementById('stage-detail').textContent=stageDetails[Number(button.dataset.stage)];
  }));
  function toast(message) {
    const node=document.getElementById('toast'); node.textContent=message; node.hidden=false;
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.hidden=true,2300);
  }
  document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
    const text=document.getElementById(button.dataset.copy).textContent;
    try {
      if(navigator.clipboard?.writeText && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const input=document.createElement('textarea'); input.value=text; input.style.cssText='position:fixed;left:-9999px;top:0'; document.body.append(input); input.select();
        const ok=document.execCommand('copy'); input.remove(); if(!ok)throw new Error('copy unavailable');
      }
      toast('代码已复制');
    } catch { toast('无法自动复制，可选中代码后按 Ctrl+C'); }
  }));
  const dialog=document.getElementById('search-dialog');
  const input=document.getElementById('search-input');
  const results=document.getElementById('search-results');
  function openSearch(){ if(!dialog.open)dialog.showModal(); input.focus(); }
  document.getElementById('search-open').addEventListener('click',openSearch);
  document.getElementById('search-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch()}if(event.key==='Escape')setMenu(false)});
  function highlighted(text,query) {
    const start=text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if(start<0)return esc(text);
    return esc(text.slice(0,start))+'<mark>'+esc(text.slice(start,start+query.length))+'</mark>'+esc(text.slice(start+query.length));
  }
  function search() {
    const query=input.value.trim(); results.replaceChildren();
    if(!query){results.innerHTML='<p class="search-hint">输入关键词，搜索七节完整内容。</p>';return}
    const found=searchIndex.filter(row=>(row.title+' '+row.text).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const info=document.createElement('p');info.className='search-hint';info.textContent=found.length?'找到 '+found.length+' 个相关主题':'没有找到相关内容';results.append(info);
    found.forEach(row=>{
      const at=row.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      const start=Math.max(0,at-55);const snippet=(start?'…':'')+row.text.slice(start,start+190)+(row.text.length>start+190?'…':'');
      const button=document.createElement('button');button.type='button';button.className='search-result';
      button.innerHTML='<small>'+esc(row.label)+'</small><b>'+highlighted(row.title,query)+'</b><p>'+highlighted(snippet,query)+'</p>';
      button.addEventListener('click',()=>{dialog.close();if(location.hash==='#'+row.target)showHash();else location.hash=row.target});results.append(button);
    });
  }
  input.addEventListener('input',search);
  let printSnapshot=null;
  function preparePrint(all=false) {
    if(printSnapshot)return;
    printSnapshot={hidden:chapters.map(c=>c.hidden),details:Array.from(document.querySelectorAll('.code-block details')).map(d=>[d,d.open])};
    document.body.classList.toggle('print-all',all);
    if(all)chapters.forEach(c=>c.hidden=false);
    printSnapshot.details.forEach(([detail])=>detail.open=true);
  }
  function finishPrint(){if(!printSnapshot)return;chapters.forEach((c,i)=>c.hidden=printSnapshot.hidden[i]);printSnapshot.details.forEach(([d,open])=>d.open=open);document.body.classList.remove('print-all');printSnapshot=null;updateReading()}
  let quizPrintActive=false;
  function prepareQuizPrint(all=false,answers=false){
    if(quizPrintActive)return;
    const lessons=all?quizBank.lessons:quizBank.lessons.filter(l=>l.number===number());
    let html='<h1>第一章 · '+(all?'全章':'本节')+'自测'+(answers?'答案解析':'题目')+'</h1><p>姓名：____________　日期：____________<br>选择题自动评分；分析与设计题按要点自评。每节 100 分。</p>';
    for(const lesson of lessons){
      html+='<h2>'+esc(lesson.number+' '+lesson.title)+'</h2>';
      for(const q of lesson.questions){
        html+='<section class="quiz-paper-question"><h3>'+esc(q.id+' '+q.title)+' · 10 分</h3><p>'+esc(q.prompt)+'</p>'+(q.code?'<pre><code>'+esc(q.code)+'</code></pre>':'');
        if(q.options)html+=q.options.map(o=>'<p>'+esc(o.key+'. '+o.text)+'</p>').join('');
        if(answers)html+='<div class="quiz-paper-answer"><p><b>参考答案'+(q.answer?'：'+esc(q.answer.join('、')):'')+'</b></p><p>'+esc(q.referenceAnswer)+'</p><p><b>解析</b></p><p>'+esc(q.explanation)+'</p>'+(q.rubric?q.rubric.map(r=>'<p>'+esc(r.score+' 分：'+r.point)+'</p>').join(''):'')+'</div>';
        else html+='<div class="quiz-paper-space">作答：____________________________</div>';
        html+='</section>';
      }
    }
    document.getElementById('quiz-print-root').innerHTML=html;document.body.classList.add('print-quiz');quizPrintActive=true;
  }
  function finishQuizPrint(){document.body.classList.remove('print-quiz');quizPrintActive=false}
  function printQuiz(all=false,answers=false){prepareQuizPrint(all,answers);try{window.print()}finally{finishQuizPrint()}}
  document.addEventListener('chapterquiz:print',event=>{if(mode==='quiz')printQuiz(event.detail?.all===true,event.detail?.answers===true)});
  window.addEventListener('beforeprint',()=>{if(mode==='quiz')prepareQuizPrint();else preparePrint()});
  window.addEventListener('afterprint',()=>{finishPrint();finishQuizPrint()});
  document.getElementById('print-current').addEventListener('click',()=>{if(mode==='quiz'){printQuiz();return}preparePrint(false);try{window.print()}finally{finishPrint()}});
  document.getElementById('print-all').addEventListener('click',()=>{if(mode==='quiz'){printQuiz(true);return}preparePrint(true);try{window.print()}finally{finishPrint()}});
  showHash(true);
})();
