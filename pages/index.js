import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyDefaultModelUpdate,
  applyModelConfigSave,
  createModelTestFeedback,
} from '../lib/services/model-settings-state';
import { canTranslatePdfState, createPdfHistoryItem } from '../lib/services/pdf-history';
import { normalizePreviewForDisplay, segmentPreviewBlocks } from '../lib/services/preview-format';

const PRIMARY_VIEWS = [
  { id: 'write', label: '写作', short: '写' },
  { id: 'literature', label: '文献', short: '文' },
  { id: 'translate', label: '翻译', short: '翻' },
  { id: 'history', label: '历史', short: '历' },
  { id: 'settings', label: '设置', short: '设' },
];

const BUILTIN_MODELS = [
  { id: 'claude', label: 'Claude', sub: 'Anthropic' },
  { id: 'deepseek', label: 'DeepSeek', sub: '国内可用' },
  { id: 'doubao', label: '火山方舟', sub: '字节跳动' },
  { id: 'qwen', label: '通义千问', sub: '阿里云' },
];

const TASK_ACTIONS = [
  { label: '扩写', intent: 'expand', mode: 'expand', placeholder: '输入需要扩写的段落、提纲或研究问题。' },
  { label: '润色', intent: 'polish', mode: 'polish', placeholder: '粘贴需要润色的段落，保留原意。' },
  { label: '降重', intent: 'dedup', mode: 'dedup', placeholder: '粘贴需要改写降重的段落或章节。' },
  { label: '综述', intent: 'literature', mode: 'literature', placeholder: '输入综述主题，或先在文献页检索后再注入当前会话。', literatureIntent: true },
  { label: '摘要', intent: 'abstract', mode: 'general', placeholder: '输入论文内容或研究摘要素材，生成摘要。' },
  { label: '结构', intent: 'outline', mode: 'general', placeholder: '输入题目、研究问题或方向，生成章节结构。' },
];

const INITIAL_TRANSLATION_STATUS = {
  stage: 'idle',
  progress: 0,
  message: '',
  transport: null,
  model: null,
  fallbackUsed: false,
  fallbackLevel: 0,
  fallbackReason: '',
};

const INITIAL_MODEL_FORM = {
  id: '',
  label: '',
  provider: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  textModel: '',
  visionModel: '',
  supportsVision: true,
  apiStyle: 'chat-completions',
};

const PDF_HISTORY_KEY = 'paper-assistant:pdfHistory';
const MAX_PDF_HISTORY = 8;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function renderMarkdown(text) {
  if (!text) return '';

  const escapeHtml = (value = '') => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const renderInline = (value = '') => escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--surface2);padding:1px 5px;border-radius:4px;font-size:0.9em;font-family:monospace">$1</code>');

  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = [];
  let table = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p style="margin:0 0 10px;line-height:1.9">${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul style="padding-left:18px;margin:8px 0 12px">${list.map((item) => `<li style="margin:4px 0">${renderInline(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  const flushTable = () => {
    if (!table.length) return;
    const rows = table
      .filter((row) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(row))
      .map((row) => row.split('|').map((cell) => cell.trim()).filter(Boolean));
    if (rows.length) {
      html.push(`<div style="overflow:auto;margin:10px 0 14px"><table style="width:100%;border-collapse:collapse;font-size:13px">${rows.map((cells, rowIndex) => `<tr>${cells.map((cell) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        return `<${tag} style="border:1px solid var(--border);padding:7px 9px;text-align:left;vertical-align:top">${renderInline(cell)}</${tag}>`;
      }).join('')}</tr>`).join('')}</table></div>`);
    }
    table = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushAll();
      continue;
    }

    if (/^[-*_]{3,}$/.test(line)) {
      flushAll();
      html.push('<hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />');
      continue;
    }

    if (/^\|.+\|$/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }

    flushTable();

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const size = heading[1].length === 1 ? 18 : heading[1].length === 2 ? 16 : 14;
      html.push(`<h3 style="font-size:${size}px;font-weight:700;margin:14px 0 8px">${renderInline(heading[2])}</h3>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      list.push(numbered[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();
  return html.join('');
}

function useTimeAgo(dateStr) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!dateStr) return;
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) setLabel('刚刚');
    else if (minutes < 60) setLabel(`${minutes}分钟前`);
    else if (minutes < 1440) setLabel(`${Math.floor(minutes / 60)}小时前`);
    else setLabel(`${Math.floor(minutes / 1440)}天前`);
  }, [dateStr]);

  return label;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

async function readApiPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return {
        rawText,
        payload: rawText ? JSON.parse(rawText) : {},
      };
    } catch {
      return {
        rawText,
        payload: {},
      };
    }
  }

  return {
    rawText,
    payload: {},
  };
}

function formatApiError(response, payload, rawText, fallbackMessage) {
  if (payload?.error) {
    return payload.error;
  }

  if (typeof rawText === 'string' && rawText.trim()) {
    if (rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
      return '服务端返回了 HTML 错误页。通常是本地 Next 开发服务缓存异常，请刷新或重启本地服务。';
    }

    return rawText.trim().slice(0, 160);
  }

  if (response.status >= 500) {
    return `${fallbackMessage}（HTTP ${response.status}）`;
  }

  return fallbackMessage;
}

function cleanPreviewText(text = '') {
  return normalizePreviewForDisplay(text);
}

function readPdfHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PDF_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePdfHistory(items) {
  const next = items.slice(0, MAX_PDF_HISTORY);

  try {
    window.localStorage.setItem(PDF_HISTORY_KEY, JSON.stringify(next));
  } catch {
    const compact = next.map((item) => ({ ...item, pdfBase64: '' }));
    window.localStorage.setItem(PDF_HISTORY_KEY, JSON.stringify(compact));
  }
}

async function writeClipboardText(text) {
  const value = String(text || '');

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function dataUrlToBlob(dataUrl) {
  const [meta = '', encoded = ''] = String(dataUrl).split(',');
  const mimeMatch = meta.match(/^data:([^;]+);base64$/);
  if (!mimeMatch || !encoded) {
    throw new Error('导出文件格式异常');
  }

  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeMatch[1] });
}

function downloadDataUrl(dataUrl, filename) {
  const blob = dataUrlToBlob(dataUrl);
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename || 'paper-assistant-export';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
    link.remove();
  }, 0);
}

