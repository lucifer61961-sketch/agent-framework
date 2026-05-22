# Agent Framework v1.0

A complete, self-hosted autonomous AI agent — Telegram bot frontend, agentic loop backend, persistent memory, Docker sandboxing, voice messages, file handling, and a full admin API.

---

## ⚡ Quick Start (5 minutes)

```bash
# 1. Install
npm install

# 2. Interactive setup — creates your .env file
npm run setup

# 3. Verify everything works
npm test

# 4. Start the bot
npm start
```

That's it. The server logs the webhook registration command on startup.

---

## What the bot can do

| Input type | How it works |
|---|---|
| 💬 Text message | Sent directly to the agent |
| 🎤 Voice note | Transcribed via Whisper, then sent to agent |
| 📎 Text/code/markdown/CSV file | Content extracted and injected as context |
| 🖼️ Photo | Downloaded, described in prompt |
| 📋 Caption + file | File content + your caption combined |

### Bot commands

| Command | Action |
|---|---|
| `/start` | Welcome + inline menu |
| `/help` | All commands |
| `/clear` | Wipe your conversation history |
| `/status` | Your session info |
| `/skills` | List available tools |
| `/memory` | Show your last 6 conversation turns |

---

## Configuration

Run `npm run setup` for a guided wizard, or edit `.env` manually:

```env
# Required
TELEGRAM_BOT_TOKEN=your-token-from-BotFather
ANTHROPIC_API_KEY=sk-ant-...      # or use OPENAI_API_KEY + PROVIDER=openai

# Optional — enables web search
SERPAPI_KEY=your-key              # 100 free/month at serpapi.com
# BRAVE_SEARCH_API_KEY=your-key  # 2000 free/month (overrides SerpAPI)

# Optional — auto-registers webhook on startup
PUBLIC_URL=https://your-domain.com

# Security
ADMIN_TOKEN=your-secret-token     # protects /admin/* routes

# Tuning
QUEUE_CONCURRENCY=4               # max parallel agent runs
RATE_LIMIT_PER_MIN=20             # messages per user per minute
```

---

## Local development with ngrok

```bash
# Terminal 1 — start the agent
npm start

# Terminal 2 — expose it to the internet
npx ngrok http 3000

# The ngrok output gives you a URL like https://abc123.ngrok.io
# Set PUBLIC_URL=https://abc123.ngrok.io in .env and restart
```

---

## Docker (production)

```bash
cp .env.example .env   # fill in your keys
docker compose up --build -d
docker compose logs -f
```

The `docker-compose.yml` mounts the Docker socket so the bash sandbox can spawn containers inside.

---

## Project structure

```
agent-framework/
├── setup.ts              ← Interactive setup wizard
├── test-agent.ts         ← Self-test script
├── directives/
│   ├── SOUL.md           ← Agent persona (edit freely)
│   ├── USER.md           ← Your preferences
│   └── AGENTS.md         ← Operational rules
├── src/
│   ├── start.ts          ← Entry point
│   ├── agent.ts          ← Core agentic loop
│   ├── gateway/
│   │   ├── server.ts     ← Express + all systems wired
│   │   ├── telegram-client.ts
│   │   └── handlers/
│   │       ├── voice.ts  ← Whisper transcription
│   │       ├── media.ts  ← Image + document handling
│   │       └── progress.ts ← Live status updates
│   ├── skills/builtin/
│   │   ├── google-search.skill.ts
│   │   └── file-writer.skill.ts
│   ├── session/
│   │   ├── store.ts      ← SQLite session store
│   │   └── session-agent.ts
│   ├── sandbox/docker.ts ← Isolated bash execution
│   ├── queue/task-queue.ts
│   ├── middleware/rate-limiter.ts
│   ├── metrics/collector.ts
│   ├── admin/router.ts   ← Admin REST API
│   └── plugins/loader.ts ← Community plugin autoloader
└── .env                  ← Your config (created by setup.ts)
```

---

## Admin API

Requires `Authorization: Bearer <ADMIN_TOKEN>` header.

```bash
# Health check
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/health

# View metrics
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/metrics

# List sessions
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/sessions

# Clear a user's history
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/sessions/telegram%3A123456789
```

---

## Adding a custom skill

```typescript
// my-skill.ts
import { Skill, SkillTool } from "./src/skills";

export class JokeSkill implements Skill {
  name        = "joke_teller";
  description = "Tells a random joke";
  category    = "custom" as const;
  version     = "1.0.0";

  getTools(): SkillTool[] {
    return [{
      definition: {
        name: "tell_joke",
        description: "Returns a random joke.",
        input_schema: { type: "object", properties: {} },
      },
      handler: async () => {
        const res = await fetch("https://official-joke-api.appspot.com/random_joke");
        const joke = await res.json() as { setup: string; punchline: string };
        return `${joke.setup}\n\n${joke.punchline}`;
      },
    }];
  }
}
```

Then register it in `server.ts`:
```typescript
await skillRouter.register(new JokeSkill());
```

---

## Customising the agent's personality

Edit the three Markdown files in `directives/`:

- **`SOUL.md`** — name, tone, personality, values
- **`USER.md`** — your preferences, domain context, workspace rules
- **`AGENTS.md`** — tool policies, iteration limits, response format rules

Changes take effect on the next server restart.

---

## License

MIT
