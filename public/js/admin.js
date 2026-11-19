// Admin Dashboard Logic
let socket;
let currentTournamentId = 'fifa-night-04';
let adminPin = localStorage.getItem('fifa_admin_pin') || '';
let tournamentData = null;
let currentEditingMatch = null;
let teamsCatalog = { clubs: [], national: [] };

// Path segment
const pathSegments = window.location.pathname.split('/').filter(Boolean);
if (pathSegments.length >= 2 && pathSegments[0] === 'admin') {
  currentTournamentId = pathSegments[1];
}

// Elements
const loginModal = document.getElementById('loginModal');
const adminPinInput = document.getElementById('adminPinInput');
const submitPinBtn = document.getElementById('submitPinBtn');
const pinErrorMsg = document.getElementById('pinErrorMsg');
const adminMainContent = document.getElementById('adminMainContent');
const publicViewLink = document.getElementById('publicViewLink');

const adminStatusBadge = document.getElementById('adminStatusBadge');
const adminStatsText = document.getElementById('adminStatsText');
const btnApproveList = document.getElementById('btnApproveList');
const btnExecuteDraw = document.getElementById('btnExecuteDraw');
const btnRedraw = document.getElementById('btnRedraw');
const btnResetTournament = document.getElementById('btnResetTournament');

const settingName = document.getElementById('settingName');
const settingVersion = document.getElementById('settingVersion');
const settingMax = document.getElementById('settingMax');
const settingAllowed = document.getElementById('settingAllowed');
const btnSaveSettings = document.getElementById('btnSaveSettings');

const manualPlayerName = document.getElementById('manualPlayerName');
const manualTeamSelect = document.getElementById('manualTeamSelect');
const btnAddManualParticipant = document.getElementById('btnAddManualParticipant');

const adminParticipantsCount = document.getElementById('adminParticipantsCount');
const adminParticipantsTbody = document.getElementById('adminParticipantsTbody');
const adminMatchesList = document.getElementById('adminMatchesList');

// Score Modal Elements
const scoreModal = document.getElementById('scoreModal');
const scoreModalTitle = document.getElementById('scoreModalTitle');
const scoreModalP1Name = document.getElementById('scoreModalP1Name');
const scoreModalP1Team = document.getElementById('scoreModalP1Team');
const scoreModalP1Input = document.getElementById('scoreModalP1Input');
const scoreModalP2Name = document.getElementById('scoreModalP2Name');
const scoreModalP2Team = document.getElementById('scoreModalP2Team');
const scoreModalP2Input = document.getElementById('scoreModalP2Input');
const saveScoreBtn = document.getElementById('saveScoreBtn');
const closeScoreModalBtn = document.getElementById('closeScoreModalBtn');
const cancelScoreBtn = document.getElementById('cancelScoreBtn');

publicViewLink.href = `/t/${currentTournamentId}`;

// Verify Pin
async function verifyPin(pin) {
  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    if (res.ok) {
      adminPin = pin;
      localStorage.setItem('fifa_admin_pin', pin);
      loginModal.classList.add('hidden');
      adminMainContent.classList.remove('hidden');
      initAdminSocket();
      loadAdminData();
      loadTeamsCatalog();
    } else {
      pinErrorMsg.classList.remove('hidden');
    }
  } catch (err) {
    pinErrorMsg.textContent = 'خطأ في الاتصال';
    pinErrorMsg.classList.remove('hidden');
  }
}

submitPinBtn.addEventListener('click', () => {
  verifyPin(adminPinInput.value.trim());
});
adminPinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verifyPin(adminPinInput.value.trim());
});

// Auto login if pin saved
if (adminPin) {
  verifyPin(adminPin);
}

// Socket
function initAdminSocket() {
  socket = io();
  socket.on('connect', () => {
    socket.emit('join:admin', { tournamentId: currentTournamentId, pin: adminPin });
  });

  socket.on('admin:update', (data) => {
    tournamentData = data;
    renderAdmin(data);
  });

  socket.on('admin:error', (msg) => {
    alert(msg);
  });
}

