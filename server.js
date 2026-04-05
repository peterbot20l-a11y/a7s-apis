const express = require('express');
const fs      = require('fs');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;
const DB   = path.join(__dirname, 'players.json');
const API_SECRET = process.env.API_SECRET || 'changeme123';

app.use(cors());
app.use(express.json());

function loadDB() {
  if (!fs.existsSync(DB)) fs.writeFileSync(DB, '{}');
  return JSON.parse(fs.readFileSync(DB, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

const TIER_PTS = {
  Ht1:60, Lt1:52, Ht2:44, Lt2:36, Ht3:28,
  Lt3:20, Ht4:15, Lt4:10, Ht5:5,  Lt5:2
};

function auth(req, res, next) {
  if (req.headers['x-api-secret'] !== API_SECRET)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/players', (req, res) => {
  const db = loadDB();
  const players = Object.values(db)
    .map(p => ({
      ...p,
      totalPoints: Object.values(p.tiers || {}).reduce((s, t) => s + (TIER_PTS[t] || 0), 0)
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, 100);
  res.json(players);
});

app.get('/api/players/:ign', (req, res) => {
  const db = loadDB();
  const player = Object.values(db).find(
    p => p.ign.toLowerCase() === req.params.ign.toLowerCase()
  );
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json({
    ...player,
    totalPoints: Object.values(player.tiers || {}).reduce((s, t) => s + (TIER_PTS[t] || 0), 0)
  });
});

app.post('/api/ranktest', auth, (req, res) => {
  const { ign, discordId, gamemode, tier, tierBefore, tester, comment } = req.body;
  if (!ign || !discordId || !gamemode || !tier)
    return res.status(400).json({ error: 'Missing required fields' });

  const db  = loadDB();
  const key = discordId;

  if (!db[key]) {
    db[key] = {
      ign,
      discordId,
      tiers: {},
      history: [],
      addedAt: new Date().toISOString(),
    };
  }

  db[key].ign             = ign;
  db[key].tiers[gamemode] = tier;
  db[key].history.unshift({ gamemode, tier, tierBefore, tester, comment, date: new Date().toISOString() });
  if (db[key].history.length > 50) db[key].history = db[key].history.slice(0, 50);

  saveDB(db);
  res.json({ success: true, player: db[key] });
});

app.delete('/api/players/:discordId/cooldown', auth, (req, res) => {
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`✅ a7s API running on port ${PORT}`));
