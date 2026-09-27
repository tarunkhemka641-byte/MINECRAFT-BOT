const express = require('express');
const mineflayer = require('mineflayer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store active bot instances and configurations
const bots = new Map();

function createMinecraftBot(config) {
  const { id, host, port, username, version, auth } = config;

  console.log(`[${id}] Connecting ${username} to ${host}:${port}...`);

  const bot = mineflayer.createBot({
    host,
    port: parseInt(port, 10) || 25565,
    username,
    version: version || false,
    auth: auth || 'offline'
  });

  bot.customData = {
    ...config,
    status: 'connecting',
    lastMessage: 'Connecting to server...',
    antiAfkInterval: null
  };

  bot.once('spawn', () => {
    bot.customData.status = 'online';
    bot.customData.lastMessage = 'Spawned into the world successfully.';
    console.log(`[${id}] ${username} successfully joined.`);

    // Subtle Anti-AFK routine: swings arm and looks around every 25 seconds
    bot.customData.antiAfkInterval = setInterval(() => {
      if (bot && bot.entity) {
        bot.swingArm('right');
        const yaw = (Math.random() * Math.PI * 2) - Math.PI;
        const pitch = ((Math.random() * 60) - 30) * (Math.PI / 180);
        bot.look(yaw, pitch, true);
      }
    }, 25000);
  });

  bot.on('chat', (sender, message) => {
    if (sender === bot.username) return;
    bot.customData.lastMessage = `${sender}: ${message}`;
  });

  bot.on('kicked', (reason) => {
    const parsed = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log(`[${id}] Kicked:`, parsed);
    bot.customData.status = 'kicked';
    bot.customData.lastMessage = `Kicked: ${parsed}`;
    cleanupInterval(bot);
  });

  bot.on('error', (err) => {
    console.error(`[${id}] Error:`, err.message);
    bot.customData.status = 'error';
    bot.customData.lastMessage = `Error: ${err.message}`;
    cleanupInterval(bot);
  });

  bot.on('end', () => {
    console.log(`[${id}] Connection closed.`);
    cleanupInterval(bot);
    if (bot.customData.status !== 'stopped') {
      bot.customData.status = 'offline';
      bot.customData.lastMessage = 'Disconnected. Auto-reconnecting in 15s...';
      // Auto-reconnect after 15 seconds
      setTimeout(() => {
        if (bots.has(id) && bots.get(id).customData.status === 'offline') {
          bots.set(id, createMinecraftBot(config));
        }
      }, 15000);
    }
  });

  return bot;
}

function cleanupInterval(bot) {
  if (bot.customData && bot.customData.antiAfkInterval) {
    clearInterval(bot.customData.antiAfkInterval);
    bot.customData.antiAfkInterval = null;
  }
}

// REST API Endpoints for the Dashboard
app.get('/api/bots', (req, res) => {
  const botList = [];
  bots.forEach((bot, id) => {
    botList.push({
      id,
      username: bot.customData.username,
      host: bot.customData.host,
      port: bot.customData.port,
      version: bot.customData.version,
      status: bot.customData.status,
      lastMessage: bot.customData.lastMessage,
      health: bot.health || 0,
      food: bot.food || 0
    });
  });
  res.json(botList);
});

app.post('/api/bots', (req, res) => {
  const { host, port, username, version } = req.body;
  if (!host || !username) {
    return res.status(400).json({ error: 'Server host and bot username are required.' });
  }

  const id = `bot_${Date.now()}`;
  const config = {
    id,
    host: host.trim(),
    port: port ? parseInt(port, 10) : 25565,
    username: username.trim(),
    version: version ? version.trim() : undefined,
    auth: 'offline'
  };

  const newBot = createMinecraftBot(config);
  bots.set(id, newBot);
  res.status(201).json({ success: true, id });
});

app.post('/api/bots/:id/action', (req, res) => {
  const { id } = req.params;
  const { action, payload } = req.body;
  const bot = bots.get(id);

  if (!bot) return res.status(404).json({ error: 'Bot not found.' });

  switch (action) {
    case 'jump':
      if (bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 400);
      }
      break;

    case 'move_forward':
      if (bot.entity) {
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 1000);
      }
      break;

    case 'move_back':
      if (bot.entity) {
        bot.setControlState('back', true);
        setTimeout(() => bot.setControlState('back', false), 1000);
      }
      break;

    case 'chat':
      if (payload && payload.message) {
        bot.chat(payload.message);
      }
      break;

    case 'stop':
      bot.customData.status = 'stopped';
      cleanupInterval(bot);
      bot.quit();
      break;

    case 'restart':
      cleanupInterval(bot);
      bot.quit();
      const currentConfig = { ...bot.customData };
      bots.set(id, createMinecraftBot(currentConfig));
      break;

    default:
      return res.status(400).json({ error: 'Invalid action.' });
  }

  res.json({ success: true, action });
});

app.delete('/api/bots/:id', (req, res) => {
  const { id } = req.params;
  const bot = bots.get(id);
  if (bot) {
    bot.customData.status = 'stopped';
    cleanupInterval(bot);
    bot.quit();
    bots.delete(id);
  }
  res.json({ success: true });
});

// Render Health Check endpoint
app.get('/healthz', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
  console.log(`AFK Bot Dashboard running on port ${PORT}`);
});
