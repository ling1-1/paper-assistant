import { useRef, useState } from 'react';

export default function TranslatePageVercel() {
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [mode, setMode] = useState('translate');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('zh');
  const [field, setField] = useState('general');
  const [streamMode, setStreamMode] = useState(true);
  const [error, setError] = useState('');
  const [translationMeta, setTranslationMeta] = useState(null);
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressLogs, setProgressLogs] = useState([]);
  
  const [pdfName, setPdfName] = useState('');
  const [pdfBase64, setPdfBase64] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [extractedText, setExtractedText] = useState('');
  const [pdfPages, setPdfPages] = useState([]);
  
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState('docx');
  const [showBilingual, setShowBilingual] = useState(false);

  const outputRef = useRef(null);
  const fileInputRef = useRef(null);

  const getModeHint = () => {
    switch (mode) {
      case 'translate':
        return sourceLang === 'en' ? '请输入英文内容...' : '请输入中文内容...';
      case 'explain':
        return '请输入要解释的专业术语或句子...';
      case 'polish':
        return sourceLang === 'en' ? '请输入要润色的英文内容...' : '请输入要润色的中文内容...';
      default:
        return '请输入内容...';
    }
  };

  const handleTranslate = async () => {
    setIsTranslating(true);
    setError('');
    setOutputText('');
    setTranslationMeta(null);
    setProgressMessage('准备开始翻译...');
    setProgressPercent(0);
    setProgressLogs([]);

    try {
      if (pdfBase64 && mode === 'translate') {
        const response = await fetch('/api/translate-direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pdfBase64,
            filename: pdfName,
            extractedText,
            pdfPages,
            stream: true,
            mode,
            sourceLang,
            targetLang,
            field,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || data.message || '翻译失败');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));

            if (data.error) throw new Error(data.error);
            if (data.message) {
              setProgressMessage(data.message);
              setProgressLogs((prev) => [...prev.slice(-5), data.message]);
            }
            if (typeof data.chunkIndex === 'number' && typeof data.totalChunks === 'number') {
              setProgressPercent(Math.round(((data.chunkIndex + 1) / data.totalChunks) * 100));
            }
            if (data.chunk) setOutputText((prev) => prev + data.chunk);
            if (data.done) {
              setProgressMessage('翻译完成');
              setProgressPercent(100);
              if (data.translation) setOutputText(data.translation);
              setTranslationMeta({ transport: data.transport, fileId: data.fileId });
            }
          }
        }
        return;
      }

      if (!inputText.trim()) {
        setError('请输入要翻译的内容');
        setIsTranslating(false);
        return;
      }

      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText,
          mode,
          sourceLang,
          targetLang,
          field,
          stream: streamMode,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '翻译失败');
      }

      if (streamMode) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.chunk) setOutputText(prev => prev + data.chunk);
            if (data.done) break;
          }
        }
      } else {
        const data = await response.json();
        setOutputText(data.translation);
      }
    } catch (err) {
      setError(err.message);
      setProgressMessage('翻译失败');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSwapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  };

  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setError('');
    setPdfName('');
    setPdfBase64('');
    setExtractedText('');
    setPdfTotalPages(0);
    setPdfPages([]);
    setTranslationMeta(null);
    setProgressMessage('');
    setProgressPercent(0);
    setProgressLogs([]);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(outputText);
    alert('已复制到剪贴板');
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file || file.type !== 'application/pdf') {
      setError('请选择 PDF 文件');
      return;
    }

    setIsUploading(true);
    setError('');
    setPdfName(file.name);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target.result;

        try {
          const response = await fetch('/api/upload-pdf-advanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: base64, filename: file.name }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || data.message || 'PDF 解析失败');
          }

          setPdfBase64(base64);
          setExtractedText(data.text);
          setInputText(data.text);
          setPdfTotalPages(data.totalPages);
          setPdfPages(data.pages || []);
        } catch (err) {
          setError(err.message);
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('文件读取失败：' + err.message);
      setIsUploading(false);
    }
  };

  const handleExport = async () => {
    if (!outputText) {
      setError('没有可导出的翻译结果');
      return;
    }

    setIsExporting(true);
    setError('');

    try {
      let response;
      let data;

      if (exportFormat === 'pdf') {
        response = await fetch('/api/export-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalText: inputText,
            translatedText: outputText,
            filename: pdfName || 'translation',
            sourceLang,
            targetLang,
            mode,
            pdfBase64,
          }),
        });
      } else {
        response = await fetch('/api/export-docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalText: inputText,
            translatedText: outputText,
            filename: pdfName || 'translation',
            sourceLang,
            targetLang,
            mode,
          }),
        });
      }

      data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || '导出失败');
      }

      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = data.filename;
      link.click();

      alert(`✅ 已导出：${data.filename}${data.pages ? ` (${data.pages}页)` : ''}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInputText(text);
    } catch (err) {
      setError('无法读取剪贴板内容');
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* Header - Vercel 风格 */}
      <header className="border-b border-zinc-800 bg-black/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-white" viewBox="0 0 76 65" fill="currentColor">
                <path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/>
              </svg>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-white">Paper Assistant</h1>
                <p className="text-xs text-zinc-500">专业学术论文翻译</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-zinc-500">Powered by VolcEngine</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* 控制栏 - Geist Grid 布局 */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-medium text-zinc-300">翻译设置</h2>
            <button
              onClick={handleClear}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              重置
            </button>
          </div>

          {/* PDF 上传 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-zinc-400">PDF 文件</label>
              <input ref={fileInputRef} type="file" accept=".pdf" onChange={handleFileSelect} className="hidden" />
              <button
                onClick={triggerFileSelect}
                disabled={isUploading}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md transition-all border ${
                  isUploading
                    ? 'bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:border-zinc-500 hover:text-white'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {isUploading ? '解析中...' : '上传 PDF'}
              </button>
            </div>
            {pdfName && (
              <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-zinc-800 rounded">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  {pdfName}
                </span>
                {pdfTotalPages > 0 && <span>{pdfTotalPages} 页</span>}
                {extractedText && <span>{extractedText.length} 字符</span>}
              </div>
            )}
          </div>

          {/* Grid 布局 - Geist 风格 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* 模式 */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-2">模式</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 transition-all"
              >
                <option value="translate">📝 翻译</option>
                <option value="explain">💡 术语解释</option>
                <option value="polish">✨ 润色优化</option>
              </select>
            </div>

            {/* 学科领域 */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-2">学科领域</label>
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 transition-all"
              >
                <option value="general">通用</option>
                <option value="cs">💻 计算机科学</option>
                <option value="medicine">🏥 医学</option>
                <option value="engineering">⚙️ 工程</option>
                <option value="biology">🧬 生物学</option>
                <option value="chemistry">🧪 化学化工</option>
              </select>
            </div>

            {/* 翻译方向 */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-2">翻译方向</label>
              <div className="flex items-center gap-2">
                <select
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                >
                  <option value="en">英语</option>
                  <option value="zh">中文</option>
                </select>
                <button
                  onClick={handleSwapLanguages}
                  className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="交换语言"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </button>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
                >
                  <option value="zh">中文</option>
                  <option value="en">英语</option>
                </select>
              </div>
            </div>

            {/* 导出格式 */}
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-2">导出格式</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setExportFormat('docx')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all border ${
                    exportFormat === 'docx'
                      ? 'bg-white text-black border-white'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-500'
                  }`}
                >
                  Word
                </button>
                <button
                  onClick={() => setExportFormat('pdf')}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all border ${
                    exportFormat === 'pdf'
                      ? 'bg-white text-black border-white'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-500'
                  }`}
                >
                  PDF
                </button>
              </div>
            </div>
          </div>

          {/* 操作按钮 - Geist 风格 */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTranslate}
              disabled={isTranslating || (!inputText.trim() && !pdfBase64)}
              className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md transition-all ${
                isTranslating || (!inputText.trim() && !pdfBase64)
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-white text-black hover:bg-zinc-200'
              }`}
            >
              {isTranslating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  翻译中...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  开始翻译
                </>
              )}
            </button>

            <button
              onClick={() => setShowBilingual(!showBilingual)}
              disabled={!outputText}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
                !outputText
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : showBilingual
                    ? 'bg-zinc-700 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              📖 双语对照
            </button>

            <button
              onClick={handleExport}
              disabled={isExporting || !outputText}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
                isExporting || !outputText
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {isExporting ? '导出中...' : '📥 导出'}
            </button>
          </div>

          {/* 高级选项 */}
          <div className="mt-4 flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={streamMode}
                onChange={(e) => setStreamMode(e.target.checked)}
                className="w-4 h-4 rounded bg-zinc-800 border-zinc-700 text-white focus:ring-white/20"
              />
              <span className="text-xs text-zinc-500">流式输出（实时显示）</span>
            </label>
            {translationMeta?.transport && (
              <span className={`text-xs px-2 py-1 rounded ${
                translationMeta.transport === 'ark-file' ? 'bg-green-900/20 text-green-400' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {translationMeta.transport === 'ark-file' ? '原始 PDF 直连' : '文本直出'}
              </span>
            )}
          </div>

          {/* 进度条 */}
          {(isTranslating || progressMessage) && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between mb-2 text-xs">
                <span className="text-zinc-300">{progressMessage || '处理中...'}</span>
                <span className="text-zinc-500">{progressPercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-white transition-all duration-300"
                  style={{ width: `${Math.max(progressPercent, 6)}%` }}
                />
              </div>
              {!!progressLogs.length && (
                <div className="mt-3 space-y-1 text-xs text-zinc-500 font-mono">
                  {progressLogs.map((log, index) => (
                    <div key={`${log}-${index}`}>› {log}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 翻译区域 - Geist Grid */}
        {showBilingual ? (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-zinc-300">📖 双语对照</h2>
              <button
                onClick={() => setShowBilingual(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                返回列表
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-400px)] min-h-[500px]">
              <div className="border border-zinc-800 rounded-lg p-4 overflow-auto bg-black/50">
                <h3 className="text-xs font-medium text-zinc-500 mb-3 sticky top-0 bg-black/50 backdrop-blur">原文</h3>
                <pre className="text-sm leading-6 text-zinc-300 whitespace-pre-wrap font-mono">{inputText || ' '}</pre>
              </div>
              <div className="border border-zinc-800 rounded-lg p-4 overflow-auto bg-black/50">
                <h3 className="text-xs font-medium text-zinc-500 mb-3 sticky top-0 bg-black/50 backdrop-blur">译文</h3>
                <pre className="text-sm leading-6 text-zinc-300 whitespace-pre-wrap font-mono">{outputText || ' '}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 输入框 */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-zinc-300">原文</h2>
                <button
                  onClick={handlePaste}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  粘贴
                </button>
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={getModeHint()}
                className="w-full h-80 px-3 py-2 text-sm bg-black border border-zinc-800 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20 font-mono text-zinc-300 placeholder-zinc-600 transition-all"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                <span>{inputText.length} 字符</span>
                {error && (
                  <span className="text-red-400 inline-flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </span>
                )}
              </div>
            </div>

            {/* 输出框 */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-zinc-300">译文</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleExport}
                    disabled={isExporting || !outputText}
                    className={`text-xs transition-colors inline-flex items-center gap-1 ${
                      outputText ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    导出
                  </button>
                  <button
                    onClick={handleCopy}
                    disabled={!outputText}
                    className={`text-xs transition-colors inline-flex items-center gap-1 ${
                      outputText ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    复制
                  </button>
                </div>
              </div>
              <div
                ref={outputRef}
                className="w-full h-80 px-3 py-2 text-sm bg-black border border-zinc-800 rounded-md overflow-auto font-mono"
              >
                {outputText ? (
                  <pre className="leading-6 text-zinc-300 whitespace-pre-wrap">{outputText}</pre>
                ) : (
                  <span className="text-zinc-600">翻译结果将显示在这里...</span>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>© 2026 Paper Assistant</span>
            <span className="inline-flex items-center gap-4">
              <span>Powered by VolcEngine</span>
              <span>Geist Design</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
