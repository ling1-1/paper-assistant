import { useState, useEffect, useRef } from 'react';

// ── 工具函数 ──────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:0.9em;font-family:monospace">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:14px;font-weight:600;margin:14px 0 6px">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h3 style="font-size:15px;font-weight:600;margin:16px 0 7px">$1</h3>')
    .replace(/^- (.+)$/gm,   '<li style="margin:3px 0;padding-left:4px">$1</li>')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g, '<ul style="padding-left:18px;margin:8px 0">$&</ul>')
    .replace(/\n\n/g, '</p><p style="margin:0 0 10px">')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p style="margin:0 0 10px">')
    .replace(/$/, '</p>');
}

// timeAgo 用 useEffect 延迟计算，避免 SSR/CSR 不一致
function useTimeAgo(dateStr) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!dateStr) return;
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) setLabel('刚刚');
    else if (m < 60) setLabel(`${m}分钟前`);
    else if (m < 1440) setLabel(`${Math.floor(m / 60)}小时前`);
    else setLabel(`${Math.floor(m / 1440)}天前`);
  }, [dateStr]);
  return label;
}

// ── 常量 ──────────────────────────────────────────────────
const MODES = [
  { id: 'general',    icon: '🎯', label: '通用辅助',  color: '#2d4a8a' },
  { id: 'expand',     icon: '✏️',  label: '学术扩写',  color: '#1a6b3c' },
  { id: 'polish',     icon: '💎', label: '语言润色',  color: '#7c3aed' },
  { id: 'dedup',      icon: '🔄', label: '降重改写',  color: '#b45309' },
  { id: 'literature', icon: '📚', label: '文献综述',  color: '#0369a1' },
  { id: 'deai',       icon: '🤖', label: '去AI化',    color: '#be123c' },
];

const MODELS = [
  { id: 'claude',   label: 'Claude',   sub: 'Anthropic', dot: '#d97706' },
  { id: 'deepseek', label: 'DeepSeek', sub: '国内可用',   dot: '#2563eb' },
  { id: 'doubao',   label: '火山方舟', sub: '字节跳动',   dot: '#7c3aed' },
  { id: 'qwen',     label: '通义千问', sub: '阿里云',     dot: '#059669' },
];

const QUICK = [
  { label: '✏️ 扩写',   text: '请将以下内容进行学术化扩写：\n\n' },
  { label: '💎 润色',   text: '请润色以下段落，使表达更自然流畅：\n\n' },
  { label: '🔄 降重',   text: '请对以下内容进行降重改写，保持原意：\n\n' },
  { label: '🤖 去AI化', text: '请去除AI化表达，使以下内容更像人工写作：\n\n' },
  { label: '📋 给题目', text: '我的论文题目是：' },
  { label: '📚 文献',   text: '', special: 'lit' },
  { label: '🏗️ 框架',   text: '请帮我设计以下论文题目的章节框架：\n\n' },
  { label: '📝 摘要',   text: '请帮我为以下论文内容撰写摘要：\n\n' },
];