export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentView, setCurrentView] = useState('write');
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversationTitle, setConversationTitle] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [assistantMode, setAssistantMode] = useState('general');
  const [assistantModel, setAssistantModel] = useState('');
  const [modelRegistry, setModelRegistry] = useState([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [defaultModelId, setDefaultModelId] = useState('doubao');
  const [modelForm, setModelForm] = useState(INITIAL_MODEL_FORM);
  const [modelFormVisible, setModelFormVisible] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelConfigMessage, setModelConfigMessage] = useState('');
  const [modelTestingId, setModelTestingId] = useState('');
  const [modelTestResults, setModelTestResults] = useState({});
  const [activeIntent, setActiveIntent] = useState('general');
  const [loading, setLoading] = useState(false);
  const [litQuery, setLitQuery] = useState('');
  const [litResults, setLitResults] = useState([]);
  const [litLoading, setLitLoading] = useState(false);
  const [litInject, setLitInject] = useState(false);
  const [litAiSearch, setLitAiSearch] = useState(true);
  const [litActionMessage, setLitActionMessage] = useState('');
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [charCount, setCharCount] = useState(0);
  const [streamingText, setStreamingText] = useState('');
  const [historyLen, setHistoryLen] = useState(20);
  const [renameLoading, setRenameLoading] = useState(false);

  const [pdfFile, setPdfFile] = useState(null);
  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfText, setPdfText] = useState('');
  const [pdfPages, setPdfPages] = useState([]);
  const [translatedText, setTranslatedText] = useState('');
  const [translationField, setTranslationField] = useState('general');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('zh');
  const [showBilingual, setShowBilingual] = useState(false);
  const [translationPreviewMode, setTranslationPreviewMode] = useState('text');
  const [overlayPages, setOverlayPages] = useState([]);
  const [overlayPageIndex, setOverlayPageIndex] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayLoading, setOverlayLoading] = useState(false);
  const [overlayTranslating, setOverlayTranslating] = useState(false);
  const [overlayStatus, setOverlayStatus] = useState('');
  const [overlayPageLimit, setOverlayPageLimit] = useState('one');
  const [pdf2zhJob, setPdf2zhJob] = useState(null);
  const [pdf2zhLoading, setPdf2zhLoading] = useState(false);
  const [pdf2zhError, setPdf2zhError] = useState('');
  const [pdf2zhPreviewType, setPdf2zhPreviewType] = useState('mono');
  const [translationError, setTranslationError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState('docx');
  const [translationStatus, setTranslationStatus] = useState(INITIAL_TRANSLATION_STATUS);
  const [pdfHistory, setPdfHistory] = useState([]);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState('');

  const endRef = useRef(null);
  const textAreaRef = useRef(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatAttachmentInputRef = useRef(null);
  const lastSavedPdf2zhJobIdRef = useRef('');

  useEffect(() => {
    setMounted(true);
    setPdfHistory(readPdfHistory());
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    if (!conversationId) return;
    window.localStorage.setItem('paper-assistant:lastConversationId', conversationId);
  }, [conversationId]);

  useEffect(() => {
    loadConversations();
    loadModels();
    const timer = setTimeout(async () => {
      const lastConversationId = window.localStorage.getItem('paper-assistant:lastConversationId');

      if (lastConversationId) {
        const opened = await openConversation(lastConversationId, true);
        if (opened) return;
      }

      try {
        const response = await fetch('/api/conversations');
        const { payload } = await readApiPayload(response);
        const latest = payload.conversations?.[0];
        if (latest?.id) {
          await openConversation(latest.id, true);
          return;
        }
      } catch {
      }

      newConversation();
    }, 100);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pdf2zhJob?.id || !['queued', 'running'].includes(pdf2zhJob.status)) return undefined;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/pdf2zh/jobs/${encodeURIComponent(pdf2zhJob.id)}`);
        const { payload, rawText } = await readApiPayload(response);

        if (!response.ok || !payload.success) {
          throw new Error(formatApiError(response, payload, rawText, 'pdf2zh 状态查询失败'));
        }

        if (!cancelled) {
          setPdf2zhJob(payload.data.job);
        }
      } catch (error) {
        if (!cancelled) {
          setPdf2zhError(error.message);
        }
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pdf2zhJob?.id, pdf2zhJob?.status]);

  const currentAction = useMemo(
    () => TASK_ACTIONS.find((item) => item.intent === activeIntent) || null,
    [activeIntent],
  );

  const currentConversation = useMemo(
    () => conversations.find((item) => item.id === conversationId) || null,
    [conversations, conversationId],
  );

  const fileSummary = useMemo(() => {
    if (!pdfFile) return '';
    const sizeMb = (pdfFile.size / 1024 / 1024).toFixed(2);
    return `${pdfFile.name} · ${sizeMb} MB`;
  }, [pdfFile]);

  const recentConversations = conversations.slice(0, 5);
  const currentModel = modelRegistry.find((item) => item.id === assistantModel)
    || (modelsLoaded ? BUILTIN_MODELS.find((item) => item.id === assistantModel) : null);
  const defaultModel = modelRegistry.find((item) => item.id === defaultModelId)
    || (modelsLoaded ? BUILTIN_MODELS.find((item) => item.id === defaultModelId) : null);
  const configuredModels = modelRegistry.filter((item) => item.configured);
  const visionReadyModels = modelRegistry.filter((item) => item.supportsVision && item.visionConfigured);
  const missingModelConfig = modelsLoaded && currentModel && !currentModel.configured;
  const currentModelStatus = !modelsLoaded ? '加载中' : currentModel?.configured ? '已配置' : '待配置';
  const hasTranslationOutput = Boolean(translatedText.trim());
  const pdf2zhCanDownload = pdf2zhJob?.status === 'done';
  const pdf2zhStatusLabel = pdf2zhJob?.status
    ? {
      submitting: '提交中',
      queued: '排队中',
      running: '处理中',
      done: '已完成',
      failed: '失败',
    }[pdf2zhJob.status] || pdf2zhJob.status
    : '未启动';

  const savePdfHistoryItem = useCallback((item) => {
    const nextItem = createPdfHistoryItem({
      item,
      cleaner: cleanPreviewText,
      defaults: {
        field: translationField,
        sourceLang,
        targetLang,
        transport: translationStatus.transport || 'parsed',
        model: translationStatus.model || assistantModel || '',
        translatedText,
        originalText: pdfText,
        pdfBase64,
      },
    });

    setPdfHistory((current) => {
      const deduped = current.filter((entry) => entry.filename !== nextItem.filename);
      const next = [nextItem, ...deduped].slice(0, MAX_PDF_HISTORY);
      writePdfHistory(next);
      return next;
    });
  }, [assistantModel, pdfBase64, pdfText, sourceLang, targetLang, translatedText, translationField, translationStatus.model, translationStatus.transport]);

  useEffect(() => {
    if (pdf2zhJob?.status !== 'done' || !pdf2zhJob.id) return;
    if (lastSavedPdf2zhJobIdRef.current === pdf2zhJob.id) return;

    lastSavedPdf2zhJobIdRef.current = pdf2zhJob.id;
    setPdf2zhPreviewType('mono');
    setTranslationPreviewMode('pdf2zh');
    savePdfHistoryItem({
      filename: pdfFile?.name || pdf2zhJob.filename || 'paper.pdf',
      fileSize: pdfFile?.size || pdf2zhJob.fileSize || 0,
      totalPages: pdfPages.length || 0,
      pdfBase64,
      originalText: pdfText,
      translatedText,
      status: 'pdf2zh',
      transport: 'pdf2zh',
      model: 'pdf2zh',
      pdf2zhJob,
      pdf2zhPreviewType: 'mono',
    });
  }, [pdf2zhJob, pdfBase64, pdfFile?.name, pdfFile?.size, pdfPages.length, pdfText, savePdfHistoryItem, translatedText]);

  const restorePdfHistoryItem = useCallback((item) => {
    setPdfFile({
      name: item.filename,
      size: item.fileSize || 0,
    });
    setPdfBase64(item.pdfBase64 || '');
    setPdfText(item.originalText || '');
    setPdfPages(Array.from({ length: item.totalPages || 0 }, (_, index) => ({ pageNumber: index + 1, text: '' })));
    setTranslatedText(item.translatedText || '');
    setShowBilingual(Boolean(item.originalText && !item.translatedText));
    setPdf2zhJob(item.pdf2zhJob || null);
    setPdf2zhPreviewType(item.pdf2zhPreviewType || 'mono');
    setTranslationPreviewMode(item.pdf2zhJob?.status === 'done' ? 'pdf2zh' : item.overlayPages?.length ? 'overlay' : 'text');
    setOverlayPages(item.overlayPages || []);
    setOverlayPageIndex(0);
    setOverlayStatus(item.overlayStatus || (item.overlayPages?.length ? '已从历史记录恢复原位对照' : ''));
    setTranslationField(item.field || 'general');
    setSourceLang(item.sourceLang || 'en');
    setTargetLang(item.targetLang || 'zh');
    setTranslationError('');
    setTranslationStatus({
      stage: item.status === 'done' ? 'done' : 'parsed',
      progress: item.status === 'done' ? 100 : 0,
      message: item.overlayPages?.length
        ? '已从历史记录恢复原位对照'
        : item.pdfBase64
          ? item.status === 'done' ? '已从历史记录恢复' : '已恢复历史 PDF 记录'
          : item.originalText
            ? '已恢复历史 PDF 文本，原始文件未保存时将使用文本翻译'
            : '已恢复历史 PDF 记录',
      transport: item.transport || null,
      model: item.model || null,
      fallbackUsed: item.transport === 'text-fallback',
      fallbackLevel: item.transport === 'text-fallback' ? 3 : 0,
      fallbackReason: '',
    });
  }, []);

  const deleteRemotePdf2zhJob = useCallback(async (jobId) => {
    if (!jobId) return null;

    const response = await fetch(`/api/pdf2zh/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
    const { payload, rawText } = await readApiPayload(response);
    if (!response.ok || !payload.success) {
      const message = formatApiError(response, payload, rawText, 'pdf2zh 文件删除失败');
      if (!/not found|job not found|不存在|未找到/i.test(message)) {
        throw new Error(message);
      }
    }

    return payload;
  }, []);

  const renamePdfHistoryItem = useCallback((item) => {
    const nextName = window.prompt('重命名这条 PDF 处理记录', item.filename || '');
    if (!nextName?.trim()) return;

    setPdfHistory((current) => {
      const next = current.map((entry) => (
        entry.id === item.id
          ? { ...entry, filename: nextName.trim(), updatedAt: new Date().toISOString() }
          : entry
      ));
      writePdfHistory(next);
      return next;
    });
  }, []);

  const deletePdfHistoryItem = useCallback(async (item) => {
    if (!window.confirm(`删除处理记录“${item.filename}”？`)) return;

    try {
      if (item.pdf2zhJob?.id) {
        await deleteRemotePdf2zhJob(item.pdf2zhJob.id);
      }

      setPdfHistory((current) => {
        const next = current.filter((entry) => entry.id !== item.id);
        writePdfHistory(next);
        return next;
      });

      if (pdf2zhJob?.id === item.pdf2zhJob?.id) {
        setPdf2zhJob(null);
      }
    } catch (error) {
      setPdf2zhError(error.message);
    }
  }, [deleteRemotePdf2zhJob, pdf2zhJob?.id]);

  const cleanupPdfHistoryGeneratedFiles = useCallback(async (item) => {
    if (!item.pdf2zhJob?.id) return;
    if (!window.confirm(`清理“${item.filename}”的排版 PDF 生成文件？历史记录会保留，但单语/双语 PDF 需要重新生成。`)) return;

    try {
      const payload = await deleteRemotePdf2zhJob(item.pdf2zhJob.id);
      const deletedJobId = item.pdf2zhJob.id;
      const bytesFreed = payload?.data?.result?.bytesFreed || payload?.result?.bytesFreed || 0;

      setPdfHistory((current) => {
        const next = current.map((entry) => (
          entry.id === item.id
            ? { ...entry, pdf2zhJob: null, updatedAt: new Date().toISOString() }
            : entry
        ));
        writePdfHistory(next);
        return next;
      });

      if (pdf2zhJob?.id === deletedJobId) {
        setPdf2zhJob(null);
        if (translationPreviewMode === 'pdf2zh') {
          setTranslationPreviewMode(translatedText ? 'text' : 'overlay');
        }
      }

      setPdf2zhError(bytesFreed ? `已清理生成文件，释放约 ${formatBytes(bytesFreed)}。` : '已清理生成文件。');
    } catch (error) {
      setPdf2zhError(error.message);
    }
  }, [deleteRemotePdf2zhJob, pdf2zhJob?.id, translatedText, translationPreviewMode]);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations');
      const { payload } = await readApiPayload(response);
      setConversations(payload.conversations || []);
    } catch {
      setConversations([]);
    }
  }, []);

  const refreshModelsAndFind = useCallback(async (preferredModelId = '') => {
    const response = await fetch('/api/models');
    const { payload, rawText } = await readApiPayload(response);
    if (!response.ok) {
      throw new Error(formatApiError(response, payload, rawText, '模型配置读取失败'));
    }

    const models = payload.models || [];
    const nextDefault = payload.defaultModel || 'doubao';
    const nextModelId = preferredModelId || assistantModel || nextDefault;
    const nextModel = models.find((item) => item.id === nextModelId) || models.find((item) => item.id === nextDefault) || null;

    setModelRegistry(models);
    setDefaultModelId(nextDefault);
    setModelsLoaded(true);
    setAssistantModel(nextModel?.id || nextDefault);

    return nextModel;
  }, [assistantModel]);

  const loadModels = useCallback(async () => {
    try {
      await refreshModelsAndFind(assistantModel);
    } catch (error) {
      setModelConfigMessage(error.message);
      setModelsLoaded(true);
    }
  }, [assistantModel, refreshModelsAndFind]);

  const newConversation = useCallback(() => {
    const id = genId();
    setConversationId(id);
    setConversationTitle('未命名写作会话');
    setMessages([]);
    setStreamingText('');
    setInput('');
    setLitInject(false);
    setActiveIntent('general');
    setAssistantMode('general');
    setCurrentView('write');
    window.localStorage.setItem('paper-assistant:lastConversationId', id);
  }, []);

  const openConversation = useCallback(async (id, silent = false) => {
    try {
      const response = await fetch(`/api/conversations?id=${id}&action=history`);
      const { payload, rawText } = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(formatApiError(response, payload, rawText, '加载对话失败'));
      }

      const conversation = conversations.find((item) => item.id === id);
      setConversationId(id);
      setConversationTitle(conversation?.title || '未命名写作会话');
      setMessages(payload.history || []);
      setCurrentView('write');
      setActiveIntent('general');
      setAssistantMode('general');
      window.localStorage.setItem('paper-assistant:lastConversationId', id);
      return true;
    } catch {
      if (!silent) {
        setConversationId(id);
        setConversationTitle('未命名写作会话');
        setMessages([]);
      }
      return false;
    }
  }, [conversations]);

  async function renameConversation() {
    if (!conversationId || !conversationTitle.trim()) return;

    setRenameLoading(true);
    try {
      const response = await fetch('/api/conversations?action=rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: conversationId,
          title: conversationTitle.trim(),
        }),
      });
      const { payload, rawText } = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(formatApiError(response, payload, rawText, '重命名失败'));
      }
      await loadConversations();
    } catch {
    } finally {
      setRenameLoading(false);
    }
  }

  function handleInput(event) {
    const value = event.target.value;
    setInput(value);
    setCharCount(value.length);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 240)}px`;
  }

  async function handleChatAttachmentSelect(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setAttachmentError('');

    try {
      const prepared = [];
      for (const file of files.slice(0, 4)) {
        if (file.size > 8 * 1024 * 1024) {
          throw new Error(`${file.name} 超过 8MB，暂不支持作为写作附件。`);
        }

        if (file.type.startsWith('image/')) {
          prepared.push({
            id: genId(),
            kind: 'image',
            name: file.name,
            size: file.size,
            dataUrl: await readFileAsDataUrl(file),
          });
          continue;
        }

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const fileBase64 = await readFileAsDataUrl(file);
          const response = await fetch('/api/pdf/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileBase64, filename: file.name }),
          });
          const { payload, rawText } = await readApiPayload(response);
          if (!response.ok || !payload.success) {
            throw new Error(formatApiError(response, payload, rawText, `${file.name} 解析失败`));
          }
          prepared.push({
            id: genId(),
            kind: 'document',
            name: file.name,
            size: file.size,
            text: cleanPreviewText(payload.data?.text || '').slice(0, 12000),
            meta: `${payload.data?.totalPages || 0} 页 PDF`,
          });
          continue;
        }

        if (file.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(file.name)) {
          prepared.push({
            id: genId(),
            kind: 'document',
            name: file.name,
            size: file.size,
            text: (await file.text()).slice(0, 12000),
            meta: '文本附件',
          });
          continue;
        }

        throw new Error(`${file.name} 暂不支持。当前支持图片、PDF、TXT/MD。`);
      }

      setChatAttachments((current) => [...current, ...prepared].slice(0, 6));
    } catch (error) {
      setAttachmentError(error.message);
    } finally {
      if (chatAttachmentInputRef.current) {
        chatAttachmentInputRef.current.value = '';
      }
    }
  }

  function removeChatAttachment(id) {
    setChatAttachments((current) => current.filter((item) => item.id !== id));
  }

  function chooseAction(action) {
    setActiveIntent(action.intent);
    setAssistantMode(action.mode);
    if (action.literatureIntent) {
      setCurrentView('literature');
    } else {
      setCurrentView('write');
      textAreaRef.current?.focus();
    }
  }

  async function saveModelConfig(event) {
    event?.preventDefault?.();
    setModelSaving(true);
    setModelConfigMessage('');

    try {
      const isBuiltin = BUILTIN_MODELS.some((item) => item.id === modelForm.id);
      const response = await fetch(isBuiltin ? '/api/models?action=override' : '/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelForm),
      });
      const { payload, rawText } = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(formatApiError(response, payload, rawText, '保存模型配置失败'));
      }

      const nextState = applyModelConfigSave({
        assistantModel,
        defaultModelId,
        formModelId: modelForm.id,
        payload,
      });

      setModelRegistry(nextState.models);
      setDefaultModelId(nextState.defaultModelId);
      setModelsLoaded(true);
      setAssistantModel(nextState.assistantModel);
      setModelForm(INITIAL_MODEL_FORM);
      setModelFormVisible(false);
      setModelConfigMessage(nextState.message);
    } catch (error) {
      setModelConfigMessage(error.message);
    } finally {
      setModelSaving(false);
    }
  }

  async function chooseDefaultModel(modelId) {
    setModelConfigMessage('');
    try {
      const response = await fetch('/api/models?action=default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const { payload, rawText } = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(formatApiError(response, payload, rawText, '设置默认模型失败'));
      }

      const nextState = applyDefaultModelUpdate({
        assistantModel,
        modelId,
        payload,
      });

      setDefaultModelId(nextState.defaultModelId);
      setModelRegistry(nextState.models);
      setModelsLoaded(true);
      setAssistantModel(nextState.assistantModel);
      setModelConfigMessage(nextState.message);
    } catch (error) {
      setModelConfigMessage(error.message);
    }
  }

  async function removeCustomModel(id) {
    setModelConfigMessage('');
    try {
      const target = modelRegistry.find((item) => item.id === id);
      const response = await fetch('/api/models?action=delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const { payload, rawText } = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(formatApiError(response, payload, rawText, '删除模型失败'));
      }

      setModelRegistry(payload.models || []);
      setDefaultModelId(payload.defaultModel || 'doubao');
      setModelsLoaded(true);
      setAssistantModel((current) => (current === id ? (payload.defaultModel || 'doubao') : current));
      setModelConfigMessage(target?.source === 'builtin' ? '系统模型的自定义覆盖已清除。' : '自定义模型已删除。');
    } catch (error) {
      setModelConfigMessage(error.message);
    }
  }

  async function testModel(modelId, capability = 'both') {
    setModelTestingId(`${modelId}:${capability}`);
    setModelConfigMessage('');
    try {
      const response = await fetch('/api/models?action=test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, capability }),
      });
      const { payload, rawText } = await readApiPayload(response);
      if (!response.ok) {
        throw new Error(formatApiError(response, payload, rawText, '模型测试失败'));
      }

      const feedback = createModelTestFeedback({ assistantModel, payload });
      setAssistantModel(feedback.assistantModel);
      setModelTestResults((current) => ({
        ...current,
        [modelId]: {
          test: feedback.test,
          message: feedback.message,
          testedAt: new Date().toISOString(),
        },
      }));
      setModelConfigMessage(feedback.message);
    } catch (error) {
      setModelConfigMessage(error.message);
    } finally {
      setModelTestingId('');
    }
  }

function editModel(model) {
  setModelForm({
      id: model.id,
      label: model.label,
      provider: model.provider || 'openai-compatible',
      baseUrl: model.baseUrl || '',
      apiKey: '',
      textModel: model.textModel || '',
      visionModel: model.visionModel || '',
      supportsVision: Boolean(model.supportsVision),
      apiStyle: model.apiStyle || 'chat-completions',
    });
    setModelFormVisible(true);
    setCurrentView('settings');
    setModelConfigMessage(`正在编辑 ${model.label}。如不改 API Key，可留空后直接保存。`);
  }

  async function doLiteratureSearch(queryOverride) {
    const query = (queryOverride || litQuery).trim();
    if (!query) return;

    setLitLoading(true);

    try {
      const response = await fetch('/api/literature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          limit: 6,
          ai: litAiSearch,
          model: assistantModel || defaultModelId,
        }),
      });
      const { payload, rawText } = await readApiPayload(response);

      if (!response.ok) {
        throw new Error(formatApiError(response, payload, rawText, '文献检索失败'));
      }

      setLitResults(payload.results || []);
      if (payload.meta?.aiError) {
        setLitActionMessage(`${payload.meta.aiError}。当前使用原始关键词检索。`);
      } else if (payload.meta?.aiQuery && payload.meta.aiQuery !== query) {
        setLitActionMessage(`AI 已将检索式优化为：${payload.meta.aiQuery}`);
      } else {
        setLitActionMessage('');
      }
      setCurrentView('literature');
    } catch (error) {
      alert(`文献检索失败：${error.message}`);
    } finally {
      setLitLoading(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    const attachmentSnapshot = chatAttachments;
    if ((!text && attachmentSnapshot.length === 0) || loading || !conversationId) return;

    let modelForRequest = currentModel;
    if (!modelsLoaded || missingModelConfig) {
      try {
        modelForRequest = await refreshModelsAndFind(assistantModel || defaultModelId);
      } catch (error) {
        setMessages((current) => [...current, { role: 'error', content: error.message || '模型配置读取失败，请稍后重试。' }]);
        return;
      }
    }

    if (modelForRequest && !modelForRequest.configured) {
      setMessages((current) => [...current, { role: 'error', content: `当前模型 ${modelForRequest.label || assistantModel} 尚未配置，请先到“设置”页补充 API Key。` }]);
      setCurrentView('settings');
      return;
    }

    const providerForRequest = modelForRequest?.id || assistantModel || defaultModelId;

    setInput('');
    setCharCount(0);
    setChatAttachments([]);
    setAttachmentError('');
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto';
    }

    const visibleUserContent = attachmentSnapshot.length
      ? `${text || '请处理附件'}\n\n附件：${attachmentSnapshot.map((item) => item.name).join('、')}`
      : text;
    setMessages((current) => [...current, { role: 'user', content: visibleUserContent }]);
    setLoading(true);
    setStreamingText('');
    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          userMessage: text,
          attachments: attachmentSnapshot.map((item) => ({
            kind: item.kind,
            name: item.name,
            text: item.text || '',
            dataUrl: item.dataUrl || '',
            meta: item.meta || '',
          })),
          conversationId,
          mode: assistantMode,
          intent: activeIntent,
          model: providerForRequest,
          searchLit: litInject,
          litQuery: litQuery.trim(),
          contextFlags: {
            withLiterature: litInject,
            isDraftingTask: Boolean(currentAction && ['expand', 'outline', 'abstract', 'literature', 'title'].includes(currentAction.intent)),
            isRevisionTask: Boolean(currentAction && ['polish', 'dedup', 'deai'].includes(currentAction.intent)),
          },
          historyLen,
        }),
      });

      if (!response.ok) {
        const { payload, rawText } = await readApiPayload(response);
        throw new Error(formatApiError(response, payload, rawText, '对话请求失败'));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const payload = JSON.parse(line.slice(6));

            if (payload.chunk) {
              full += payload.chunk;
              setStreamingText(full);
            }

            if (payload.error) {
              throw new Error(payload.error);
            }

            if (payload.done) {
              setStreamingText('');
              setMessages((current) => [...current, { role: 'assistant', content: full }]);
              if (payload.literatureResults?.length > 0) {
                setLitResults(payload.literatureResults);
              }
              await loadConversations();
            }
          } catch (error) {
            if (error.message !== 'Unexpected end of JSON input') {
              console.warn(error);
            }
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        if (streamingText) {
          setMessages((current) => [...current, { role: 'assistant', content: `${streamingText}\n\n*（已中止）*` }]);
        }
        setStreamingText('');
      } else {
        setMessages((current) => [...current, { role: 'error', content: error.message }]);
      }
    } finally {
      setLoading(false);
      setStreamingText('');
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  async function copyMessage(content, idx) {
    const copied = await writeClipboardText(content);
    if (copied) {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }
  }

  async function deleteConversationItem(id, event) {
    event?.stopPropagation?.();
    if (!confirm('删除此对话？')) return;

    await fetch(`/api/conversations?id=${id}`, { method: 'DELETE' });
    await loadConversations();

    if (window.localStorage.getItem('paper-assistant:lastConversationId') === id) {
      window.localStorage.removeItem('paper-assistant:lastConversationId');
    }

    if (id === conversationId) {
      newConversation();
    }
  }

  async function handleSelectFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setTranslationError('请选择 PDF 文件');
      return;
    }

    setIsUploading(true);
    setTranslationError('');
    setTranslatedText('');
    setTranslationPreviewMode('text');
    setOverlayPages([]);
    setOverlayPageIndex(0);
    setOverlayStatus('');
    setPdf2zhJob(null);
    setPdf2zhLoading(false);
    setPdf2zhError('');
    setTranslationStatus({
      stage: 'parsing',
      progress: 5,
      message: '正在校验并解析 PDF',
      transport: null,
      model: null,
      fallbackUsed: false,
      fallbackLevel: 0,
      fallbackReason: '',
    });

    try {
      const fileBase64 = await readFileAsDataUrl(file);
      const response = await fetch('/api/pdf/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64,
          filename: file.name,
        }),
      });
      const { payload, rawText } = await readApiPayload(response);

      if (!response.ok || !payload.success) {
        throw new Error(formatApiError(response, payload, rawText, 'PDF 解析失败'));
      }

      setPdfFile(file);
      setPdfBase64(fileBase64);
      setPdfText(payload.data.text);
      setPdfPages(payload.data.pages || []);
      setTranslationStatus({
        stage: 'parsed',
        progress: 100,
        message: `解析完成，共 ${payload.data.totalPages} 页`,
        transport: null,
        model: null,
        fallbackUsed: false,
        fallbackLevel: 0,
        fallbackReason: '',
      });
      savePdfHistoryItem({
        filename: file.name,
        fileSize: file.size,
        totalPages: payload.data.totalPages,
        pdfBase64: fileBase64,
        originalText: payload.data.text,
        status: 'parsed',
        transport: 'parsed',
        model: null,
      });
    } catch (error) {
      setTranslationError(error.message);
      setTranslationStatus({
        ...INITIAL_TRANSLATION_STATUS,
        stage: 'error',
        message: 'PDF 解析失败',
      });
    } finally {
      setIsUploading(false);
    }
  }

  async function handleTranslate() {
    const useTextOnlyHistory = !pdfBase64 && Boolean(pdfText.trim());

    if (!canTranslatePdfState({ pdfBase64, pdfText })) {
      setTranslationError('请先上传 PDF，或载入包含解析文本的历史记录');
      return;
    }

    setIsTranslating(true);
    setTranslationError('');
    setTranslatedText('');
    setTranslationStatus({
      stage: 'uploading',
      progress: 10,
      message: useTextOnlyHistory ? '历史记录缺少原始 PDF，准备使用文本翻译' : '准备开始翻译',
      transport: useTextOnlyHistory ? 'text-fallback' : null,
      model: useTextOnlyHistory ? assistantModel : null,
      fallbackUsed: useTextOnlyHistory,
      fallbackLevel: useTextOnlyHistory ? 3 : 0,
      fallbackReason: '',
    });

    try {
      const response = await fetch(useTextOnlyHistory ? '/api/translate' : '/api/translate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(useTextOnlyHistory
          ? {
            text: pdfText,
            sourceLang,
            targetLang,
            field: translationField,
            model: assistantModel,
            stream: true,
          }
          : {
            pdfBase64,
            filename: pdfFile?.name || 'paper.pdf',
            extractedText: pdfText,
            pages: pdfPages,
            sourceLang,
            targetLang,
            field: translationField,
            provider: assistantModel,
            stream: true,
          }),
      });

      if (!response.ok) {
        const { payload, rawText } = await readApiPayload(response);
        throw new Error(formatApiError(response, payload, rawText, '翻译失败'));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = JSON.parse(line.slice(6));

          if (payload.error) {
            throw new Error(payload.error);
          }

          if (payload.chunk) {
            setTranslatedText((current) => current + payload.chunk);
          }

          if (payload.meta || payload.message || typeof payload.progress === 'number') {
            setTranslationStatus((current) => ({
              stage: payload.stage || current.stage,
              progress: typeof payload.progress === 'number' ? payload.progress : current.progress,
              message: payload.message || current.message,
              transport: payload.meta?.transport || (useTextOnlyHistory ? 'text-fallback' : current.transport),
              model: payload.meta?.model || current.model,
              fallbackUsed: payload.meta?.fallbackUsed ?? (useTextOnlyHistory || current.fallbackUsed),
              fallbackLevel: payload.meta?.fallbackLevel ?? (useTextOnlyHistory ? 3 : current.fallbackLevel),
              fallbackReason: payload.meta?.fallbackReason || current.fallbackReason,
            }));
          }

          if (payload.done && payload.data?.translation) {
            setTranslatedText(payload.data.translation);
            savePdfHistoryItem({
              filename: pdfFile?.name || 'paper.pdf',
              fileSize: pdfFile?.size || 0,
              totalPages: pdfPages.length,
              pdfBase64,
              originalText: pdfText,
              translatedText: payload.data.translation,
              status: 'done',
              transport: payload.meta?.transport || (useTextOnlyHistory ? 'text-fallback' : translationStatus.transport) || 'text-fallback',
              model: payload.meta?.model || translationStatus.model || assistantModel,
            });
          }
        }
      }
    } catch (error) {
      setTranslationError(error.message);
      setTranslationStatus((current) => ({
        ...current,
        stage: 'error',
        message: '翻译失败',
      }));
    } finally {
      setIsTranslating(false);
    }
  }

  async function handleGenerateOverlay() {
    if (!pdfBase64) {
      setTranslationError('请先上传 PDF');
      return;
    }

    setTranslationPreviewMode('overlay');
    setOverlayLoading(true);
    setOverlayTranslating(false);
    setOverlayStatus('正在识别页面文字框');
    setOverlayPages([]);
    setOverlayPageIndex(0);
    setTranslationError('');
    setTranslationStatus({
      stage: 'overlay-ocr',
      progress: 15,
      message: '正在生成原位对照 OCR',
      transport: 'overlay',
      model: currentModel?.label || assistantModel || null,
      fallbackUsed: false,
      fallbackLevel: 0,
      fallbackReason: '',
    });

    try {
      const ocrResponse = await fetch('/api/pdf/overlay-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64,
          filename: pdfFile?.name || 'paper.pdf',
          provider: assistantModel,
          engine: 'auto',
          pageLimit: overlayPageLimit === 'all' ? 'all' : 1,
        }),
      });
      const { payload: ocrPayload, rawText: ocrRawText } = await readApiPayload(ocrResponse);

      if (!ocrResponse.ok || !ocrPayload.success) {
        throw new Error(formatApiError(ocrResponse, ocrPayload, ocrRawText, '原位 OCR 失败'));
      }

      const recognizedPages = ocrPayload.data?.pages || [];
      const blockCount = recognizedPages.reduce((sum, page) => sum + (page.blocks?.length || 0), 0);
      const totalPages = ocrPayload.data?.totalPages || recognizedPages.length;
      const pageScope = recognizedPages.length < totalPages
        ? `前 ${recognizedPages.length}/${totalPages} 页`
        : `${recognizedPages.length} 页`;
      setOverlayPages(recognizedPages);
      setOverlayStatus(`已识别${pageScope}、${blockCount} 个文本块，正在生成译文覆盖层`);
      setOverlayLoading(false);
      setOverlayTranslating(true);
      setTranslationStatus((current) => ({
        ...current,
        stage: 'overlay-translate',
        progress: 55,
        message: `已识别${pageScope}、${blockCount} 个文本块，正在翻译覆盖层`,
        model: ocrPayload.meta?.model || current.model,
      }));

      const translateResponse = await fetch('/api/translate-overlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: recognizedPages,
          sourceLang,
          targetLang,
          field: translationField,
          provider: assistantModel,
        }),
      });
      const { payload: translatePayload, rawText: translateRawText } = await readApiPayload(translateResponse);

      if (!translateResponse.ok || !translatePayload.success) {
        throw new Error(formatApiError(translateResponse, translatePayload, translateRawText, '原位覆盖翻译失败'));
      }

      const translatedPages = translatePayload.data?.pages || recognizedPages;
      setOverlayPages(translatedPages);
      setOverlayStatus('原位对照已生成');
      setTranslationStatus((current) => ({
        ...current,
        stage: 'overlay-done',
        progress: 100,
        message: '原位对照已生成',
        model: translatePayload.meta?.model || current.model,
      }));
      savePdfHistoryItem({
        filename: pdfFile?.name || 'paper.pdf',
        fileSize: pdfFile?.size || 0,
        totalPages: pdfPages.length || translatedPages.length,
        pdfBase64,
        originalText: pdfText,
        translatedText,
        status: 'overlay',
        transport: 'overlay',
        model: translatePayload.meta?.model || ocrPayload.meta?.model || assistantModel,
        overlayPages: translatedPages,
        overlayStatus: '原位对照已生成',
      });
    } catch (error) {
      setTranslationError(error.message);
      setOverlayStatus(error.message);
      setTranslationStatus((current) => ({
        ...current,
        stage: 'error',
        progress: Math.max(current.progress, 15),
        message: '原位对照生成失败',
        fallbackReason: error.message,
      }));
    } finally {
      setOverlayLoading(false);
      setOverlayTranslating(false);
    }
  }

  async function handleStartPdf2zh() {
    if (!pdfBase64) {
      setPdf2zhError('当前记录没有保存原始 PDF，请重新上传 PDF 后再启动排版翻译。');
      return;
    }

    setPdf2zhLoading(true);
    setPdf2zhError('');
    lastSavedPdf2zhJobIdRef.current = '';
    setPdf2zhPreviewType('mono');
    setTranslationPreviewMode('pdf2zh');
    setPdf2zhJob({
      id: '',
      status: 'submitting',
      stage: 'submitting',
      progress: 0,
      filename: pdfFile?.name || 'paper.pdf',
    });

    try {
      const response = await fetch('/api/pdf2zh/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64,
          filename: pdfFile?.name || 'paper.pdf',
          sourceLang,
          targetLang,
          mode: 'dual',
          pages: 'all',
        }),
      });
      const { payload, rawText } = await readApiPayload(response);

      if (!response.ok || !payload.success) {
        throw new Error(formatApiError(response, payload, rawText, 'pdf2zh 任务提交失败'));
      }

      setPdf2zhJob(payload.data.job);
    } catch (error) {
      setPdf2zhError(error.message);
      setPdf2zhJob(null);
    } finally {
      setPdf2zhLoading(false);
    }
  }

  async function handleDeleteCurrentPdf2zhJob() {
    if (!pdf2zhJob?.id) return;
    if (!window.confirm('删除当前排版翻译生成的 PDF 文件？这会释放服务器存储空间。')) return;

    try {
      const payload = await deleteRemotePdf2zhJob(pdf2zhJob.id);
      const deletedJobId = pdf2zhJob.id;
      const bytesFreed = payload?.data?.result?.bytesFreed || payload?.result?.bytesFreed || 0;
      setPdf2zhJob(null);
      setPdf2zhError(bytesFreed ? `已删除当前排版 PDF 文件，释放约 ${formatBytes(bytesFreed)}。` : '已删除当前排版 PDF 文件。');
      if (translationPreviewMode === 'pdf2zh') {
        setTranslationPreviewMode(translatedText ? 'text' : 'overlay');
      }
      setPdfHistory((current) => {
        const next = current.map((entry) => (
          entry.pdf2zhJob?.id === deletedJobId
            ? { ...entry, pdf2zhJob: null, updatedAt: new Date().toISOString() }
            : entry
        ));
        writePdfHistory(next);
        return next;
      });
    } catch (error) {
      setPdf2zhError(error.message);
    }
  }

  async function handleExport() {
    if (!translatedText) {
      setTranslationError('没有可导出的译文');
      return;
    }

    setIsExporting(true);
    setTranslationError('');

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: exportFormat,
          originalText: pdfText,
          translatedText,
          pdfBase64,
          filename: pdfFile?.name || 'translation',
          sourceLang,
          targetLang,
        }),
      });
      const { payload, rawText } = await readApiPayload(response);

      if (!response.ok || !payload.success) {
        throw new Error(formatApiError(response, payload, rawText, '导出失败'));
      }

      downloadDataUrl(payload.data.downloadUrl, payload.data.filename);
    } catch (error) {
      setTranslationError(error.message);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCopyTranslation() {
    if (!translatedText) return;
    const copied = await writeClipboardText(translatedText);
    if (!copied) {
      setTranslationError('复制失败，请检查浏览器剪贴板权限。');
    }
  }

  function handleResetTranslation() {
    setPdfFile(null);
    setPdfBase64('');
    setPdfText('');
    setPdfPages([]);
    setTranslatedText('');
    setTranslationError('');
    setShowBilingual(false);
    setTranslationPreviewMode('text');
    setOverlayPages([]);
    setOverlayPageIndex(0);
    setOverlayVisible(true);
    setOverlayStatus('');
    setPdf2zhJob(null);
    setPdf2zhLoading(false);
    setPdf2zhError('');
    setTranslationStatus(INITIAL_TRANSLATION_STATUS);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function injectPaperToChat(paper) {
    setInput(`标题：${paper.title}\n作者：${paper.authors}\n年份：${paper.year}\n摘要：${paper.abstract}`);
    setActiveIntent('literature');
    setAssistantMode('literature');
    setCurrentView('write');
    setLitActionMessage(`已将《${paper.title}》注入当前会话。`);
    textAreaRef.current?.focus();
  }

  async function copyCitation(paper) {
    try {
      const copied = await writeClipboardText(paper.gbRef);
      setLitActionMessage(copied
        ? `已复制《${paper.title}》的引用格式。`
        : '复制引用失败，请检查浏览器剪贴板权限。');
    } catch {
      setLitActionMessage('复制引用失败，请检查浏览器剪贴板权限。');
    }
  }

  function openPaper(paper) {
    const target = paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : '');
    if (!target) {
      setLitActionMessage(`《${paper.title}》当前没有可打开的原文链接。`);
      return;
    }

    window.open(target, '_blank', 'noopener,noreferrer');
    setLitActionMessage(`已在新标签页打开《${paper.title}》原文链接。`);
  }

  if (!mounted) {
    return <div style={{ height: '100vh', background: '#f5f1e8' }} />;
  }

  return (
    <div style={pageStyle(sidebarCollapsed)}>
      <aside style={leftRailStyle(sidebarCollapsed)}>
        <div style={railHeaderStyle(sidebarCollapsed)}>
          <div style={brandStyle(sidebarCollapsed)}>
          <div style={brandMarkStyle()}>PA</div>
          {!sidebarCollapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap' }}>Paper Assistant</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, whiteSpace: 'nowrap' }}>Academic Workbench</div>
            </div>
          )}
          </div>
          <button
            onClick={() => setSidebarCollapsed((current) => !current)}
            style={collapseButtonStyle(sidebarCollapsed)}
            title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
          >
            {sidebarCollapsed ? '>' : '<'}
          </button>
        </div>

        <nav style={railNavStyle(sidebarCollapsed)}>
          {PRIMARY_VIEWS.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentView(item.id)}
              style={navButtonStyle(currentView === item.id, sidebarCollapsed)}
              title={item.label}
            >
              {sidebarCollapsed ? item.short : item.label}
            </button>
          ))}
        </nav>

        {!sidebarCollapsed && (
        <div style={{ marginTop: 18, minHeight: 0, overflowY: 'auto' }}>
          <div style={sectionLabelStyle()}>最近会话</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {recentConversations.length === 0 && (
              <div style={mutedPanelStyle()}>暂无会话记录</div>
            )}
            {recentConversations.map((item) => (
              <button key={item.id} onClick={() => openConversation(item.id)} style={recentItemStyle(item.id === conversationId)}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.title || '未命名写作会话'}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                  {formatTaskLabel(item)} · {item.message_count} 条
                </span>
              </button>
            ))}
          </div>
        </div>
        )}

        <button onClick={newConversation} style={primaryRailButtonStyle(sidebarCollapsed)} title="新建写作会话">
          {sidebarCollapsed ? '+' : '新建写作会话'}
        </button>
      </aside>

      <main style={centerCanvasStyle()}>
        {currentView === 'write' && (
          <section style={canvasPanelStyle()}>
            <header style={canvasHeaderStyle()}>
              <div>
                <div style={canvasEyebrowStyle()}>Writing Desk</div>
                <input
                  value={conversationTitle}
                  onChange={(event) => setConversationTitle(event.target.value)}
                  onBlur={renameConversation}
                  placeholder="未命名写作会话"
                  style={titleInputStyle()}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {renameLoading ? '保存中…' : currentConversation ? '已保存' : '本地草稿'}
              </div>
            </header>

            <div style={writeBodyStyle()}>
              {messages.length === 0 && !streamingText && !loading ? (
                <div style={emptyDeskStyle()}>
                  <div style={canvasEyebrowStyle()}>Start</div>
                  <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.2, marginBottom: 8 }}>先选择任务，再开始输入</div>
                  <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.8, maxWidth: 680 }}>
                    输入论文题目、段落、研究问题或修改要求。当前工作台会根据任务类型在后端自动组装写作模板，不在前端直接暴露 prompt。
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {messages.map((message, index) => (
                    <DocumentEntry key={index} message={message} idx={index} copiedIdx={copiedIdx} onCopy={copyMessage} />
                  ))}

                  {streamingText && (
                    <div style={assistantBlockStyle()}>
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }} />
                      <span className="cursor-blink" />
                    </div>
                  )}

                  {loading && !streamingText && (
                    <div style={assistantBlockStyle()}>
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>

            <footer style={writeFooterStyle()}>
              <div style={segmentedStyle()}>
                {TASK_ACTIONS.map((action) => (
                  <button key={action.intent} onClick={() => chooseAction(action)} style={segmentButtonStyle(activeIntent === action.intent)}>
                    {action.label}
                  </button>
                ))}
              </div>

              <div style={metaRowStyle()}>
                <span style={metaPillStyle()}>{currentAction?.label || '普通对话'}</span>
                <span style={metaHintStyle()}>{litInject ? '已带文献上下文' : '普通写作上下文'}</span>
                <label style={modelSelectLabelStyle()}>
                  <span>模型</span>
                  <select
                    value={assistantModel}
                    onChange={(event) => setAssistantModel(event.target.value)}
                    style={compactSelectStyle()}
                  >
                    {modelRegistry.map((item) => (
                      <option key={item.id} value={item.id} disabled={!item.configured}>
                        {item.label}{item.configured ? '' : '（未配置）'}
                      </option>
                    ))}
                  </select>
                </label>
                <span style={metaHintStyle()}>{currentModelStatus}</span>
              </div>

              <div style={inputPanelStyle()}>
                <input
                  ref={chatAttachmentInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,text/plain,text/markdown,.txt,.md,.csv"
                  onChange={handleChatAttachmentSelect}
                  style={{ display: 'none' }}
                />
                <textarea
                  ref={textAreaRef}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={4}
                  placeholder={currentAction?.placeholder || '输入论文题目、段落或修改要求。'}
                  style={editorTextareaStyle()}
                />
                {(chatAttachments.length > 0 || attachmentError) && (
                  <div style={attachmentTrayStyle()}>
                    {chatAttachments.map((item) => (
                      <div key={item.id} style={attachmentChipStyle()}>
                        <span>{item.kind === 'image' ? '图片' : '文件'} · {item.name}</span>
                        <button type="button" onClick={() => removeChatAttachment(item.id)} style={plainTextButtonStyle()}>
                          移除
                        </button>
                      </div>
                    ))}
                    {attachmentError && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{attachmentError}</span>}
                  </div>
                )}
                <div style={inputFooterStyle()}>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{charCount} 字符</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => chatAttachmentInputRef.current?.click()} style={secondaryButtonStyle()}>
                      添加文件/图片
                    </button>
                    {loading ? (
                      <button onClick={stopGeneration} style={secondaryButtonStyle()}>停止</button>
                    ) : (
                      <button onClick={sendMessage} disabled={!input.trim() && chatAttachments.length === 0} style={primaryButtonStyle(Boolean(input.trim() || chatAttachments.length))}>发送</button>
                    )}
                  </div>
                </div>
              </div>
            </footer>
          </section>
        )}

        {currentView === 'literature' && (
          <section style={canvasPanelStyle()}>
            <header style={canvasHeaderStyle()}>
              <div>
                <div style={canvasEyebrowStyle()}>Literature Desk</div>
                <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>文献检索与综述资料台</div>
              </div>
              <button onClick={() => setLitInject((current) => !current)} style={secondaryButtonStyle()}>
                {litInject ? '停用上下文' : '启用上下文'}
              </button>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 10, marginBottom: 18, alignItems: 'center' }}>
              <input
                value={litQuery}
                onChange={(event) => setLitQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && doLiteratureSearch()}
                placeholder="输入研究主题或英文关键词"
                style={searchFieldStyle()}
              />
              <button
                onClick={() => setLitAiSearch((current) => !current)}
                style={segmentButtonStyle(litAiSearch)}
                type="button"
              >
                {litAiSearch ? 'AI 检索：开' : 'AI 检索：关'}
              </button>
              <button onClick={() => doLiteratureSearch()} disabled={litLoading || !litQuery.trim()} style={primaryButtonStyle(!litLoading && Boolean(litQuery.trim()))}>
                {litLoading ? '检索中…' : litAiSearch ? 'AI 检索' : '开始检索'}
              </button>
            </div>

            <div style={resultsHeaderStyle()}>
              <span>标题</span>
              <span>作者 / 年份 / 来源</span>
              <span>操作</span>
            </div>

            <div style={{ display: 'grid', gap: 10, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
              {litResults.length === 0 && (
                <div style={mutedPanelLargeStyle()}>
                  检索结果会显示在这里，建议优先使用英文关键词。
                </div>
              )}
              {litActionMessage && (
                <div style={infoNoteStyle()}>
                  {litActionMessage}
                </div>
              )}
              {litResults.map((paper, index) => (
                <article key={index} style={resultRowStyle()}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>{paper.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                      {paper.authors} · {paper.year} · {paper.venue || paper.source}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7 }}>
                    {paper.abstract}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button onClick={() => injectPaperToChat(paper)} style={secondaryButtonStyle()}>
                      注入会话
                    </button>
                    <button onClick={() => copyCitation(paper)} style={secondaryButtonStyle()}>
                      复制引用
                    </button>
                    <button onClick={() => openPaper(paper)} style={secondaryButtonStyle()}>
                      打开原文
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {currentView === 'translate' && (
          <section style={{ ...canvasPanelStyle(), padding: 0, overflow: 'hidden' }}>
            <div style={translateGridStyle()}>
              <aside style={translateRailStyle()}>
                <div style={canvasEyebrowStyle()}>Translate</div>
                <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, marginBottom: 14 }}>文档处理台</div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>文件</div>
                  <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleSelectFile} style={{ display: 'none' }} />
                  <button onClick={() => fileInputRef.current?.click()} style={primaryButtonStyle(!isUploading)}>
                    {isUploading ? '解析中…' : pdfFile ? '更换 PDF' : '选择 PDF'}
                  </button>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>
                    {fileSummary || '尚未选择文件'}
                  </div>
                </div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>处理历史</div>
                  {pdfHistory.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7 }}>
                      处理过的 PDF 会显示在这里。
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {pdfHistory.slice(0, 5).map((item) => (
                        <div key={item.id} style={pdfHistoryItemStyle()}>
                          <button onClick={() => restorePdfHistoryItem(item)} style={pdfHistoryLoadButtonStyle()}>
                            <span style={{ fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.filename}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {item.totalPages || '—'} 页 · {pdfHistoryTransportLabel(item.transport)} · {formatTimeLabel(item.updatedAt)}
                            </span>
                          </button>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button type="button" onClick={() => restorePdfHistoryItem(item)} style={plainTextButtonStyle()}>载入</button>
                            <button type="button" onClick={() => renamePdfHistoryItem(item)} style={plainTextButtonStyle()}>重命名</button>
                            {item.pdf2zhJob?.id && (
                              <button type="button" onClick={() => cleanupPdfHistoryGeneratedFiles(item)} style={plainTextButtonStyle()}>清理文件</button>
                            )}
                            <button type="button" onClick={() => deletePdfHistoryItem(item)} style={plainTextButtonStyle()}>删除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>参数</div>
                  <label style={fieldLabelStyle()}>领域</label>
                  <select value={translationField} onChange={(event) => setTranslationField(event.target.value)} style={selectStyle()}>
                    <option value="general">通用</option>
                    <option value="computer">计算机</option>
                    <option value="medicine">医学</option>
                    <option value="finance">金融</option>
                    <option value="law">法学</option>
                  </select>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                    <div>
                      <label style={fieldLabelStyle()}>源语言</label>
                      <select value={sourceLang} onChange={(event) => setSourceLang(event.target.value)} style={selectStyle()}>
                        <option value="en">英语</option>
                        <option value="zh">中文</option>
                        <option value="ja">日语</option>
                      </select>
                    </div>
                    <div>
                      <label style={fieldLabelStyle()}>目标语言</label>
                      <select value={targetLang} onChange={(event) => setTargetLang(event.target.value)} style={selectStyle()}>
                        <option value="zh">中文</option>
                        <option value="en">英语</option>
                        <option value="ja">日语</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>处理步骤</div>
                  <StepItem index="01" title="文件解析" status={translationStatus.stage === 'parsed' ? 'done' : 'idle'} />
                  <StepItem index="02" title="模型直传" status={translationStatus.transport === 'ark-file' ? 'done' : 'idle'} />
                  <StepItem index="03" title="视觉页翻译" status={translationStatus.transport === 'page-images' ? 'done' : 'idle'} />
                  <StepItem index="04" title="文本回退" status={translationStatus.transport === 'text-fallback' ? 'done' : 'idle'} />
                </div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>处理信息</div>
                  <ContextRow label="阶段" value={translationStatus.message || '等待任务开始'} />
                  <ContextRow label="链路" value={transportLabel(translationStatus)} />
                  <ContextRow label="模型" value={translationStatus.model || currentModel?.label || '未启动'} />
                  <ContextRow label="页数" value={pdfPages.length ? `${pdfPages.length} 页` : '—'} />
                  <ContextRow label="回退" value={fallbackHint(translationStatus)} />
                  {translationStatus.fallbackReason && (
                    <ContextRow label="原因" value={shortReason(translationStatus.fallbackReason)} />
                  )}
                  <ContextRow label="进度" value={`${Math.round(translationStatus.progress)}%`} />
                  <div style={{ marginTop: 12, height: 6, background: 'var(--surface2)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${translationStatus.progress}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                  {translationError && (
                    <div style={errorNoteStyle()}>{translationError}</div>
                  )}
                </div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>原位对照</div>
                  <ContextRow label="状态" value={overlayStatus || '未生成'} />
                  <ContextRow label="页数" value={overlayPages.length ? `${overlayPages.length} 页` : '—'} />
                  <ContextRow label="译文层" value={overlayVisible ? '显示' : '隐藏'} />
                  <label style={fieldLabelStyle()}>
                    识别范围
                    <select
                      value={overlayPageLimit}
                      onChange={(event) => setOverlayPageLimit(event.target.value)}
                      style={selectStyle()}
                      disabled={overlayLoading || overlayTranslating}
                    >
                      <option value="one">先看 1 页</option>
                      <option value="all">全部页面</option>
                    </select>
                  </label>
                  <button
                    onClick={handleGenerateOverlay}
                    disabled={overlayLoading || overlayTranslating || !pdfBase64}
                    style={primaryButtonStyle(!(overlayLoading || overlayTranslating || !pdfBase64))}
                  >
                    {overlayLoading ? '识别中…' : overlayTranslating ? '覆盖翻译中…' : '生成原位对照'}
                  </button>
                </div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>排版翻译</div>
                  <ContextRow label="引擎" value="pdf2zh" />
                  <ContextRow label="状态" value={pdf2zhStatusLabel} />
                  <ContextRow label="进度" value={pdf2zhJob?.progress != null ? `${Math.round(pdf2zhJob.progress)}%` : '—'} />
                  <div style={infoNoteStyle()}>
                    排版 PDF 适合快速导出。双语版会按“原文页 / 译文页”交替排列，不是同页双栏；含水印或复杂图表的论文建议优先检查单语版。
                  </div>
                  {pdf2zhJob?.error && (
                    <div style={errorNoteStyle()}>{pdf2zhJob.error}</div>
                  )}
                  {pdf2zhError && (
                    <div style={errorNoteStyle()}>{pdf2zhError}</div>
                  )}
                  <button
                    onClick={handleStartPdf2zh}
                    disabled={pdf2zhLoading || ['queued', 'running'].includes(pdf2zhJob?.status)}
                    style={primaryButtonStyle(!(pdf2zhLoading || ['queued', 'running'].includes(pdf2zhJob?.status)))}
                  >
                    {pdf2zhLoading ? '提交中…' : '生成排版 PDF'}
                  </button>
                  {pdf2zhCanDownload && (
                    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setPdf2zhPreviewType('mono');
                            setTranslationPreviewMode('pdf2zh');
                          }}
                          style={segmentButtonStyle(pdf2zhPreviewType === 'mono' && translationPreviewMode === 'pdf2zh')}
                        >
                          预览单语
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPdf2zhPreviewType('dual');
                            setTranslationPreviewMode('pdf2zh');
                          }}
                          style={segmentButtonStyle(pdf2zhPreviewType === 'dual' && translationPreviewMode === 'pdf2zh')}
                        >
                          预览双语
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <a
                          href={`/api/pdf2zh/jobs/${encodeURIComponent(pdf2zhJob.id)}/download?type=mono`}
                          style={{ ...secondaryButtonStyle(), textAlign: 'center' }}
                        >
                          下载单语
                        </a>
                        <a
                          href={`/api/pdf2zh/jobs/${encodeURIComponent(pdf2zhJob.id)}/download?type=dual`}
                          style={{ ...secondaryButtonStyle(), textAlign: 'center' }}
                        >
                          下载双语
                        </a>
                      </div>
                      <button type="button" onClick={handleDeleteCurrentPdf2zhJob} style={secondaryButtonStyle()}>
                        删除生成文件
                      </button>
                    </div>
                  )}
                </div>

                <div style={subsectionStyle()}>
                  <div style={subsectionTitleStyle()}>导出</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <button onClick={() => setExportFormat('docx')} style={segmentButtonStyle(exportFormat === 'docx')}>Word</button>
                    <button onClick={() => setExportFormat('pdf')} style={segmentButtonStyle(exportFormat === 'pdf')}>PDF</button>
                  </div>
                  <button onClick={handleExport} disabled={isExporting || !hasTranslationOutput} style={primaryButtonStyle(!(isExporting || !hasTranslationOutput))}>
                    {isExporting ? '导出中…' : '执行导出'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 'auto' }}>
                  <button onClick={handleTranslate} disabled={isTranslating || isUploading} style={primaryButtonStyle(!(isTranslating || isUploading))}>
                    {isTranslating ? '处理中…' : '开始翻译'}
                  </button>
                  <button onClick={handleResetTranslation} style={secondaryButtonStyle()}>
                    重置
                  </button>
                </div>
              </aside>

              <section style={translatePreviewStyle()}>
                <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 18 }}>
                  <div>
                    <div style={canvasEyebrowStyle()}>Preview</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>翻译预览</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setTranslationPreviewMode('text')} style={segmentButtonStyle(translationPreviewMode === 'text')}>
                      正文译文
                    </button>
                    <button onClick={() => setTranslationPreviewMode('overlay')} style={segmentButtonStyle(translationPreviewMode === 'overlay')}>
                      原位对照
                    </button>
                    <button onClick={() => setTranslationPreviewMode('pdf2zh')} style={segmentButtonStyle(translationPreviewMode === 'pdf2zh')}>
                      排版 PDF
                    </button>
                    <button onClick={() => setShowBilingual((current) => !current)} style={secondaryButtonStyle()}>
                      {showBilingual ? '仅看译文' : '原文 / 译文'}
                    </button>
                    <button onClick={handleCopyTranslation} disabled={!hasTranslationOutput} style={secondaryButtonStyle()}>
                      复制译文
                    </button>
                  </div>
                </header>

                <div style={previewSurfaceStyle()}>
                  {translationPreviewMode === 'pdf2zh' ? (
                    <Pdf2zhPreview
                      job={pdf2zhJob}
                      previewType={pdf2zhPreviewType}
                      setPreviewType={setPdf2zhPreviewType}
                    />
                  ) : translationPreviewMode === 'overlay' ? (
                    <OverlayPreview
                      pages={overlayPages}
                      pageIndex={overlayPageIndex}
                      setPageIndex={setOverlayPageIndex}
                      overlayVisible={overlayVisible}
                      setOverlayVisible={setOverlayVisible}
                      loading={overlayLoading || overlayTranslating}
                      status={overlayStatus}
                    />
                  ) : !hasTranslationOutput && pdfText.trim() ? (
                    <PreviewBlock title="原文" content={pdfText} />
                  ) : !hasTranslationOutput ? (
                    <div style={{ color: 'var(--text3)', lineHeight: 1.8 }}>
                      上传并启动翻译后，预览内容会显示在这里。若从旧历史恢复但没有正文，请重新上传 PDF 生成完整记录。
                    </div>
                  ) : showBilingual ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
                      <PreviewBlock title="原文" content={pdfText} />
                      <PreviewBlock title="译文" content={translatedText} />
                    </div>
                  ) : (
                    <PreviewBlock title="译文" content={translatedText} />
                  )}
                </div>
              </section>
            </div>
          </section>
        )}

        {currentView === 'history' && (
          <section style={canvasPanelStyle()}>
            <header style={canvasHeaderStyle()}>
              <div>
                <div style={canvasEyebrowStyle()}>History</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>会话历史</div>
              </div>
              <button onClick={newConversation} style={primaryButtonStyle(true)}>新建会话</button>
            </header>
            <div style={{ display: 'grid', gap: 12, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
              {conversations.length === 0 && (
                <div style={mutedPanelLargeStyle()}>目前还没有保存下来的会话。</div>
              )}
              {conversations.map((item) => (
                <div key={item.id} style={historyRowStyle(item.id === conversationId)}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.title || '未命名写作会话'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                      {formatTaskLabel(item)} · {item.message_count} 条 · {formatTimeLabel(item.updated_at)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => openConversation(item.id)} style={secondaryButtonStyle()}>打开</button>
                    <button onClick={(event) => deleteConversationItem(item.id, event)} style={secondaryButtonStyle()}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentView === 'settings' && (
          <section style={canvasPanelStyle()}>
            <header style={canvasHeaderStyle()}>
              <div>
                <div style={canvasEyebrowStyle()}>Settings</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>工作台设置</div>
              </div>
              <button onClick={() => setModelFormVisible((current) => !current)} style={secondaryButtonStyle()}>
                {modelFormVisible ? '收起配置面板' : '新增模型'}
              </button>
            </header>

            <div style={{ display: 'grid', gap: 14, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
              <SettingsSection title="模型配置中心">
                <div style={modelSummaryGridStyle()}>
                  <ModelSummaryCard label="当前使用" value={currentModel?.label || assistantModel || '未选择'} detail={currentModelStatus} />
                  <ModelSummaryCard label="默认模型" value={defaultModel?.label || defaultModelId || '未设置'} detail="不会自动切换当前会话" />
                  <ModelSummaryCard label="可调用模型" value={`${configuredModels.length} / ${modelRegistry.length}`} detail="文本能力可用于写作与翻译" />
                  <ModelSummaryCard label="视觉能力" value={`${visionReadyModels.length} 个`} detail="影响图片页 PDF 翻译" />
                </div>

                <div style={modelCardGridStyle()}>
                  {modelRegistry.map((item) => (
                    <ModelConfigCard
                      key={item.id}
                      model={item}
                      active={item.id === assistantModel}
                      defaultModel={item.id === defaultModelId}
                      testing={modelTestingId === `${item.id}:both`}
                      testResult={modelTestResults[item.id]}
                      onUse={() => setAssistantModel(item.id)}
                      onSetDefault={() => chooseDefaultModel(item.id)}
                      onTest={() => testModel(item.id, 'both')}
                      onEdit={() => editModel(item)}
                      onRemove={() => removeCustomModel(item.id)}
                    />
                  ))}
                </div>
              </SettingsSection>

              {modelFormVisible && (
                <SettingsSection title="新增 / 编辑 OpenAI 兼容模型">
                  <form onSubmit={saveModelConfig} style={{ display: 'grid', gap: 10 }}>
                    <div style={settingsGridStyle()}>
                      <label style={fieldStackStyle()}>
                        <span style={fieldLabelStyle()}>模型 ID</span>
                        <input value={modelForm.id} onChange={(event) => setModelForm((current) => ({ ...current, id: event.target.value.trim() }))} placeholder="例如 custom-research" style={searchFieldStyle()} />
                      </label>
                      <label style={fieldStackStyle()}>
                        <span style={fieldLabelStyle()}>显示名称</span>
                        <input value={modelForm.label} onChange={(event) => setModelForm((current) => ({ ...current, label: event.target.value }))} placeholder="例如 Research Model" style={searchFieldStyle()} />
                      </label>
                    </div>
                    <label style={fieldStackStyle()}>
                      <span style={fieldLabelStyle()}>接口地址</span>
                      <input value={modelForm.baseUrl} onChange={(event) => setModelForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1/chat/completions" style={searchFieldStyle()} />
                      <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
                        如果使用 NVIDIA，请填写 OpenAI 兼容接口 `https://integrate.api.nvidia.com/v1/chat/completions`，不要填 `build.nvidia.com/...` 页面地址。
                      </span>
                    </label>
                    <label style={fieldStackStyle()}>
                      <span style={fieldLabelStyle()}>接口协议</span>
                      <select
                        value={modelForm.apiStyle}
                        onChange={(event) => setModelForm((current) => ({ ...current, apiStyle: event.target.value }))}
                        style={selectStyle()}
                      >
                        <option value="chat-completions">Chat Completions</option>
                        <option value="responses">Responses</option>
                      </select>
                    </label>
                    <label style={fieldStackStyle()}>
                      <span style={fieldLabelStyle()}>API Key</span>
                      <input value={modelForm.apiKey} onChange={(event) => setModelForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="sk-..." style={searchFieldStyle()} />
                    </label>
                    <div style={settingsGridStyle()}>
                      <label style={fieldStackStyle()}>
                        <span style={fieldLabelStyle()}>文本模型名</span>
                        <input value={modelForm.textModel} onChange={(event) => setModelForm((current) => ({ ...current, textModel: event.target.value }))} placeholder="gpt-4o-mini" style={searchFieldStyle()} />
                      </label>
                      <label style={fieldStackStyle()}>
                        <span style={fieldLabelStyle()}>视觉模型名</span>
                        <input value={modelForm.visionModel} onChange={(event) => setModelForm((current) => ({ ...current, visionModel: event.target.value }))} placeholder="gpt-4.1-mini" style={searchFieldStyle()} />
                      </label>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text2)' }}>
                      <input
                        type="checkbox"
                        checked={modelForm.supportsVision}
                        onChange={(event) => setModelForm((current) => ({ ...current, supportsVision: event.target.checked }))}
                      />
                      启用视觉翻译能力
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button type="submit" disabled={modelSaving} style={primaryButtonStyle(!modelSaving)}>
                        {modelSaving ? '保存中…' : '保存模型'}
                      </button>
                      <button type="button" onClick={() => setModelForm(INITIAL_MODEL_FORM)} style={secondaryButtonStyle()}>
                        清空
                      </button>
                    </div>
                  </form>
                </SettingsSection>
              )}

              <SettingsSection title="历史窗口">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input type="range" min={4} max={40} step={2} value={historyLen} onChange={(event) => setHistoryLen(Number(event.target.value))} style={{ flex: 1 }} />
                  <span style={{ width: 32, textAlign: 'right', fontWeight: 700 }}>{historyLen}</span>
                </div>
              </SettingsSection>

              <SettingsSection title="测试与配置反馈">
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.8 }}>
                  当前共识别到 {modelRegistry.length} 个模型，其中 {configuredModels.length} 个已配置可调用。点击卡片右侧测试图标只会测试连通性，不会切换当前模型。
                </div>
                {modelConfigMessage && (
                  <div style={{ marginTop: 10, ...infoNoteStyle(missingModelConfig ? 'warn' : 'neutral') }}>
                    {modelConfigMessage}
                  </div>
                )}
              </SettingsSection>

              <SettingsSection title="会话存储">
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.8 }}>
                  当前仍使用本地文件作为开发环境持久化存储，生产环境建议切换到外部数据库。
                </div>
              </SettingsSection>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function DocumentEntry({ message, idx, copiedIdx, onCopy }) {
  if (message.role === 'error') {
    return <div style={errorNoteStyle()}>{message.content}</div>;
  }

  if (message.role === 'user') {
    return (
      <div style={userBlockStyle()}>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>用户输入</div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{message.content}</div>
      </div>
    );
  }

  return (
    <div style={assistantBlockStyle()}>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>输出结果</div>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      <div style={{ marginTop: 10 }}>
        <button onClick={() => onCopy(message.content, idx)} style={plainTextButtonStyle()}>
          {copiedIdx === idx ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  );
}

function PreviewBlock({ title, content }) {
  const blocks = segmentPreviewBlocks(content);

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={previewDocumentStyle()}>
        {blocks.map((block, index) => (
          <PreviewParagraph key={`${block.type}-${index}`} block={block} />
        ))}
      </div>
    </div>
  );
}

