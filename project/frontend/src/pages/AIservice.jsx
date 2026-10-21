import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { analyzeDataWithAI } from '../api';

function AIservice() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '안녕하세요! 학원 관리 시스템의 AI 분석 비서입니다. 원생 통계, 출석률, 수납 내역 등 분석할 데이터를 업로드하시거나 궁금한 점을 자유롭게 물어보세요!' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // 파일 업로드 및 DB 상태(State)
  const [uploadedData, setUploadedData] = useState(null);
  const [fileName, setFileName] = useState('');
  // DB 요약은 서버가 직접 만들어 가명화한 뒤 AI 에 전달합니다(includeDb). 프론트는 원생 데이터를 내려받지 않습니다.
  const [isDbLoaded, setIsDbLoaded] = useState(false);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  
  // Strict Mode로 인한 중복 호출 방지용 레퍼런스(Reference)
  const isInitialized = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 컴포넌트(Component) 마운트(Mount) 시 DB 데이터 로드 및 초기 요약
  useEffect(() => {
    // 이미 초기화가 진행되었다면 중단 (API 중복 호출 방지)
    if (isInitialized.current) return;
    isInitialized.current = true;

    const initializeDBAndSummarize = async () => {
      try {
        setIsLoading(true);
        setIsDbLoaded(true);

        setMessages(prev => [...prev, {
          role: 'system',
          content: '🔄 시스템: 학원 데이터베이스(DB)와 성공적으로 연동되었습니다. AI가 데이터를 분석하는 중입니다...'
        }]);

        const initialPrompt = "현재 학원의 원생(Members), 수업(Classes), 출석(Attendances) 데이터를 기반으로 전체적인 학원 운영 현황을 요약하고, 의미 있는 통계나 인사이트를 한눈에 보기 좋게 정리해줘.";
        
        const aiSummary = await analyzeDataWithAI(initialPrompt, null, { includeDb: true });
        
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `[📊 DB 데이터 학습 및 초기 분석 리포트]\n\n${aiSummary}` 
        }]);

      } catch (error) {
        console.error("[DB 초기화 에러]:", error);
        
        // 429 에러(한도 초과)인지 확인하여 친절한 메시지 출력
        let errorMessage = '❌ 시스템: 데이터베이스(DB) 정보를 불러오거나 분석하는 데 실패했습니다.';
        if (error.message && error.message.includes('429')) {
          errorMessage = '⚠️ 시스템: AI API 무료 사용량(Quota)을 초과했습니다. 약 1분 후에 새로고침하여 다시 시도해 주세요.';
        }

        setMessages(prev => [...prev, {
          role: 'system',
          content: errorMessage
        }]);
      } finally {
        setIsLoading(false);
      }
    };

    initializeDBAndSummarize();
  }, []); 

  // 파일 업로드 핸들러(Handler)
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        let parsedData;
        if (file.name.endsWith('.json')) {
          parsedData = JSON.parse(event.target.result);
        } else {
          parsedData = event.target.result; 
        }
        setUploadedData(parsedData);
        setMessages(prev => [...prev, { 
          role: 'system', 
          content: `📁 시스템: [${file.name}] 데이터가 성공적으로 분석 컨텍스트(Context)에 로드되었습니다.` 
        }]);
      } catch (error) {
        alert('파일 데이터를 읽는 중 오류가 발생했습니다.');
      }
    };
    reader.readAsText(file);
  };

  // 메시지 전송 핸들러(Handler)
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 0);

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const contextPayload = uploadedData ? { uploaded_files: uploadedData } : null;
      const aiResponse = await analyzeDataWithAI(userMessage, contextPayload, { includeDb: isDbLoaded });
      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
    } catch (error) {
      console.error("[AI 서비스 에러 디버깅]:", error);
      
      // 사용자 메시지 전송 시 429 에러 처리
      let aiErrorMessage = '죄송합니다. 데이터를 분석하는 중에 오류가 발생했습니다. 개발자 도구(Developer Tools)를 확인해 주세요.';
      if (error.message && error.message.includes('429')) {
        aiErrorMessage = '⚠️ 질문이 너무 많거나 API 사용량을 초과했습니다. 잠시 후 다시 질문해 주세요!';
      }

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: aiErrorMessage 
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 40px)', boxSizing: 'border-box' }}>
      
      {/* 상단 헤더 영역 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <h2 className="page-title">🤖 AI 데이터 분석 서비스</h2>
          <p className="page-subtitle">학원 운영 데이터를 기반으로 인사이트(Insight)를 도출하고 자유롭게 질문해 보세요.</p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface)', padding: '6px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
          {isDbLoaded ? (
            <span className="badge" style={{ fontSize: '12px', background: 'var(--success-soft)', color: 'var(--success-text)', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
              🔗 DB 연동 완료
            </span>
          ) : (
            <span className="badge" style={{ fontSize: '12px', background: 'var(--warning-soft)', color: 'var(--warning-text)', padding: '4px 8px', borderRadius: '4px' }}>
              ⏳ DB 연결 중...
            </span>
          )}

          {uploadedData ? (
            <span className="badge primary" style={{ fontSize: '12px' }}>
              🟢 {fileName} 완료
            </span>
          ) : (
            <span className="badge gray" style={{ fontSize: '12px' }}>
              ⚪ 추가 데이터 미등록
            </span>
          )}
          
          <label htmlFor="file-upload" className="btn ghost sm" style={{ margin: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📁 추가 업로드
          </label>
          <input id="file-upload" type="file" accept=".csv, .json" onChange={handleFileUpload} style={{ display: 'none' }} />
        </div>
      </div>

      {/* 메인 대화창 패널 */}
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
                  maxWidth: '75%',
                  padding: '12px 16px',
                  borderRadius: msg.role === 'user' ? '12px 2px 12px 12px' : msg.role === 'system' ? '8px' : '2px 12px 12px 12px',
                  lineHeight: '1.6',
                  wordBreak: 'break-word'
                }}>
                  {msg.role === 'system' || msg.role === 'user' ? (
                    msg.content
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="message-wrapper assistant" style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div className="message-bubble loading" style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: '2px 12px 12px 12px' }}>
                  📊 AI가 학원 데이터를 정밀 분석하고 있습니다... (API 상태에 따라 시간이 걸릴 수 있습니다)
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
              placeholder={isLoading ? "AI가 응답을 생성하는 중입니다..." : "학습된 데이터를 바탕으로 AI에게 질문을 입력해보세요..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              style={{ flex: 1, height: '40px' }}
              disabled={isLoading}
            />
            <button className="btn" type="submit" disabled={isLoading} style={{ height: '40px', padding: '0 20px', whiteSpace: 'nowrap' }}>
              분석 요청
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default AIservice;