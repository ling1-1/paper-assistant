#!/usr/bin/env python3
"""测试中文 PDF 导出 - 使用 reportlab"""

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
import os

# 注册中文字体
font_path = '/System/Library/Fonts/STHeiti Light.ttc'
print(f'正在注册中文字体：{font_path}')

try:
    pdfmetrics.registerFont(TTFont('STHeiti', font_path))
    print('✅ 字体注册成功')
except Exception as e:
    print(f'❌ 字体注册失败：{e}')
    # 尝试使用其他字体
    font_path = '/System/Library/Fonts/Supplemental/NotoSansCJK-Regular.ttc'
    print(f'尝试备用字体：{font_path}')
    pdfmetrics.registerFont(TTFont('NotoSansCJK', font_path))
    print('✅ 备用字体注册成功')

# 创建 PDF
output_path = '/tmp/paper-assistant/test-chinese-output-reportlab.pdf'
c = canvas.Canvas(output_path, pagesize=A4)
width, height = A4

# 设置字体
c.setFont('STHeiti', 18)

# 添加标题
c.drawCentredString(width / 2, height - 50, '中文 PDF 测试')

# 添加内容
c.setFont('STHeiti', 12)
y = height - 100
c.drawString(50, y, '这是一段中文测试文本。')
y -= 20
c.drawString(50, y, 'Paper Assistant - 论文翻译工具')
y -= 20
c.drawString(50, y, '英文测试：The quick brown fox jumps over the lazy dog.')
y -= 20
c.drawString(50, y, '混合测试：AI 编程 + 效率工具 = 生产力提升')

# 保存 PDF
c.save()

print(f'✅ PDF 已生成：{output_path}')
print(f'📄 文件大小：{os.path.getsize(output_path)} bytes')