function Pdf2zhPreview({ job, previewType, setPreviewType }) {
  const isDone = job?.status === 'done' && job.id;
  const safeType = previewType === 'dual' ? 'dual' : 'mono';
  const previewUrl = isDone
    ? `/api/pdf2zh/jobs/${encodeURIComponent(job.id)}/download?type=${safeType}&inline=1`
    : '';

  if (!job) {
    return (
      <div style={overlayEmptyStyle()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>排版 PDF</div>
        <div>点击左侧“生成排版 PDF”，完成后可在这里直接预览单语或双语 PDF。</div>
      </div>
    );
  }

  if (!isDone) {
    return (
      <div style={overlayEmptyStyle()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>排版 PDF</div>
        <div>{job.status === 'failed' ? (job.error || '排版翻译失败') : `正在处理：${job.stage || job.status || '排队中'}，${Math.round(job.progress || 0)}%`}</div>
      </div>
    );
  }

  return (
    <div style={pdf2zhPreviewWrapStyle()}>
      <div style={overlayToolbarStyle()}>
        <div>
          <div style={{ fontWeight: 700 }}>排版 PDF 预览</div>
          <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>
            双语 PDF 为原文页与译文页交替显示；若要快速检查翻译完整性，建议先看单语 PDF。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={() => setPreviewType('mono')} style={segmentButtonStyle(safeType === 'mono')}>
            单语
          </button>
          <button type="button" onClick={() => setPreviewType('dual')} style={segmentButtonStyle(safeType === 'dual')}>
            双语
          </button>
          <a
            href={`/api/pdf2zh/jobs/${encodeURIComponent(job.id)}/download?type=${safeType}`}
            style={{ ...secondaryButtonStyle(), textDecoration: 'none' }}
          >
            下载当前 PDF
          </a>
        </div>
      </div>
      <iframe
        title={`pdf2zh-${safeType}-preview`}
        src={previewUrl}
        style={pdf2zhIframeStyle()}
      />
    </div>
  );
}

function OverlayPreview({
  pages,
  pageIndex,
  setPageIndex,
  overlayVisible,
  setOverlayVisible,
  loading,
  status,
}) {
  const safeIndex = Math.min(Math.max(pageIndex, 0), Math.max(pages.length - 1, 0));
  const page = pages[safeIndex];

  if (!page) {
    return (
      <div style={overlayEmptyStyle()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>原位对照</div>
        <div>{loading ? (status || '正在生成原位对照…') : '点击左侧“生成原位对照”，这里会显示原页图片和译文覆盖层。'}</div>
      </div>
    );
  }

  const visibleBlocks = (page.blocks || []).filter(shouldRenderOverlayBlock);

  return (
    <div style={overlayPreviewWrapStyle()}>
      <div style={overlayToolbarStyle()}>
        <div>{status || `第 ${page.pageNumber} 页`}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setOverlayVisible((current) => !current)}
            style={secondaryButtonStyle()}
          >
            {overlayVisible ? '隐藏译文层' : '显示译文层'}
          </button>
          <button
            type="button"
            onClick={() => setPageIndex(Math.max(0, safeIndex - 1))}
            disabled={safeIndex === 0}
            style={secondaryButtonStyle()}
          >
            上一页
          </button>
          <span style={{ color: 'var(--text3)' }}>{safeIndex + 1} / {pages.length}</span>
          <button
            type="button"
            onClick={() => setPageIndex(Math.min(pages.length - 1, safeIndex + 1))}
            disabled={safeIndex >= pages.length - 1}
            style={secondaryButtonStyle()}
          >
            下一页
          </button>
        </div>
      </div>

      <div style={overlayCanvasStyle(page)}>
        <img src={page.imageUrl} alt={`PDF page ${page.pageNumber}`} style={overlayImageStyle(overlayVisible)} />
        {overlayVisible && (
          <div style={overlayLayerStyle()}>
            {visibleBlocks.map((block) => (
              <div key={block.id} style={overlayBoxStyle(block, page)} title={block.text}>
                {formatOverlayText(block.translatedText || block.text)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function shouldRenderOverlayBlock(block) {
  if (!block || block.preserveOriginal) return false;
  if (block.type === 'formula' || block.type === 'reference') return false;

  const source = String(block.text || '').trim();
  const translated = String(block.translatedText || '').trim();
  return Boolean(translated && translated !== source);
}

function formatOverlayText(text = '') {
  return cleanPreviewText(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function PreviewParagraph({ block }) {
  if (block.type === 'title') {
    return <h2 style={previewTitleStyle()}>{block.text}</h2>;
  }

  if (block.type === 'table') {
    return <PreviewTable rows={block.rows} />;
  }

  if (block.type === 'section') {
    return <h3 style={previewSectionStyle()}>{block.text}</h3>;
  }

  if (block.type === 'meta') {
    return <p style={previewMetaStyle()}>{block.text}</p>;
  }

  return <p style={previewParagraphStyle()}>{block.text}</p>;
}

function PreviewTable({ rows = [] }) {
  if (!rows.length) return null;

  return (
    <div style={previewTableWrapStyle()}>
      <table style={previewTableStyle()}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const Cell = rowIndex === 0 ? 'th' : 'td';
                return (
                  <Cell key={`${rowIndex}-${cellIndex}`} style={previewTableCellStyle(rowIndex === 0)}>
                    {cell}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelSummaryCard({ label, value, detail }) {
  return (
    <div style={modelSummaryCardStyle()}>
      <div style={{ color: 'var(--text3)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
      <div style={{ marginTop: 6, color: 'var(--text3)', fontSize: 12, lineHeight: 1.5 }}>{detail}</div>
    </div>
  );
}

function ModelConfigCard({
  model,
  active,
  defaultModel,
  testing,
  testResult,
  onUse,
  onSetDefault,
  onTest,
  onEdit,
  onRemove,
}) {
  const sourceLabel = model.source === 'custom' ? '自定义' : '系统';
  const textAvailable = Boolean(model.textConfigured || model.configured);
  const visionLabel = model.supportsVision
    ? model.visionConfigured ? '视觉可用' : '视觉待配置'
    : '未启用视觉';
  const testTone = testResult?.test?.text?.success && (testResult.test?.vision?.success || testResult.test?.vision?.skipped)
    ? 'ok'
    : 'neutral';

  return (
    <article style={modelCardStyle(active)}>
      <div style={modelCardTopStyle()}>
        <div style={{ minWidth: 0 }}>
          <div style={modelCardTitleRowStyle()}>
            <span style={modelAvatarStyle(model.label)}>{getModelInitial(model.label)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {model.label}
              </div>
              <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 4 }}>
                {sourceLabel} · {model.provider || 'openai-compatible'} · {model.apiStyle || 'chat-completions'}
              </div>
            </div>
          </div>
        </div>

        <div style={modelActionBarStyle()}>
          <ModelIconButton title={active ? '当前正在使用' : '设为当前使用'} disabled={active} active={active} onClick={onUse}>
            <ModelIcon name="target" />
          </ModelIconButton>
          <ModelIconButton title={defaultModel ? '默认模型' : '设为默认模型'} disabled={defaultModel} active={defaultModel} onClick={onSetDefault}>
            <ModelIcon name="star" />
          </ModelIconButton>
          <ModelIconButton title="测试模型（文本与视觉）" disabled={testing} onClick={onTest}>
            {testing ? <span style={{ fontWeight: 800 }}>…</span> : <ModelIcon name="pulse" />}
          </ModelIconButton>
          <ModelIconButton title="修改配置" onClick={onEdit}>
            <ModelIcon name="edit" />
          </ModelIconButton>
          <ModelIconButton title={model.source === 'builtin' ? '清除自定义覆盖' : '删除模型'} danger onClick={onRemove}>
            <ModelIcon name="trash" />
          </ModelIconButton>
        </div>
      </div>

      <div style={modelBadgeRowStyle()}>
        {active && <ModelStatusPill tone="accent">当前使用</ModelStatusPill>}
        {defaultModel && <ModelStatusPill tone="warm">默认</ModelStatusPill>}
        <ModelStatusPill tone={model.configured ? 'ok' : 'muted'}>{model.configured ? '已配置' : '未配置'}</ModelStatusPill>
        <ModelStatusPill tone={textAvailable ? 'ok' : 'muted'}>{textAvailable ? '文本可用' : '文本待配置'}</ModelStatusPill>
        <ModelStatusPill tone={model.visionConfigured ? 'ok' : 'muted'}>{visionLabel}</ModelStatusPill>
      </div>

      <div style={modelSpecGridStyle()}>
        <ModelSpec label="文本模型" value={model.textModel || '未填写'} />
        <ModelSpec label="视觉模型" value={model.supportsVision ? (model.visionModel || '未填写') : '未启用'} />
      </div>

      {testResult?.message && (
        <div style={modelTestResultStyle(testTone)}>
          <div>{testResult.message}</div>
          <div style={{ marginTop: 6, color: 'var(--text3)', fontSize: 11 }}>
            最近测试：{formatTimeLabel(testResult.testedAt)}
          </div>
        </div>
      )}
    </article>
  );
}

function ModelSpec({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: 'var(--text3)', fontSize: 11, marginBottom: 5 }}>{label}</div>
      <div style={{ color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={value}>
        {value}
      </div>
    </div>
  );
}

function ModelStatusPill({ tone = 'muted', children }) {
  return <span style={modelStatusPillStyle(tone)}>{children}</span>;
}

function ModelIconButton({ title, disabled = false, active = false, danger = false, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={modelIconButtonStyle({ active, danger, disabled })}
    >
      {children}
    </button>
  );
}

function ModelIcon({ name }) {
  if (name === 'star') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.8 14.7 9l5.8.8-4.2 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.2-4.1L9.3 9 12 3.8Z" />
      </svg>
    );
  }

  if (name === 'pulse') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h4l2-5 4 10 2-5h4" />
      </svg>
    );
  }

  if (name === 'edit') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 19h4.2L18.4 9.8a2.1 2.1 0 0 0 0-3L17.2 5.6a2.1 2.1 0 0 0-3 0L5 14.8V19Z" />
        <path d="m13.5 6.5 3 3" />
      </svg>
    );
  }

  if (name === 'trash') {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 7h14" />
        <path d="M9 7V5h6v2" />
        <path d="M8 10v8" />
        <path d="M12 10v8" />
        <path d="M16 10v8" />
        <path d="M7 7l1 15h8l1-15" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </svg>
  );
}

function getModelInitial(label = '') {
  const trimmed = String(label).trim();
  if (!trimmed) return 'M';
  return trimmed.slice(0, 1).toUpperCase();
}

function SettingsSection({ title, children }) {
  return (
    <div style={settingsSectionStyle()}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function StepItem({ index, title, status }) {
  return (
    <div style={stepItemStyle(status === 'done')}>
      <div style={stepIndexStyle(status === 'done')}>{index}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>{title}</div>
    </div>
  );
}

function ContextRow({ label, value }) {
  return (
    <div style={contextRowStyle()}>
      <span>{label}</span>
      <span style={{ color: 'var(--text)', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function transportLabel(status) {
  if (status.transport === 'ark-file') return '原始 PDF 直传';
  if (status.transport === 'page-images') return '图片页视觉翻译';
  if (status.transport === 'text-fallback') return '文本提取翻译';
  return '等待任务开始';
}

function fallbackHint(status) {
  if (!status?.fallbackUsed) return '未触发回退';
  if (status.fallbackLevel === 2) return '已从原始 PDF 直传切换到图片页视觉翻译';
  if (status.fallbackLevel === 3) {
    return status.fallbackReason?.includes('未配置')
      ? '当前没有可用视觉模型，已自动切换到文本提取翻译'
      : '图片页视觉翻译暂不可用，已自动切换到文本提取翻译';
  }
  return '已自动切换到备用链路';
}

function pdfHistoryTransportLabel(transport) {
  if (transport === 'ark-file') return '直传';
  if (transport === 'page-images') return '视觉';
  if (transport === 'text-fallback') return '文本';
  if (transport === 'pdf2zh') return '排版';
  if (transport === 'parsed') return '已解析';
  return '记录';
}

function formatBytes(value = 0) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function shortReason(reason = '') {
  const text = String(reason).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function formatTaskLabel(conversation) {
  const modeMap = {
    general: '写作',
    expand: '扩写',
    polish: '润色',
    dedup: '降重',
    literature: '综述',
    deai: '去模板化',
  };
  const lastMode = conversation?.mode || conversation?.last_mode;
  return modeMap[lastMode] || '写作';
}

function formatTimeLabel(dateStr) {
  if (!dateStr) return '未知时间';
  return new Date(dateStr).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function pageStyle(sidebarCollapsed = false) {
  return {
    display: 'grid',
    gridTemplateColumns: `${sidebarCollapsed ? 68 : 220}px minmax(0, 1fr)`,
    gap: 18,
    height: '100vh',
    padding: 18,
    background: 'var(--bg)',
    overflow: 'hidden',
  };
}

function leftRailStyle(collapsed = false) {
  return {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: collapsed ? '12px 10px' : 14,
    display: 'flex',
    flexDirection: 'column',
    gap: collapsed ? 16 : 14,
    minHeight: 0,
    alignItems: collapsed ? 'center' : 'stretch',
  };
}

function railHeaderStyle(collapsed = false) {
  return {
    display: 'flex',
    flexDirection: collapsed ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'space-between',
    gap: collapsed ? 10 : 12,
    width: '100%',
    minWidth: 0,
  };
}

function centerCanvasStyle() {
  return {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };
}

function canvasPanelStyle() {
  return {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 20,
    height: 'calc(100vh - 36px)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  };
}

function brandStyle(collapsed = false) {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: collapsed ? 'center' : 'flex-start',
    gap: collapsed ? 0 : 12,
    minWidth: 0,
    flex: collapsed ? '0 0 auto' : 1,
  };
}

function brandMarkStyle() {
  return {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: 'var(--accent)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
  };
}

function railNavStyle(collapsed = false) {
  return {
    display: 'grid',
    gap: collapsed ? 8 : 4,
    width: '100%',
    justifyItems: collapsed ? 'center' : 'stretch',
  };
}

function navButtonStyle(active, collapsed = false) {
  if (collapsed) {
    return {
      width: 40,
      height: 40,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 10,
      border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
      background: active ? 'var(--surface2)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--text3)',
      fontSize: 12,
      fontWeight: 800,
      letterSpacing: '.04em',
    };
  }

  return {
    textAlign: 'left',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid transparent',
    background: active ? 'var(--surface2)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text2)',
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    width: '100%',
  };
}

function collapseButtonStyle(collapsed = false) {
  return {
    flexShrink: 0,
    width: collapsed ? 34 : 28,
    height: collapsed ? 30 : 28,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text2)',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
  };
}

function primaryRailButtonStyle(collapsed = false) {
  return {
    marginTop: 'auto',
    width: collapsed ? 40 : '100%',
    height: collapsed ? 40 : 'auto',
    padding: collapsed ? 0 : '12px 14px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--accent)',
    color: 'white',
    fontSize: 13,
    fontWeight: 700,
  };
}

function sectionLabelStyle() {
  return {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    fontWeight: 700,
  };
}

function recentItemStyle(active) {
  return {
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--surface)',
    textAlign: 'left',
  };
}

function mutedPanelStyle() {
  return {
    padding: '12px',
    borderRadius: 8,
    border: '1px dashed var(--border)',
    color: 'var(--text3)',
    fontSize: 12,
    lineHeight: 1.7,
  };
}

function mutedPanelLargeStyle() {
  return {
    padding: '28px',
    borderRadius: 12,
    border: '1px dashed var(--border)',
    color: 'var(--text3)',
    fontSize: 13,
    lineHeight: 1.8,
    textAlign: 'center',
  };
}

function canvasHeaderStyle() {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingBottom: 16,
    borderBottom: '1px solid var(--border)',
    marginBottom: 18,
  };
}

function canvasEyebrowStyle() {
  return {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    fontWeight: 700,
    marginBottom: 8,
  };
}

function titleInputStyle() {
  return {
    border: 'none',
    background: 'transparent',
    fontSize: 28,
    lineHeight: 1.2,
    fontWeight: 700,
    color: 'var(--text)',
    outline: 'none',
    width: '100%',
    minWidth: 260,
  };
}

function writeBodyStyle() {
  return {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    paddingRight: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };
}

function emptyDeskStyle() {
  return {
    minHeight: 260,
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  };
}

function writeFooterStyle() {
  return {
    marginTop: 18,
    paddingTop: 16,
    borderTop: '1px solid var(--border)',
    display: 'grid',
    gap: 10,
  };
}

function segmentedStyle() {
  return {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  };
}

function segmentButtonStyle(active) {
  return {
    padding: '8px 12px',
    borderRadius: 8,
    border: active ? '1px solid var(--accent-border)' : '1px solid transparent',
    background: active ? 'var(--surface3)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text2)',
    fontSize: 12,
    fontWeight: active ? 700 : 500,
  };
}

function metaRowStyle() {
  return {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'center',
  };
}

function metaPillStyle() {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: 999,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    fontSize: 12,
    fontWeight: 600,
  };
}

function metaHintStyle() {
  return {
    fontSize: 12,
    color: 'var(--text3)',
  };
}

function modelSelectLabelStyle() {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--text3)',
  };
}

function compactSelectStyle() {
  return {
    border: '1px solid var(--border)',
    borderRadius: 999,
    background: 'var(--surface)',
    color: 'var(--text)',
    padding: '5px 28px 5px 10px',
    fontSize: 12,
    maxWidth: 220,
    outline: 'none',
  };
}

function inputPanelStyle() {
  return {
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    overflow: 'hidden',
  };
}

function editorTextareaStyle() {
  return {
    width: '100%',
    border: 'none',
    resize: 'none',
    outline: 'none',
    padding: 18,
    fontSize: 15,
    lineHeight: 1.8,
    minHeight: 170,
    background: 'transparent',
    color: 'var(--text)',
    fontFamily: 'inherit',
  };
}

function inputFooterStyle() {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 18px',
    borderTop: '1px solid var(--border)',
    background: 'var(--surface2)',
  };
}

function attachmentTrayStyle() {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    padding: '0 18px 12px',
  };
}

function attachmentChipStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    padding: '6px 8px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface2)',
    fontSize: 12,
    color: 'var(--text2)',
  };
}

function primaryButtonStyle(enabled) {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    border: 'none',
    background: enabled ? 'var(--accent)' : 'var(--surface3)',
    color: enabled ? 'white' : 'var(--text3)',
    fontSize: 12,
    fontWeight: 700,
  };
}

function secondaryButtonStyle() {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text2)',
    fontSize: 12,
    fontWeight: 600,
    textDecoration: 'none',
  };
}

function plainTextButtonStyle() {
  return {
    border: 'none',
    background: 'transparent',
    color: 'var(--text2)',
    fontSize: 12,
    padding: 0,
  };
}

function userBlockStyle() {
  return {
    padding: 18,
    borderRadius: 12,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
  };
}

function assistantBlockStyle() {
  return {
    padding: 18,
    borderRadius: 12,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    lineHeight: 1.8,
  };
}

function searchFieldStyle() {
  return {
    flex: 1,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface)',
    padding: '12px 14px',
    fontSize: 14,
    outline: 'none',
  };
}

function settingsGridStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  };
}

function fieldStackStyle() {
  return {
    display: 'grid',
    gap: 6,
  };
}

function resultsHeaderStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: '2fr 2fr 180px',
    gap: 14,
    padding: '0 12px 10px',
    borderBottom: '1px solid var(--border)',
    fontSize: 11,
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    fontWeight: 700,
  };
}

function resultRowStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: '2fr 2fr 180px',
    gap: 14,
    alignItems: 'start',
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
  };
}

function translateGridStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: '300px minmax(0, 1fr)',
    height: 'calc(100vh - 36px)',
    minHeight: 0,
  };
}

function translateRailStyle() {
  return {
    padding: 18,
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    background: 'var(--surface)',
    minHeight: 0,
    overflowY: 'auto',
  };
}

function translatePreviewStyle() {
  return {
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    background: 'var(--surface)',
  };
}

function subsectionStyle() {
  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
  };
}

function subsectionTitleStyle() {
  return {
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 10,
  };
}

function pdfHistoryItemStyle() {
  return {
    display: 'grid',
    gap: 8,
    textAlign: 'left',
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
  };
}

function pdfHistoryLoadButtonStyle() {
  return {
    display: 'grid',
    gap: 4,
    width: '100%',
    padding: 0,
    border: 'none',
    background: 'transparent',
    textAlign: 'left',
  };
}

function fieldLabelStyle() {
  return {
    display: 'block',
    marginBottom: 6,
    fontSize: 12,
    color: 'var(--text2)',
  };
}

function selectStyle() {
  return {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    background: 'var(--surface)',
    fontSize: 13,
    color: 'var(--text)',
    outline: 'none',
  };
}

