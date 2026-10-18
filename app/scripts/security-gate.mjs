#!/usr/bin/env node
/** OWASP LLM Top 10 安全门入口。 */
import { runSecurityChecks } from './checks/security-rules.mjs'

const json = process.argv.includes('--json')
const results = runSecurityChecks()
const failures = results.filter((item) => !item.ok && !item.na)
const ok = failures.length === 0

if (json) {
  console.log(JSON.stringify({ ok, results }, null, 2))
} else {
  console.log('===== OWASP LLM Top 10 安全门 =====')
  for (const item of results) {
    const mark = item.na ? '➖' : item.ok ? '✅' : '❌'
    console.log(`${mark} ${item.id} ${item.title}`)
    console.log(`   ${item.detail}`)
  }
  console.log(ok ? '\n✅ 安全门通过' : `\n❌ 安全门未通过：${failures.map((item) => item.id).join('、')}`)
}

process.exit(ok ? 0 : 1)
