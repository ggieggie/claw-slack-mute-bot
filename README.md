# claw-slack-mute-bot

OpenClaw agent mute/unmute controller for Slack.

ミーティング中の agent 間ループを強制停止するための専用 bot。  
OpenClaw を経由せず pm2 で常駐し、`chat.abort` + `agents unbind/bind` で制御する。

## Setup

```bash
cp .env.example .env
# Edit .env with your tokens
npm install
```

## Run

```bash
# Direct
node index.js

# pm2
pm2 start index.js --name slack-mute-bot
pm2 save
```

## Commands

| Command | Description |
|---------|-------------|
| `!mute all` | 全 agent を abort + unbind |
| `!mute pm` | PM のみ mute |
| `!mute be` | Backend のみ mute |
| `!mute fe` | Frontend のみ mute |
| `!mute qa` | QA のみ mute |
| `!mute status` | 現在のミュート状況を表示 |
| `!unmute all` | 全 agent を bind 復元 |
| `!unmute pm` | PM のみ unmute |

## Architecture

```
Human: "!mute all"
  → slack-mute-bot (Socket Mode, pm2)
    → openclaw gateway call chat.abort (per agent)
    → openclaw agents unbind (per agent)
  ← 🔇 全員 muted