function stepItemStyle(done) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    color: done ? 'var(--text)' : 'var(--text2)',
  };
}

function stepIndexStyle(done) {
  return {
    width: 28,
    height: 28,
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: done ? 'var(--surface3)' : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
  };
}

function previewSurfaceStyle() {
  return {
    flex: 1,
    minHeight: 0,
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: '#fffefc',
    padding: 20,
    overflow: 'auto',
  };
}

function previewDocumentStyle() {
  return {
    maxWidth: 860,
    margin: '0 auto',
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.95,
  };
}

function pdf2zhPreviewWrapStyle() {
  return {
    display: 'grid',
    gridTemplateRows: 'auto minmax(520px, 1fr)',
    gap: 14,
    minWidth: 0,
    height: '100%',
  };
}

function pdf2zhIframeStyle() {
  return {
    width: '100%',
    height: '100%',
    minHeight: 620,
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: '#fff',
  };
}

function overlayEmptyStyle() {
  return {
    display: 'grid',
    placeContent: 'center',
    minHeight: 420,
    color: 'var(--text3)',
    textAlign: 'center',
    lineHeight: 1.8,
  };
}

function overlayPreviewWrapStyle() {
  return {
    display: 'grid',
    gap: 14,
    minWidth: 0,
    height: '100%',
  };
}

