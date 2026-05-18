const FIELD_HINTS = {
  general: '通用学术论文',
  computer: '计算机科学',
  medicine: '医学',
  finance: '金融',
  law: '法学',
  engineering: '工程',
  biology: '生物学',
  chemistry: '化学化工',
};

const TRANSLATION_RULES = `你是一位专业的学术论文翻译专家。

要求：
1. 准确传达原文含义，不要自行增删事实。
2. 保留段落结构、引用编号、图表编号、单位、化学式和数学公式。
3. 保留所有 LaTeX 公式和命令，例如 $...$、$$...$$、\\ce{...}、\\frac{...}{...}、\\alpha 等。
4. 学术语气正式、自然，不输出额外解释、总结或标题。
5. 如遇占位符 token，必须原样保留。
6. 忽略明显的 PDF 页眉、页脚、页码、断栏混排残片和不可读乱码，不要输出 emoji 或装饰符号。`;

function buildTextTranslationPrompt({ sourceLang = 'en', targetLang = 'zh', field = 'general' }) {
  return `${TRANSLATION_RULES}

领域：${FIELD_HINTS[field] || FIELD_HINTS.general}
翻译方向：${sourceLang === 'en' ? '英文' : '中文'} -> ${targetLang === 'en' ? '英文' : '中文'}`;
}

function buildPdfDirectPrompt({ targetLang = 'zh' }) {
  return `你是一位专业的学术论文翻译专家。请直接基于用户上传的整篇论文 PDF 输出${targetLang === 'zh' ? '中文' : '英文'}译文。

要求：
1. 只输出译文正文。
2. 保留标题层级、段落顺序、公式、引用、图表编号和单位。
3. 遇到不能安全翻译的公式或符号时保持原样。
4. 不要输出解释、总结、致谢或额外提示。`;
}

function buildPdfVisionPrompt({
  sourceLang = 'en',
  targetLang = 'zh',
  field = 'general',
  pageNumber = 1,
  totalPages = 1,
}) {
  return `你正在处理一篇${FIELD_HINTS[field] || FIELD_HINTS.general}的论文图片页，第 ${pageNumber}/${totalPages} 页。

任务：
1. 识别图片中的正文、标题、图表编号、引用编号和公式位置。
2. 将${sourceLang === 'en' ? '英文' : '中文'}准确翻译成${targetLang === 'en' ? '英文' : '中文'}。
3. 保持段落顺序、标题层级、图表编号、引用编号、单位和公式，不要额外解释。
4. 如果页面只有图表或公式说明，也按原顺序输出可翻译文本；无法安全翻译的符号保持原样。
5. 忽略明显的页眉、页脚、页码和扫描噪声，不输出 emoji 或装饰符号。
6. 只输出这一页的译文，不要补充“第几页”“翻译如下”等说明。`;
}

function buildPdfVisionBatchPrompt({
  sourceLang = 'en',
  targetLang = 'zh',
  field = 'general',
  pages = [],
  totalPages = 1,
}) {
  const pageNumbers = pages.map((page) => page.pageNumber).filter(Boolean);
  const firstPage = pageNumbers[0] || 1;
  const lastPage = pageNumbers[pageNumbers.length - 1] || firstPage;

  return `你正在处理一篇${FIELD_HINTS[field] || FIELD_HINTS.general}论文的连续图片页，第 ${firstPage}-${lastPage}/${totalPages} 页。每张图片对应一个 PDF 页面，请把这些页面作为同一篇论文的连续上下文来理解，而不是孤立翻译。

任务：
1. 识别这些页面中的标题、正文、表格、图表编号、引用编号、公式和化学式位置。
2. 将${sourceLang === 'en' ? '英文' : '中文'}准确翻译成${targetLang === 'en' ? '英文' : '中文'}，保持学术论文语气。
3. 只输出译文正文，按页面和段落自然衔接；不要输出“第 X 页译文”等说明。
4. 对表格优先保留原始数值、单位、化学式和列关系；无法可靠识别的表格区域请简要标注“表格内容识别不完整”，不要逐字复写乱码。
5. 参考文献、作者列表、期刊名、卷期页码原则上保留原文格式，不要强行翻译人名、刊名或参考文献条目。
6. 忽略页眉、页脚、页码、扫描噪声和重复字符；如果看到类似 MSMSMS、乱码串、重复符号，请直接省略。
7. 不要使用 Markdown 标题符号、代码块、emoji 或额外解释。
8. 不要输出 HTML 标签或富文本标记，例如 <sub>、<sup>、<br>；化学式可使用普通文本或 Unicode 上下标。`;
}

const ASSISTANT_INTENT_PROMPTS = {
  general: '',
  expand: `当前动作：学术扩写。你应主动补充论证、背景和逻辑承接，但不要凭空添加数据或文献。`,
  polish: `当前动作：语言润色。你应优先优化表达、句式和学术风格，不改变作者原意。`,
  dedup: `当前动作：降重改写。你应在保留原意的前提下重组句式和表述，避免机械同义词替换。`,
  deai: `当前动作：去AI化。你应降低模板感，减少机械递进词，让表述更像真实作者写作。`,
  outline: `当前动作：结构设计。优先产出章节框架、研究路径、每章重点，而不是直接写完整正文。`,
  abstract: `当前动作：摘要生成。优先凝练研究背景、方法、结果和结论，控制学术摘要风格。`,
  literature: `当前动作：文献综述。优先基于可用文献做归纳对比，不允许编造文献信息。`,
  title: `当前动作：题目分析。优先分析选题范围、研究对象、结构建议和后续写作步骤。`,
};

function buildAssistantIntentPrompt({
  intent = 'general',
  contextFlags = {},
}) {
  const intentPrompt = ASSISTANT_INTENT_PROMPTS[intent] || '';
  const flagPrompts = [];

  if (contextFlags.withLiterature) {
    flagPrompts.push('当前请求已启用文献上下文，回答时优先吸收系统提供的真实文献。');
  }

  if (contextFlags.isDraftingTask) {
    flagPrompts.push('当前请求属于写作任务，输出时优先给出可直接使用的正文或提纲。');
  }

  if (contextFlags.isRevisionTask) {
    flagPrompts.push('当前请求属于修改任务，优先保留原文信息，再做结构或措辞优化。');
  }

  return [intentPrompt, ...flagPrompts]
    .filter(Boolean)
    .join('\n\n');
}

module.exports = {
  buildTextTranslationPrompt,
  buildPdfDirectPrompt,
  buildPdfVisionPrompt,
  buildPdfVisionBatchPrompt,
  buildAssistantIntentPrompt,
  FIELD_HINTS,
};
