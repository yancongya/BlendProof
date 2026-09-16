#!/bin/zsh
# BlendProof dev servers, detached from the calling session (fork+setsid),
# so they survive the terminal/agent session that started them.
# Logs: /tmp/blendproof-app.log  /tmp/blendproof-landing.log
# Stop: kill $(cat /tmp/blendproof-app.pid /tmp/blendproof-landing.pid)

set -e
ROOT="${0:A:h:h}"
NODE=/usr/local/bin/node
VITE="$ROOT/node_modules/vite/bin/vite.js"

spawn() {
  local name="$1" config="$2" pidfile="/tmp/blendproof-$name.pid"
  if [[ -f "$pidfile" ]] && kill -0 $(cat "$pidfile") 2>/dev/null; then
    echo "blendproof-$name already running (pid $(cat "$pidfile"))"
    return
  fi
  /usr/bin/python3 - "$name" "$config" "$pidfile" << 'PYEOF'
import os, sys
name, config, pidfile = sys.argv[1], sys.argv[2], sys.argv[3]
pid = os.fork()
if pid == 0:
    os.setsid()
    os.chdir("/Users/tanyancong/工作/开发/BlendProof")
    with open(f"/tmp/blendproof-{name}.log", "ab", 0) as log:
        os.dup2(log.fileno(), 1); os.dup2(log.fileno(), 2)
    os.execv("/usr/local/bin/node", ["/usr/local/bin/node",
        "/Users/tanyancong/工作/开发/BlendProof/node_modules/vite/bin/vite.js",
        "--config", config])
with open(pidfile, "w") as f:
    f.write(str(pid))
PYEOF
  echo "blendproof-$name started"
}

spawn app "$ROOT/vite.config.ts"          # http://localhost:5173/
spawn landing "$ROOT/landing/vite.config.ts"  # http://localhost:5174/landing/
