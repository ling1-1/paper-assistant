import { useRef, useState } from 'react';

export default function TranslatePageV2() {
  const [file, setFile] = useState(null);
  const [extractedText, setExtractedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [field, setField] = useState('general');
  const [showBilingual, setShowBilingual] = useState(false);

  const outputRef = useRef(null);

  /**
   * 处理文件上传
   */
  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile || selectedFile.type !== 'application/pdf') {
      setError('请选择 PDF 文件');
      return;
    }

    setFile(selectedFile);
    setError('');
    setStatusMessage('正在解析 PDF...');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('/api/upload-pdf-advanced', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'PDF 解析失败');
      }

      setExtractedText(data.text);
      setStatusMessage(`✅ 解析成功：${data.totalPages}页，${data.text.length}字符`);
    } catch (err) {
      setError(`❌ ${err.message}`);
      setStatusMessage('');
    }
  };

  /**
   * 处理翻译
   */
  const handleTranslate = async () => {
    if (!extractedText) {
      setError('请先上传 PDF 文件');
      return;
    }

    setIsTranslating(true);
    setTranslatedText('');
    setError('');
    setProgress(0);

    try {
      const response = await fetch('/api/translate-chunked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: extractedText,
          field,
          sourceLang: 'en',
          targetLang: 'zh',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '翻译失败');
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
          
          try {
            const data = JSON.parse(line.slice(6));

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.message) {
              setStatusMessage(data.message);
            }

            if (data.progress !== undefined) {
              setProgress(data.progress);
            }

            if (data.text) {
              setTranslatedText((prev) => prev + data.text);
            }

            if (data.stage === 'done') {
              setStatusMessage('✅ 翻译完成！');
              setProgress(100);
            }
          } catch (parseErr) {
            console.error('解析 SSE 数据失败:', parseErr);
          }
        }
      }
    } catch (err) {
      setError(`❌ ${err.message}`);
      setStatusMessage('翻译失败');
    } finally {
      setIsTranslating(false);
    }
  };

  /**
   * 导出为 Word
   */
  const handleExport = async () => {
    if (!translatedText) {
      setError('没有可导出的翻译结果');
      return;
    }

    try {
      const response = await fetch('/api/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalText: extractedText,
          translatedText,
          filename: file?.name || 'translation',
          sourceLang: 'en',
          targetLang: 'zh',
          mode: 'translate',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '导出失败');
      }

      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = data.filename;
      link.click();

      alert(`✅ 已导出：${data.filename}`);
    } catch (err) {
      setError(`❌ ${err.message}`);
    }
  };

  /**
   * 复制译文
   */
  const handleCopy = () => {
    navigator.clipboard.writeText(translatedText);
    alert('✅ 已复制到剪贴板');
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-black/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-white" viewBox="0 0 76 65" fill="currentColor">
                <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
              </svg>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-white">Paper Assistant V2</h1>
                <p className="text-xs text-zinc-500">分块翻译 · 实时进度 · 更快更稳定</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* 控制面板 */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
          <h2 className="text-sm font-medium text-zinc-300 mb-4">翻译设置</h2>

          {/* 文件上传 */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-zinc-400">PDF 文件</label>
              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-500 hover:text-white cursor-pointer transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                上传 PDF
                <input type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>

            {file && (
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-zinc-800 rounded">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  {file.name}
                </span>
              </div>
            )}
          </div>

          {/* 学科领域 */}
          <div className="mb-6">
            <label className="block text-xs font-medium text-zinc-500 mb-2">学科领域</label>
            <select
              value={field}
              onChange={(e) => setField(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 focus:outline-none focus:ring-2 focus:ring-white/20 transition-all"
            >
              <option value="general">通用</option>
              <option value="cs">💻 计算机科学</option>
              <option value="medicine">🏥 医学</option>
              <option value="engineering">⚙️ 工程</option>
              <option value="biology">🧬 生物学</option>
              <option value="chemistry">🧪 化学化工</option>
            </select>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTranslate}
              disabled={isTranslating || !extractedText}
              className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md transition-all ${
                isTranslating || !extractedText
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
              disabled={!translatedText}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
                !translatedText
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
              disabled={!translatedText}
              className={`px-4 py-2.5 text-sm font-medium rounded-md transition-all ${
                !translatedText
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              📥 导出
            </button>
          </div>

          {/* 进度条 */}
          {(isTranslating || progress > 0) && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between mb-2 text-xs">
                <span className="text-zinc-300">{statusMessage || '处理中...'}</span>
                <span className="text-zinc-500">{progress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-white transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="mt-4 p-3 bg-red-900/20 border border-red-900 rounded-md text-red-400 text-xs">
              {error}
            </div>
          )}
        </section>

        {/* 翻译区域 */}
        {showBilingual ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
              <h3 className="text-xs font-medium text-zinc-500 mb-3">原文</h3>
              <pre className="text-sm leading-6 text-zinc-300 whitespace-pre-wrap font-mono h-[600px] overflow-auto">
                {extractedText || ' '}
              </pre>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
              <h3 className="text-xs font-medium text-zinc-500 mb-3">译文</h3>
              <pre className="text-sm leading-6 text-zinc-300 whitespace-pre-wrap font-mono h-[600px] overflow-auto">
                {translatedText || ' '}
              </pre>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-300">译文</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCopy}
                  disabled={!translatedText}
                  className={`text-xs transition-colors inline-flex items-center gap-1 ${
                    translatedText ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H8z" />
                  </svg>
                  复制
                </button>
                <button
                  onClick={handleExport}
                  disabled={!translatedText}
                  className={`text-xs transition-colors inline-flex items-center gap-1 ${
                    translatedText ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  导出
                </button>
              </div>
            </div>
            <div
              ref={outputRef}
              className="w-full h-[600px] px-3 py-2 text-sm bg-black border border-zinc-800 rounded-md overflow-auto font-mono"
            >
              {translatedText ? (
                <pre className="leading-6 text-zinc-300 whitespace-pre-wrap">{translatedText}</pre>
              ) : (
                <span className="text-zinc-600">翻译结果将显示在这里...</span>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>© 2026 Paper Assistant V2</span>
            <span>Powered by VolcEngine</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
