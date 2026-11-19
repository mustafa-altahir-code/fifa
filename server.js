const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

// Database setup
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new DatabaseSync(path.join(dbDir, 'tournament.db'));

// Read teams catalog
const teamsCatalog = JSON.parse(fs.readFileSync(path.join(dbDir, 'teams.json'), 'utf8'));

// Initialize DB schema
db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    game_version TEXT NOT NULL,
    max_participants INTEGER NOT NULL,
    tournament_type TEXT NOT NULL,
    allowed_teams TEXT NOT NULL,
    status TEXT NOT NULL,
    champion_id TEXT,
    runner_up_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    team_type TEXT NOT NULL,
    team_badge TEXT,
    registered_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_locks (
    tournament_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    player_name TEXT,
    locked_until INTEGER NOT NULL,
    PRIMARY KEY(tournament_id, team_id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    round_name TEXT NOT NULL,
    round_order INTEGER NOT NULL,
    match_order INTEGER NOT NULL,
    player1_id TEXT,
    player2_id TEXT,
    score1 INTEGER,
    score2 INTEGER,
    winner_id TEXT,
    status TEXT NOT NULL,
    next_match_id TEXT,
    next_slot INTEGER
  );

  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    timestamp INTEGER NOT NULL
  );
`);

// Insert default tournament if not exists
const defaultTournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get('fifa-night-04');
if (!defaultTournament) {
  db.prepare(`
    INSERT INTO tournaments (id, name, game_version, max_participants, tournament_type, allowed_teams, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('fifa-night-04', 'FIFA Night #04', 'EA FC 26', 16, 'خروج المغلوب', 'both', 'registration_open', Date.now());
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Clean expired locks periodically
function cleanupExpiredLocks() {
  const now = Date.now();
  db.prepare('DELETE FROM team_locks WHERE locked_until < ?').run(now);
}
setInterval(cleanupExpiredLocks, 5000);

// Helper: Get full tournament public payload
function getTournamentData(tournamentId, isAdmin = false) {
  cleanupExpiredLocks();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!tournament) return null;

  const participants = db.prepare(`
    SELECT id, player_name, team_id, team_name, team_type, team_badge, registered_at 
    FROM participants 
    WHERE tournament_id = ? 
    ORDER BY registered_at ASC
  `).all(tournamentId);

  const activeLocks = db.prepare(`
    SELECT team_id, session_id, player_name, locked_until 
    FROM team_locks 
    WHERE tournament_id = ? AND locked_until > ?
  `).all(tournamentId, Date.now());

  // CRITICAL RULE: Matches/bracket are STRICTLY hidden unless tournament status is 'started' or 'completed'
  let matches = [];
  const bracketVisible = tournament.status === 'started' || tournament.status === 'completed';
  if (bracketVisible || isAdmin) {
    matches = db.prepare(`
      SELECT m.*, 
        p1.player_name as p1_name, p1.team_name as p1_team, p1.team_badge as p1_badge,
        p2.player_name as p2_name, p2.team_name as p2_team, p2.team_badge as p2_badge
      FROM matches m
      LEFT JOIN participants p1 ON m.player1_id = p1.id
      LEFT JOIN participants p2 ON m.player2_id = p2.id
      WHERE m.tournament_id = ?
      ORDER BY m.round_order ASC, m.match_order ASC
    `).all(tournamentId);
  }

  let champion = null;
  let runnerUp = null;
  if (tournament.champion_id) {
    champion = participants.find(p => p.id === tournament.champion_id) || null;
  }
  if (tournament.runner_up_id) {
    runnerUp = participants.find(p => p.id === tournament.runner_up_id) || null;
  }

  return {
    tournament,
    participants,
    activeLocks,
    matches: bracketVisible ? matches : (isAdmin ? matches : []),
    bracketVisible,
    champion,
    runnerUp,
    stats: {
      registered: participants.length,
      max: tournament.max_participants,
      remaining: Math.max(0, tournament.max_participants - participants.length),
      percentage: Math.min(100, Math.round((participants.length / tournament.max_participants) * 100))
    }
  };
}

