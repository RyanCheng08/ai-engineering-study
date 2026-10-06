"""Validate the shared question bank, exports, and legacy quiz redirect."""
from pathlib import Path
import hashlib, html, json

ROOT=Path(__file__).resolve().parent
EXPORT=ROOT.parent
NUMBERS=['1.1','1.2','1.3','1.4','1.5','1.6','1.7']
LEVELS={1:'基础',2:'理解',3:'应用',4:'分析',5:'综合'}
TYPES={'single':'单选题','multiple':'多选题','short':'分析 / 设计题'}
EXPECTED=['single','single','single','multiple','single','multiple','short','short','short','short']

def validate(lesson):
    number=lesson['number'];questions=lesson['questions']
    assert number in NUMBERS and len(questions)==10,(number,'expected ten questions')
    for i,q in enumerate(questions):
        assert q['id']==f'{number}-{i+1:02d}' and q['order']==i+1,(number,'question ordering')
        assert q['level']==i//2+1 and q['type']==EXPECTED[i],(number,q['id'],'difficulty or type')
        for field in ['title','prompt','referenceAnswer','explanation']:
            assert isinstance(q[field],str) and q[field].strip(),(q['id'],field)
        assert q['sourceRefs'] and all(isinstance(r,str) and r.strip() for r in q['sourceRefs']),(q['id'],'sources')
        if q['type']=='short':
            assert 3<=len(q['rubric'])<=5 and sum(r['score'] for r in q['rubric'])==10,(q['id'],'rubric total')
            assert all(isinstance(r['score'],int) and r['score']>0 and r['point'].strip() for r in q['rubric'])
        else:
            keys=[o['key'] for o in q['options']]
            assert keys==['A','B','C','D'] and all(o['text'].strip() for o in q['options']),(q['id'],'options')
            assert len(q['answer'])==len(set(q['answer'])) and set(q['answer'])<=set(keys)
            assert len(q['answer'])==1 if q['type']=='single' else 2<=len(q['answer'])<=3,(q['id'],'answer count')
    return lesson

def paper(lessons,answers=False):
    out=['第一章 · 70道递进测试题'+('（答案解析版）' if answers else '（题目版）'),'','范围：1.1～1.7，每节10题，每节100分。','难度：基础 → 理解 → 应用 → 分析 → 综合，每档2题。','选择题每题10分；多选须全对且无错选。分析与设计题对照评分要点自评。','']
    for l in lessons:
        out.extend(['='*60,l['number']+' '+l['title'],'='*60,''])
        for q in l['questions']:
            out.extend([q['id']+'  '+q['title']+'  ['+LEVELS[q['level']]+' · '+TYPES[q['type']]+' · 10分]',q['prompt']])
            if q.get('code'):out.extend(['',q['code']])
            if q['type']!='short':out.extend(o['key']+'. '+o['text'] for o in q['options'])
            if answers:
                out.extend(['','参考答案'+('（'+ '、'.join(q['answer'])+'）' if q['type']!='short' else '')+'：',q['referenceAnswer'],'','解析与易错点：',q['explanation']])
                if q['type']=='short':out.extend(['','评分要点（合计10分）：',*[str(r['score'])+'分：'+r['point'] for r in q['rubric']]])
                out.extend(['','复习依据：'+'；'.join(q['sourceRefs'])])
            else:out.extend(['','作答：'+'_'*45,''] if q['type']=='short' else ['','答案：______'])
            out.extend(['','-'*60,''])
    return '\n'.join(out)

def print_markup(lessons):
    esc=html.escape
    parts=['<h1>第一章 · 70道递进测试题</h1><p>1.1～1.7 · 每节10题 · 基础 → 理解 → 应用 → 分析 → 综合<br>姓名：_______________　日期：_______________</p>']
    for l in lessons:
        parts.append('<h2>'+esc(l['number']+' '+l['title'])+'</h2>')
        for q in l['questions']:
            parts.extend(['<section class="print-question"><h3>'+esc(q['id']+' '+q['title']+'（'+LEVELS[q['level']]+' · '+TYPES[q['type']]+' · 10分）')+'</h3>','<p>'+esc(q['prompt'])+'</p>'])
            if q.get('code'):parts.append('<pre>'+esc(q['code'])+'</pre>')
            if q['type']!='short':parts.extend('<p>'+esc(o['key']+'. '+o['text'])+'</p>' for o in q['options'])
            parts.append('<div class="print-space">作答：</div><div class="print-answer"><p><b>参考答案'+('：'+esc('、'.join(q['answer'])) if q['type']!='short' else '')+'</b></p><p>'+esc(q['referenceAnswer'])+'</p><p><b>解析与易错点</b></p><p>'+esc(q['explanation'])+'</p>')
            if q['type']=='short':parts.extend('<p>'+esc(str(r['score'])+'分：'+r['point'])+'</p>' for r in q['rubric'])
            parts.append('<p class="print-source">复习依据：'+esc('；'.join(q['sourceRefs']))+'</p></div></section>')
    return ''.join(parts)

def main():
    lessons=[validate(json.loads((ROOT/f'lesson-{n}.json').read_text(encoding='utf-8-sig'))) for n in NUMBERS]
    assert [l['number'] for l in lessons]==NUMBERS
    bank={'title':'第一章 · 70道递进测试题','version':1,'source':'第一章 学习笔记.md','lessons':lessons}
    data=json.dumps(bank,ensure_ascii=False)
    page=(ROOT/'quiz-redirect-template.html').read_text(encoding='utf-8')
    (EXPORT/'chapter-one-quiz.html').write_text(page,encoding='utf-8')
    (EXPORT/'第一章测试题-题目版.txt').write_text(paper(lessons),encoding='utf-8-sig')
    (EXPORT/'第一章测试题-答案解析.txt').write_text(paper(lessons,True),encoding='utf-8-sig')
    (ROOT/'question-bank.json').write_text(json.dumps(bank,ensure_ascii=False,indent=2),encoding='utf-8')
    report={'sectionCount':7,'questionCount':70,'single':28,'multiple':14,'short':28,'objectiveMaxPerSection':60,'selfAssessedMaxPerSection':40,'sourceSha256':hashlib.sha256((EXPORT.parent/'第一章 学习笔记.md').read_bytes()).hexdigest(),'perSection':[{'number':l['number'],'count':len(l['questions'])} for l in lessons]}
    (ROOT/'build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
