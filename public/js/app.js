// FIFA Tournament Public Client App
let socket;
let currentTournamentId = 'fifa-night-04';
let tournamentData = null;
let teamsCatalog = { clubs: [], national: [] };
let takenTeamsMap = {};
let lockedTeamsMap = {};
let selectedTeam = null;
let lockTimerInterval = null;
let currentCategory = 'all';

// Session ID for temporary lock
let sessionId = localStorage.getItem('fifa_session_id');
if (!sessionId) {
  sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  localStorage.setItem('fifa_session_id', sessionId);
}

// Detect tournament ID from URL path: /t/:id
const pathSegments = window.location.pathname.split('/').filter(Boolean);
if (pathSegments.length >= 2 && pathSegments[0] === 't') {
  currentTournamentId = pathSegments[1];
}

// DOM Elements
const tournamentNavName = document.getElementById('tournamentNavName');
const tournamentHeroName = document.getElementById('tournamentHeroName');
const gameVersionBadge = document.getElementById('gameVersionBadge');
const tournamentTypeBadge = document.getElementById('tournamentTypeBadge');
const allowedTeamsBadge = document.getElementById('allowedTeamsBadge');
const statusBadge = document.getElementById('statusBadge');
const openRegisterModalBtn = document.getElementById('openRegisterModalBtn');

const bannerOpen = document.getElementById('bannerOpen');
const bannerFull = document.getElementById('bannerFull');
const bannerWaitingDraw = document.getElementById('bannerWaitingDraw');
const bannerStarted = document.getElementById('bannerStarted');

const counterRatio = document.getElementById('counterRatio');
const progressBar = document.getElementById('progressBar');
const statRegistered = document.getElementById('statRegistered');
const statRemaining = document.getElementById('statRemaining');
const statPercent = document.getElementById('statPercent');

const participantsGrid = document.getElementById('participantsGrid');
const participantsCountBadge = document.getElementById('participantsCountBadge');
const noParticipantsMsg = document.getElementById('noParticipantsMsg');

const bracketHiddenNotice = document.getElementById('bracketHiddenNotice');
const bracketLiveContainer = document.getElementById('bracketLiveContainer');
const bracketTree = document.getElementById('bracketTree');

const championSection = document.getElementById('championSection');
const championName = document.getElementById('championName');
const championTeam = document.getElementById('championTeam');
const runnerUpName = document.getElementById('runnerUpName');
const runnerUpTeam = document.getElementById('runnerUpTeam');

// Modal Elements
const registerModal = document.getElementById('registerModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const confirmRegisterBtn = document.getElementById('confirmRegisterBtn');
const regPlayerName = document.getElementById('regPlayerName');
const teamSearchInput = document.getElementById('teamSearchInput');
const teamsSelectionGrid = document.getElementById('teamsSelectionGrid');
const lockCountdownBanner = document.getElementById('lockCountdownBanner');
const lockTimerText = document.getElementById('lockTimerText');
const modalAlertMsg = document.getElementById('modalAlertMsg');
const copyShareBtn = document.getElementById('copyShareBtn');
const connectionBar = document.getElementById('connectionBar');

// Toast helper
function showToast(text) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = text;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

// Initialize Socket.io
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    connectionBar.classList.add('hidden');
    socket.emit('join:tournament', currentTournamentId);
  });

  socket.on('disconnect', () => {
    connectionBar.classList.remove('hidden');
  });

  socket.on('tournament:update', (data) => {
    tournamentData = data;
    renderTournament(data);
  });
}

// Fetch Initial Data
async function loadInitialData() {
  try {
    const res = await fetch(`/api/tournament/${currentTournamentId}`);
    if (res.ok) {
      tournamentData = await res.json();
      renderTournament(tournamentData);
    }
  } catch (err) {
    console.error('Error fetching tournament data:', err);
  }
}