// Broadcast tournament updates
function broadcastTournament(tournamentId) {
  const publicData = getTournamentData(tournamentId, false);
  const adminData = getTournamentData(tournamentId, true);
  io.to(`tournament:${tournamentId}`).emit('tournament:update', publicData);
  io.to(`admin:${tournamentId}`).emit('admin:update', adminData);
}

// Check and auto-update registration status based on counts
function checkRegistrationStatus(tournamentId) {
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!t) return;
  const count = db.prepare('SELECT COUNT(*) as count FROM participants WHERE tournament_id = ?').get(tournamentId).count;

  if (t.status === 'registration_open' && count >= t.max_participants) {
    db.prepare("UPDATE tournaments SET status = 'registration_full' WHERE id = ?").run(tournamentId);
  } else if (t.status === 'registration_full' && count < t.max_participants) {
    db.prepare("UPDATE tournaments SET status = 'registration_open' WHERE id = ?").run(tournamentId);
  }
}

// Public API
app.get('/api/tournament/:id', (req, res) => {
  const data = getTournamentData(req.params.id, false);
  if (!data) return res.status(404).json({ error: 'البطولة غير موجودة' });
  res.json(data);
});

app.get('/api/teams/:id', (req, res) => {
  cleanupExpiredLocks();
  const tournamentId = req.params.id;
  const participants = db.prepare('SELECT team_id, player_name FROM participants WHERE tournament_id = ?').all(tournamentId);
  const takenMap = {};
  participants.forEach(p => { takenMap[p.team_id] = p.player_name; });

  const locks = db.prepare('SELECT team_id, player_name, locked_until FROM team_locks WHERE tournament_id = ? AND locked_until > ?').all(tournamentId, Date.now());
  const locksMap = {};
  locks.forEach(l => { locksMap[l.team_id] = { by: l.player_name, until: l.locked_until }; });

  res.json({
    catalog: teamsCatalog,
    taken: takenMap,
    locked: locksMap
  });
});

// Lock team temporarily (2 minutes)
app.post('/api/teams/lock', (req, res) => {
  cleanupExpiredLocks();
  const { tournamentId, teamId, playerName, sessionId } = req.body;
  if (!tournamentId || !teamId || !sessionId) return res.status(400).json({ error: 'بيانات ناقصة' });

  // Check if tournament open
  const t = db.prepare('SELECT status FROM tournaments WHERE id = ?').get(tournamentId);
  if (!t || t.status !== 'registration_open') {
    return res.status(400).json({ error: 'التسجيل مغلق حاليًا' });
  }

  // Check if taken
  const taken = db.prepare('SELECT player_name FROM participants WHERE tournament_id = ? AND team_id = ?').get(tournamentId, teamId);
  if (taken) return res.status(409).json({ error: `الفريق محجوز مسبقًا للاعب ${taken.player_name}` });

  // Check if locked by another session
  const locked = db.prepare('SELECT session_id, player_name FROM team_locks WHERE tournament_id = ? AND team_id = ? AND locked_until > ?').get(tournamentId, teamId, Date.now());
  if (locked && locked.session_id !== sessionId) {
    return res.status(409).json({ error: 'الفريق محجوز مؤقتًا بواسطة لاعب آخر (لمدة دقيقتين)' });
  }

  // Clear previous lock by same session
  db.prepare('DELETE FROM team_locks WHERE tournament_id = ? AND session_id = ?').run(tournamentId, sessionId);

  // Set 2 min lock (120 seconds)
  const lockedUntil = Date.now() + 120 * 1000;
  db.prepare(`
    INSERT INTO team_locks (tournament_id, team_id, session_id, player_name, locked_until)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, team_id) DO UPDATE SET
      session_id = excluded.session_id,
      player_name = excluded.player_name,
      locked_until = excluded.locked_until
  `).run(tournamentId, teamId, sessionId, playerName || '', lockedUntil);

  broadcastTournament(tournamentId);
  res.json({ success: true, lockedUntil });
});