function overlayToolbarStyle() {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    color: 'var(--text2)',
    fontSize: 12,
  };
}

function overlayCanvasStyle(page) {
  return {
    position: 'relative',
    width: '100%',
    maxWidth: page?.width ? Math.min(page.width, 1180) : 1180,
    margin: '0 auto',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
    background: '#fff',
    boxShadow: '0 12px 30px rgba(45, 38, 28, 0.08)',
    aspectRatio: page?.width && page?.height ? `${page.width} / ${page.height}` : undefined,
  };
}

function overlayImageStyle(isDimmed) {
  return {
    display: 'block',
    width: '100%',
    maxHeight: 'none',
    objectFit: 'contain',
    opacity: isDimmed ? 0.48 : 1,
    transition: 'opacity .18s ease',
  };
}

function overlayLayerStyle() {
  return {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  };
}

function overlayBoxStyle(block, page) {
  const bbox = block.bbox || {};
  const pageWidth = page?.width || 1;
  const pageHeight = page?.height || 1;
  const isTitle = block.type === 'title';
  const area = Number(bbox.width || pageWidth) * Number(bbox.height || 1);
  const textLength = String(block.translatedText || block.text || '').length;
  const density = area ? textLength / area : 0;
  const boxHeight = Number(bbox.height || 1);
  const fontSize = isTitle
    ? Math.max(10, Math.min(15, boxHeight * 0.32))
    : Math.max(7.5, Math.min(11, density > 0.026 ? boxHeight * 0.12 : boxHeight * 0.16));

  return {
    position: 'absolute',
    left: `${(Number(bbox.x || 0) / pageWidth) * 100}%`,
    top: `${(Number(bbox.y || 0) / pageHeight) * 100}%`,
    width: `${(Number(bbox.width || pageWidth) / pageWidth) * 100}%`,
    height: `${(Number(bbox.height || 1) / pageHeight) * 100}%`,
    padding: isTitle ? '3px 6px' : '2px 5px',
    borderRadius: 4,
    border: '1px solid rgba(84, 72, 55, 0.18)',
    background: isTitle ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.96)',
    color: '#1f2933',
    fontSize,
    lineHeight: isTitle ? 1.18 : 1.22,
    fontWeight: isTitle ? 700 : 500,
    overflow: 'auto',
    overflowWrap: 'break-word',
    wordBreak: 'normal',
    textAlign: 'left',
    boxShadow: '0 3px 10px rgba(30, 25, 18, 0.10)',
    backdropFilter: 'blur(1.5px)',
    scrollbarWidth: 'none',
  };
}