// ── 主组件 ────────────────────────────────────────────────
export default function App() {
  const [mounted, setMounted] = useState(false);   // ← 关键：避免 hydration 不一致
  const [convs,   setConvs]   = useState([]);
  const [convId,  setConvId]  = useState(null);
  const [msgs,    setMsgs]    = useState([]);
  const [input,   setInput]   = useState('');
  const [mode,    setMode]    = useState('general');
  const [model,   setModel]   = useState('claude');
  const [loading, setLoading] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [tab,     setTab]     = useState('chat');
  const [litQuery,   setLitQuery]   = useState('');
  const [litResults, setLitResults] = useState([]);
  const [litLoading, setLitLoading] = useState(false);
  const [litInject,  setLitInject]  = useState(false);
  const [copiedIdx,  setCopiedIdx]  = useState(null);
  const [charCount,  setCharCount]  = useState(0);
  const [streamingText, setStreamingText] = useState('');
  const [historyLen,    setHistoryLen]    = useState(20);

  const endRef   = useRef(null);
  const taRef    = useRef(null);
  const abortRef = useRef(null);

  // 仅在客户端挂载后渲染动态内容，彻底消除 hydration 错误
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, streamingText]);

  async function loadConvs() {
    try {
      const r = await fetch('/api/conversations');
      const d = await r.json();
      setConvs(d.conversations || []);
    } catch {}
  }

  function newConv() {
    const id = genId();
    setConvId(id);
    setMsgs([{ role: 'system', content: '你好！我是论文助手。发送需要处理的内容，或告诉我你的论文题目。' }]);
    setLitResults([]);
    setLitInject(false);
    setStreamingText('');
  }

  useEffect(() => {
    // 先加载历史对话
    loadConvs();
    // 如果是首次访问（无历史），创建新对话
    setTimeout(() => {
      if (!convId) newConv();
    }, 100);
  }, []);

  function handleInput(e) {
    const v = e.target.value;
    setInput(v);
    setCharCount(v.length);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  }

  async function doLitSearch(q) {
    const query = (q || litQuery).trim();
    if (!query) return;
    setLitLoading(true);
    try {
      const r = await fetch('/api/literature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 6 }),
      });
      const d = await r.json();
      setLitResults(d.results || []);
      if (d.results?.length > 0) setTab('lit');
    } catch (e) {
      alert('文献检索失败：' + e.message);
    } finally {
      setLitLoading(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !convId) return;

    setInput('');
    setCharCount(0);
    if (taRef.current) taRef.current.style.height = 'auto';

    setMsgs(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    setStreamingText('');
    abortRef.current = new AbortController();

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          userMessage: text,
          conversationId: convId,
          mode, model, stream: true,
          searchLit: litInject,
          litQuery: litQuery.trim(),
          historyLen,
        }),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.chunk) { full += ev.chunk; setStreamingText(full); }
            if (ev.error) throw new Error(ev.error);
            if (ev.done) {
              setStreamingText('');
              setMsgs(prev => [...prev, { role: 'assistant', content: full }]);
              if (ev.literatureResults?.length > 0) {
                setLitResults(ev.literatureResults);
                setTab('lit');
              }
              loadConvs();
            }
          } catch (pe) {
            if (pe.message !== 'Unexpected end of JSON input') console.warn(pe);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        if (streamingText) {
          setMsgs(prev => [...prev, { role: 'assistant', content: streamingText + '\n\n*（已中止）*' }]);
        }
        setStreamingText('');
      } else {
        setMsgs(prev => [...prev, { role: 'error', content: err.message }]);
      }
    } finally {
      setLoading(false);
      setStreamingText('');
    }
  }

  function stopGen() { abortRef.current?.abort(); }

  function quickAction(a) {
    if (a.special === 'lit') { setTab('lit'); return; }
    setInput(a.text);
    taRef.current?.focus();
  }

  async function copyMsg(content, idx) {
    await navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  async function delConv(id, e) {
    e.stopPropagation();
    if (!confirm('删除此对话？')) return;
    await fetch(`/api/conversations?id=${id}`, { method: 'DELETE' });
    loadConvs();
    if (id === convId) newConv();
  }

  const curMode  = MODES.find(m => m.id === mode);
  const curModel = MODELS.find(m => m.id === model);

  // 服务端渲染时只输出最简骨架，避免 hydration 不一致
  if (!mounted) {
    return <div style={{ height: '100vh', background: '#f2f0ea' }} />;
  }

  // ── JSX ─────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ══ SIDEBAR ══════════════════════════════════════ */}
      {sidebar && (
        <aside style={{
          width: 230, background: 'var(--surface)', borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
        }}>
          {/* Logo + 新建 */}
          <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9, background: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0,
              }}>📝</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>论文助手</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>AI 学术写作</div>
              </div>
            </div>
            <button onClick={newConv} style={{
              width: '100%', padding: '8px 0', borderRadius: 'var(--radius-sm)',
              background: 'var(--accent)', border: 'none', color: 'white',
              fontSize: 13, fontWeight: 500,
            }}>＋ 新建对话</button>
          </div>

          {/* 功能模式 */}
          <div style={{ padding: '10px 8px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <SectionLabel>功能模式</SectionLabel>
            {MODES.map(m => (
              <SideBtn key={m.id} active={mode === m.id} color={m.color} onClick={() => setMode(m.id)}>
                <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{m.icon}</span>
                {m.label}
                {mode === m.id && <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: m.color }} />}
              </SideBtn>
            ))}
          </div>

          {/* AI 模型 */}
          <div style={{ padding: '10px 8px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <SectionLabel>AI 模型</SectionLabel>
            {MODELS.map(m => (
              <SideBtn key={m.id} active={model === m.id} color="var(--accent)" onClick={() => setModel(m.id)}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{m.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{m.sub}</span>
              </SideBtn>
            ))}
          </div>

          {/* 历史对话 */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <SectionLabel style={{ padding: '10px 12px 5px' }}>历史对话</SectionLabel>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
              {!convs || convs.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: 12 }}>暂无历史</div>
                : convs.map(c => <ConvItem key={c.id} c={c} active={c.id === convId}
                    onClick={() => { setConvId(c.id); setMsgs([{ role: 'system', content: '已切换对话' }]); setTab('chat'); }}
                    onDelete={delConv} />)
              }
            </div>
          </div>
        </aside>
      )}

      {/* ══ MAIN ════════════════════════════════════════ */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* 顶栏 */}
        <header style={{
          height: 50, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8, flexShrink: 0,
        }}>
          <button onClick={() => setSidebar(v => !v)} style={{
            background: 'none', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '4px 8px', color: 'var(--text2)', fontSize: 15,
          }}>☰</button>

          <div style={{ display: 'flex', gap: 4 }}>
            {[['chat', '💬 对话'], ['lit', '📚 文献'], ['settings', '⚙️ 设置']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: '4px 11px', borderRadius: 6, fontSize: 12, fontWeight: tab === id ? 600 : 400,
                border: tab === id ? 'none' : '1px solid var(--border)',
                background: tab === id ? 'var(--accent)' : 'transparent',
                color: tab === id ? 'white' : 'var(--text2)',
              }}>{label}</button>
            ))}
            <a href="/translate" target="_blank" style={{
              padding: '4px 11px', borderRadius: 6, fontSize: 12, fontWeight: 400,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text2)',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>🌐 翻译</a>
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {litInject && (
              <span style={{
                fontSize: 11, padding: '3px 9px', borderRadius: 20,
                background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid var(--amber-border)',
              }}>📚 文献注入中</span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              {curMode?.icon} {curMode?.label} · {curModel?.label}
            </span>
          </div>
        </header>

        {/* ── 对话面板 ───────────────────────────────── */}
        {tab === 'chat' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 8px' }}>
              <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {msgs.map((msg, i) => (
                  <MsgBubble key={i} msg={msg} idx={i} copiedIdx={copiedIdx} onCopy={copyMsg} />
                ))}

                {/* 流式输出 */}
                {streamingText && (
                  <div className="msg-in" style={{ display: 'flex', gap: 9 }}>
                    <Avatar label="助" />
                    <div style={{
                      flex: 1, padding: '11px 14px', background: 'var(--surface)',
                      border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px',
                      fontSize: 14, lineHeight: 1.7,
                    }}>
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }} />
                      <span className="cursor-blink" />
                    </div>
                  </div>
                )}

                {/* 等待指示器 */}
                {loading && !streamingText && (
                  <div style={{ display: 'flex', gap: 9 }}>
                    <Avatar label="助" />
                    <div style={{
                      padding: '12px 16px', background: 'var(--surface)',
                      border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px',
                      display: 'flex', gap: 4, alignItems: 'center',
                    }}>
                      <span className="dot" /><span className="dot" /><span className="dot" />
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </div>

            {/* 输入区 */}
            <div style={{
              background: 'var(--surface)', borderTop: '1px solid var(--border)',
              padding: '10px 16px 14px', flexShrink: 0,
            }}>
              <div style={{ maxWidth: 820, margin: '0 auto' }}>
                {/* 快捷按钮 */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                  {QUICK.map((a, i) => (
                    <button key={i} onClick={() => quickAction(a)} style={{
                      padding: '4px 10px', borderRadius: 20,
                      border: '1px solid var(--border)', background: 'var(--surface2)',
                      color: 'var(--text2)', fontSize: 12,
                    }}>{a.label}</button>
                  ))}
                </div>

                {/* 文献注入提示 */}
                {litInject && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                    background: 'var(--amber-bg)', border: '1px solid var(--amber-border)',
                    borderRadius: 'var(--radius-sm)', marginBottom: 8, fontSize: 12, color: 'var(--amber)',
                  }}>
                    📚 文献注入已开启——发消息时会把检索结果注入给 AI
                    <button onClick={() => setLitInject(false)} style={{
                      marginLeft: 'auto', background: 'none', border: 'none',
                      color: 'var(--amber)', fontSize: 13, cursor: 'pointer',
                    }}>×</button>
                  </div>
                )}

                {/* 文本框 */}
                <div style={{
                  display: 'flex', gap: 8, alignItems: 'flex-end',
                  background: 'var(--surface2)', border: '1px solid var(--border2)',
                  borderRadius: 'var(--radius)', padding: '9px 10px 9px 14px',
                }}>
                  <textarea ref={taRef} value={input} onChange={handleInput}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder="输入内容或需求…（Enter 发送，Shift+Enter 换行）"
                    rows={1}
                    style={{
                      flex: 1, border: 'none', background: 'transparent', resize: 'none',
                      fontSize: 14, color: 'var(--text)', outline: 'none', lineHeight: 1.6,
                      minHeight: 22, maxHeight: 160,
                    }} />
                  {loading
                    ? <button onClick={stopGen} style={{
                        width: 34, height: 34, borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border2)', background: 'var(--red-bg)',
                        color: 'var(--red)', fontSize: 14, flexShrink: 0,
                      }} title="停止">⬛</button>
                    : <button onClick={send} disabled={!input.trim()} style={{
                        width: 34, height: 34, borderRadius: 'var(--radius-sm)', border: 'none',
                        background: input.trim() ? 'var(--accent)' : 'var(--surface3)',
                        color: input.trim() ? 'white' : 'var(--text3)', fontSize: 18, flexShrink: 0,
                      }}>↑</button>
                  }
                </div>

                {charCount > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, textAlign: 'right' }}>
                    {charCount} 字符
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 文献面板 ───────────────────────────────── */}
        {tab === 'lit' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
            <div style={{ maxWidth: 820, margin: '0 auto' }}>
              <div style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>📚 文献检索</h2>
                <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                  数据源：<strong>CrossRef</strong>（主）→ <strong>OpenAlex</strong>（备），均免费无速率限制。建议用<strong>英文关键词</strong>，准确率更高。
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input value={litQuery} onChange={e => setLitQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doLitSearch()}
                  placeholder="如：machine learning education / deep learning NLP…"
                  style={{
                    flex: 1, padding: '9px 14px', borderRadius: 'var(--radius)', fontSize: 14,
                    border: '1px solid var(--border2)', background: 'var(--surface)',
                    color: 'var(--text)', outline: 'none',
                  }} />
                <button onClick={() => doLitSearch()} disabled={litLoading || !litQuery.trim()} style={{
                  padding: '9px 18px', borderRadius: 'var(--radius)', border: 'none',
                  background: 'var(--accent)', color: 'white', fontWeight: 600, fontSize: 14,
                  opacity: !litLoading && litQuery.trim() ? 1 : .5,
                  display: 'flex', alignItems: 'center', gap: 7,
                }}>
                  {litLoading ? <><span className="spinner" /> 检索中</> : '🔍 检索'}
                </button>
              </div>

              {/* 文献注入开关 */}
              {litResults.length > 0 && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                  background: litInject ? 'var(--amber-bg)' : 'var(--surface2)',
                  border: `1px solid ${litInject ? 'var(--amber-border)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-sm)', marginBottom: 14, fontSize: 13,
                  color: litInject ? 'var(--amber)' : 'var(--text2)',
                }}>
                  <Toggle value={litInject} onChange={setLitInject} color="var(--amber)" />
                  {litInject
                    ? '✅ 文献注入已开启——下次发消息时 AI 会基于这些文献回答'
                    : '开启后，AI 会基于这些真实文献来回答问题'}
                </div>
              )}

              {litResults.length === 0 && !litLoading && (
                <div style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)', padding: '50px 20px',
                  textAlign: 'center', color: 'var(--text3)',
                }}>
                  <div style={{ fontSize: 30, marginBottom: 10 }}>📖</div>
                  输入关键词检索真实学术文献
                </div>
              )}

              {litResults.map((p, i) => (
                <LitCard key={i} paper={p} onInject={(text) => {
                  setInput(text); setTab('chat'); taRef.current?.focus();
                }} />
              ))}
            </div>
          </div>
        )}

        {/* ── 设置面板 ───────────────────────────────── */}
        {tab === 'settings' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
            <div style={{ maxWidth: 660, margin: '0 auto' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>⚙️ 设置</h2>

              <SettingCard title="API Key 配置" icon="🔑">
                <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.6 }}>
                  API Key 存在服务端 <code style={{ background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>.env.local</code> 文件中，修改后需重启服务。
                </p>
                {[
                  { m: MODELS[0], env: 'ANTHROPIC_API_KEY' },
                  { m: MODELS[1], env: 'DEEPSEEK_API_KEY' },
                  { m: MODELS[2], env: 'VOLC_API_KEY + VOLC_MODEL' },
                  { m: MODELS[3], env: 'DASHSCOPE_API_KEY' },
                ].map(({ m, env }) => (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7,
                    padding: '8px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)',
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, width: 72 }}>{m.label}</span>
                    <code style={{ fontSize: 11, color: 'var(--text3)', flex: 1 }}>{env}</code>
                  </div>
                ))}
              </SettingCard>

              <SettingCard title="对话历史长度" icon="💬">
                <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
                  每次请求携带的历史条数（越多消耗 Token 越多，当前：<strong>{historyLen} 条</strong>）
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input type="range" min={4} max={40} step={2} value={historyLen}
                    onChange={e => setHistoryLen(+e.target.value)} style={{ flex: 1 }} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', width: 28 }}>{historyLen}</span>
                </div>
              </SettingCard>

              <SettingCard title="文献数据源" icon="📚">
                {[
                  { name: 'CrossRef',        status: '主力', color: 'var(--green)',  desc: '1 亿+ 文献，无需 Key，无速率限制，最稳定' },
                  { name: 'OpenAlex',        status: '备用', color: 'var(--accent)', desc: '2 亿+ 文献，完全开放，无需 Key' },
                  { name: 'Semantic Scholar', status: '可选', color: 'var(--amber)',  desc: '质量高但限速严，需在 .env.local 配置 SEMANTIC_SCHOLAR_API_KEY' },
                ].map(src => (
                  <div key={src.name} style={{
                    display: 'flex', gap: 10, padding: '8px 12px',
                    background: 'var(--surface2)', borderRadius: 'var(--radius-sm)', marginBottom: 7,
                  }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10, flexShrink: 0, alignSelf: 'flex-start',
                      background: src.color + '20', color: src.color, fontWeight: 600,
                    }}>{src.status}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{src.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{src.desc}</div>
                    </div>
                  </div>
                ))}
              </SettingCard>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── 子组件 ────────────────────────────────────────────────

function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: 'var(--text3)',
      letterSpacing: '.06em', textTransform: 'uppercase',
      padding: '0 4px', marginBottom: 4, ...style,
    }}>{children}</div>
  );
}

function SideBtn({ children, active, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 9px', borderRadius: 'var(--radius-sm)', border: 'none', marginBottom: 1,
      background: active ? (color + '18') : 'transparent',
      color: active ? color : 'var(--text2)',
      fontWeight: active ? 600 : 400, fontSize: 13, textAlign: 'left',
    }}>{children}</button>
  );
}

function ConvItem({ c, active, onClick, onDelete }) {
  const timeLabel = useTimeAgo(c.updated_at);
  return (
    <div onClick={onClick} style={{
      padding: '7px 9px', borderRadius: 'var(--radius-sm)', marginBottom: 2,
      cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 6,
      background: active ? 'var(--surface2)' : 'transparent',
    }}>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{
          fontSize: 12, fontWeight: active ? 600 : 400,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{c.title || '新对话'}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
          {timeLabel} · {c.message_count} 条
        </div>
      </div>
      <button onClick={e => onDelete(c.id, e)} style={{
        background: 'none', border: 'none', color: 'var(--text3)',
        fontSize: 15, padding: '0 2px', borderRadius: 4, flexShrink: 0, lineHeight: 1,
      }}>×</button>
    </div>
  );
}

function Avatar({ label, color }) {
  return (
    <div style={{
      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
      background: color || 'var(--surface2)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700,
      color: color ? 'white' : 'var(--accent)',
    }}>{label}</div>
  );
}

function MsgBubble({ msg, idx, copiedIdx, onCopy }) {
  if (msg.role === 'system') return (
    <div style={{
      alignSelf: 'center', background: 'var(--accent-bg)', color: 'var(--accent)',
      border: '1px solid var(--accent-border)', borderRadius: 'var(--radius)',
      padding: '7px 14px', fontSize: 13, maxWidth: '85%', textAlign: 'center',
    }}>{msg.content}</div>
  );

  if (msg.role === 'error') return (
    <div style={{
      background: 'var(--red-bg)', border: '1px solid var(--red-border)',
      borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--red)',
    }}>❌ 错误：{msg.content}</div>
  );

  if (msg.role === 'user') return (
    <div className="msg-in" style={{
      display: 'flex', gap: 9, justifyContent: 'flex-end',
      maxWidth: '80%', alignSelf: 'flex-end',
    }}>
      <div style={{
        padding: '10px 14px', background: 'var(--user-bg)', color: 'white',
        borderRadius: '12px 4px 12px 12px', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{msg.content}</div>
      <Avatar label="我" color="var(--user-bg)" />
    </div>
  );

  return (
    <div className="msg-in" style={{ display: 'flex', gap: 9, maxWidth: '88%' }}>
      <Avatar label="助" />
      <div style={{ flex: 1 }}>
        <div style={{
          padding: '11px 14px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: '4px 12px 12px 12px',
          fontSize: 14, lineHeight: 1.7, wordBreak: 'break-word',
        }}>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
          <button onClick={() => onCopy(msg.content, idx)} style={{
            padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text3)', fontSize: 11,
          }}>
            {copiedIdx === idx ? '✅ 已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ value, onChange, color }) {
  return (
    <button onClick={() => onChange(v => !v)} style={{
      width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
      background: value ? color : 'var(--border2)', position: 'relative', flexShrink: 0,
      transition: 'background .15s',
    }}>
      <span style={{
        position: 'absolute', top: 2,
        left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: 'white',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function LitCard({ paper, onInject }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(paper.gbRef);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, flex: 1 }}>{paper.title}</h3>
        <span style={{
          fontSize: 10, padding: '2px 7px', borderRadius: 10, flexShrink: 0,
          background: 'var(--surface2)', color: 'var(--text3)', border: '1px solid var(--border)',
        }}>{paper.source}</span>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <span>👥 {paper.authors?.split(',').slice(0, 3).join(',')}{paper.authors?.split(',').length > 3 ? ' 等' : ''}</span>
        <span>📅 {paper.year}</span>
        {paper.venue && <span>📰 {paper.venue}</span>}
        {paper.citations > 0 && <span>📊 被引 {paper.citations}</span>}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.65, marginBottom: 12 }}>{paper.abstract}</p>

      <div style={{
        background: 'var(--amber-bg)', border: '1px solid var(--amber-border)',
        borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 10,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          GB/T 7714 引用格式
        </div>
        <div style={{ fontSize: 12, color: 'var(--amber)', fontFamily: 'monospace', lineHeight: 1.6 }}>{paper.gbRef}</div>
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button onClick={copy} style={{
          padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)',
          background: 'var(--surface2)', fontSize: 12, color: 'var(--text2)',
        }}>{copied ? '✅ 已复制' : '复制引用'}</button>
        {paper.doi && (
          <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer" style={{
            padding: '4px 12px', borderRadius: 6, border: '1px solid var(--accent-border)',
            background: 'var(--accent-bg)', fontSize: 12, color: 'var(--accent)', textDecoration: 'none',
          }}>🔗 查看原文</a>
        )}
        <button onClick={() => onInject(`请基于以下文献帮我写一段综述内容：\n标题：${paper.title}\n作者：${paper.authors}\n年份：${paper.year}\n摘要：${paper.abstract}`)} style={{
          padding: '4px 12px', borderRadius: 6, border: '1px solid var(--green-border)',
          background: 'var(--green-bg)', fontSize: 12, color: 'var(--green)',
        }}>引入对话</button>
      </div>
    </div>
  );
}

function SettingCard({ title, icon, children }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: 18, marginBottom: 14,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}