// Unlock team
app.post('/api/teams/unlock', (req, res) => {
  const { tournamentId, teamId, sessionId } = req.body;
  db.prepare('DELETE FROM team_locks WHERE tournament_id = ? AND team_id = ? AND session_id = ?').run(tournamentId, teamId, sessionId);
  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Register participant
app.post('/api/register', (req, res) => {
  cleanupExpiredLocks();
  const { tournamentId, playerName, teamId, teamName, teamType, teamBadge, sessionId } = req.body;
  const cleanName = (playerName || '').trim();

  if (!cleanName || !tournamentId || !teamId || !teamName) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!t) return res.status(404).json({ error: 'البطولة غير موجودة' });
  if (t.status !== 'registration_open') {
    return res.status(400).json({ error: 'لا يمكن التسجيل، حالة البطولة ليست في وضع فتح التسجيل' });
  }

  const currentCount = db.prepare('SELECT COUNT(*) as count FROM participants WHERE tournament_id = ?').get(tournamentId).count;
  if (currentCount >= t.max_participants) {
    return res.status(400).json({ error: 'اكتمل عدد المشاركين المطلوب' });
  }

  // Check duplicate player name
  const existingPlayer = db.prepare('SELECT id FROM participants WHERE tournament_id = ? AND LOWER(player_name) = LOWER(?)').get(tournamentId, cleanName);
  if (existingPlayer) {
    return res.status(400).json({ error: 'اسم اللاعب مسجل مسبقًا في هذه البطولة' });
  }

  // Check duplicate team
  const takenTeam = db.prepare('SELECT player_name FROM participants WHERE tournament_id = ? AND team_id = ?').get(tournamentId, teamId);
  if (takenTeam) {
    return res.status(400).json({ error: `هذا الفريق محجوز بالفعل بواسطة ${takenTeam.player_name}` });
  }

  // Check lock
  const lock = db.prepare('SELECT session_id, player_name FROM team_locks WHERE tournament_id = ? AND team_id = ? AND locked_until > ?').get(tournamentId, teamId, Date.now());
  if (lock && sessionId && lock.session_id !== sessionId) {
    return res.status(400).json({ error: 'الفريق محجوز مؤقتًا لشخص آخر' });
  }

  // Insert participant
  const participantId = 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  db.prepare(`
    INSERT INTO participants (id, tournament_id, player_name, team_id, team_name, team_type, team_badge, registered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(participantId, tournamentId, cleanName, teamId, teamName, teamType || 'club', teamBadge || '', Date.now());

  // Remove lock
  db.prepare('DELETE FROM team_locks WHERE tournament_id = ? AND team_id = ?').run(tournamentId, teamId);

  checkRegistrationStatus(tournamentId);
  broadcastTournament(tournamentId);

  res.json({ success: true, participantId });
});

// Admin Middleware
function adminAuth(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body.pin || req.query.pin;
  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ error: 'رمز الأدمن غير صحيح' });
  }
  next();
}

app.post('/api/admin/verify', (req, res) => {
  const { pin } = req.body;
  if (pin === ADMIN_PIN) res.json({ success: true });
  else res.status(401).json({ error: 'رمز الأدمن غير صحيح' });
});

app.get('/api/admin/tournament/:id', adminAuth, (req, res) => {
  const data = getTournamentData(req.params.id, true);
  if (!data) return res.status(404).json({ error: 'البطولة غير موجودة' });
  res.json(data);
});

// Admin: Remove participant
app.post('/api/admin/remove-participant', adminAuth, (req, res) => {
  const { tournamentId, participantId } = req.body;
  const p = db.prepare('SELECT player_name FROM participants WHERE id = ?').get(participantId);
  db.prepare('DELETE FROM participants WHERE id = ? AND tournament_id = ?').run(participantId, tournamentId);

  db.prepare('INSERT INTO admin_logs (tournament_id, action, details, timestamp) VALUES (?, ?, ?, ?)').run(
    tournamentId, 'حذف مشارك', `تم حذف المشارك ${p ? p.player_name : participantId}`, Date.now()
  );

  checkRegistrationStatus(tournamentId);
  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Admin: Add participant manually
app.post('/api/admin/add-participant', adminAuth, (req, res) => {
  const { tournamentId, playerName, teamId, teamName, teamType, teamBadge } = req.body;
  const cleanName = (playerName || '').trim();
  if (!cleanName || !teamId || !teamName) return res.status(400).json({ error: 'بيانات ناقصة' });

  const existingPlayer = db.prepare('SELECT id FROM participants WHERE tournament_id = ? AND LOWER(player_name) = LOWER(?)').get(tournamentId, cleanName);
  if (existingPlayer) return res.status(400).json({ error: 'اسم اللاعب مسجل مسبقًا' });

  const takenTeam = db.prepare('SELECT player_name FROM participants WHERE tournament_id = ? AND team_id = ?').get(tournamentId, teamId);
  if (takenTeam) return res.status(400).json({ error: `الفريق محجوز لـ ${takenTeam.player_name}` });

  const participantId = 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  db.prepare(`
    INSERT INTO participants (id, tournament_id, player_name, team_id, team_name, team_type, team_badge, registered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(participantId, tournamentId, cleanName, teamId, teamName, teamType || 'club', teamBadge || '', Date.now());

  db.prepare('INSERT INTO admin_logs (tournament_id, action, details, timestamp) VALUES (?, ?, ?, ?)').run(
    tournamentId, 'إضافة مشارك يدويًا', `تم إضافة ${cleanName} مع ${teamName}`, Date.now()
  );

  checkRegistrationStatus(tournamentId);
  broadcastTournament(tournamentId);
  res.json({ success: true, participantId });
});

// Admin: Update tournament settings
app.post('/api/admin/update-settings', adminAuth, (req, res) => {
  const { tournamentId, name, gameVersion, maxParticipants, allowedTeams } = req.body;
  db.prepare(`
    UPDATE tournaments 
    SET name = ?, game_version = ?, max_participants = ?, allowed_teams = ?
    WHERE id = ?
  `).run(name, gameVersion, Number(maxParticipants), allowedTeams, tournamentId);

  checkRegistrationStatus(tournamentId);
  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Admin: Approve participants list -> change status to 'waiting_draw'
app.post('/api/admin/approve-list', adminAuth, (req, res) => {
  const { tournamentId } = req.body;
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!t) return res.status(404).json({ error: 'البطولة غير موجودة' });

  const count = db.prepare('SELECT COUNT(*) as count FROM participants WHERE tournament_id = ?').get(tournamentId).count;
  if (count < t.max_participants) {
    return res.status(400).json({ error: `لا يمكن اعتماد القائمة قبل اكتمال العدد (${count}/${t.max_participants})` });
  }

  db.prepare("UPDATE tournaments SET status = 'waiting_draw' WHERE id = ?").run(tournamentId);
  db.prepare('INSERT INTO admin_logs (tournament_id, action, details, timestamp) VALUES (?, ?, ?, ?)').run(
    tournamentId, 'اعتماد القائمة النهائية', 'تم اعتماد قائمة المشاركين وإغلاق التسجيل رسميًا بانتظار القرعة', Date.now()
  );

  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Knockout bracket generator helper
function generateKnockoutMatches(tournamentId, participants, maxCount) {
  // Shuffle participants randomly
  const shuffled = [...participants];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Clear existing matches
  db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(tournamentId);

  const roundsInfo = [];
  if (maxCount === 16) {
    roundsInfo.push({ name: 'دور الـ 16', count: 8, order: 1 });
    roundsInfo.push({ name: 'ربع النهائي', count: 4, order: 2 });
    roundsInfo.push({ name: 'نصف النهائي', count: 2, order: 3 });
    roundsInfo.push({ name: 'النهائي', count: 1, order: 4 });
  } else if (maxCount === 8) {
    roundsInfo.push({ name: 'ربع النهائي', count: 4, order: 1 });
    roundsInfo.push({ name: 'نصف النهائي', count: 2, order: 2 });
    roundsInfo.push({ name: 'النهائي', count: 1, order: 3 });
  } else if (maxCount === 4) {
    roundsInfo.push({ name: 'نصف النهائي', count: 2, order: 1 });
    roundsInfo.push({ name: 'النهائي', count: 1, order: 2 });
  }

  const allMatches = [];
  roundsInfo.forEach(r => {
    for (let i = 0; i < r.count; i++) {
      allMatches.push({
        id: `m_${r.order}_${i + 1}`,
        tournament_id: tournamentId,
        round_name: r.name,
        round_order: r.order,
        match_order: i + 1,
        player1_id: null,
        player2_id: null,
        score1: null,
        score2: null,
        winner_id: null,
        status: 'upcoming',
        next_match_id: null,
        next_slot: null
      });
    }
  });

  // Link matches to their parents/next rounds
  for (let rIndex = 0; rIndex < roundsInfo.length - 1; rIndex++) {
    const currentRound = roundsInfo[rIndex];
    const nextRound = roundsInfo[rIndex + 1];

    for (let m = 0; m < currentRound.count; m++) {
      const currentMatch = allMatches.find(x => x.round_order === currentRound.order && x.match_order === m + 1);
      const nextMatchOrder = Math.floor(m / 2) + 1;
      const nextSlot = (m % 2) + 1; // 1 or 2
      const nextMatch = allMatches.find(x => x.round_order === nextRound.order && x.match_order === nextMatchOrder);
      if (currentMatch && nextMatch) {
        currentMatch.next_match_id = nextMatch.id;
        currentMatch.next_slot = nextSlot;
      }
    }
  }

  // Populate round 1 with shuffled participants
  for (let i = 0; i < roundsInfo[0].count; i++) {
    const match = allMatches.find(x => x.round_order === 1 && x.match_order === i + 1);
    if (match) {
      match.player1_id = shuffled[i * 2] ? shuffled[i * 2].id : null;
      match.player2_id = shuffled[i * 2 + 1] ? shuffled[i * 2 + 1].id : null;
    }
  }

  // Save all matches
  const insertStmt = db.prepare(`
    INSERT INTO matches (id, tournament_id, round_name, round_order, match_order, player1_id, player2_id, score1, score2, winner_id, status, next_match_id, next_slot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  allMatches.forEach(m => {
    insertStmt.run(m.id, m.tournament_id, m.round_name, m.round_order, m.match_order, m.player1_id, m.player2_id, m.score1, m.score2, m.winner_id, m.status, m.next_match_id, m.next_slot);
  });
}

// Admin: Execute Draw & Start Tournament
app.post('/api/admin/execute-draw', adminAuth, (req, res) => {
  const { tournamentId } = req.body;
  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  if (!t) return res.status(404).json({ error: 'البطولة غير موجودة' });

  const participants = db.prepare('SELECT * FROM participants WHERE tournament_id = ?').all(tournamentId);
  if (participants.length !== t.max_participants) {
    return res.status(400).json({ error: `يجب اكتمال العدد (${t.max_participants}) قبل إجراء القرعة` });
  }

  generateKnockoutMatches(tournamentId, participants, t.max_participants);
  db.prepare("UPDATE tournaments SET status = 'started' WHERE id = ?").run(tournamentId);

  db.prepare('INSERT INTO admin_logs (tournament_id, action, details, timestamp) VALUES (?, ?, ?, ?)').run(
    tournamentId, 'إجراء القرعة وبدء البطولة', 'تم إجراء القرعة العشوائية وتوليد مخطط البطولة بنجاح', Date.now()
  );

  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Admin: Redraw (only allowed before any match has started or finished)
app.post('/api/admin/redraw', adminAuth, (req, res) => {
  const { tournamentId } = req.body;
  const matches = db.prepare('SELECT * FROM matches WHERE tournament_id = ?').all(tournamentId);
  const anyStarted = matches.some(m => m.status === 'completed' || m.status === 'in_progress' || m.score1 !== null);
  if (anyStarted) {
    return res.status(400).json({ error: 'لا يمكن إعادة القرعة، حيث بدأت بعض المباريات بالفعل' });
  }

  const t = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId);
  const participants = db.prepare('SELECT * FROM participants WHERE tournament_id = ?').all(tournamentId);

  generateKnockoutMatches(tournamentId, participants, t.max_participants);
  db.prepare('INSERT INTO admin_logs (tournament_id, action, details, timestamp) VALUES (?, ?, ?, ?)').run(
    tournamentId, 'إعادة إجراء القرعة', 'تمت إعادة سحب القرعة عشوائيًا بواسطة الأدمن قبل بدء المباريات', Date.now()
  );

  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Admin: Update Match Score & Advance Winner
app.post('/api/admin/update-match', adminAuth, (req, res) => {
  const { tournamentId, matchId, score1, score2, status } = req.body;
  const match = db.prepare('SELECT * FROM matches WHERE id = ? AND tournament_id = ?').get(matchId, tournamentId);
  if (!match) return res.status(404).json({ error: 'المباراة غير موجودة' });

  const s1 = parseInt(score1, 10);
  const s2 = parseInt(score2, 10);

  if (isNaN(s1) || isNaN(s2)) {
    return res.status(400).json({ error: 'النتيجة غير صحيحة' });
  }
  if (status === 'completed' && s1 === s2) {
    return res.status(400).json({ error: 'نظام خروج المغلوب لا يقبل التعادل! حدد الفائز بركلات الترجيح/الوقت الإضافي' });
  }

  let winnerId = null;
  let loserId = null;
  if (status === 'completed') {
    if (s1 > s2) {
      winnerId = match.player1_id;
      loserId = match.player2_id;
    } else {
      winnerId = match.player2_id;
      loserId = match.player1_id;
    }
  }

  db.prepare(`
    UPDATE matches 
    SET score1 = ?, score2 = ?, status = ?, winner_id = ?
    WHERE id = ?
  `).run(s1, s2, status, winnerId, matchId);

  // If winner determined and there is a next match, advance winner
  if (winnerId && match.next_match_id) {
    if (match.next_slot === 1) {
      db.prepare('UPDATE matches SET player1_id = ? WHERE id = ?').run(winnerId, match.next_match_id);
    } else {
      db.prepare('UPDATE matches SET player2_id = ? WHERE id = ?').run(winnerId, match.next_match_id);
    }
  }

  // Check if this was the final match
  if (status === 'completed' && !match.next_match_id) {
    db.prepare(`
      UPDATE tournaments 
      SET status = 'completed', champion_id = ?, runner_up_id = ?
      WHERE id = ?
    `).run(winnerId, loserId, tournamentId);

    db.prepare('INSERT INTO admin_logs (tournament_id, action, details, timestamp) VALUES (?, ?, ?, ?)').run(
      tournamentId, 'اختتام البطولة وتتويج البطل', `فوز اللاعب صاحب المعرف ${winnerId} باللقب`, Date.now()
    );
  }

  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Admin: Reset Tournament
app.post('/api/admin/reset', adminAuth, (req, res) => {
  const { tournamentId } = req.body;
  db.prepare('DELETE FROM matches WHERE tournament_id = ?').run(tournamentId);
  db.prepare('DELETE FROM participants WHERE tournament_id = ?').run(tournamentId);
  db.prepare('DELETE FROM team_locks WHERE tournament_id = ?').run(tournamentId);
  db.prepare("UPDATE tournaments SET status = 'registration_open', champion_id = NULL, runner_up_id = NULL WHERE id = ?").run(tournamentId);

  db.prepare('INSERT INTO admin_logs (tournament_id, action, details, timestamp) VALUES (?, ?, ?, ?)').run(
    tournamentId, 'إعادة ضبط البطولة', 'تم مسح جميع التسجيلات والمباريات وإعادة فتح التسجيل', Date.now()
  );

  broadcastTournament(tournamentId);
  res.json({ success: true });
});

// Page routes
app.get('/t/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin', (req, res) => {
  res.redirect('/admin/fifa-night-04');
});

app.get('/', (req, res) => {
  res.redirect('/t/fifa-night-04');
});

// Socket.io Real-time connection
io.on('connection', (socket) => {
  socket.on('join:tournament', (tournamentId) => {
    socket.join(`tournament:${tournamentId}`);
    const data = getTournamentData(tournamentId, false);
    if (data) socket.emit('tournament:update', data);
  });

  socket.on('join:admin', ({ tournamentId, pin }) => {
    if (pin === ADMIN_PIN) {
      socket.join(`admin:${tournamentId}`);
      const data = getTournamentData(tournamentId, true);
      if (data) socket.emit('admin:update', data);
    } else {
      socket.emit('admin:error', 'رمز غير صحيح');
    }
  });
});

server.listen(PORT, () => {
  console.log(`FIFA Tournament server running at http://localhost:${PORT}`);
  console.log(`Public Page: http://localhost:${PORT}/t/fifa-night-04`);
  console.log(`Admin Dashboard: http://localhost:${PORT}/admin/fifa-night-04 (PIN: ${ADMIN_PIN})`);
});