function previewTitleStyle() {
  return {
    margin: '4px 0 18px',
    fontSize: 22,
    lineHeight: 1.45,
    fontWeight: 700,
    letterSpacing: '-.01em',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  };
}

function previewSectionStyle() {
  return {
    margin: '26px 0 10px',
    paddingTop: 14,
    borderTop: '1px solid var(--border)',
    fontSize: 17,
    lineHeight: 1.5,
    fontWeight: 700,
  };
}

function previewMetaStyle() {
  return {
    margin: '0 0 12px',
    color: 'var(--text2)',
    fontSize: 13,
    lineHeight: 1.75,
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  };
}

function previewParagraphStyle() {
  return {
    margin: '0 0 16px',
    textAlign: 'justify',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  };
}

function previewTableWrapStyle() {
  return {
    overflowX: 'auto',
    margin: '12px 0 18px',
    border: '1px solid var(--border)',
    borderRadius: 10,
    background: '#fff',
  };
}

function previewTableStyle() {
  return {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
    lineHeight: 1.65,
  };
}

function previewTableCellStyle(header = false) {
  return {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    textAlign: 'left',
    verticalAlign: 'top',
    fontWeight: header ? 700 : 400,
    background: header ? 'var(--surface2)' : '#fff',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  };
}

function contextRowStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: '96px 1fr',
    gap: 10,
    fontSize: 12,
    color: 'var(--text2)',
    lineHeight: 1.6,
  };
}

