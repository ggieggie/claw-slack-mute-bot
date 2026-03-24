const { App } = require('@slack/bolt');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// --- Config ---
const ALLOWED_CHANNELS = [
  'C0AMQDC8XJR', // #dev_claw_dev
];

const ALLOWED_USERS = [
  'U099MRZEH89', // トモトくん
  'U5KGKEDJ9',   // 小尾さん
];

const AGENTS = {
  pm:  { agent: 'pm',       bind: 'slack:pimu',     sessionKey: 'agent:pm:slack:channel:c0amqdc8xjr' },
  be:  { agent: 'backend',  bind: 'slack:bakutan',   sessionKey: 'agent:backend:slack:channel:c0amqdc8xjr' },
  fe:  { agent: 'frontend', bind: 'slack:dezafuro',  sessionKey: 'agent:frontend:slack:channel:c0amqdc8xjr' },
  qa:  { agent: 'qa',       bind: 'slack:qtaro',     sessionKey: 'agent:qa:slack:channel:c0amqdc8xjr' },
};

// --- OpenClaw commands ---
async function abortSession(sessionKey) {
  try {
    await execAsync(
      `openclaw gateway call chat.abort --params '${JSON.stringify({ sessionKey })}' --timeout 5000 --json`,
      { timeout: 10000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function checkBinding(agent, bind) {
  try {
    const { stdout } = await execAsync(
      `openclaw agents bindings --agent ${agent} --json`,
      { timeout: 10000 }
    );
    return stdout.includes(bind);
  } catch {
    // fallback: non-json output
    try {
      const { stdout } = await execAsync(
        `openclaw agents bindings --agent ${agent}`,
        { timeout: 10000 }
      );
      return stdout.includes(bind);
    } catch {
      return null; // unknown
    }
  }
}

async function unbindAgent(agent, bind, { maxRetries = 3, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execAsync(
        `openclaw agents unbind --agent ${agent} --bind ${bind}`,
        { timeout: 10000 }
      );
    } catch (e) {
      console.error(`unbind attempt ${attempt} failed ${agent}:`, e.message);
    }

    // Wait for hotreload to apply
    await new Promise(r => setTimeout(r, delayMs));

    // Verify binding is actually gone
    const stillBound = await checkBinding(agent, bind);
    if (stillBound === false) {
      if (attempt > 1) console.log(`unbind ${agent} succeeded on attempt ${attempt}`);
      return true;
    }
    console.warn(`unbind ${agent} attempt ${attempt}: binding still present, retrying...`);
  }
  console.error(`unbind ${agent} failed after ${maxRetries} attempts`);
  return false;
}

async function bindAgent(agent, bind, { maxRetries = 3, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execAsync(
        `openclaw agents bind --agent ${agent} --bind ${bind}`,
        { timeout: 10000 }
      );
    } catch (e) {
      console.error(`bind attempt ${attempt} failed ${agent}:`, e.message);
    }

    // Wait for hotreload to apply
    await new Promise(r => setTimeout(r, delayMs));

    // Verify binding is present
    const isBound = await checkBinding(agent, bind);
    if (isBound === true) {
      if (attempt > 1) console.log(`bind ${agent} succeeded on attempt ${attempt}`);
      return true;
    }
    console.warn(`bind ${agent} attempt ${attempt}: binding not applied, retrying...`);
  }
  console.error(`bind ${agent} failed after ${maxRetries} attempts`);
  return false;
}

// --- Mute state tracking ---
const mutedAgents = new Set();

// --- Slack App ---
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.message(/^!(mute|unmute)\s*(all|pm|be|fe|qa|status)?$/i, async ({ message, say, context }) => {
  // Guard: channel + user check
  if (!ALLOWED_CHANNELS.includes(message.channel)) return;
  if (!ALLOWED_USERS.includes(message.user)) return;

  const cmd = context.matches[1].toLowerCase();
  const target = (context.matches[2] || '').toLowerCase();

  try {
    // --- !mute ---
    if (cmd === 'mute' && (target === 'all' || AGENTS[target])) {
      const targets = target === 'all' ? Object.keys(AGENTS) : [target];

      // 1. chat.abort
      await Promise.all(
        targets.map(k => abortSession(AGENTS[k].sessionKey))
      );

      // 2. unbind
      const results = await Promise.all(
        targets.map(async k => {
          const ok = await unbindAgent(AGENTS[k].agent, AGENTS[k].bind);
          if (ok) mutedAgents.add(k);
          return { key: k, ok };
        })
      );

      const summary = results.map(r => `${r.key}: ${r.ok ? '🔇' : '❌'}`).join('  ');
      await say(`🔇 *${target === 'all' ? '全員' : target}* muted（abort + unbind）\n${summary}`);
      return;
    }

    // --- !unmute ---
    if (cmd === 'unmute' && (target === 'all' || AGENTS[target])) {
      const targets = target === 'all' ? Object.keys(AGENTS) : [target];

      const results = await Promise.all(
        targets.map(async k => {
          const ok = await bindAgent(AGENTS[k].agent, AGENTS[k].bind);
          if (ok) mutedAgents.delete(k);
          return { key: k, ok };
        })
      );

      const summary = results.map(r => `${r.key}: ${r.ok ? '🔊' : '❌'}`).join('  ');
      await say(`🔊 *${target === 'all' ? '全員' : target}* unmuted（bind復元）\n${summary}`);
      return;
    }

    // --- !mute status ---
    if (cmd === 'mute' && target === 'status') {
      const lines = Object.keys(AGENTS).map(k =>
        `*${k}*: ${mutedAgents.has(k) ? '🔇 muted' : '🔊 active'}`
      );
      await say(`📊 *ミュート状況*\n${lines.join('\n')}`);
      return;
    }

    // --- Usage ---
    await say('使い方: `!mute [all|pm|be|fe|qa|status]` / `!unmute [all|pm|be|fe|qa]`');
  } catch (err) {
    console.error('Error:', err);
    try { await say(`❌ エラー: ${err.message}`); } catch {}
  }
});

(async () => {
  await app.start();
  console.log('✅ slack-mute-bot ready (Socket Mode)');
})();
