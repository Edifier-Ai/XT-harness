# Generates the 天禧 eval fixtures (documents, sheets, PDFs, photos, mails) into tianxi/eval/fixtures,
# plus manifest.json with the facts the checkers compare against.
import json, os, sys, random, hashlib, shutil, datetime
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

OUT = sys.argv[1]
if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)
random.seed(7)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
M = {}

def p(*a):
    f = os.path.join(OUT, *a); os.makedirs(os.path.dirname(f), exist_ok=True); return f

def pdf(path, pages):
    c = canvas.Canvas(path)
    for lines in pages:
        c.setFont('STSong-Light', 12); y = 790
        for ln in lines: c.drawString(60, y, ln); y -= 22
        c.showPage()
    c.save()

def docx(path, title, paras):
    d = Document(); d.add_heading(title, 1)
    for t in paras: d.add_paragraph(t)
    d.save(path)

def jpg(path, color, exif_date=None, size=(64, 48)):
    im = Image.new('RGB', size, color)
    if exif_date:
        ex = Image.Exif(); ex[0x0132] = exif_date
        ex.get_ifd(0x8769)[0x9003] = exif_date
        im.save(path, exif=ex)
    else: im.save(path)

# ---- 01 / 30: messy downloads folder ----
for base in ['01/下载', '30/下载']:
    jpg(p(base, 'IMG_0012.jpg'), (200, 80, 80)); jpg(p(base, '截图 2026-10-12.png'), (80, 80, 200))
    docx(p(base, '设计规范v3.docx'), '设计规范', ['按钮圆角 8px。'])
    pdf(p(base, '合同v2.pdf'), [['合同 v2']])
    wb = Workbook(); wb.active.append(['物料', '单价']); wb.active.append(['屏幕', 320]); wb.save(p(base, '报价单.xlsx'))
    open(p(base, '会议记录.txt'), 'w').write('周一例会：确认 Q4 节奏。\n')
    shutil.make_archive(p(base, '素材包'), 'zip', root_dir=os.path.join(OUT, base), base_dir='会议记录.txt')
    prs = Presentation(); s = prs.slides.add_slide(prs.slide_layouts[0]); s.shapes.title.text = '产品介绍'; prs.save(p(base, '产品介绍.pptx'))
M['01'] = {'files': sorted(os.listdir(os.path.join(OUT, '01', '下载')))}

# ---- 02: duplicates ----
b = '02/下载'
pdf(p(b, '发票-10月.pdf'), [['发票 10 月 合计 ¥1,280.00']]); shutil.copy(p(b, '发票-10月.pdf'), p(b, '发票-10月(1).pdf'))
jpg(p(b, '团建合影.jpg'), (30, 160, 90)); shutil.copy(p(b, '团建合影.jpg'), p(b, '团建合影 - 副本.jpg'))
docx(p(b, '方案A.docx'), '方案A', ['方案 A 内容']); docx(p(b, '方案B.docx'), '方案B', ['方案 B 内容，与 A 不同'])
open(p(b, 'readme.txt'), 'w').write('唯一文件\n')
M['02'] = {'groups': [['发票-10月.pdf', '发票-10月(1).pdf'], ['团建合影.jpg', '团建合影 - 副本.jpg']], 'newest': ['发票-10月(1).pdf', '团建合影.jpg'], 'unique': ['方案A.docx', '方案B.docx', 'readme.txt']}

# ---- 03: photos with EXIF dates ----
dates = {}
start = datetime.datetime(2026, 10, 1, 9, 0)
for i in range(20):
    d = start + datetime.timedelta(days=random.randint(0, 6), hours=random.randint(0, 10), minutes=random.randint(0, 59))
    name = f'DSC_{4100 + i * 7}.jpg'
    jpg(p('03/照片', name), (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)), d.strftime('%Y:%m:%d %H:%M:%S'))
    h = hashlib.md5(open(p('03/照片', name), 'rb').read()).hexdigest()
    dates[h] = d.strftime('%Y-%m-%d')
M['03'] = {'dates': dates}

