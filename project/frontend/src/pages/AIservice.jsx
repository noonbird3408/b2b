import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { analyzeDataWithAI, fetchDashboardInsights } from '../api';

// v8.1: 화면에 들어오자마자 AI 를 호출하던 동작(무료 사용량 소모·429 위험) → 버튼을 눌렀을 때만 호출
// AI 가 꺼져 있거나 실패해도 서버 집계(인사이트)로 만든 기본 리포트를 보여 줘서 시연이 끊기지 않습니다.

const SUGGESTIONS = [
  '수업별 출석 요약해 줘',
  '출석률이 떨어진 반과 이유',
  '이번 주 미납 관리 계획',
  '관심이 필요한 학생 정리',
  '학부모 공지 초안 써 줘',
];

const pct = (v) => (v == null ? '–' : `${v}%`);
const won = (v) => `${Number(v || 0).toLocaleString()}원`;

/** AI 없이 서버 집계만으로 만든 리포트 (정의는 대시보드와 동일) */
function basicReport(ins) {
  if (!ins) return '집계 데이터를 불러오지 못했습니다.';
  const a = ins.attendance || {}, b = ins.billing || {}, m = ins.members || {}, r = ins.revenue || {};
  const lines = [
    `### 📊 운영 데이터 요약 (${ins.today})`,
    '',
    '| 지표 | 값 |',
    '|---|---|',
    `| 재원생 | ${m.active}명 (이번 달 +${m.new_this_month} / −${m.left_this_month}) |`,
    `| 오늘 출석률 | ${pct(a.today?.rate)} (출석 ${a.today?.present ?? 0} · 지각 ${a.today?.late ?? 0} · 결석 ${a.today?.absent ?? 0}) |`,
    `| 최근 30일 출석률 | ${pct(a.rate_30d)}${a.rate_change != null ? ` (직전 30일 대비 ${a.rate_change > 0 ? '+' : ''}${a.rate_change}%p)` : ''} |`,
    `| 이달 수납률 | ${pct(b.collection_rate)} (${won(b.month_collected)} / ${won(b.month_billed)}) |`,
    `| 미납 | ${b.unpaid_count ?? 0}건 · ${won(b.unpaid_total)} (연체 학생 ${b.overdue_members ?? 0}명) |`,
    `| 이번 달 매출 | ${won(r.this_month)}${r.change_rate != null ? ` (전월 대비 ${r.change_rate > 0 ? '+' : ''}${r.change_rate}%)` : ''} |`,
    `| 학부모 포털 활성(7일) | ${ins.parents?.active_7d ?? 0} / 연결 ${ins.parents?.linked_accounts ?? 0}계정 |`,
    '',
  ];
  const lowClasses = (ins.classes || []).filter((c) => c.rate_30d != null && c.rate_30d < 80);
  const todo = [];
  if ((ins.risk_students || []).length) todo.push(`이탈 위험 학생 ${ins.risk_students.length}명 — 대시보드의 '이탈 위험' 카드에서 사유 확인 후 보호자 상담`);
  if (b.overdue_members) todo.push(`연체 ${b.overdue_members}명 — 수납·청구 화면에서 학부모 알림 발송 또는 현장 수납`);
  if (lowClasses.length) todo.push(`출석률 80% 미만 반: ${lowClasses.map((c) => `${c.name}(${c.rate_30d}%)`).join(', ')}`);
  if (a.today?.unchecked) todo.push(`오늘 미체크 ${a.today.unchecked}명 — 출석 체크 또는 키오스크 확인`);
  lines.push('**오늘 할 일**', '', ...(todo.length ? todo.map((t) => `- ${t}`) : ['- 특별히 조치가 필요한 항목이 없습니다. 👍']));
  return lines.join('\n');
}

/** AI 에 보낼 집계 요약 — 학생 이름·연락처 없이 숫자만 */
function aggregateContext(ins) {
  if (!ins) return null;
  return {
    기준일: ins.today,
    members: ins.members,
    attendance: { today: ins.attendance?.today, rate_30d: ins.attendance?.rate_30d, rate_prev_30d: ins.attendance?.rate_prev_30d,
      this_week: ins.attendance?.this_week, last_week: ins.attendance?.last_week },
    classes: (ins.classes || []).map((c) => ({ class: c.name, students: c.enrolled, rate_30d: c.rate_30d, scheduled_today: c.scheduled_today })),
    billing: ins.billing,
    revenue: ins.revenue,
    risk_student_count: (ins.risk_students || []).length,
    parents: ins.parents,
    definitions: ins.definitions,
  };
}

const STYLES = `
.ai-wrap{display:flex;flex-direction:column;height:calc(100dvh - 128px);min-height:420px;}
.ai-top{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.ai-top h2{margin:0;}
.ai-status{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--surface);padding:6px 10px;border-radius:10px;border:1px solid var(--border);}
.ai-panel{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
.ai-messages{flex:1;min-height:0;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:14px;background:var(--surface-2);overscroll-behavior:contain;}
.ai-msg{display:flex;}
.ai-msg.user{justify-content:flex-end;}
.ai-msg.system{justify-content:center;}
.ai-bubble{max-width:min(760px,88%);padding:12px 16px;border-radius:14px;line-height:1.65;font-size:13.5px;word-break:break-word;}
.ai-msg.user .ai-bubble{background:var(--primary);color:#fff;border-radius:14px 4px 14px 14px;white-space:pre-wrap;}
.ai-msg.assistant .ai-bubble{background:var(--surface);border:1px solid var(--border);border-radius:4px 14px 14px 14px;}
.ai-msg.system .ai-bubble{background:var(--gray-soft);color:var(--text-2);font-size:12.5px;}
.ai-bubble table{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0;}
.ai-bubble th,.ai-bubble td{border:1px solid var(--border);padding:5px 8px;text-align:left;}
.ai-bubble h3{font-size:15px;margin:2px 0 8px;}
.ai-bubble p{margin:6px 0;}
.ai-bubble ul{margin:6px 0;padding-left:20px;}
.ai-bottom{flex:0 0 auto;border-top:1px solid var(--border);background:var(--surface);padding:10px 12px 12px;}
.ai-suggest{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;}
.ai-suggest::-webkit-scrollbar{display:none;}
.ai-form{display:flex;gap:8px;}
.ai-form textarea{flex:1;resize:none;min-height:42px;max-height:120px;border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:14px;}
@media(max-width:900px){.ai-wrap{height:calc(100dvh - 190px);}}
@media(max-width:600px){.ai-wrap{height:calc(100dvh - 170px);}.ai-messages{padding:12px;}.ai-bubble{max-width:94%;}.ai-status .hide-sm{display:none;}}
`;

