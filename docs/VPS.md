# VPS deployment

## 1. Prepare

```bash
cd gateway
cp .env.example .env
cp providers.example.json providers.json
chmod 600 .env
```

Generate two different secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Put one in `ZEUS_ADMIN_TOKEN`, the other in `ZEUS_AGENT_TOKEN`.

## 2. Start

```bash
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

The compose file intentionally binds only to `127.0.0.1`.

## 3. TLS proxy

`deploy/Caddyfile.example` shows a minimal reverse proxy. Replace the hostname and add rate limiting/firewall controls appropriate to your VPS.

## 4. Pair a controller

Build `zeusctl` or use the release binary:

```bash
ZEUS_GATEWAY_URL=https://zeus.example.com \
ZEUS_ADMIN_TOKEN='...' \
./zeusctl pair
```

Enter the returned six-digit code in Zeus Mobile/Desktop within five minutes.

## 5. Connect a developer computer

Install the desired adapter and configure:

```bash
ZEUS_GATEWAY_URL=https://zeus.example.com
ZEUS_AGENT_TOKEN=...
ZEUS_MACHINE_NAME="My workstation"
```

Use a separate agent token rotation process if a machine is lost.