# ---- 04: contract PDF ----
pages = [['采购合同', '甲方：联想（北京）有限公司', '乙方：华贸电子有限公司'], ['第一条 标的物：笔记本屏幕模组 10,000 片'], ['第二条 交付：2026 年 12 月 31 日前分两批交付'],
         ['第三条 违约责任', '乙方逾期交付的，应向甲方支付违约金，', '违约金为合同总额的 5%，即人民币 128,000 元。'], ['第四条 争议解决：提交北京仲裁委员会仲裁']]
pdf(p('04', '采购合同.pdf'), pages)
M['04'] = {'page': 4, 'amount': '128,000'}

# ---- 05: meeting minutes ----
docx(p('05', '会议纪要.docx'), '天禧概念版项目会 会议纪要', [
    '时间：10 月 18 日 14:00，参会：张伟、李娜、王强、summer。',
    '一、项目整体计划在 11 月 15 日上线内测版本，先覆盖 PC 端。',
    '二、本期预算确定为 30 万元，超出部分需要另行审批。',
    '三、屏幕模组供应商最终选定华贸电子，备选为恒达科技。',
    '会后待办：张伟负责在下周三前输出接口文档；李娜负责联系华贸电子确认样品时间；王强负责提交预算审批流程。'])
M['05'] = {'facts': [['11月15', '11 月 15', '11.15', '11/15'], ['30万', '30 万', '300,000', '300000'], ['华贸']], 'owners': [['张伟', '接口'], ['李娜', '华贸'], ['王强', '预算']]}

# ---- 06: weekly report ----
paras = ['本周交互创新组主要推进了三件事。第一，天禧做 PPT 体验原型完成第二版，内部试用 12 人，平均满意度 4.3 分（5 分制），比上一版提升 0.6 分。',
         '第二，知识库生成式小组件完成 18 个场景梳理，其中 6 个进入原型阶段。我们对这些场景逐一做了可行性评估，部分场景依赖端侧模型能力，需要和算法团队进一步对齐。',
         '第三，概念版天禧客户端完成第一版打包，安装包体积 336MB，接下来要在 3 台不同配置的电脑上做稳定性测试。',
         '此外，本周参加了两次跨部门评审，收到的主要反馈集中在交互一致性和响应速度上。我们已经把反馈整理成清单，计划下周逐项回复。',
         '下周计划：完成概念版天禧评测，覆盖 30 个任务；与业务方对齐两个落地场景；准备月度汇报材料。团队整体进度正常，没有需要上级协调的阻塞事项。']
docx(p('06', '周报.docx'), '交互创新组周报（10.13–10.17）', paras)
M['06'] = {'numbers': ['12', '4.3', '0.6', '18', '336'], 'max': 300}

# ---- 07: PPT ----
prs = Presentation()
titles = ['Q3 渠道经营回顾', '核心指标达成情况', '重点渠道表现', '团队团建照片集锦', '问题与原因分析', 'Q4 行动计划']
for t in titles:
    s = prs.slides.add_slide(prs.slide_layouts[1]); s.shapes.title.text = t; s.placeholders[1].text = t + ' 的要点'
prs.save(p('07', 'Q3汇报.pptx'))
M['07'] = {'titles': titles, 'odd': 4}

# ---- 08: sales ----
wb = Workbook(); ws = wb.active; ws.title = '销售'; ws.append(['区域', '月份', '销售额（万元）'])
data = {'华北': (320, 335), '华东': (410, 428), '华南': (380, 302), '西南': (150, 141)}
for r, (a, bb) in data.items():
    for k, part in enumerate([0.5, 0.3, 0.2]):
        ws.append([r, '8月', round(a * part, 1)]); ws.append([r, '9月', round(bb * part, 1)])
wb.save(p('08', '销售.xlsx'))
M['08'] = {'answer': '华南', 'sep': {r: v[1] for r, v in data.items()}}

# ---- 09: supplier merge ----
A = ['华贸电子', '恒达科技', '佳讯光电', '明远精密', '东润材料', '星海显示']
B = ['华贸电子', '恒达科技', '佳讯光电', '明远精密', '启航包装']
for nm, lst in [('供应商A.xlsx', A), ('供应商B.xlsx', B)]:
    wb = Workbook(); ws = wb.active; ws.append(['供应商名称', '联系人', '评级'])
    for i, s in enumerate(lst): ws.append([s, '联系人' + str(i + 1), random.choice(['A', 'B', 'C'])])
    wb.save(p('09', nm))