// Load Data
async function loadAdminData() {
  try {
    const res = await fetch(`/api/admin/tournament/${currentTournamentId}`, {
      headers: { 'x-admin-pin': adminPin }
    });
    if (res.ok) {
      tournamentData = await res.json();
      renderAdmin(tournamentData);
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadTeamsCatalog() {
  try {
    const res = await fetch(`/api/teams/${currentTournamentId}`);
    if (res.ok) {
      const data = await res.json();
      teamsCatalog = data.catalog || { clubs: [], national: [] };
      populateManualTeamSelect();
    }
  } catch (e) {
    console.error(e);
  }
}

function populateManualTeamSelect() {
  manualTeamSelect.innerHTML = '<option value="">-- اختر فريقاً --</option>';
  const taken = (tournamentData && tournamentData.participants) 
    ? tournamentData.participants.map(p => p.team_id) 
    : [];

  const addOption = (item, type) => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.dataset.name = item.name;
    opt.dataset.type = type;
    opt.dataset.badge = type === 'national' ? item.flag : item.logo;
    const isTaken = taken.includes(item.id);
    opt.disabled = isTaken;
    opt.textContent = `${item.name} (${item.nameEn}) ${isTaken ? '[محجوز]' : ''}`;
    manualTeamSelect.appendChild(opt);
  };

  teamsCatalog.clubs.forEach(c => addOption(c, 'club'));
  teamsCatalog.national.forEach(n => addOption(n, 'national'));
}

// Render Admin State
function renderAdmin(data) {
  if (!data || !data.tournament) return;
  const { tournament, participants, stats, matches } = data;

  // Settings inputs
  settingName.value = tournament.name;
  settingVersion.value = tournament.game_version;
  settingMax.value = tournament.max_participants;
  settingAllowed.value = tournament.allowed_teams;

  // Stats Text
  adminStatsText.textContent = `(${stats.registered} من أصل ${stats.max} لاعبين)`;
  adminParticipantsCount.textContent = stats.registered;

  // Workflow status
  btnApproveList.disabled = true;
  btnExecuteDraw.disabled = true;
  btnRedraw.disabled = true;

  switch (tournament.status) {
    case 'registration_open':
      adminStatusBadge.className = 'px-3.5 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
      adminStatusBadge.textContent = '1. التسجيل مفتوح';
      break;

    case 'registration_full':
      adminStatusBadge.className = 'px-3.5 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40';
      adminStatusBadge.textContent = '2. اكتمل العدد (جاهز للاعتماد)';
      btnApproveList.disabled = false;
      break;

    case 'waiting_draw':
      adminStatusBadge.className = 'px-3.5 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40';
      adminStatusBadge.textContent = '3. تم اعتماد القائمة (جاهز للقرعة)';
      btnExecuteDraw.disabled = false;
      break;

    case 'started':
      adminStatusBadge.className = 'px-3.5 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 bg-purple-500/20 text-purple-300 border border-purple-500/40';
      adminStatusBadge.textContent = '4. البطولة جارية';
      // Redraw allowed only if no matches have scores yet
      const anyScored = matches && matches.some(m => m.status === 'completed' || m.score1 !== null);
      btnRedraw.disabled = anyScored;
      break;

    case 'completed':
      adminStatusBadge.className = 'px-3.5 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40';
      adminStatusBadge.textContent = '5. البطولة مكتملة (تتويج البطل)';
      break;
  }

  // Participants Table
  renderParticipantsTable(participants);

  // Matches list
  renderMatchesList(matches);

  // Refresh select
  populateManualTeamSelect();

  if (window.lucide) lucide.createIcons();
}

// Participants Table
function renderParticipantsTable(list) {
  adminParticipantsTbody.innerHTML = '';
  if (!list || list.length === 0) {
    adminParticipantsTbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-500">لا يوجد مشاركون مسجلون حاليًا</td></tr>`;
    return;
  }

  list.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'border-b border-slate-800/60 hover:bg-slate-900/40 transition';

    const dateStr = new Date(p.registered_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    tr.innerHTML = `
      <td class="py-2.5 px-3 font-gaming text-slate-500">${idx + 1}</td>
      <td class="py-2.5 px-3 font-bold text-white">${p.player_name}</td>
      <td class="py-2.5 px-3 text-slate-300 flex items-center gap-1.5">
        ${p.team_badge ? (p.team_badge.startsWith('http') ? `<img src="${p.team_badge}" class="w-4 h-4 object-contain inline">` : `<span>${p.team_badge}</span>`) : ''}
        <span>${p.team_name}</span>
      </td>
      <td class="py-2.5 px-3 text-slate-400">${p.team_type === 'national' ? 'منتخب' : 'نادي'}</td>
      <td class="py-2.5 px-3 text-slate-400">${dateStr}</td>
      <td class="py-2.5 px-3 text-center">
        <button class="btn-remove-p p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition" data-id="${p.id}" data-name="${p.player_name}" title="حذف المشارك">
          <i data-lucide="trash" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    `;

    adminParticipantsTbody.appendChild(tr);
  });

  // Attach delete events
  document.querySelectorAll('.btn-remove-p').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      if (confirm(`هل أنت متأكد من حذف اللاعب "${name}" من البطولة؟`)) {
        await fetch('/api/admin/remove-participant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
          body: JSON.stringify({ tournamentId: currentTournamentId, participantId: id })
        });
      }
    });
  });
}

