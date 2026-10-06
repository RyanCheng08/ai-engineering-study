(() => {
  'use strict';
  const entries=JSON.parse(document.getElementById('page-data').textContent).glossaryEntries;
  if(!Array.isArray(entries)||!entries.length)return;
  const byId=new Map(entries.map(term=>[term.id,term]));
  const aliasMap=new Map();
  entries.forEach(term=>term.aliases.forEach(alias=>aliasMap.set(alias.toLocaleLowerCase(),term.id)));
  const reEscape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp([...aliasMap.keys()].sort((a,b)=>b.length-a.length).map(reEscape).join('|'),'giu');
  const ascii=c=>!!c&&/[A-Za-z0-9_]/.test(c);
  function matches(text){
    const found=[];pattern.lastIndex=0;let match;
    while((match=pattern.exec(text))!==null){
      const value=match[0],start=match.index,end=start+value.length;
      if(ascii(value[0])&&ascii(text[start-1])||ascii(value.at(-1))&&ascii(text[end]))continue;
      found.push({start,end,value,id:aliasMap.get(value.toLocaleLowerCase())});
    }
    return found;
  }
  const chapterTerms=new Map();let annotationCount=0;
  document.querySelectorAll('article.chapter').forEach(chapter=>{
    const number='1.'+chapter.id.split('-')[1];
    const used=new Set(matches(chapter.textContent).map(hit=>hit.id));
    entries.forEach(term=>{if(term.chapters.includes(number))used.add(term.id)});
    chapterTerms.set(chapter.id,used);
    chapter.querySelectorAll('.markdown,.chapter-head,.visual-summary .caption').forEach(scope=>{
      const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT),nodes=[];let node;
      while((node=walker.nextNode())){
        if(!node.parentElement.closest('a,button,pre,script,style,kbd,summary,[data-term-id]')&&node.nodeValue.trim())nodes.push(node);
      }
      nodes.forEach(textNode=>{
        const hits=matches(textNode.nodeValue);if(!hits.length)return;
        const fragment=document.createDocumentFragment();let end=0;
        hits.forEach(hit=>{
          fragment.append(document.createTextNode(textNode.nodeValue.slice(end,hit.start)));
          const button=document.createElement('button');button.type='button';button.className='term-trigger';button.dataset.termId=hit.id;
          button.textContent=hit.value;button.setAttribute('aria-label','解释 '+hit.value);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','term-dialog');button.title='点击查看白话解释、类比与演示';fragment.append(button);end=hit.end;annotationCount++;
        });
        fragment.append(document.createTextNode(textNode.nodeValue.slice(end)));textNode.replaceWith(fragment);
      });
    });
    const hint=document.createElement('div');hint.className='chapter-term-hint';
    const label=document.createElement('span');label.textContent='正文中带虚线的术语，点击可看白话解释。';
    const button=document.createElement('button');button.type='button';button.className='btn';button.dataset.glossaryChapter=chapter.id;button.textContent='本节术语 · '+used.size+' 项';hint.append(label,button);chapter.querySelector('.chapter-head').append(hint);
  });
  document.body.dataset.glossaryCount=String(entries.length);document.body.dataset.termAnnotationCount=String(annotationCount);
  const dialog=document.getElementById('term-dialog'),body=document.getElementById('term-body'),title=document.getElementById('term-dialog-title');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const views=[['plain','白话解释'],['analogy','生活类比'],['steps','分步演示'],['example','小例子']];
  let activeTerm=null,activeView='plain',stepIndex=0,opener=null,browseScope='all',browseQuery='',sampled=-1;
  const demoValues={temperature:1,'top-p':.8};
  function currentChapter(){return document.body.dataset.currentChapter||document.querySelector('article.chapter:not([hidden])')?.id||'chapter-1'}
  function modal(){if(!dialog.open){opener=document.activeElement;dialog.showModal();document.body.classList.add('glossary-open')}}
  function close(){dialog.close()}
  dialog.addEventListener('close',()=>{document.body.classList.remove('glossary-open');if(opener?.isConnected)opener.focus({preventScroll:true})});
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close()}});
  document.getElementById('term-close').addEventListener('click',close);
  document.getElementById('term-open').addEventListener('click',()=>openBrowse('all'));
  document.addEventListener('click',event=>{
    const termButton=event.target.closest('[data-term-id]');if(termButton){event.preventDefault();openTerm(termButton.dataset.termId);return}
    const chapterButton=event.target.closest('[data-glossary-chapter]');if(chapterButton)openBrowse('current');
  });
  document.addEventListener('keydown',event=>{if(dialog.open&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();event.stopImmediatePropagation();openBrowse('all')}},true);
  function openBrowse(scope='all'){
    activeTerm=null;browseScope=scope;title.textContent='术语速查';
    body.innerHTML='<div class="term-browse-tools"><input id="term-filter" type="search" placeholder="搜索 temperature、top_p 或中文关键词…" aria-label="搜索术语"><select id="term-scope" aria-label="术语范围"><option value="all">全部七节</option><option value="current">仅当前小节</option></select></div><p class="term-browse-count" id="term-count"></p><div class="term-grid" id="term-list"></div>';
    const input=document.getElementById('term-filter'),select=document.getElementById('term-scope');input.value=browseQuery;select.value=browseScope;
    input.addEventListener('input',()=>{browseQuery=input.value;renderList()});select.addEventListener('change',()=>{browseScope=select.value;renderList()});renderList();modal();input.focus({preventScroll:true});
  }
  function renderList(){
    const query=browseQuery.trim().toLocaleLowerCase(),scope=chapterTerms.get(currentChapter());
    const found=entries.filter(term=>(browseScope==='all'||scope?.has(term.id))&&[term.term,...term.aliases,term.plain].join(' ').toLocaleLowerCase().includes(query));
    document.getElementById('term-count').textContent='找到 '+found.length+' 项 · 点击术语查看四种讲解。';
    document.getElementById('term-list').innerHTML=found.length?found.map(term=>'<button type="button" class="term-list-item" data-term-id="'+esc(term.id)+'"><b>'+esc(term.term)+'</b><span>'+esc(term.plain.slice(0,52))+(term.plain.length>52?'…':'')+'</span></button>').join(''):'<p class="term-empty">没有找到，试试英文名称或相关中文关键词。</p>';
  }
  function openTerm(id){
    if(!byId.has(id))return;activeTerm=byId.get(id);activeView='plain';stepIndex=0;sampled=-1;renderDetail();modal();
  }
  function demoKind(term){if(term.aliases.some(s=>s.toLowerCase()==='temperature'))return 'temperature';if(term.aliases.some(s=>s.toLowerCase()==='top_p'))return 'top-p';return null}
  function renderDetail(focusView=false){
    const term=activeTerm;title.textContent=term.term;
    let panel='';
    if(activeView==='plain')panel='<h3>一句话先理解</h3><p>'+esc(term.plain)+'</p><p class="term-aliases">笔记里也可能写作：'+term.aliases.map(esc).join(' · ')+'</p>';
    if(activeView==='analogy')panel='<div class="term-card"><h3>'+esc(term.analogy.title)+'</h3><p>'+esc(term.analogy.description)+'</p></div>';
    if(activeView==='steps')panel='<div class="term-step-nav">'+term.steps.map((step,i)=>'<button type="button" class="term-step-dot" data-step="'+i+'" aria-label="第'+(i+1)+'步：'+esc(step.title)+'"'+(i===stepIndex?' aria-current="step"':'')+'>'+(i+1)+'</button>').join('')+'<small>一步一步看 · '+(stepIndex+1)+' / '+term.steps.length+'</small></div><div class="term-card term-step-card"><p class="eyebrow">STEP '+(stepIndex+1)+'</p><h3>'+esc(term.steps[stepIndex].title)+'</h3><p>'+esc(term.steps[stepIndex].description)+'</p></div><div class="term-step-actions"><button type="button" class="btn" id="term-step-prev"'+(stepIndex===0?' disabled':'')+'>← 上一步</button><button type="button" class="btn primary" id="term-step-next"'+(stepIndex===term.steps.length-1?' disabled':'')+'>下一步 →</button></div>';
    if(activeView==='example'){
      const example=term.example;panel='<h3>'+esc(example.title)+'</h3>';
      if(example.input||example.output)panel+='<div class="term-example-box">'+(example.input?'<div class="term-example-row"><b>示例输入 / 场景</b>'+esc(example.input)+'</div>':'')+(example.output?'<div class="term-example-row"><b>示例结果</b>'+esc(example.output)+'</div>':'')+'</div>';
      if(example.code)panel+='<pre class="term-example-code"><code>'+esc(example.code)+'</code></pre>';
      panel+='<p>'+esc(example.explanation)+'</p>';
    }
    const kind=demoKind(term);if(kind&&(activeView==='plain'||activeView==='steps'))panel+=demoMarkup(kind);
    const sources=term.sources.map(source=>source.url?'<a href="'+esc(source.url)+'" target="_blank" rel="noopener noreferrer">'+esc(source.title)+' ↗</a>':'<a href="#'+esc(source.target||'chapter-'+term.chapters[0].split('.')[1])+'" data-term-source>'+esc(source.section)+' · 原笔记</a>').join('');
    body.innerHTML='<div class="term-tabs" role="tablist" aria-label="术语讲解方式">'+views.map(([id,label])=>'<button type="button" class="term-tab" role="tab" id="term-tab-'+id+'" data-view="'+id+'" aria-controls="term-panel" aria-selected="'+(id===activeView)+'" tabindex="'+(id===activeView?'0':'-1')+'">'+label+'</button>').join('')+'</div><section class="term-panel" id="term-panel" role="tabpanel" aria-labelledby="term-tab-'+activeView+'" tabindex="0">'+panel+'</section><section class="term-pitfalls"><h3>别把它理解成这些意思</h3><ul>'+term.pitfalls.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul></section><details class="term-sources"><summary>解释依据与延伸阅读</summary>'+sources+'</details><div class="term-footer"><button type="button" class="btn" id="term-browse-back">查看其他术语 →</button></div>';
    body.querySelectorAll('[data-view]').forEach(button=>{
      button.addEventListener('click',()=>{activeView=button.dataset.view;renderDetail(true)});
      button.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();const i=views.findIndex(([id])=>id===activeView);activeView=views[event.key==='Home'?0:event.key==='End'?3:(i+(event.key==='ArrowRight'?1:3))%4][0];renderDetail(true)});
    });
    body.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>setStep(Number(button.dataset.step))));
    document.getElementById('term-step-prev')?.addEventListener('click',()=>setStep(stepIndex-1));document.getElementById('term-step-next')?.addEventListener('click',()=>setStep(stepIndex+1));
    document.getElementById('term-browse-back').addEventListener('click',()=>openBrowse(browseScope));body.querySelectorAll('[data-term-source]').forEach(a=>a.addEventListener('click',close));
    if(kind&&(activeView==='plain'||activeView==='steps'))bindDemo(kind);
    if(focusView)document.getElementById('term-tab-'+activeView).focus({preventScroll:true});
  }
  function setStep(index){stepIndex=Math.max(0,Math.min(activeTerm.steps.length-1,index));renderDetail();body.querySelector('[data-step="'+stepIndex+'"]').focus({preventScroll:true})}
  const candidates=['候选 A','候选 B','候选 C','候选 D'];
  const baseProbabilities=[.5,.3,.15,.05];
  function distribution(kind,value){
    if(kind==='temperature'){
      const weights=baseProbabilities.map(p=>Math.log(p)/value),max=Math.max(...weights);
      const unnormalized=weights.map(w=>Math.exp(w-max)),sum=unnormalized.reduce((a,b)=>a+b,0);
      return unnormalized.map(w=>w/sum);
    }
    let cumulative=0;
    const kept=baseProbabilities.map(p=>{const keep=cumulative+1e-12<value;if(keep)cumulative+=p;return keep?p:0});
    return kept.map(p=>p/cumulative);
  }
  function demoMarkup(kind){
    const temperature=kind==='temperature',label=temperature?'temperature':'top_p',value=demoValues[kind];
    return '<section class="term-sim" aria-label="'+label+' 概率演示"><h3>拖动看看：'+label+' 怎样改变候选概率</h3><p class="sim-note">教学假设：四个候选的原始概率为 50%、30%、15%、5%。这里的数值演示不调用真实模型；滑块范围仅供教学。</p><label class="term-sim-control" for="sim-value">'+label+' 演示值 <output id="sim-value-label" for="sim-value">'+value.toFixed(2)+'</output></label><input id="sim-value" type="range" min="'+(temperature?'.25':'.05')+'" max="'+(temperature?'2':'1')+'" step=".05" value="'+value+'" aria-label="'+label+' 演示值"><div class="sim-bars" id="sim-bars"></div><p class="sim-summary" id="sim-summary"></p><div class="sim-actions"><button type="button" class="btn primary" id="sim-draw">模拟抽取一次</button><button type="button" class="btn" id="sim-reset">恢复默认值</button></div><p class="sim-sample" id="sim-sample" role="status" aria-live="polite">点击按钮，按当前概率随机抽取一个候选。</p><p class="sim-note">调参数改变选择方式；它不增加知识，也不能保证结果正确。此演示一次只改变一个参数。</p></section>';
  }
  function bindDemo(kind){
    const slider=document.getElementById('sim-value');
    function update(){
      const value=demoValues[kind],probabilities=distribution(kind,value);
      document.getElementById('sim-value-label').textContent=value.toFixed(2);
      slider.setAttribute('aria-valuetext',value.toFixed(2));
      document.getElementById('sim-bars').innerHTML=probabilities.map((p,i)=>'<div class="sim-row'+(p===0?' excluded':'')+(i===sampled?' sampled':'')+'"><span>'+candidates[i]+'</span><div class="sim-bar-track"><span class="sim-bar" style="width:'+(p*100).toFixed(4)+'%"></span></div><b class="sim-weight">'+(p*100).toFixed(1)+'%</b></div>').join('');
      document.getElementById('sim-summary').textContent=kind==='temperature'?(value===1?'T = 1：概率保持 50 / 30 / 15 / 5。':value<1?'T < 1：高概率候选更突出，分布更集中。':'T > 1：低概率候选获得更多机会，分布更平缓。'):'保留累计原始概率达到 '+(value*100).toFixed(0)+'% 的最小候选集合（'+probabilities.filter(p=>p>0).length+' 项），再将保留项重新归一化。';
      document.getElementById('sim-sample').textContent=sampled<0?'点击按钮，按当前概率随机抽取一个候选。':'这次模拟抽到：'+candidates[sampled]+'。每次抽取独立，单次结果不代表长期比例。';
      return probabilities;
    }
    slider.addEventListener('input',()=>{demoValues[kind]=Number(slider.value);sampled=-1;update()});
    document.getElementById('sim-reset').addEventListener('click',()=>{demoValues[kind]=kind==='temperature'?1:.8;slider.value=demoValues[kind];sampled=-1;update()});
    document.getElementById('sim-draw').addEventListener('click',()=>{
      const probabilities=distribution(kind,demoValues[kind]),draw=Math.random();let sum=0;
      sampled=probabilities.findIndex(p=>{sum+=p;return p>0&&draw<sum});
      if(sampled<0)sampled=probabilities.findLastIndex(p=>p>0);update();
    });
    update();
  }
})();
