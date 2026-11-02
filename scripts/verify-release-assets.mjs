import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = process.cwd()
const dist = join(root, 'dist')
const landing = join(dist, 'landing')
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

check(existsSync(join(dist, 'index.html')), '缺少 dist/index.html')
check(existsSync(join(landing, 'index.html')), '缺少 dist/landing/index.html')
check(existsSync(join(landing, 'app.js')), '缺少 dist/landing/app.js')

if (existsSync(join(landing, 'index.html'))) {
  const html = readFileSync(join(landing, 'index.html'), 'utf8')
  const entry = html.match(/<script[^>]+src=["']([^"']+)["']/i)?.[1]
  check(entry === './app.js', `落地页入口必须是 ./app.js，实际为 ${entry ?? '未找到'}`)

  const refs = new Set()
  for (const [, value] of html.matchAll(/(?:src|href|srcset)=["']([^"']+)["']/gi)) {
    for (const candidate of value.split(',').map((item) => item.trim().split(/\s+/)[0])) {
      if (candidate.startsWith('./')) refs.add(candidate)
    }
  }
  if (existsSync(join(landing, 'app.js'))) {
    const app = readFileSync(join(landing, 'app.js'), 'utf8')
    for (const [, candidate] of app.matchAll(/import\(["'](\.[^"']+\.js)["']\)/g)) refs.add(candidate)
  }
  for (const ref of refs) {
    const target = resolve(landing, ref)
    const safe = relative(landing, target)
    check(!safe.startsWith('..') && !safe.startsWith('/') && existsSync(target), `落地页资源不存在: ${ref}`)
  }
}

const forbidden = []
function scan(directory) {
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const info = statSync(path)
    if (info.isDirectory()) scan(path)
    else if (/\.blend$|\.dev\.vars$|(?:^|\/)storage\//i.test(relative(root, path))) forbidden.push(relative(root, path))
  }
}
scan(join(root, 'dist'))
scan(join(root, 'dist-worker'))
check(forbidden.length === 0, `发布包包含禁止文件: ${forbidden.join(', ')}`)

if (failures.length) {
  console.error('发布包校验失败:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('发布包校验通过：工作台、落地页入口、引用资源和敏感文件边界均符合要求。')