// Render Admin Matches List
function renderMatchesList(matches) {
  adminMatchesList.innerHTML = '';
  if (!matches || matches.length === 0) {
    adminMatchesList.innerHTML = `<div class="col-span-full text-center py-8 text-xs text-slate-500 bg-slate-900/30 rounded-xl border border-dashed border-slate-800">لم يتم إجراء القرعة بعد. ستظهر المباريات هنا فور إجراء القرعة.</div>`;
    return;
  }

  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = 'gaming-card p-3 rounded-xl border border-slate-800 hover:border-emerald-500/50 cursor-pointer transition flex flex-col justify-between';

    const isDone = m.status === 'completed';
    const hasPlayers = m.player1_id && m.player2_id;

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between text-[11px] text-slate-400 mb-2 border-b border-slate-800/80 pb-1">
          <span class="font-bold text-emerald-400">${m.round_name}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded ${isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}">
            ${isDone ? 'منتهية' : (hasPlayers ? 'جاهزة للعب' : 'بانتظار التأهل')}
          </span>
        </div>

        <div class="space-y-1.5 text-xs">
          <div class="flex items-center justify-between ${m.winner_id === m.player1_id ? 'text-emerald-400 font-bold' : 'text-slate-200'}">
            <span class="truncate">${m.p1_name || 'بانتظار المتأهل'}</span>
            <span class="font-gaming font-bold bg-slate-900 px-1.5 py-0.5 rounded">${m.score1 !== null ? m.score1 : '-'}</span>
          </div>
          <div class="flex items-center justify-between ${m.winner_id === m.player2_id ? 'text-emerald-400 font-bold' : 'text-slate-200'}">
            <span class="truncate">${m.p2_name || 'بانتظار المتأهل'}</span>
            <span class="font-gaming font-bold bg-slate-900 px-1.5 py-0.5 rounded">${m.score2 !== null ? m.score2 : '-'}</span>
          </div>
        </div>
      </div>

      <div class="mt-3 pt-2 border-t border-slate-800/80 text-[10px] text-center text-slate-400 font-bold">
        ${hasPlayers ? 'انقر لتسجيل النتيجة ✏️' : 'غير مكتملة الأطراف'}
      </div>
    `;

    if (hasPlayers) {
      card.addEventListener('click', () => openScoreModal(m));
    }

    adminMatchesList.appendChild(card);
  });
}

// Open Score Modal
function openScoreModal(match) {
  currentEditingMatch = match;
  scoreModalTitle.textContent = `${match.round_name} - مباراة #${match.match_order}`;
  scoreModalP1Name.textContent = match.p1_name;
  scoreModalP1Team.textContent = match.p1_team || '';
  scoreModalP1Input.value = match.score1 !== null ? match.score1 : 0;

  scoreModalP2Name.textContent = match.p2_name;
  scoreModalP2Team.textContent = match.p2_team || '';
  scoreModalP2Input.value = match.score2 !== null ? match.score2 : 0;

  scoreModal.classList.remove('hidden');
}

closeScoreModalBtn.addEventListener('click', () => scoreModal.classList.add('hidden'));
cancelScoreBtn.addEventListener('click', () => scoreModal.classList.add('hidden'));

