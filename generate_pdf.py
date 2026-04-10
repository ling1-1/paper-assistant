#!/usr/bin/env python3
"""
Paper Assistant PDF 导出生成器 - 支持中文
使用方法：python3 generate_pdf.py <output_path> <title> <content_json>
"""

import sys
import json
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
import os

def create_bilingual_pdf(output_path, original_text, translated_text, filename='translation'):
    """创建双语对照 PDF"""
    
    # 注册中文字体
    font_path = '/System/Library/Fonts/STHeiti Light.ttc'
    try:
        pdfmetrics.registerFont(TTFont('STHeiti', font_path))
    except Exception as e:
        print(f'警告：字体注册失败 {e}，尝试备用字体')
        font_path = '/System/Library/Fonts/Supplemental/NotoSansCJK-Regular.ttc'
        pdfmetrics.registerFont(TTFont('NotoSansCJK', font_path))
    
    # 创建文档
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=40,
        leftMargin=40,
        topMargin=60,
        bottomMargin=60,
    )
    
    # 样式
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='ChineseHeader',
        parent=styles['Heading1'],
        fontName='STHeiti',
        fontSize=24,
        textColor=colors.HexColor('#2563eb'),
        alignment=TA_CENTER,
        spaceAfter=20,
    ))
    styles.add(ParagraphStyle(
        name='ChineseMeta',
        parent=styles['Normal'],
        fontName='STHeiti',
        fontSize=10,
        textColor=colors.HexColor('#6b7280'),
        spaceAfter=20,
    ))
    styles.add(ParagraphStyle(
        name='ChineseSectionTitle',
        parent=styles['Heading2'],
        fontName='STHeiti',
        fontSize=14,
        textColor=colors.HexColor('#059669'),
        spaceAfter=5,
        spaceBefore=15,
    ))
    styles.add(ParagraphStyle(
        name='ChineseText',
        parent=styles['Normal'],
        fontName='STHeiti',
        fontSize=10,
        textColor=colors.HexColor('#1f2937'),
        leading=15,
        spaceAfter=10,
    ))
    styles.add(ParagraphStyle(
        name='ChineseFooter',
        parent=styles['Normal'],
        fontName='STHeiti',
        fontSize=8,
        textColor=colors.HexColor('#9ca3af'),
        alignment=TA_CENTER,
        spaceBefore=30,
    ))
    
    # 构建内容
    story = []
    
    # 标题
    story.append(Paragraph('📚 论文翻译', styles['ChineseHeader']))
    
    # 元信息
    from datetime import datetime
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    story.append(Paragraph(f'翻译时间：{now}<br/>模式：双语对照', styles['ChineseMeta']))
    
    # 分隔线
    story.append(Paragraph('────────────────────────────────────────', styles['ChineseText']))
    
    # 分割文本为段落
    original_paragraphs = original_text.split('\n\n') if original_text else []
    translated_paragraphs = translated_text.split('\n\n')
    
    # 双语对照
    max_len = max(len(original_paragraphs), len(translated_paragraphs))
    for i in range(max_len):
        orig = original_paragraphs[i] if i < len(original_paragraphs) else ''
        trans = translated_paragraphs[i] if i < len(translated_paragraphs) else ''
        
        if orig.strip():
            story.append(Paragraph('📝 原文', styles['ChineseSectionTitle']))
            story.append(Paragraph(orig.replace('\n', '<br/>'), styles['ChineseText']))
        
        if trans.strip():
            story.append(Paragraph('🌐 译文', styles['ChineseSectionTitle']))
            story.append(Paragraph(trans.replace('\n', '<br/>'), styles['ChineseText']))
        
        if i < max_len - 1:
            story.append(Paragraph('────────────────────────────────────────', styles['ChineseText']))
    
    # 页脚
    story.append(Paragraph('由 Paper Assistant 生成 | https://github.com/ling1-1/paper-assistant', styles['ChineseFooter']))
    
    # 构建 PDF
    doc.build(story)
    return True

def main():
    if len(sys.argv) < 4:
        print('用法：python3 generate_pdf.py <output_path> <original_text_json> <translated_text_json> [filename]')
        sys.exit(1)
    
    output_path = sys.argv[1]
    original_text = json.loads(sys.argv[2]) if sys.argv[2] != 'null' else ''
    translated_text = json.loads(sys.argv[3])
    filename = sys.argv[4] if len(sys.argv) > 4 else 'translation'
    
    try:
        create_bilingual_pdf(output_path, original_text, translated_text, filename)
        print(f'SUCCESS:{output_path}')
    except Exception as e:
        print(f'ERROR:{str(e)}')
        sys.exit(1)

if __name__ == '__main__':
    main()