// Render tournament state
function renderTournament(data) {
  if (!data || !data.tournament) return;
  const { tournament, participants, stats, bracketVisible, champion, runnerUp } = data;

  // Header & info
  tournamentNavName.textContent = tournament.name;
  tournamentHeroName.textContent = `🏆 ${tournament.name}`;
  gameVersionBadge.textContent = tournament.game_version;
  tournamentTypeBadge.textContent = tournament.tournament_type || 'خروج المغلوب';
  
  if (tournament.allowed_teams === 'clubs') allowedTeamsBadge.textContent = 'أندية فقط';
  else if (tournament.allowed_teams === 'national') allowedTeamsBadge.textContent = 'منتخبات فقط';
  else allowedTeamsBadge.textContent = 'أندية ومنتخبات';

  // Stats & Progress bar
  counterRatio.textContent = `${stats.registered} / ${stats.max}`;
  statRegistered.textContent = stats.registered;
  statRemaining.textContent = stats.remaining;
  statPercent.textContent = `${stats.percentage}%`;
  progressBar.style.width = `${stats.percentage}%`;
  participantsCountBadge.textContent = stats.registered;

  // Reset Banners
  bannerOpen.classList.add('hidden');
  bannerFull.classList.add('hidden');
  bannerWaitingDraw.classList.add('hidden');
  bannerStarted.classList.add('hidden');
  championSection.classList.add('hidden');

  // Status Badge & Controls logic
  openRegisterModalBtn.classList.add('hidden');

  switch (tournament.status) {
    case 'registration_open':
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-extrabold inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> التسجيل مفتوح`;
      bannerOpen.classList.remove('hidden');
      openRegisterModalBtn.classList.remove('hidden');
      break;

    case 'registration_full':
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-extrabold inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-400 border border-amber-500/40';
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> اكتمل العدد (${stats.max}/${stats.max})`;
      bannerFull.classList.remove('hidden');
      break;

    case 'waiting_draw':
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-extrabold inline-flex items-center gap-1.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/40';
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span> بانتظار القرعة`;
      bannerWaitingDraw.classList.remove('hidden');
      break;

    case 'started':
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-extrabold inline-flex items-center gap-1.5 bg-purple-500/20 text-purple-400 border border-purple-500/40';
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-purple-400 animate-ping"></span> البطولة جارية`;
      bannerStarted.classList.remove('hidden');
      break;

    case 'completed':
      statusBadge.className = 'px-3 py-1 rounded-full text-xs font-extrabold inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40';
      statusBadge.innerHTML = `<i data-lucide="crown" class="w-3.5 h-3.5 text-amber-400"></i> البطولة مكتملة`;
      
      // Show champion section
      if (champion) {
        championSection.classList.remove('hidden');
        championName.textContent = champion.player_name;
        championTeam.innerHTML = `
          ${champion.team_badge ? `<img src="${champion.team_badge}" class="w-5 h-5 object-contain inline-block" onerror="this.remove()">` : ''}
          <span>${champion.team_name}</span>
        `;
        if (runnerUp) {
          runnerUpName.textContent = runnerUp.player_name;
          runnerUpTeam.textContent = runnerUp.team_name;
        }
      }
      break;
  }

  // Render participants
  renderParticipants(participants);

  // CRITICAL RULE: Handle Bracket Visibility
  if (bracketVisible && data.matches && data.matches.length > 0) {
    bracketHiddenNotice.classList.add('hidden');
    bracketLiveContainer.classList.remove('hidden');
    renderBracket(data.matches);
  } else {
    bracketHiddenNotice.classList.remove('hidden');
    bracketLiveContainer.classList.add('hidden');
  }

  if (window.lucide) lucide.createIcons();
}

