import * as ResEdit from 'resedit'
import fs from 'node:fs'
const [exePath, icoPath] = process.argv.slice(2)
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath))
const res = ResEdit.NtExecutableResource.from(exe)
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath))
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data))
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0]
vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: '天禧AI 概念版', FileDescription: '天禧AI 概念版', CompanyName: 'Lenovo 交互创新', OriginalFilename: 'TianxiAI.exe', InternalName: 'TianxiAI', LegalCopyright: '' })
vi.setFileVersion(0, 1, 0, 0, 1033); vi.setProductVersion(0, 1, 0, 0, 1033)
vi.outputToResourceEntries(res.entries)
res.outputResource(exe)
fs.writeFileSync(exePath, Buffer.from(exe.generate()))
console.log('exe patched')
