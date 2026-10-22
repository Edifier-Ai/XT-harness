// 存成 Word / PPT: a co-written document as a real .docx, a deck as a real .pptx. Plain OOXML parts in a zip written
// here (no library): headings, paragraphs, bullets and quotes in Word; one title and its points per slide in PowerPoint.
import zlib from 'node:zlib'

// ---------- zip (deflate, no extras) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const DOS_DATE = (1 << 5) | 1   // 1980-01-01: the files carry no meaningful time

/** files: [[name, string | Buffer]] → the zip's bytes */
export function zip(files) {
  const parts = [], central = []
  let off = 0
  for (const [name, data] of files) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    const comp = zlib.deflateRawSync(raw), nm = Buffer.from(name, 'utf8'), crc = crc32(raw)
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(DOS_DATE, 12)
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28)
    parts.push(h, nm, comp)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(DOS_DATE, 14)
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42)
    central.push(c, nm)
    off += 30 + nm.length + comp.length
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22)
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, e])
}

// text as XML: escaped, without the control characters XML does not allow
const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const FONT = 'Microsoft YaHei'

// ---------- Word ----------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const STYLE = { h1: 'Heading1', h2: 'Heading2', quote: 'Quote', li: 'ListBullet' }
function wpara(b) {
  const lines = String(b.text || '').split('\n')
  const runs = lines.map((l, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${x(l)}</w:t></w:r>`).join('')
  const st = STYLE[b.type]
  const ppr = st ? `<w:pPr><w:pStyle w:val="${st}"/>${b.type === 'li' ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>` : ''
  return `<w:p>${ppr}${runs}</w:p>`
}
const wstyle = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`

/** blocks: [{ type: h1|h2|p|li|quote, text }] → .docx bytes */
export function docx(title, blocks) {
  const body = (blocks.length ? blocks : [{ type: 'p', text: '' }]).map(wpara).join('')
  return zip([
    ['[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ['_rels/.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
    ['docProps/core.xml', XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>小天 Bot</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`],
    ['word/_rels/document.xml.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'],
    ['word/document.xml', XML + `<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`],
    ['word/styles.xml', XML + `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="312" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
      + wstyle('Heading1', 'heading 1', '<w:keepNext/><w:spacing w:before="360" w:after="200"/><w:outlineLvl w:val="0"/>', '<w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="36"/>')
      + wstyle('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/>', '<w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/>')
      + wstyle('Quote', 'Quote', '<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="BFBFBF"/></w:pBdr><w:ind w:left="300"/>', '<w:color w:val="595959"/>')
      + wstyle('ListBullet', 'List Bullet', '<w:spacing w:after="80"/><w:ind w:left="420" w:hanging="420"/>', '')
      + '</w:styles>'],
    ['word/numbering.xml', XML + `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`],
  ])
}

// ---------- PowerPoint (16:9) ----------
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
const PR = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL = (list) => XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map(([i, t, to]) => `<Relationship Id="${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}" Target="${to}"/>`).join('') + '</Relationships>'
const CX = 12192000, CY = 6858000, IN = 914400
const INK = '1F1F22', SOFT = '4A4A50', MUTE = '8A8A90'
const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
const run = (t, sz, color, b) => `<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="${sz}"${b ? ' b="1"' : ''} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/></a:rPr><a:t>${x(t)}</a:t></a:r>`
function box(idn, name, [px, py, w, h], paras, anchor = 't') {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${idn}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${px}" y="${py}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`
}
function slideXml(s, i, n) {
  const [title, ...pts] = String(s.text || '').split('\n').map((l) => l.trim())
  const points = pts.filter(Boolean)
  let tree
  const cover = !points.length && i === 0
  if (cover) {
    // a first slide with only a title is the cover
    tree = box(2, 'Title', [IN, Math.round(CY * 0.36), CX - 2 * IN, Math.round(IN * 1.6)], `<a:p><a:pPr algn="l"/>${run(title || ' ', 4000, INK, true)}</a:p>`, 'b')
      + `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="3" name="Rule"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="${IN}" y="${Math.round(CY * 0.36 + IN * 1.85)}"/><a:ext cx="${IN}" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="28575"><a:solidFill><a:srgbClr val="${INK}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`
  } else {
    const paras = (points.length ? points : ['']).map((p) => `<a:p><a:pPr marL="342900" indent="-342900"><a:spcBef><a:spcPts val="900"/></a:spcBef><a:buClr><a:srgbClr val="${MUTE}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${run(p || ' ', 2200, SOFT)}</a:p>`).join('')
    tree = box(2, 'Title', [Math.round(IN * 0.8), Math.round(IN * 0.6), CX - Math.round(IN * 1.6), Math.round(IN * 1.0)], `<a:p>${run(title || ' ', 3200, INK, true)}</a:p>`, 'b')
      + box(3, 'Body', [Math.round(IN * 0.8), Math.round(IN * 1.9), CX - Math.round(IN * 1.6), CY - Math.round(IN * 2.6)], paras)
  }
  if (!cover) tree += box(4, 'Page', [CX - Math.round(IN * 1.3), CY - Math.round(IN * 0.55), Math.round(IN * 0.6), Math.round(IN * 0.3)], `<a:p><a:pPr algn="r"/>${run(`${i + 1} / ${n}`, 1000, MUTE)}</a:p>`)
  return XML + `<p:sld ${A} ${PR}><p:cSld><p:spTree>${GRP}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}
const THEME = XML + `<a:theme ${A} name="小天"><a:themeElements><a:clrScheme name="小天"><a:dk1><a:srgbClr val="${INK}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44444A"/></a:dk2><a:lt2><a:srgbClr val="F2F2F4"/></a:lt2>`
  + '<a:accent1><a:srgbClr val="5B4BE0"/></a:accent1><a:accent2><a:srgbClr val="2F6FEB"/></a:accent2><a:accent3><a:srgbClr val="2E9C6A"/></a:accent3><a:accent4><a:srgbClr val="D98A1F"/></a:accent4><a:accent5><a:srgbClr val="C9483C"/></a:accent5><a:accent6><a:srgbClr val="7A7A82"/></a:accent6><a:hlink><a:srgbClr val="2F6FEB"/></a:hlink><a:folHlink><a:srgbClr val="7A5BD6"/></a:folHlink></a:clrScheme>'
  + `<a:fontScheme name="小天"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
  + '<a:fmtScheme name="小天"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
const LVL = (sz) => `<a:lvl1pPr><a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr>`
const MASTER = XML + `<p:sldMaster ${A} ${PR}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${GRP}</p:spTree></p:cSld>`
  + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
  + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>${LVL(3200)}</p:titleStyle><p:bodyStyle>${LVL(2200)}</p:bodyStyle><p:otherStyle>${LVL(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`
const LAYOUT = XML + `<p:sldLayout ${A} ${PR} type="blank" preserve="1"><p:cSld name="空白"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

/** slides: [{ text: "title\npoint\npoint" }] → .pptx bytes */
export function pptx(title, slides) {
  const list = slides.length ? slides : [{ text: title }]
  const n = list.length
  const ct = list.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  const files = [
    ['[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>'
      + '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>'
      + '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + ct + '</Types>'],
    ['_rels/.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'],
    ['docProps/core.xml', XML + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>小天 Bot</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`],
    ['ppt/presentation.xml', XML + `<p:presentation ${A} ${PR} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${list.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${CX}" cy="${CY}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle>${LVL(1800)}</p:defaultTextStyle></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', REL([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ['rId3', 'presProps', 'presProps.xml'], ['rId4', 'viewProps', 'viewProps.xml'], ['rId5', 'tableStyles', 'tableStyles.xml'], ...list.map((_, i) => [`rId${10 + i}`, 'slide', `slides/slide${i + 1}.xml`])])],
    ['ppt/presProps.xml', XML + `<p:presentationPr ${A} ${PR}/>`],
    ['ppt/viewProps.xml', XML + `<p:viewPr ${A} ${PR}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>`],
    ['ppt/tableStyles.xml', XML + `<a:tblStyleLst ${A} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`],
    ['ppt/theme/theme1.xml', THEME],
    ['ppt/slideMasters/slideMaster1.xml', MASTER],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', REL([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', LAYOUT],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', REL([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
  ]
  list.forEach((s, i) => {
    files.push([`ppt/slides/slide${i + 1}.xml`, slideXml(s, i, n)])
    files.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, REL([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])])
  })
  return zip(files)
}
