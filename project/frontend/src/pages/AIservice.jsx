import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { analyzeDataWithAI, fetchDashboardInsights } from '../api';

// v8.1: 화면에 들어오자마자 AI 를 호출하던 동작(무료 사용량 소모·429 위험) → 버튼을 눌렀을 때만 호출
// AI 가 꺼져 있거나 실패해도 서버 집계(인사이트)로 만든 기본 리포트를 보여 줘서 시연이 끊기지 않습니다.

const SUGGESTIONS = [
  '이번 달 운영 현황을 요약하고 개선할 점 3가지를 알려줘',
  '출석률이 낮은 반과 그 이유로 추정되는 점을 정리해줘',
  '미납 관리를 위해 이번 주에 할 일을 우선순위로 알려줘',
  '학부모 참여(포털 이용)를 늘릴 방법을 제안해줘',
];

const pct = (v) => (v == null ? '–' : `${v}%`);
const won = (v) => `${Number(v || 0).toLocaleString()}원`;

/** AI 없이 서버 집계만으로 만든 리포트 (정의는 대시보드와 동일) */
function basicReport(ins) {
  if (!ins) return '집계 데이터를 불러오지 못했습니다.';
  const a = ins.attendance || {}, b = ins.billing || {}, m = ins.members || {}, r = ins.revenue || {};
  const lines = [
    `### 📊 기본 운영 리포트 (${ins.today})`,
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
  lines.push('', '_지표 정의는 대시보드의 ⓘ 표시를 참고하세요._');
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

function AIservice() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '안녕하세요! 시설 운영 데이터를 분석하는 AI 비서입니다.\n\n아래 **운영 리포트 생성**을 누르거나 추천 질문을 골라 보세요. 학생 이름은 가명(S0001)으로 바뀌고 연락처·주소는 AI 에 전달되지 않습니다.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState(null);
  const [includeDb, setIncludeDb] = useState(true);
  const [uploadedData, setUploadedData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [aiAvailable, setAiAvailable] = useState(null);   // null=모름, true/false

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { fetchDashboardInsights().then(setInsights).catch(() => setInsights(null)); }, []);

  const ask = async (question, { report = false } = {}) => {
    if (isLoading) return;
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
        ...(report || disabled ? [{ role: 'assistant', content: `${basicReport(insights)}\n\n_(AI 대신 서버 집계로 만든 기본 리포트입니다.)_` }] : []),
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleReport = () => ask('현재 운영 데이터를 바탕으로 핵심 지표 요약, 눈에 띄는 변화, 이번 주 할 일 3가지를 표와 목록으로 정리해 줘.', { report: true });

  const handleBasicReport = () => {
    setMessages((prev) => [...prev, { role: 'user', content: '기본 리포트 보기' }, { role: 'assistant', content: basicReport(insights) }]);
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
        setMessages((prev) => [...prev, { role: 'system', content: `📁 [${file.name}] 을(를) 분석 자료에 추가했습니다. 개인정보가 있다면 올리기 전에 지워 주세요.` }]);
      } catch {
        alert('파일을 읽지 못했습니다. JSON 형식을 확인해 주세요.');
      }
    };
    reader.readAsText(file);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    ask(text);
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 40px)', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 className="page-title">🤖 AI 운영 비서</h2>
          <p className="page-subtitle">서버 집계 지표 + (선택) 가명화된 DB 요약을 근거로 답합니다.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: 'var(--surface)', padding: '6px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <span className={`badge ${aiAvailable === false ? 'danger' : aiAvailable ? 'success' : 'gray'} no-dot`} style={{ fontSize: 12 }}>
            {aiAvailable === false ? 'AI 꺼짐 · 기본 리포트 사용' : aiAvailable ? 'AI 연결됨' : 'AI 대기'}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }} title="학생·출결 원자료를 가명화해서 함께 보냅니다">
            <input type="checkbox" checked={includeDb} onChange={(e) => setIncludeDb(e.target.checked)} /> DB 요약 포함
          </label>
          <span className="badge gray no-dot" style={{ fontSize: 12 }}>{uploadedData ? `📎 ${fileName}` : '추가 자료 없음'}</span>
          <label htmlFor="file-upload" className="btn ghost sm" style={{ margin: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}>📁 자료 추가</label>
          <input id="file-upload" type="file" accept=".csv,.json" onChange={handleFileUpload} style={{ display: 'none' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn" onClick={handleReport} disabled={isLoading}>✨ 운영 리포트 생성</button>
        <button className="btn ghost" onClick={handleBasicReport} disabled={!insights}>📊 기본 리포트 (AI 없이)</button>
        {SUGGESTIONS.map((q) => (
          <button key={q} className="btn ghost sm" style={{ borderRadius: 9999 }} onClick={() => ask(q)} disabled={isLoading}>{q}</button>
        ))}
      </div>

      <div className="modal-large" style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '400px', animation: 'none', margin: 0 }}>
        <div className="chat-interface" style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', overflow: 'hidden' }}>
          <div className="chat-messages" style={{ flex: 1, background: 'var(--surface-2)', padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {messages.map((msg, index) => (
              <div key={index} className={`message-wrapper ${msg.role}`} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : msg.role === 'system' ? 'center' : 'flex-start' }}>
                <div className="message-bubble markdown-body" style={{
                  fontSize: '13.5px',
                  boxShadow: msg.role === 'assistant' ? 'var(--shadow)' : 'none',
                  border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                  background: msg.role === 'user' ? 'var(--primary)' : msg.role === 'system' ? 'var(--gray-soft)' : 'var(--surface)',
                  color: msg.role === 'user' ? '#ffffff' : 'var(--text)',
                  maxWidth: '80%',
                  padding: '12px 16px',
                  borderRadius: msg.role === 'user' ? '12px 2px 12px 12px' : msg.role === 'system' ? '8px' : '2px 12px 12px 12px',
                  lineHeight: '1.6',
                  wordBreak: 'break-word',
                }}>
                  {msg.role === 'system' || msg.role === 'user' ? msg.content : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="message-wrapper assistant" style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div className="message-bubble loading" style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: '2px 12px 12px 12px' }}>
                  📊 데이터를 분석하고 있습니다…
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form className="chat-input-area" onSubmit={handleSendMessage} style={{ borderTop: '1px solid var(--border)', padding: '16px', display: 'flex', gap: '10px', background: 'var(--surface)' }}>
            <input
              ref={inputRef}
              className="input"
              type="text"
              maxLength={2000}
              placeholder={isLoading ? 'AI가 응답을 생성하는 중입니다...' : '예: 지난주보다 출석이 줄어든 이유가 뭘까?'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              style={{ flex: 1, height: '40px' }}
              disabled={isLoading}
            />
            <button className="btn" type="submit" disabled={isLoading || !input.trim()} style={{ height: '40px', padding: '0 20px', whiteSpace: 'nowrap' }}>
              질문하기
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AIservice;
