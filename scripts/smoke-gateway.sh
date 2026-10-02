#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${ZEUS_GATEWAY_BIN:-$ROOT/dist/gateway/zeus-gateway-linux-amd64}"
if [ ! -x "$BIN" ]; then
  echo "Missing gateway binary: $BIN" >&2
  exit 2
fi
PORT="$(python3 - <<'PY'
import socket
s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()
PY
)"
TMP="$(mktemp -d)"
trap 'kill ${PID:-0} 2>/dev/null || true; rm -rf "$TMP"' EXIT
export ZEUS_ADMIN_TOKEN='smoke-admin-token-000000000000'
export ZEUS_AGENT_TOKEN='smoke-agent-token-111111111111'
export ZEUS_LISTEN_ADDR="127.0.0.1:$PORT"
export ZEUS_STATE_FILE="$TMP/auth.json"
export ZEUS_SESSION_STATE_FILE="$TMP/sessions.json"
unset ZEUS_PROVIDERS_FILE
"$BIN" >"$TMP/gateway.log" 2>&1 & PID=$!
BASE="http://127.0.0.1:$PORT"
for _ in $(seq 1 50); do
  if curl -fsS "$BASE/health" >/dev/null 2>&1; then break; fi
  sleep 0.1
done

python3 - "$BASE" <<'PY'
import json, sys, urllib.request, urllib.error
base=sys.argv[1]
admin='smoke-admin-token-000000000000'; agent='smoke-agent-token-111111111111'
def req(method,path,body=None,token=None):
    data=None if body is None else json.dumps(body).encode()
    r=urllib.request.Request(base+path,data=data,method=method)
    if data is not None: r.add_header('Content-Type','application/json')
    if token: r.add_header('Authorization','Bearer '+token)
    with urllib.request.urlopen(r,timeout=5) as resp:
        raw=resp.read()
        return resp.status, (json.loads(raw) if raw else None)
_, health=req('GET','/health'); assert health['ok'] is True
_, pair=req('POST','/v1/pair/start',{},admin)
_, done=req('POST','/v1/pair/complete',{'code':pair['code'],'device_name':'Smoke Phone'})
device=done['token']
event={
 'session_id':'smoke-session','agent_id':'smoke-agent','runtime':'codex','provider':'openai',
 'project':'Zeus','machine_id':'smoke-machine','machine_name':'Smoke Workstation',
 'type':'permission.requested','message':'Run tests?',
 'metadata':{'request_id':'req-smoke','capabilities':['approve','deny']}
}
status,_=req('POST','/v1/events',event,agent); assert status==202
_, sessions=req('GET','/v1/sessions',token=device)
s=next(x for x in sessions['sessions'] if x['id']=='smoke-session')
assert s['status']=='waiting' and s['pending_request_id']=='req-smoke'
status,action=req('POST','/v1/actions',{
 'session_id':'smoke-session','agent_id':'smoke-agent','kind':'approve','payload':{'request_id':'req-smoke'}
},device)
assert status==202 and action['kind']=='approve'
# Stale request IDs must be rejected.
try:
    req('POST','/v1/actions',{
      'session_id':'smoke-session','agent_id':'smoke-agent','kind':'deny','payload':{'request_id':'old-request'}
    },device)
except urllib.error.HTTPError as e:
    assert e.code==409
else:
    raise AssertionError('stale approval unexpectedly accepted')
# The queued approval must be delivered even if the adapter stream connects after the tap.
r=urllib.request.Request(base+'/v1/actions/stream?agent_id=smoke-agent')
r.add_header('Authorization','Bearer '+agent)
with urllib.request.urlopen(r,timeout=5) as resp:
    lines=[]
    for _ in range(12):
        line=resp.readline().decode().strip()
        lines.append(line)
        if '"kind":"approve"' in line: break
    assert any('"kind":"approve"' in x for x in lines), lines
print('Zeus Gateway smoke flow passed')
PY