// Render Participants Cards
function renderParticipants(list) {
  participantsGrid.innerHTML = '';
  if (!list || list.length === 0) {
    noParticipantsMsg.classList.remove('hidden');
    return;
  }
  noParticipantsMsg.classList.add('hidden');

  list.forEach((p, idx) => {
    const card = document.createElement('div');
    card.className = 'gaming-card rounded-xl p-3.5 border border-slate-800/90 flex items-center justify-between hover:border-slate-700 transition';

    const isFlag = p.team_type === 'national' && !p.team_badge.startsWith('http');
    const badgeHtml = isFlag 
      ? `<span class="text-2xl">${p.team_badge}</span>`
      : `<img src="${p.team_badge}" alt="${p.team_name}" class="w-8 h-8 object-contain" onerror="this.src='https://crests.football-data.org/86.png'">`;

    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center p-1">
          ${badgeHtml}
        </div>
        <div>
          <div class="font-extrabold text-sm text-white flex items-center gap-1.5">
            <span>${p.player_name}</span>
          </div>
          <div class="text-xs text-slate-400">${p.team_name}</div>
        </div>
      </div>
      <div class="text-left">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          مسجل
        </span>
      </div>
    `;
    participantsGrid.appendChild(card);
  });
}

// Render Tournament Knockout Bracket
function renderBracket(matches) {
  bracketTree.innerHTML = '';
  if (!matches || matches.length === 0) return;

  // Group by round_order
  const roundsMap = {};
  matches.forEach(m => {
    if (!roundsMap[m.round_order]) roundsMap[m.round_order] = { name: m.round_name, matches: [] };
    roundsMap[m.round_order].matches.push(m);
  });

  const sortedRoundOrders = Object.keys(roundsMap).sort((a, b) => Number(a) - Number(b));

  sortedRoundOrders.forEach((rOrder) => {
    const roundObj = roundsMap[rOrder];
    const col = document.createElement('div');
    col.className = 'bracket-round';

    const header = document.createElement('div');
    header.className = 'text-center py-1.5 px-3 rounded-lg bg-slate-800/80 border border-slate-700 text-xs font-black text-emerald-400 tracking-wider uppercase mb-2';
    header.textContent = roundObj.name;
    col.appendChild(header);

    roundObj.matches.forEach(match => {
      const matchCard = document.createElement('div');
      matchCard.className = 'bracket-match shadow-lg';

      const p1Won = match.winner_id && match.winner_id === match.player1_id;
      const p2Won = match.winner_id && match.winner_id === match.player2_id;
      const isConcluded = match.status === 'completed';

      const p1Badge = match.p1_badge ? (match.p1_badge.startsWith('http') ? `<img src="${match.p1_badge}" class="w-4 h-4 object-contain inline mr-1">` : `<span class="mr-1">${match.p1_badge}</span>`) : '';
      const p2Badge = match.p2_badge ? (match.p2_badge.startsWith('http') ? `<img src="${match.p2_badge}" class="w-4 h-4 object-contain inline mr-1">` : `<span class="mr-1">${match.p2_badge}</span>`) : '';

      matchCard.innerHTML = `
        <div class="px-2.5 py-1 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
          <span>مباراة #${match.match_order}</span>
          <span>${isConcluded ? '<span class="text-emerald-400 font-bold">منتهية</span>' : '<span class="text-slate-500">قادمة</span>'}</span>
        </div>
        <div class="bracket-slot ${p1Won ? 'winner' : (isConcluded ? 'loser' : '')}">
          <div class="flex items-center gap-1.5 truncate">
            ${p1Badge}
            <span class="truncate font-semibold text-slate-200">${match.p1_name || 'بانتظار المتأهل'}</span>
            ${match.p1_team ? `<span class="text-[10px] text-slate-500">(${match.p1_team})</span>` : ''}
          </div>
          <div class="font-gaming font-black text-sm px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
            ${match.score1 !== null ? match.score1 : '-'}
          </div>
        </div>
        <div class="bracket-slot ${p2Won ? 'winner' : (isConcluded ? 'loser' : '')}">
          <div class="flex items-center gap-1.5 truncate">
            ${p2Badge}
            <span class="truncate font-semibold text-slate-200">${match.p2_name || 'بانتظار المتأهل'}</span>
            ${match.p2_team ? `<span class="text-[10px] text-slate-500">(${match.p2_team})</span>` : ''}
          </div>
          <div class="font-gaming font-black text-sm px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
            ${match.score2 !== null ? match.score2 : '-'}
          </div>
        </div>
      `;

      col.appendChild(matchCard);
    });

    bracketTree.appendChild(col);
  });
}

// Fetch Teams Catalog & Taken Map
async function fetchTeamsData() {
  try {
    const res = await fetch(`/api/teams/${currentTournamentId}`);
    if (res.ok) {
      const data = await res.json();
      teamsCatalog = data.catalog || { clubs: [], national: [] };
      takenTeamsMap = data.taken || {};
      lockedTeamsMap = data.locked || {};
      renderTeamsSelection();
    }
  } catch (err) {
    console.error('Error fetching teams:', err);
  }
}

// Render Teams in Registration Modal
function renderTeamsSelection() {
  teamsSelectionGrid.innerHTML = '';
  const search = (teamSearchInput.value || '').trim().toLowerCase();

  let list = [];
  if (currentCategory === 'all' || currentCategory === 'clubs') {
    list = list.concat(teamsCatalog.clubs.map(c => ({ ...c, type: 'club' })));
  }
  if (currentCategory === 'all' || currentCategory === 'national') {
    list = list.concat(teamsCatalog.national.map(n => ({ ...n, type: 'national' })));
  }

  // Filter search
  if (search) {
    list = list.filter(item => 
      item.name.toLowerCase().includes(search) || 
      item.nameEn.toLowerCase().includes(search)
    );
  }

  if (list.length === 0) {
    teamsSelectionGrid.innerHTML = `<div class="col-span-2 text-center py-6 text-xs text-slate-500">لم يتم العثور على فرق مطابقة</div>`;
    return;
  }

  list.forEach(item => {
    const isTaken = takenTeamsMap[item.id];
    const isLocked = lockedTeamsMap[item.id] && lockedTeamsMap[item.id].until > Date.now();
    const isLockedByMe = selectedTeam && selectedTeam.id === item.id;
    const isSelected = selectedTeam && selectedTeam.id === item.id;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `p-2.5 rounded-xl border text-right transition flex items-center justify-between text-xs relative ${
      isSelected 
        ? 'bg-emerald-500/20 border-emerald-500 text-white shadow-md shadow-emerald-500/20' 
        : isTaken
          ? 'bg-slate-900/40 border-slate-800/60 opacity-50 cursor-not-allowed'
          : isLocked && !isLockedByMe
            ? 'bg-amber-950/20 border-amber-800/40 opacity-60 cursor-not-allowed'
            : 'bg-slate-900/80 border-slate-800 hover:border-slate-600 text-slate-300'
    }`;

    if (isTaken || (isLocked && !isLockedByMe)) {
      btn.disabled = true;
    }

    const badgeHtml = item.type === 'national' 
      ? `<span class="text-xl">${item.flag}</span>` 
      : `<img src="${item.logo}" alt="${item.name}" class="w-6 h-6 object-contain" onerror="this.remove()">`;

    let statusText = '';
    if (isTaken) {
      statusText = `<span class="text-[10px] text-rose-400 font-bold block">محجوز لـ ${isTaken}</span>`;
    } else if (isLocked && !isLockedByMe) {
      statusText = `<span class="text-[10px] text-amber-400 font-bold block">محجوز مؤقتًا</span>`;
    } else if (isSelected) {
      statusText = `<span class="text-[10px] text-emerald-400 font-bold block">محدد لك (مؤقتًا)</span>`;
    }

    btn.innerHTML = `
      <div class="flex items-center gap-2 truncate">
        ${badgeHtml}
        <div class="truncate">
          <div class="font-bold text-white truncate">${item.name}</div>
          <div class="text-[10px] text-slate-500">${item.nameEn} · ⭐ ${item.rating}</div>
          ${statusText}
        </div>
      </div>
    `;

    btn.addEventListener('click', () => {
      selectAndLockTeam(item);
    });

    teamsSelectionGrid.appendChild(btn);
  });
}

// Select team and acquire 2-min lock
async function selectAndLockTeam(item) {
  modalAlertMsg.classList.add('hidden');
  const playerName = regPlayerName.value.trim();

  try {
    const res = await fetch('/api/teams/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId: currentTournamentId,
        teamId: item.id,
        playerName: playerName,
        sessionId: sessionId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      modalAlertMsg.textContent = data.error || 'تعذر حجز الفريق';
      modalAlertMsg.classList.remove('hidden');
      return;
    }

    selectedTeam = {
      id: item.id,
      name: item.name,
      type: item.type,
      badge: item.type === 'national' ? item.flag : item.logo
    };

    confirmRegisterBtn.disabled = false;
    startLockCountdown(data.lockedUntil);
    renderTeamsSelection();

  } catch (err) {
    modalAlertMsg.textContent = 'حدث خطأ في الاتصال';
    modalAlertMsg.classList.remove('hidden');
  }
}

// 2-minute countdown timer
function startLockCountdown(lockedUntil) {
  if (lockTimerInterval) clearInterval(lockTimerInterval);
  lockCountdownBanner.classList.remove('hidden');

  function update() {
    const remainingMs = lockedUntil - Date.now();
    if (remainingMs <= 0) {
      clearInterval(lockTimerInterval);
      lockCountdownBanner.classList.add('hidden');
      selectedTeam = null;
      confirmRegisterBtn.disabled = true;
      modalAlertMsg.textContent = 'انتهت مدة الحجز المؤقت (دقيقتان). يرجى إعادة اختيار الفريق.';
      modalAlertMsg.classList.remove('hidden');
      fetchTeamsData();
      return;
    }

    const secs = Math.floor(remainingMs / 1000);
    const mins = Math.floor(secs / 60);
    const secRem = secs % 60;
    lockTimerText.textContent = `${String(mins).padStart(2, '0')}:${String(secRem).padStart(2, '0')}`;
  }

  update();
  lockTimerInterval = setInterval(update, 1000);
}

// Release temporary lock
async function releaseLock() {
  if (lockTimerInterval) clearInterval(lockTimerInterval);
  lockCountdownBanner.classList.add('hidden');

  if (selectedTeam) {
    try {
      await fetch('/api/teams/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: currentTournamentId,
          teamId: selectedTeam.id,
          sessionId: sessionId
        })
      });
    } catch (e) {}
    selectedTeam = null;
  }
}

// Modal open/close listeners
openRegisterModalBtn.addEventListener('click', () => {
  modalAlertMsg.classList.add('hidden');
  regPlayerName.value = '';
  selectedTeam = null;
  confirmRegisterBtn.disabled = true;
  lockCountdownBanner.classList.add('hidden');
  registerModal.classList.remove('hidden');
  fetchTeamsData();
});

closeModalBtn.addEventListener('click', async () => {
  await releaseLock();
  registerModal.classList.add('hidden');
});

cancelModalBtn.addEventListener('click', async () => {
  await releaseLock();
  registerModal.classList.add('hidden');
});

// Category Tabs
document.querySelectorAll('.category-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.category-tab').forEach(t => {
      t.className = 'category-tab px-2.5 py-1 rounded-md font-bold text-slate-400 hover:text-white transition';
    });
    tab.className = 'category-tab px-2.5 py-1 rounded-md font-bold transition bg-emerald-500/20 text-emerald-400';
    currentCategory = tab.dataset.cat;
    renderTeamsSelection();
  });
});

teamSearchInput.addEventListener('input', () => {
  renderTeamsSelection();
});

// Submit Registration
confirmRegisterBtn.addEventListener('click', async () => {
  const playerName = regPlayerName.value.trim();
  if (!playerName) {
    modalAlertMsg.textContent = 'يرجى إدخال اسم اللاعب أولاً';
    modalAlertMsg.classList.remove('hidden');
    regPlayerName.focus();
    return;
  }
  if (!selectedTeam) {
    modalAlertMsg.textContent = 'يرجى اختيار فريق من القائمة';
    modalAlertMsg.classList.remove('hidden');
    return;
  }

  confirmRegisterBtn.disabled = true;
  confirmRegisterBtn.innerHTML = `<span>جاري التسجيل...</span>`;

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournamentId: currentTournamentId,
        playerName: playerName,
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
        teamType: selectedTeam.type,
        teamBadge: selectedTeam.badge,
        sessionId: sessionId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      modalAlertMsg.textContent = data.error || 'فشل التسجيل';
      modalAlertMsg.classList.remove('hidden');
      confirmRegisterBtn.disabled = false;
      confirmRegisterBtn.innerHTML = `<span>تأكيد التسجيل</span> <i data-lucide="check" class="w-4 h-4"></i>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    if (lockTimerInterval) clearInterval(lockTimerInterval);
    selectedTeam = null;
    registerModal.classList.add('hidden');
    showToast(`تم تسجيلك بنجاح باسم "${playerName}"! 🎉`);

  } catch (err) {
    modalAlertMsg.textContent = 'حدث خطأ في الاتصال بالخادم';
    modalAlertMsg.classList.remove('hidden');
  } finally {
    confirmRegisterBtn.innerHTML = `<span>تأكيد التسجيل</span> <i data-lucide="check" class="w-4 h-4"></i>`;
    if (window.lucide) lucide.createIcons();
  }
});

// Share Button logic
copyShareBtn.addEventListener('click', () => {
  const shareUrl = window.location.href;
  const shareText = `🏆 انضم إلى بطولة ${tournamentData?.tournament?.name || 'FIFA Night'} الآن!\nسجل اسمك وفريقك قبل اكتمال المقاعد:\n${shareUrl}`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('تم نسخ رابط البطولة لمشاركته في الواتساب! 📋');
    });
  } else {
    showToast('تم نسخ الرابط');
  }

  // If on mobile, open whatsapp share directly
  if (/Android|iPhone/i.test(navigator.userAgent)) {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, '_blank');
  }
});

// Startup
loadInitialData();
initSocket();