function errorNoteStyle() {
  return {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    border: '1px solid var(--red-border)',
    background: 'var(--red-bg)',
    color: 'var(--red)',
    fontSize: 12,
    lineHeight: 1.7,
  };
}

function infoNoteStyle(tone = 'neutral') {
  const isWarn = tone === 'warn';
  return {
    padding: 12,
    borderRadius: 8,
    border: `1px solid ${isWarn ? 'var(--border)' : 'var(--accent-border)'}`,
    background: isWarn ? 'var(--surface2)' : 'var(--accent-bg)',
    color: isWarn ? 'var(--text2)' : 'var(--text)',
    fontSize: 12,
    lineHeight: 1.7,
  };
}

function historyRowStyle(active) {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'center',
    padding: 16,
    borderRadius: 10,
    border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--surface)',
  };
}

function settingsSectionStyle() {
  return {
    padding: 18,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
  };
}

function modelSummaryGridStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 10,
    marginBottom: 14,
  };
}

function modelSummaryCardStyle() {
  return {
    padding: 14,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'linear-gradient(180deg, #fffefc 0%, var(--surface2) 100%)',
    minWidth: 0,
  };
}

function modelCardGridStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 12,
  };
}

function modelCardStyle(active) {
  return {
    display: 'grid',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--surface)',
    boxShadow: active ? '0 10px 26px rgba(55, 83, 112, 0.08)' : 'none',
    minWidth: 0,
  };
}

function modelCardTopStyle() {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  };
}

function modelCardTitleRowStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  };
}

function modelAvatarStyle() {
  return {
    width: 34,
    height: 34,
    flexShrink: 0,
    borderRadius: 10,
    border: '1px solid var(--accent-border)',
    background: 'var(--surface3)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 800,
  };
}

function modelActionBarStyle() {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    flexShrink: 0,
  };
}

function modelIconButtonStyle({ active = false, danger = false, disabled = false } = {}) {
  return {
    width: 34,
    height: 34,
    borderRadius: 9,
    border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
    background: active ? 'var(--surface3)' : 'var(--surface)',
    color: danger ? 'var(--red)' : active ? 'var(--accent)' : 'var(--text2)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.58 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: 0,
  };
}

function modelBadgeRowStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  };
}

function modelStatusPillStyle(tone = 'muted') {
  const palette = {
    accent: ['var(--accent-bg)', 'var(--accent-border)', 'var(--accent)'],
    warm: ['#f8efe2', '#e0c9a6', '#7b5a22'],
    ok: ['#eef7f0', '#bfd9c4', '#25613b'],
    muted: ['var(--surface2)', 'var(--border)', 'var(--text3)'],
  }[tone] || ['var(--surface2)', 'var(--border)', 'var(--text3)'];

  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 24,
    padding: '3px 8px',
    borderRadius: 999,
    border: `1px solid ${palette[1]}`,
    background: palette[0],
    color: palette[2],
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.2,
  };
}

function modelSpecGridStyle() {
  return {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
  };
}

function modelTestResultStyle(tone = 'neutral') {
  const isOk = tone === 'ok';
  return {
    padding: 10,
    borderRadius: 10,
    border: `1px solid ${isOk ? '#bfd9c4' : 'var(--border)'}`,
    background: isOk ? '#f6fbf7' : '#fffdf9',
    color: 'var(--text2)',
    fontSize: 12,
    lineHeight: 1.65,
  };
}