function AIservice() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState(null);
  const [dbUnavailable, setDbUnavailable] = useState(false);
  const [includeDb, setIncludeDb] = useState(true);
  const [uploadedData, setUploadedData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [aiAvailable, setAiAvailable] = useState(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // 대화가 길어져도 위(상태)·아래(입력)는 고정, 가운데 목록만 스크롤
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, isLoading]);
  useEffect(() => {
    fetchDashboardInsights()
      .then((data) => {
        setInsights(data);
        setDbUnavailable(false);
        // 들어오자마자 AI 호출 없이 서버 집계로 만든 데이터 요약을 보여 줌
        setMessages([{ role: 'assistant', content: basicReport(data) }]);
      })
      .catch(() => {
        setDbUnavailable(true);
        setMessages([{ role: 'system', content: '운영 데이터를 불러오지 못했습니다. 질문은 계속할 수 있습니다.' }]);
      });
  }, []);

  const ask = async (question, { report = false } = {}) => {
    if (isLoading || !question.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setIsLoading(true);
    try {
      const context = { insights: aggregateContext(insights), ...(uploadedData ? { uploaded_files: uploadedData } : {}) };
      const answer = await analyzeDataWithAI(question, context, { includeDb });
      setAiAvailable(true);
      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (error) {
      const disabled = /비활성|503/.test(error.message || '');
      if (disabled) setAiAvailable(false);
      setMessages((prev) => [...prev,
        { role: 'system', content: `⚠️ ${error.message || 'AI 응답을 받지 못했습니다.'}` },
        ...(report || disabled ? [{ role: 'assistant', content: basicReport(insights) }] : []),
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) return alert('1MB 이하의 CSV/JSON 파일만 올릴 수 있습니다.');
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = file.name.endsWith('.json') ? JSON.parse(event.target.result) : event.target.result;
        setUploadedData(parsed);
        setFileName(file.name);
        setMessages((prev) => [...prev, { role: 'system', content: `📁 ${file.name} 을(를) 분석 자료에 추가했습니다.` }]);
      } catch {
        alert('파일을 읽지 못했습니다. JSON 형식을 확인해 주세요.');
      }
    };
    reader.readAsText(file);
  };

  const submit = (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    ask(text);
  };

  return (
    <div className="ai-wrap">
      <style>{STYLES}</style>
      <div className="ai-top">
        <h2 className="page-title">AI 비서</h2>
        <div className="ai-status">
          <span className={`badge ${insights ? 'success' : dbUnavailable ? 'danger' : 'gray'} no-dot`}>
            {insights ? 'DB 연동 완료' : dbUnavailable ? 'DB 연결 실패' : 'DB 확인 중'}
          </span>
          {aiAvailable === false && <span className="badge warning no-dot">AI 꺼짐</span>}
          <label className="hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }} title="학생·출결 자료를 가명화해서 함께 보냅니다">
            <input type="checkbox" checked={includeDb} onChange={(e) => setIncludeDb(e.target.checked)} /> DB 요약 포함
          </label>
          {uploadedData && <span className="badge gray no-dot">📎 {fileName}</span>}
          <label htmlFor="ai-file-upload" className="btn ghost sm" style={{ margin: 0 }}>📁 추가 업로드</label>
          <input id="ai-file-upload" type="file" accept=".csv,.json" onChange={handleFileUpload} style={{ display: 'none' }} />
        </div>
      </div>

      <div className="ai-panel">
        <div className="ai-messages" ref={listRef} aria-live="polite">
          {messages.length === 0 && <div className="fl-skeleton" style={{ height: 160 }} />}
          {messages.map((msg, index) => (
            <div key={index} className={`ai-msg ${msg.role}`}>
              <div className="ai-bubble">
                {msg.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown> : msg.content}
              </div>
            </div>
          ))}
          {isLoading && <div className="ai-msg assistant"><div className="ai-bubble">📊 분석 중…</div></div>}
        </div>

        <div className="ai-bottom">
          <div className="ai-suggest">
            <button type="button" className="chip active" onClick={() => ask('현재 운영 데이터로 핵심 지표 요약, 눈에 띄는 변화, 이번 주 할 일 3가지를 표와 목록으로 정리해 줘.', { report: true })} disabled={isLoading}>✨ 운영 리포트</button>
            {SUGGESTIONS.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => ask(q)} disabled={isLoading}>{q}</button>
            ))}
          </div>
          <form className="ai-form" onSubmit={submit}>
            <textarea ref={inputRef} rows={1} maxLength={2000} value={input} disabled={isLoading}
              placeholder={isLoading ? '응답을 만드는 중입니다…' : '무엇이든 물어보세요 (Enter 전송, Shift+Enter 줄바꿈)'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
            <button className="btn" type="submit" disabled={isLoading || !input.trim()}>보내기</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AIservice;
