import { useState, useRef } from 'react';
import Head from 'next/head';

export default function TranslatePage() {
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [mode, setMode] = useState('translate'); // translate / explain / polish
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('zh');
  const [field, setField] = useState('general');
  const [streamMode, setStreamMode] = useState(true);
  const [error, setError] = useState('');
  const [directPdfMode, setDirectPdfMode] = useState(false); // 直接上传 PDF 给火山方舟
  
  // PDF 相关状态
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfName, setPdfName] = useState('');
  const [pdfBase64, setPdfBase64] = useState(''); // 存储原始 PDF base64
  const [isUploading, setIsUploading] = useState(false);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [extractedText, setExtractedText] = useState('');
  const [useAdvancedPdf, setUseAdvancedPdf] = useState(true); // 使用增强版 PDF 解析
  
  // 导出相关状态
  const [isExporting, setIsExporting] = useState(false);
  
  const outputRef = useRef(null);
  const fileInputRef = useRef(null);

  // 获取当前模式的提示文本
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

  // 获取当前模式的标题
  const getModeTitle = () => {
    switch (mode) {
      case 'translate':
        return `${sourceLang === 'en' ? '英文' : '中文'}原文`;
      case 'explain':
        return '待解释内容';
      case 'polish':
        return `${sourceLang === 'en' ? '英文' : '中文'}原文`;
      default:
        return '原文';
    }
  };

  // 获取输出框标题
  const getOutputTitle = () => {
    switch (mode) {
      case 'translate':
        return `${targetLang === 'en' ? '英文' : '中文'}翻译`;
      case 'explain':
        return '术语解释';
      case 'polish':
        return `${targetLang === 'en' ? '英文' : '中文'}润色`;
      default:
        return '输出';
    }
  };

  // 翻译处理（流式）
  const handleTranslate = async () => {
    if (!inputText.trim()) {
      setError('请输入要翻译的内容');
      return;
    }

    setIsTranslating(true);
    setError('');
    setOutputText('');

    try {
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
        // 流式读取
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // 保留不完整行

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            
            if (data.error) {
              throw new Error(data.error);
            }
            if (data.chunk) {
              setOutputText(prev => prev + data.chunk);
            }
            if (data.done) {
              break;
            }
          }
        }
      } else {
        // 非流式
        const data = await response.json();
        setOutputText(data.translation);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsTranslating(false);
    }
  };

  // 交换语言
  const handleSwapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  };

  // 清空
  const handleClear = () => {
    setInputText('');
    setOutputText('');
    setError('');
    setPdfFile(null);
    setPdfName('');
    setExtractedText('');
    setPdfTotalPages(0);
  };

  // 复制结果
  const handleCopy = () => {
    navigator.clipboard.writeText(outputText);
    alert('已复制到剪贴板');
  };

  // PDF 上传处理
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
      // 读取文件为 base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target.result;

        try {
          // 选择 API：增强版或普通版
          const apiEndpoint = useAdvancedPdf ? '/api/upload-pdf-advanced' : '/api/upload-pdf';
          
          const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file: base64,
              filename: file.name,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || data.message || 'PDF 解析失败');
          }

          setPdfFile(data);
          setPdfBase64(base64); // 存储原始 PDF base64
          setExtractedText(data.text);
          setInputText(data.text);
          setPdfTotalPages(data.totalPages);
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

  // 导出为 Word 或 PDF
  const handleExport = async () => {
    if (!outputText) {
      setError('没有可导出的翻译结果');
      return;
    }

    setIsExporting(true);
    setError('');

    try {
      // Word 导出（纯文本）
      const response = await fetch('/api/export-docx', {
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || '导出失败');
      }

      // 触发下载
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = data.filename;
      link.click();

      alert(`✅ 已导出：${data.filename}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // 触发文件选择
  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  // 粘贴输入
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInputText(text);
    } catch (err) {
      setError('无法读取剪贴板内容');
    }
  };

  return (
    <>
      <Head>
        <title>论文翻译 - Paper Assistant</title>
        <meta name="description" content="专业学术论文翻译工具" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-7xl mx-auto">
          {/* 标题 */}
          <header className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">
              📚 论文翻译
            </h1>
            <p className="text-gray-600">
              专业学术论文翻译 | 支持中英互译 | 术语精准
            </p>
          </header>

          {/* 控制栏 */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            {/* PDF 上传区域 */}
            <div className="mb-6 pb-6 border-b border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">📄 PDF 文件上传</h3>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={triggerFileSelect}
                  disabled={isUploading}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    isUploading
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  {isUploading ? '⏳ 解析中...' : '📎 上传 PDF'}
                </button>
              </div>
              {pdfName && (
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-600">
                    📁 {pdfName}
                  </span>
                  {pdfTotalPages > 0 && (
                    <span className="text-gray-500">
                      | 📊 {pdfTotalPages} 页
                    </span>
                  )}
                  {extractedText && (
                    <span className="text-gray-500">
                      | ✏️ {extractedText.length} 字符
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 翻译模式 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  模式
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="translate">📝 翻译</option>
                  <option value="explain">💡 术语解释</option>
                  <option value="polish">✨ 润色优化</option>
                </select>
              </div>

              {/* 学科领域 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  学科领域
                </label>
                <select
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="general">通用</option>
                  <option value="cs">💻 计算机科学</option>
                  <option value="medicine">🏥 医学</option>
                  <option value="engineering">⚙️ 工程</option>
                  <option value="biology">🧬 生物学</option>
                  <option value="chemistry">🧪 化学化工</option>
                </select>
              </div>

              {/* 语言方向 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  翻译方向
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="en">英语</option>
                    <option value="zh">中文</option>
                  </select>
                  <button
                    onClick={handleSwapLanguages}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="交换语言"
                  >
                    ⇄
                  </button>
                  <select
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="zh">中文</option>
                    <option value="en">英语</option>
                  </select>
                </div>
              </div>

              {/* 操作按钮 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  导出
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleTranslate}
                    disabled={isTranslating || !inputText.trim()}
                    className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all ${
                      isTranslating || !inputText.trim()
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isTranslating ? '翻译中...' : '开始翻译'}
                  </button>
                  <button
                    onClick={handleExport}
                    disabled={isExporting || !outputText}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      isExporting || !outputText
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                    title="导出为 Word 文档"
                  >
                    {isExporting ? '导出中...' : '📄 导出 Word'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  ℹ️ PDF 导出功能开发中（中文字体支持）
                </p>
              </div>
            </div>

            {/* 高级选项 */}
            <div className="mt-4 flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={streamMode}
                  onChange={(e) => setStreamMode(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">流式输出（实时显示）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useAdvancedPdf}
                  onChange={(e) => setUseAdvancedPdf(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">增强版 PDF 解析（保留排版）✨</span>
              </label>
            </div>
          </div>

          {/* 翻译区域 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 输入框 */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-800">
                  {getModeTitle()}
                </h2>
                <button
                  onClick={handlePaste}
                  className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                >
                  📋 粘贴
                </button>
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={getModeHint()}
                className="w-full h-96 px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
              <div className="mt-2 text-sm text-gray-500 text-right">
                {inputText.length} 字符
              </div>
            </div>

            {/* 输出框 */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-800">
                  {getOutputTitle()}
                </h2>
                <div className="flex gap-3">
                  <button
                    onClick={handleExport}
                    disabled={isExporting || !outputText}
                    className={`text-sm transition-colors ${
                      outputText
                        ? 'text-purple-600 hover:text-purple-800'
                        : 'text-gray-400 cursor-not-allowed'
                    }`}
                    title="导出为 Word 文档"
                  >
                    {isExporting ? '⏳ 导出中...' : '📥 导出 Word'}
                  </button>
                  <button
                    onClick={handleCopy}
                    disabled={!outputText}
                    className={`text-sm transition-colors ${
                      outputText
                        ? 'text-blue-600 hover:text-blue-800'
                        : 'text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    📋 复制
                  </button>
                </div>
              </div>
              <div
                ref={outputRef}
                className="w-full h-96 px-4 py-3 border border-gray-300 rounded-lg overflow-auto bg-gray-50 font-mono text-sm whitespace-pre-wrap"
              >
                {outputText || (
                  <span className="text-gray-400">翻译结果将显示在这里...</span>
                )}
              </div>
              {error && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  ❌ {error}
                </div>
              )}
            </div>
          </div>

          {/* 功能说明 */}
          <div className="mt-8 bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              💡 功能说明
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-medium text-blue-800 mb-2">📝 翻译模式</h4>
                <p className="text-sm text-blue-700">
                  专业学术论文翻译，保持术语准确性，支持中英互译
                </p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <h4 className="font-medium text-green-800 mb-2">💡 术语解释</h4>
                <p className="text-sm text-green-700">
                  遇到不懂的专业术语？让 AI 为你详细解释
                </p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <h4 className="font-medium text-purple-800 mb-2">✨ 润色优化</h4>
                <p className="text-sm text-purple-700">
                  优化表达，让论文更加学术化、规范化
                </p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <h4 className="font-medium text-orange-800 mb-2">📄 PDF 上传</h4>
                <p className="text-sm text-orange-700">
                  直接上传 PDF 论文，自动提取文本进行翻译
                </p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg">
                <h4 className="font-medium text-red-800 mb-2">📥 导出 Word</h4>
                <p className="text-sm text-red-700">
                  翻译结果导出为 Word 文档，保留原文对照
                </p>
              </div>
              <div className="p-4 bg-teal-50 rounded-lg">
                <h4 className="font-medium text-teal-800 mb-2">🎯 学科领域</h4>
                <p className="text-sm text-teal-700">
                  5 大学科领域，专业术语精准翻译
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
