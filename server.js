const express = require('express');
const cors    = require('cors');
const https   = require('https');
const { MongoClient } = require('mongodb');

const app  = express();
const PORT = process.env.PORT || 3001;
const API_SECRET            = process.env.API_SECRET || 'bob1234';
const MONGODB_URI           = process.env.MONGODB_URI;
const DISCORD_CLIENT_ID     = '1488881882270793909';
const DISCORD_CLIENT_SECRET = 'zNaTeqXlv5IZ1r1cOgcPeWlyHikz63ib';
const REDIRECT_URI          = 'https://peterbot20l-a11y.github.io/a7s-apis/';

app.use(cors());
app.use(express.json());

const TIER_PTS = {
  Ht1:60, Lt1:52, Ht2:44, Lt2:36, Ht3:28,
  Lt3:20, Ht4:15, Lt4:10, Ht5:5,  Lt5:2
};

let db;
async function getDB() {
  if (!db) {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('a7s').collection('players');
  }
  return db;
}

function auth(req, res, next) {
  if (req.headers['x-api-secret'] !== API_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function discordRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

app.post('/api/discord/token', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  }).toString();
  try {
    const tokenData = await discordRequest({
      hostname: 'discord.com',
      path: '/api/oauth2/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, body);
    if (tokenData.error) return res.status(400).json(tokenData);
    const userData = await discordRequest({
      hostname: 'discord.com',
      path: '/api/users/@me',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    res.json({ user: userData, access_token: tokenData.access_token });
  } catch (err) {
    res.status(500).json({ error: 'Discord auth failed' });
  }
});

app.get('/api/players', async (req, res) => {
  try {
    const col = await getDB();
    const players = await col.find({}).toArray();
    const result = players
      .map(p => ({ ...p, _id: undefined, totalPoints: Object.values(p.tiers || {}).reduce((s, t) => s + (TIER_PTS[t] || 0), 0) }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 100);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/api/players/:ign', async (req, res) => {
  try {
    const col = await getDB();
    const player = await col.findOne({ ign: { $regex: new RegExp(`^${req.params.ign}$`, 'i') } });
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json({ ...player, _id: undefined, totalPoints: Object.values(player.tiers || {}).reduce((s, t) => s + (TIER_PTS[t] || 0), 0) });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/ranktest', auth, async (req, res) => {
  const { ign, discordId, gamemode, tier, tierBefore, tester, comment } = req.body;
  if (!ign || !discordId || !gamemode || !tier)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    const col = await getDB();
    const existing = await col.findOne({ discordId });
    const history = existing?.history || [];
    history.unshift({ gamemode, tier, tierBefore, tester, comment, date: new Date().toISOString() });
    if (history.length > 50) history.length = 50;
    const update = {
      $set: { ign, discordId, [`tiers.${gamemode}`]: tier, history },
      $setOnInsert: { addedAt: new Date().toISOString(), region: 'NA', restricted: false }
    };
    await col.updateOne({ discordId }, update, { upsert: true });
    const player = await col.findOne({ discordId });
    res.json({ success: true, player });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.patch('/api/players/:discordId', auth, async (req, res) => {
  try {
    const col = await getDB();
    const { ign, region, tiers, history } = req.body;
    const update = {};
    if (ign) update.ign = ign;
    if (region) update.region = region;
    if (tiers) update.tiers = tiers;
    if (history) update.history = history;
    await col.updateOne({ discordId: req.params.discordId }, { $set: update });
    const player = await col.findOne({ discordId: req.params.discordId });
    res.json({ success: true, player });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.delete('/api/players/:discordId', auth, async (req, res) => {
  try {
    const col = await getDB();
    await col.deleteOne({ discordId: req.params.discordId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.post('/api/claim', async (req, res) => {
  const { discordId, discordUsername, discordAvatar, ign } = req.body;
  if (!discordId || !ign) return res.status(400).json({ error: 'Missing fields' });
  try {
    const col = await getDB();
    const player = await col.findOne({ ign: { $regex: new RegExp(`^${ign}$`, 'i') } });
    if (!player) return res.status(404).json({ error: 'No player with that IGN found' });
    if (player.claimedBy) return res.status(409).json({ error: 'Already claimed' });
    await col.updateOne({ ign: player.ign }, { $set: { claimedBy: discordId, discordUsername, discordAvatar } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

app.delete('/api/players/:discordId/cooldown', auth, (req, res) => {
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`✅ a7s API running on port ${PORT}`));