saveScoreBtn.addEventListener('click', async () => {
  if (!currentEditingMatch) return;
  const s1 = parseInt(scoreModalP1Input.value, 10);
  const s2 = parseInt(scoreModalP2Input.value, 10);

  if (isNaN(s1) || isNaN(s2)) {
    alert('يرجى إدخال أرقام صحيحة للأهداف');
    return;
  }
  if (s1 === s2) {
    alert('لا يمكن انتهاء مباراة خروج مغلوب بالتعادل. حدد الفائز بركلات الترجيح!');
    return;
  }

  saveScoreBtn.disabled = true;
  try {
    const res = await fetch('/api/admin/update-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
      body: JSON.stringify({
        tournamentId: currentTournamentId,
        matchId: currentEditingMatch.id,
        score1: s1,
        score2: s2,
        status: 'completed'
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'فشل تحديث النتيجة');
    } else {
      scoreModal.classList.add('hidden');
    }
  } catch (err) {
    alert('خطأ في الاتصال بالخادم');
  } finally {
    saveScoreBtn.disabled = false;
  }
});

// Approve List Button
btnApproveList.addEventListener('click', async () => {
  if (!confirm('هل أنت متأكد من اعتماد القائمة النهائية وإغلاق التسجيل؟')) return;
  const res = await fetch('/api/admin/approve-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
    body: JSON.stringify({ tournamentId: currentTournamentId })
  });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'فشل اعتماد القائمة');
});

// Execute Draw Button
btnExecuteDraw.addEventListener('click', async () => {
  if (!confirm('هل أنت متأكد من إجراء القرعة العشوائية وبدء البطولة الآن؟ سيظهر جدول المواجهات لجميع المشاركين.')) return;
  const res = await fetch('/api/admin/execute-draw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
    body: JSON.stringify({ tournamentId: currentTournamentId })
  });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'فشل إجراء القرعة');
});

// Redraw Button
btnRedraw.addEventListener('click', async () => {
  if (!confirm('تحذير: هل أنت متأكد من رغبتك في إعادة سحب القرعة من جديد؟')) return;
  const res = await fetch('/api/admin/redraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
    body: JSON.stringify({ tournamentId: currentTournamentId })
  });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'فشل إعادة القرعة');
});

// Reset Tournament Button
btnResetTournament.addEventListener('click', async () => {
  if (!confirm('⚠️ تحذير شديد: سيتم مسح جميع المشاركين والقرعة والنتائج وإعادة البطولة لنقطة الصفر! هل أنت متأكد؟')) return;
  const res = await fetch('/api/admin/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
    body: JSON.stringify({ tournamentId: currentTournamentId })
  });
  const data = await res.json();
  if (!res.ok) alert(data.error || 'فشل إعادة الضبط');
});

// Save Settings Button
btnSaveSettings.addEventListener('click', async () => {
  const name = settingName.value.trim();
  const gameVersion = settingVersion.value.trim();
  const maxParticipants = settingMax.value;
  const allowedTeams = settingAllowed.value;

  if (!name || !gameVersion) return alert('يرجى ملء الاسم والإصدار');

  const res = await fetch('/api/admin/update-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
    body: JSON.stringify({
      tournamentId: currentTournamentId,
      name,
      gameVersion,
      maxParticipants,
      allowedTeams
    })
  });
  const data = await res.json();
  if (res.ok) alert('تم حفظ الإعدادات بنجاح');
  else alert(data.error || 'فشل الحفظ');
});

// Add Manual Participant
btnAddManualParticipant.addEventListener('click', async () => {
  const name = manualPlayerName.value.trim();
  const selectedOpt = manualTeamSelect.selectedOptions[0];

  if (!name || !selectedOpt || !selectedOpt.value) {
    return alert('يرجى إدخال اسم اللاعب واختيار فريق متاح');
  }

  const res = await fetch('/api/admin/add-participant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': adminPin },
    body: JSON.stringify({
      tournamentId: currentTournamentId,
      playerName: name,
      teamId: selectedOpt.value,
      teamName: selectedOpt.dataset.name,
      teamType: selectedOpt.dataset.type,
      teamBadge: selectedOpt.dataset.badge
    })
  });

  const data = await res.json();
  if (res.ok) {
    manualPlayerName.value = '';
    manualTeamSelect.value = '';
  } else {
    alert(data.error || 'فشل إضافة المشارك');
  }
});