M['09'] = {'onlyA': ['东润材料', '星海显示'], 'onlyB': ['启航包装']}

# ---- 10: data with planted errors ----
wb = Workbook(); ws = wb.active; ws.append(['姓名', '年龄', '入职日期', '采购数量', '邮箱'])
rows = [['赵一', 28, '2023-04-01', 120, 'zhao1@lenovo.com'], ['钱二', 35, '2021-09-15', 80, 'qian2@lenovo.com'], ['孙三', 250, '2022-01-10', 60, 'sun3@lenovo.com'],
        ['李四', 41, '2026-13-01', 95, 'li4@lenovo.com'], ['周五', 30, '2020-06-30', -40, 'zhou5@lenovo.com'], ['吴六', 26, '2024-02-29', 75, 'wu6lenovo.com'],
        ['郑七', 33, '2019-11-11', 110, 'zheng7@lenovo.com'], ['王八', 29, '2022-08-08', 66, 'wang8@lenovo.com']]
for r in rows: ws.append(r)
wb.save(p('10', '员工采购数据.xlsx'))
M['10'] = {'errors': [['250', '孙三'], ['2026-13', '李四'], ['-40', '周五'], ['wu6lenovo', '吴六']]}

# ---- 14: chat log ----
open(p('14', '聊天记录.txt'), 'w').write('''【项目群】10月18日
杨润：summer 周一前把概念版天禧的评测方案发我看一下
summer：好的
张伟：接口文档我周三前给
杨润：summer 你再约一下华贸的人，确认样品寄送时间
李娜：样品的事我来跟进物流
杨润：还有 summer 记得把月度汇报的 PPT 初稿周四发群里
summer：收到
王强：预算审批我这周提交
杨润：summer 顺便把上周评审的反馈清单整理一下，周五前同步给大家
杨润：另外 summer 帮忙订一下下周二的会议室，评审要用
''')
M['14'] = {'mine': [['评测'], ['华贸', '样品'], ['月度汇报', 'PPT'], ['反馈'], ['会议室']], 'others': [['接口文档'], ['物流'], ['预算审批']]}

# ---- 16: customer mails ----
mails = [('客户需求-联想渠道商北京星辰.txt', '北京星辰科技', '10月14日', '希望 11 月底前提供 200 台 ThinkPad X9 的样机，支持统一预装企业软件。'),
         ('客户需求-上海云图.txt', '上海云图信息', '10月15日', '需要天禧在企业内网离线可用，并支持对接他们的 OA 审批。'),
         ('客户需求-深圳华光.txt', '深圳华光制造', '10月16日', '希望平板端能扫码报工，每天导出一份产线日报。')]
for fn, who, d, need in mails:
    open(p('16/邮件', fn), 'w').write(f'发件人：{who} 采购部\n日期：2026年{d}\n主题：需求沟通\n\n您好，\n{need}\n请尽快回复，谢谢。\n')
M['16'] = {'clients': [['星辰'], ['云图'], ['华光']], 'dates': [['10月14', '10-14', '10/14', '10.14'], ['10月15', '10-15', '10/15', '10.15'], ['10月16', '10-16', '10/16', '10.16']]}

# ---- 24: (no inputs) / 26: folder to zip ----
for i in range(5): open(p('26/资料', f'资料{i + 1}.txt'), 'w').write(f'第 {i + 1} 份资料\n')
docx(p('26/资料', '说明.docx'), '说明', ['资料说明'])
M['26'] = {'count': 6}

# ---- 27: invoices ----
amts = [1280.00, 356.50, 2049.90, 88.00, 615.60]
for i, a in enumerate(amts):
    pdf(p('27/发票', f'发票_{i + 1:02d}.pdf'), [[f'增值税普通发票  NO.2026{i + 1:04d}', '购买方：联想（北京）有限公司', f'项目：差旅及办公用品', f'价税合计（小写）：¥{a:,.2f}']])
M['27'] = {'total': round(sum(amts), 2)}

json.dump(M, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
print('fixtures ok', sum(len(f) for _, _, f in os.walk(OUT)))
