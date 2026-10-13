import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {partitionSources,originalItems,markdownText} from './exercise-source.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const sourceDir=path.join(dir,'../../lesson-notes/chapter-02');
const files=['第二章 学习笔记：让 Agent 从“会回答”走向“能安全做事”.md','第二章笔记附录四的练习题和答案.md'];
const sources=files.map(f=>fs.readFileSync(path.join(sourceDir,f),'utf8').replace(/^\uFEFF/,''));
const {spans}=partitionSources(sources);
const items=originalItems(sources);
// Rubrics are supplemental study aids; the original answer remains verbatim apart
// from Markdown presentation markers. All references target retained teaching.
const spec=[
 [1,1,'一、Function Calling 到底解决什么问题？','说清模型产生的是工具名称、候选参数、调用 ID','指出应用接收 Tool Call，Runtime 在执行前校验和授权','说明通过治理后才由 handler 执行，申请不等于已执行'],
 [1,1,'二、Tool、Tool Call 和 handler 有什么区别？','区分面向模型的 Schema 与面向基础设施的 ToolDefinition','说明 handler 面向业务系统执行确定动作','指出模型不能看到密钥、连接和内部权限配置'],
 [1,2,'三、Input、Output 和 Error Schema 分别有什么用？','指出模型输出不可信且可能受提示注入影响','说明身份、租户、角色、审批必须来自可信服务端','区分候选业务参数与可信授权事实'],
 [1,2,'四、为什么 tool_call_id 不能丢？','区分工具调用 ID、整条调用链 trace_id 和业务对象 ID','说明一次任务可有多个调用、多个调用可操作同一业务对象','指出 tool_call_id 不能代替跨调用的业务幂等键'],
 [2,2,'四、为什么需要“发现 + 快照”？','说明 Registry 管理工具和版本','说明发现根据职责、身份、模式、启停和依赖筛选候选','说明模型选择候选仍不等于获得执行授权'],
 [2,3,'四、为什么需要“发现 + 快照”？','说明先路由与灰度选择版本，再冻结 Snapshot','指出 Schema 与 handler 必须使用同一已选版本','能解释 v1 参数被 v2 执行导致版本漂移的后果'],
 [2,3,'四、为什么需要“发现 + 快照”？','说明发现时剔除不可用能力，避免围绕它规划','说明执行前复查停用、权限撤回或依赖失效','指出 Snapshot 的版本冻结不能绕过最新安全限制'],
 [2,3,'五、invoke() 为什么要分成 prepare、execute、finalize？','说明 prepare 校验、可信上下文和授权先于 execute','说明 finalize 校验、脱敏、审计、包装先于回写','能说明晚检查权限、晚脱敏、重新查全局注册表的具体后果'],
 [3,2,'一、MCP 解决什么，不解决什么？','区分 Function Calling 提出意图与 MCP 接入能力','说明 Runtime 实施每次调用的确定性治理','说明 Loop 依结果持续决策、等待审批、询问或结束'],
 [3,2,'三、Tool、Resource 和 Prompt 怎样选择？','说明 Tool 用于带参数的查询或动作','说明 Resource 用于稳定 URI 的只读上下文','说明 Prompt 是用户选用的模板，不能替代业务授权'],
 [3,3,'六、为什么远端工具必须先适配成内部 ToolDefinition？','说明统一 ToolDefinition 后本地与远端共用治理入口','说明 Adapter 负责限定名、协议、错误和结果转换','指出 Loop 不应为每个 Server 绕过 Runtime 特判执行'],
 [4,2,'2. 白名单、RBAC 和人工确认不能合成一个判断','区分工具可用范围、主体业务权限和具体资源授权','说明人工审批确认的是有资格主体的一次高风险动作','指出审批不能替代权限，业务权限不能替代资源归属检查'],
 [4,3,'5. 审批为什么必须绑定参数？','说明审批绑定主体、租户、工具、参数摘要、有效期和使用状态','指出改参后旧审批失效，使用后不能再授权新的执行','说明并发下需原子校验与消费，防止重复执行'],
 [4,3,'3. 工具重试和模型重试有什么区别？','说明 Runtime 重试保持工具、参数、意图不变以恢复明确瞬时故障','说明 Loop 可改参数、切工具、调整计划或询问用户','指出权限和参数问题不能原样重试，且各层共用预算避免次数相乘'],
 [4,4,'3. 工具重试和模型重试有什么区别？','说明超时只是没及时收到结果，不能推出未执行','说明非幂等写返回 TIMEOUT_UNKNOWN 后应查状态、对账或人工介入','说明可靠幂等键、去重表或唯一约束是受控重试的重要条件'],
 [4,3,'2. SQL 和 Shell 为什么不能原样交给模型？','说明 Sandbox 约束进程、文件、网络和系统资源','说明权限治理判断主体是否能执行具体业务动作','能解释沙箱内仍可能经获准 API 发起越权请求，二者需配合'],
 [3,3,'七、MCP 结果为什么不能原样回灌模型？','说明限长、脱敏和归一化分别控制体积、泄漏与协议稳定','说明保留来源和原 tool_call_id','说明外部文本只是数据，不能赋予指令权限'],
 [5,3,'七、Audit 与 Trace 怎样分工？','区分 Trace 的路径耗时失败与 Audit 的身份规则动作证据','说明二者经任务和调用 ID 关联且策略放行不等于业务成功','指出审计故障不能把已成功业务改写为失败并诱发重试'],
 [4,4,'六、八项安全测试怎样证明治理有效？','说明返回拒绝错误不代表动作未执行','同时验证结果协议、handler 调用次数和真实副作用证据','说明拒绝时 handler 零调用、副作用为零且保留调用 ID'],
 [5,4,'六、MCP 工具怎样进入同一条治理链？','说明各来源转成 ToolDefinition，经 Registry、Snapshot、统一 invoke','用相同契约测试覆盖非法参数、越权、缺审批和停用的副作用前拒绝','用调用探针及关联审计、Trace 证明不存在绕行入口'],
 [5,4,'一、这一阶段最终交付什么？','画出 Gateway、Model、Tool Call、Snapshot、Runtime、Policy/Approval、Handler/MCP、Tool Result、Loop 主链','说明模型提议、Runtime 副作用前治理、handler 执行的边界','说明 MCP 外部接入与 Loop 根据结果继续决策的边界'],
 [5,5,'九、阶段二最终验收清单','核验可信身份不可伪造、同一 Snapshot、所有入口统一 invoke','核验无幂等写操作不因超时盲重试，各工具来源共用治理链','核验调用 ID、结果及日志脱敏、Audit/Trace 关联，并提交测试证据'],
 [5,5,'3. 审查验收','识别权限检查在副作用之后、各层重复重试两类问题','识别写超时误判失败、敏感信息进入模型或日志两类问题','识别仅检查错误文本而不查副作用、丢失原调用 ID 两类问题'],
];
const next=[10,10,10,10,10];
const questions=items.map((item,i)=>{
 const [chapter,level,heading,...points]=spec[i];
 const order=++next[chapter-1];
 const q={id:`2.${chapter}-${String(order).padStart(2,'0')}`,order,level,type:'short',title:markdownText(item.promptMarkdown),prompt:markdownText(item.promptMarkdown),referenceAnswer:markdownText(item.answerMarkdown),explanation:'原笔记开放题。先独立说明因果、边界及证据，再对照原参考答案自评；以下评分要点为依据本章正文补充的学习辅助，不是原文评分标准。',rubric:points.map((point,j)=>({point,score:[3,4,3][j]})),sourceRefs:[`2.${chapter}／${heading}`],sourceKind:'original',sourceLabel:'原笔记练习',originalKey:item.key,originalNumber:item.originalNumber,originalPromptMarkdown:item.promptMarkdown,originalAnswerPromptMarkdown:item.answerPromptMarkdown,originalAnswerMarkdown:item.answerMarkdown,originalSourceFile:files[1],originalSection:item.key.startsWith('review-')?'一、复习题与参考答案':'三、阶段二项目：题目与验收答案'};
 if(item.key==='review-1'){
  q.originalAdditionalPrompts=[spans.find(s=>s.key==='section-2.1-outcome').raw];
  q.alternatePrompts=[markdownText(q.originalAdditionalPrompts[0])];
 }
 if(item.key==='project-oral'){
  const span=spans.find(s=>s.key==='section-2.5-oral');
  q.originalAdditionalPrompts=[span.raw];
  q.alternatePrompts=['画出完整业务流程图，并说清 Function Calling、MCP、Runtime、Handler 的边界。'];
  q.code=span.raw.match(/```Plaintext\r?\n([\s\S]*?)\r?\n```/)[1];
  q.explanation+=' 2.5“口头验收”与本题要求相同，已合并来源并保留原流程代码。';
 }
 if(item.key==='project-code')q.explanation='原答案仅写“参考项目二代码”，未提供唯一完整实现。本题保留这条原答案；评分要点补充依据 2.5“阶段二最终验收清单”。请结合自己的实现与测试证据自评，不把补充要点当作原文给出的完整代码答案。';
 return q;
});
fs.writeFileSync(path.join(dir,'original-exercises.json'),JSON.stringify(questions,null,2));
const bank=JSON.parse(fs.readFileSync(path.join(dir,'quiz-bank.json'),'utf8').replace(/^\uFEFF/,''));
for(const l of bank.lessons){l.questions=l.questions.filter(q=>q.sourceKind!=='original');if(l.questions.length!==10)throw Error('Generated base questions changed');l.questions.push(...questions.filter(q=>q.id.startsWith(l.number+'-')));}
bank.title='第二章 2.1～2.5 自测与原笔记练习';
fs.writeFileSync(path.join(dir,'quiz-bank.json'),JSON.stringify(bank,null,2));
const migration={version:1,chapter:2,generatedQuestions:50,originalQuestions:23,totalQuestions:73,questionsPerLesson:next,sourceFiles:files.map((file,i)=>({file,sha256:crypto.createHash('sha256').update(Buffer.from(sources[i])).digest('hex')})),deduplication:'保留原有50题的ID及题序。原开放题要求完整解释，与已有选择题或扩展情境题考查方式不同，故不删除。仅把主笔记附录四与答案文件同题、2.5口头验收与项目口头题合并来源。2.1学完应讲清的一句话关联复习第1题。主附录漏列16、20题，按独立答案文件补齐。',retainedBoundary:'保留教学型问句、学习能力表格、八项安全测试说明/表格/断言代码、阶段二代码验收和审查清单；它们解释工程通过标准。移除附录四题单、独立答案全文及2.5口头题小节，2.1学完应讲清的问题亦迁入自测。',removedSpans:spans.map(s=>({...s,sourceFile:files[s.sourceIndex],sha256:crypto.createHash('sha256').update(s.raw).digest('hex'),destinations:s.questionKeys.map(key=>questions.find(q=>q.originalKey===key).id)})),items:items.map((item,i)=>({key:item.key,originalNumber:item.originalNumber,newQuestionId:questions[i].id,destination:questions[i].id.split('-')[0]+' 本节自测',sourceFile:files[1],mainAppendixPresent:item.mainAppendixPresent,promptMarkdown:item.promptMarkdown,answerMarkdown:item.answerMarkdown,sourceRaw:item.raw,mergeBasis:item.key==='project-oral'?'主笔记口头验收与独立答案口头题要求同一流程和层边界':item.key==='review-1'?'主附录与答案同题；2.1学习结果询问同一申请与执行边界':item.mainAppendixPresent?'主附录与独立答案同题合并一次':'独立答案文件补全的原题，新增到相应节'}))};
fs.writeFileSync(path.join(dir,'exercise-migration.json'),JSON.stringify(migration,null,2));
console.log(JSON.stringify({questions:questions.length,perLesson:next,total:next.reduce((a,b)=>a+b,0),removedSpans:spans.map(s=>s.key)}));
