import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

// Deliberately not a general-purpose cleaner: no arbitrary paths or dependency purge.
export const TARGETS = ['dist', 'dist-worker', 'tsconfig.tsbuildinfo', 'node_modules/.vite-temp']
const inside = (root, path) => root === sep || path === root || path.startsWith(root + sep)
function checkedPath(root, name) {
  const path = resolve(root, name)
  if (!inside(root, path) || path === root) throw new Error('Path outside cleanup boundary')
  let cursor = root
  for (const part of relative(root, path).split(sep)) {
    cursor = join(cursor, part)
    if (existsSync(cursor) || (() => { try { return lstatSync(cursor).isSymbolicLink() } catch { return false } })()) {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink refused: ${name}`)
    }
  }
  return path
}
function measure(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error('Nested symlink refused')
  if (stat.isDirectory()) return readdirSync(path).reduce((sum, name) => sum + measure(join(path, name)), 0)
  if (!stat.isFile()) throw new Error('Special file refused')
  return stat.size
}

export function processGuard(root, run = spawnSync) {
  const ps = run('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 10000 })
  const cwd = run('lsof', ['-nP', '-a', '-d', 'cwd', '-Fpn'], { encoding: 'utf8', timeout: 10000 })
  if (ps.status !== 0 || ps.stderr.trim() || cwd.status !== 0 || cwd.stderr.trim()) {
    throw new Error('Cannot verify running processes; cleanup is blocked (run with process-inspection permission)')
  }
  const rows = ps.stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }))
  const ancestors = new Set([process.pid])
  let parent = process.ppid
  while (parent && !ancestors.has(parent)) {
    ancestors.add(parent)
    parent = rows.find(row => row.pid === parent)?.ppid
  }
  const localPids = new Set()
  let pid
  for (const line of cwd.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    if (line.startsWith('n') && inside(root, line.slice(1))) localPids.add(pid)
  }
  // Desktop tool servers inherit this cwd but do not own the project's builds.
  // Keep the exception narrow; all candidates still undergo open-file checks.
  const hostTool = command => !command.includes(root + sep) && (
    command.includes('/cua-repl/bin/cua-repl.mjs') ||
    /(?:^npm exec xcodebuildmcp@\S+|\/node_modules\/\.bin\/xcodebuildmcp)\s+mcp\s*$/.test(command)
  )
  const runtimes = rows.filter(row => !ancestors.has(row.pid) &&
    !hostTool(row.command) &&
    /^(node|npm|npx|bun|deno|esbuild|workerd|python[\d.]*)$/.test(basename(row.command.split(' ')[0])) &&
    (localPids.has(row.pid) || row.command.includes(root + sep)))
  const devPids = new Set(runtimes.filter(row => /vite\/bin\/vite\.js/.test(row.command) &&
    !/\s(build|preview)(\s|$)/.test(row.command)).map(row => row.pid))
  const blocking = runtimes.filter(row => !devPids.has(row.pid) &&
    !(row.command.includes('/esbuild') && devPids.has(row.ppid)))
  return name => {
    if (blocking.length) return `Project runtime/build active: PID ${blocking.map(row => row.pid).join(', ')}`
    if (devPids.size && name.startsWith('node_modules/')) return `Vite dev active: PID ${[...devPids].join(', ')}`
    const path = join(root, name)
    const probe = run('lsof', ['-nP', ...(lstatSync(path).isDirectory() ? ['+D', path] : [path])], { encoding: 'utf8', timeout: 10000 })
    if (probe.stdout.trim()) return 'Open files detected'
    if (probe.status !== 1 || probe.stderr.trim()) return 'Open-file check unavailable'
    return null
  }
}

export function planCleanup(root, guard) {
  root = realpathSync(root)
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  return TARGETS.map(name => {
    try {
      const path = checkedPath(root, name)
      if (!existsSync(path)) return { name, state: 'absent', bytes: 0 }
      if (tracked.some(file => file === name || file.startsWith(name + '/'))) throw new Error('Contains Git-tracked files')
      const ignored = spawnSync('git', ['check-ignore', '-q', '--', name], { cwd: root })
      if (ignored.status !== 0) throw new Error('Not Git-ignored')
      const bytes = measure(path)
      const reason = guard(name)
      const stat = lstatSync(path)
      return { name, bytes, state: reason ? 'skipped' : 'ready', reason, device: stat.dev, inode: stat.ino }
    } catch (error) { return { name, state: 'skipped', bytes: 0, reason: error.message } }
  })
}

export function quarantine(root, plan, trashRoot, guard) {
  root = realpathSync(root)
  // Re-plan immediately before moving; stale dry-run output never authorizes a move.
  const fresh = planCleanup(root, guard)
  const selected = fresh.filter(item => item.state === 'ready' && plan.some(old =>
    old.name === item.name && old.state === 'ready' && old.device === item.device && old.inode === item.inode))
  if (!selected.length) return { movedBytes: 0, entries: [], skipped: fresh.filter(item => item.state === 'skipped') }
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  // Check every existing parent, including .Trash/output, before creating anything.
  checkedPath(sep, resolve(trashRoot).slice(1))
  const reportDir = checkedPath(root, 'output/cleanup')
  mkdirSync(reportDir, { recursive: true })
  const destination = join(trashRoot, id)
  mkdirSync(destination, { recursive: true })
  const reportPath = join(reportDir, `${id}.json`)
  const report = { id, root, movedBytes: 0, entries: [], skipped: fresh.filter(item => item.state === 'skipped') }
  const save = () => {
    const json = JSON.stringify(report, null, 2) + '\n'
    writeFileSync(join(destination, 'manifest.json'), json)
    writeFileSync(reportPath, json)
  }
  save()
  for (const item of selected) {
    const entry = { ...item, original: join(root, item.name), destination: join(destination, item.name.replaceAll('/', '__')), state: 'pending' }
    report.entries.push(entry)
    save()
    try {
      const path = checkedPath(root, item.name)
      const stat = lstatSync(path)
      if (stat.dev !== item.device || stat.ino !== item.inode) throw new Error('Path identity changed')
      measure(path) // Reject newly introduced symlinks/special files too.
      const reason = guard(item.name)
      if (reason) throw new Error(reason)
      renameSync(path, entry.destination) // No copy/delete fallback, no permanent deletion.
      entry.state = 'moved'
      report.movedBytes += item.bytes
    } catch (error) { entry.state = 'failed'; entry.reason = error.message }
    save()
  }
  return { ...report, reportPath }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) throw new Error('Usage: npm run clean:task -- [--dry-run | --apply]')
    const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'))
    const guard = processGuard(root)
    const plan = planCleanup(root, guard)
    console.log(JSON.stringify({ mode: args.includes('--apply') ? 'apply' : 'dry-run', plan }, null, 2))
    if (args.includes('--apply')) {
      if (process.platform !== 'darwin') throw new Error('Apply requires macOS Trash; dry-run only on this platform')
      const report = quarantine(root, plan, join(homedir(), '.Trash/BlendProof-builds'), name => processGuard(root)(name))
      console.log(JSON.stringify(report, null, 2))
      console.log('Moved to recoverable Trash, not physically reclaimed. Never auto-empty Trash; see manifest for original paths.')
      if (report.entries.some(entry => entry.state === 'failed')) process.exitCode = 1
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
