// Dashboard functionality

// Check authentication
if (!localStorage.getItem('admin_token')) {
  window.location.href = '/admin/index.html';
}

// Global state
let currentPool = null;
let participants = [];
let picks = [];
let teams = [];
let templates = [];

// Initialize dashboard
async function init() {
  await loadDashboard();
  await loadTemplates();
  setupEventListeners();

  // Initialize round filters based on current pool's tournament type
  if (currentPool) {
    populateRoundSelect('round-filter', currentPool.tournament_type || 'march_madness', false);
    if (currentPool.current_round) {
      document.getElementById('round-filter').value = currentPool.current_round;
    }
  }
}

function setupEventListeners() {
  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Navigation
  document.querySelectorAll('.nav-menu a').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = e.target.dataset.page;
      navigateTo(page);
    });
  });

  // Add Participant Form
  document.getElementById('add-participant-form').addEventListener('submit', handleAddParticipant);

  // Betty Message Form
  document.getElementById('betty-message-form').addEventListener('submit', handleSendBettyMessage);

  // Team Forms
  document.getElementById('add-team-form').addEventListener('submit', handleAddTeam);
  document.getElementById('edit-team-form').addEventListener('submit', handleEditTeam);
  document.getElementById('eliminate-team-form').addEventListener('submit', handleEliminateTeam);

  // Pick Form
  document.getElementById('add-pick-form').addEventListener('submit', handleAddPick);

  // Simulate Game Form
  document.getElementById('simulate-game-form').addEventListener('submit', handleSimulateGame);

  // Message content preview
  document.getElementById('message-content')?.addEventListener('input', updateMessagePreview);
}

function logout() {
  localStorage.removeItem('admin_token');
  window.location.href = '/admin/index.html';
}

function navigateTo(page) {
  // Update active nav link
  document.querySelectorAll('.nav-menu a').forEach((link) => {
    link.classList.remove('active');
    if (link.dataset.page === page) {
      link.classList.add('active');
    }
  });

  // Show corresponding view
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.remove('active');
  });
  document.getElementById(`${page}-view`).classList.add('active');

  // Load data for the view
  switch (page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'participants':
      loadParticipants();
      break;
    case 'picks':
      // Update round filter based on current pool's tournament type
      if (currentPool) {
        populateRoundSelect('round-filter', currentPool.tournament_type || 'march_madness', false);
        // Set to current round if available
        if (currentPool.current_round) {
          document.getElementById('round-filter').value = currentPool.current_round;
        }
      }
      loadPicks();
      break;
    case 'teams':
      loadTeams();
      break;
    case 'betty':
      // Betty chat is static for now
      break;
    case 'pool':
      loadPoolSettings();
      break;
  }
}

// Dashboard
async function loadDashboard() {
  try {
    currentPool = await api.getPool();
    participants = await api.getParticipants();
    picks = await api.getPicks();

    // Update stats - only count paid participants
    const unpaidCount = participants.filter((p) => !p.paid).length;
    const activeCount = participants.filter((p) => p.status === 'active' && p.paid).length;
    const eliminatedCount = participants.filter((p) => p.status === 'eliminated' && p.paid).length;

    // Picks submitted in current round only, for paid active participants
    let picksSubmittedCount = 0;
    if (currentPool.current_round) {
      picksSubmittedCount = picks.filter((pick) => pick.round === currentPool.current_round).length;
    }

    document.getElementById('unpaid-participants').textContent = unpaidCount;
    document.getElementById('active-participants').textContent = activeCount;
    document.getElementById('eliminated-participants').textContent = eliminatedCount;
    document.getElementById('current-round').textContent = currentPool.current_round || 'Not Started';
    document.getElementById('pool-status').textContent = currentPool.status.charAt(0).toUpperCase() + currentPool.status.slice(1);
    document.getElementById('picks-submitted').textContent = `${picksSubmittedCount}/${activeCount}`;

    // Render recent participants
    renderRecentParticipants();
  } catch (error) {
    console.error('Error loading dashboard:', error);
    alert('Failed to load dashboard data');
  }
}

function renderRecentParticipants() {
  const tbody = document.querySelector('#recent-participants-table tbody');
  const recentParticipants = participants.slice(0, 10);

  tbody.innerHTML = recentParticipants
    .map(
      (p) => `
    <tr>
      <td>${p.slack_username || p.slack_user_id}</td>
      <td><span class="badge badge-${p.status}">${p.status}</span></td>
      <td><span class="badge badge-${p.paid ? 'paid' : 'unpaid'}">${p.paid ? 'Paid' : 'Unpaid'}</span></td>
      <td>${new Date(p.joined_at).toLocaleDateString()}</td>
    </tr>
  `
    )
    .join('');
}

function refreshDashboard() {
  loadDashboard();
}

// Participants
async function loadParticipants() {
  try {
    participants = await api.getParticipants();
    renderParticipants();
  } catch (error) {
    console.error('Error loading participants:', error);
    alert('Failed to load participants');
  }
}

function renderParticipants(filter = 'all') {
  const tbody = document.querySelector('#participants-table tbody');
  let filtered = participants;

  if (filter !== 'all') {
    filtered = participants.filter((p) => p.status === filter);
  }

  tbody.innerHTML = filtered
    .map(
      (p) => `
    <tr>
      <td>${p.slack_user_id}</td>
      <td>${p.slack_username || '-'}</td>
      <td><span class="badge badge-${p.status}">${p.status}</span></td>
      <td><span class="badge badge-${p.paid ? 'paid' : 'unpaid'}">${p.paid ? 'Yes' : 'No'}</span></td>
      <td><strong>${p.seed_sum || 0}</strong></td>
      <td>${p.eliminated_round || '-'}</td>
      <td>${p.eliminated_team || '-'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="viewParticipantDetails('${p.id}')">View</button>
        ${!p.paid ? `<button class="btn btn-sm btn-success" onclick="markParticipantPaid('${p.id}')">Mark Paid</button>` : ''}
        ${p.status === 'active' ? `<button class="btn btn-sm btn-danger" onclick="eliminateParticipant('${p.id}')">Eliminate</button>` : ''}
      </td>
    </tr>
  `
    )
    .join('');
}

function filterParticipants() {
  const filter = document.getElementById('participant-filter').value;
  renderParticipants(filter);
}

async function viewParticipantDetails(id) {
  try {
    const participant = await api.getParticipant(id);
    const { picks, teamsUsed } = await api.getPicksByParticipant(id);

    alert(`Participant: ${participant.slack_username || participant.slack_user_id}
Status: ${participant.status}
Paid: ${participant.paid ? 'Yes' : 'No'}
Seed Sum (Tiebreaker): ${participant.seed_sum || 0}
Teams Used: ${teamsUsed.join(', ') || 'None'}
Total Picks: ${picks.length}`);
  } catch (error) {
    console.error('Error viewing participant:', error);
    alert('Failed to load participant details');
  }
}

async function syncChannelMembers() {
  if (!confirm('Sync all members from the Slack channel as unpaid participants?\n\nThis will add any new members who are not already in the pool.')) {
    return;
  }

  try {
    const result = await api.syncChannelMembers();

    const message = `✅ Sync Complete!\n\n` +
      `Total channel members: ${result.result.totalMembers}\n` +
      `New participants added: ${result.result.newParticipants}\n` +
      `Already in pool: ${result.result.existingParticipants}` +
      (result.result.errors.length > 0 ? `\n\nErrors: ${result.result.errors.length}` : '');

    alert(message);
    loadParticipants();
  } catch (error) {
    console.error('Error syncing channel members:', error);
    alert('Failed to sync channel members');
  }
}

async function markParticipantPaid(id) {
  if (!confirm('Mark this participant as paid?')) return;

  try {
    await api.markPaid(id);
    alert('Participant marked as paid');
    loadParticipants();
  } catch (error) {
    console.error('Error marking paid:', error);
    alert('Failed to mark participant as paid');
  }
}

async function eliminateParticipant(id) {
  const reason = prompt('Reason for elimination:');
  if (!reason) return;

  const round = currentPool?.current_round || 'Manual';

  try {
    await api.eliminateParticipant(id, reason, round);
    alert('Participant eliminated');
    loadParticipants();
  } catch (error) {
    console.error('Error eliminating participant:', error);
    alert('Failed to eliminate participant');
  }
}

// Picks
async function loadPicks() {
  try {
    const round = document.getElementById('round-filter')?.value || currentPool?.current_round;
    if (round) {
      picks = await api.getPicksByRound(round);
    } else {
      picks = await api.getPicks();
    }
    renderPicks();
  } catch (error) {
    console.error('Error loading picks:', error);
    alert('Failed to load picks');
  }
}

function renderPicks() {
  const tbody = document.querySelector('#picks-table tbody');

  tbody.innerHTML = picks
    .map(
      (pick) => `
    <tr>
      <td>${pick.slack_username || pick.participant_slack_id || pick.participant_id.substring(0, 8) + '...'}</td>
      <td>${pick.round}</td>
      <td>${pick.team_name}</td>
      <td>${pick.team_seed || '-'}</td>
      <td><span class="badge badge-${pick.result || 'pending'}">${pick.result || 'Pending'}</span></td>
      <td>${new Date(pick.submitted_at).toLocaleString()}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editPick('${pick.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deletePick('${pick.id}')">Delete</button>
      </td>
    </tr>
  `
    )
    .join('');
}

function filterPicks() {
  loadPicks();
}

async function showAddPickModal() {
  // Populate participants dropdown (active only)
  const allParticipants = await api.getParticipants();
  const participantSelect = document.getElementById('pick-participant-select');
  participantSelect.innerHTML = '<option value="">-- Select Participant --</option>';
  allParticipants
    .filter((p) => p.status === 'active')
    .forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.slack_username || p.slack_user_id}`;
      participantSelect.appendChild(opt);
    });

  // Populate teams dropdown (active only)
  const allTeams = await api.getTeams();
  const teamSelect = document.getElementById('pick-team-select');
  teamSelect.innerHTML = '<option value="">-- Select Team --</option>';
  allTeams
    .filter((t) => t.status === 'active')
    .sort((a, b) => (a.seed || 99) - (b.seed || 99) || a.team_name.localeCompare(b.team_name))
    .forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.team_name;
      opt.textContent = t.seed ? `(${t.seed}) ${t.team_name}` : t.team_name;
      teamSelect.appendChild(opt);
    });

  // Populate round options based on tournament type
  if (currentPool) {
    populateRoundSelect('pick-round-select', currentPool.tournament_type || 'march_madness', false);
    // Default round to current pool round
    if (currentPool.current_round) {
      document.getElementById('pick-round-select').value = currentPool.current_round;
    }
  }

  document.getElementById('add-pick-modal').classList.add('active');
}

async function handleAddPick(e) {
  e.preventDefault();

  const participant_id = document.getElementById('pick-participant-select').value;
  const round = document.getElementById('pick-round-select').value;
  const team_name = document.getElementById('pick-team-select').value;

  if (!participant_id || !round || !team_name) {
    alert('Please fill in all fields.');
    return;
  }

  try {
    await api.createPick({ participant_id, round, team_name });
    closeModal('add-pick-modal');
    alert(`✅ Pick saved: ${team_name} for ${round}`);
    await loadPicks();
  } catch (error) {
    console.error('Error adding pick:', error);
    alert(`Failed to save pick: ${error.message}`);
  }
}

async function loadPicksSummary() {
  try {
    const summary = await api.getPicksSummary();

    let summaryText = `Pick Summary for ${summary.round}\n\n`;
    summaryText += `Total Picks: ${summary.totalPicks}\n\n`;
    summaryText += `Most Popular Picks:\n`;
    summary.popularPicks.slice(0, 10).forEach((pick, idx) => {
      summaryText += `${idx + 1}. ${pick.team} (${pick.count} picks)\n`;
    });

    alert(summaryText);
  } catch (error) {
    console.error('Error loading picks summary:', error);
    alert('Failed to load picks summary');
  }
}

async function editPick(id) {
  const newTeam = prompt('Enter new team name:');
  if (!newTeam) return;

  try {
    await api.updatePick(id, { team_name: newTeam });
    alert('Pick updated');
    loadPicks();
  } catch (error) {
    console.error('Error updating pick:', error);
    alert(`Failed to update pick: ${error.message}`);
  }
}

async function deletePick(id) {
  if (!confirm('Delete this pick?')) return;

  try {
    await api.deletePick(id);
    alert('Pick deleted');
    loadPicks();
  } catch (error) {
    console.error('Error deleting pick:', error);
    alert('Failed to delete pick');
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────────

async function loadTeams() {
  try {
    teams = await api.getTeams();
    renderTeams();
    updateTeamStats();
  } catch (error) {
    console.error('Error loading teams:', error);
    alert('Failed to load teams');
  }
}

function updateTeamStats() {
  const activeCount = teams.filter((t) => t.status === 'active').length;
  const eliminatedCount = teams.filter((t) => t.status === 'eliminated').length;
  document.getElementById('total-teams').textContent = teams.length;
  document.getElementById('active-teams').textContent = activeCount;
  document.getElementById('eliminated-teams').textContent = eliminatedCount;
}

function renderTeams(filter = 'all') {
  const tbody = document.querySelector('#teams-table tbody');
  let filtered = teams;

  if (filter !== 'all') {
    filtered = teams.filter((t) => t.status === filter);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999;">No teams found. Use "Add Team" or "Bulk Import" to get started.</td></tr>';
    return;
  }

  // Sort: by region, then seed, then name
  filtered.sort((a, b) => {
    const regionOrder = ['East', 'West', 'South', 'Midwest'];
    const ra = regionOrder.indexOf(a.region) >= 0 ? regionOrder.indexOf(a.region) : 99;
    const rb = regionOrder.indexOf(b.region) >= 0 ? regionOrder.indexOf(b.region) : 99;
    if (ra !== rb) return ra - rb;
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return a.team_name.localeCompare(b.team_name);
  });

  tbody.innerHTML = filtered
    .map(
      (t) => `
    <tr>
      <td><strong>${t.team_name}</strong></td>
      <td>${t.seed || '-'}</td>
      <td>${t.region || '-'}</td>
      <td><span class="badge badge-${t.status === 'active' ? 'active' : 'eliminated'}">${t.status === 'active' ? 'Active' : 'Eliminated'}</span></td>
      <td>${t.eliminated_round || '-'}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="showEditTeamModal('${t.id}')">Edit</button>
        ${t.status === 'active' ? `<button class="btn btn-sm btn-danger" onclick="showEliminateTeamModal('${t.id}', '${t.team_name.replace(/'/g, "\\'")}')">Eliminate</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="deleteTeam('${t.id}', '${t.team_name.replace(/'/g, "\\'")}')">Delete</button>
      </td>
    </tr>
  `
    )
    .join('');
}

function filterTeams() {
  const filter = document.getElementById('team-filter').value;
  renderTeams(filter);
}

function showAddTeamModal() {
  document.getElementById('add-team-form').reset();
  document.getElementById('add-team-modal').classList.add('active');
}

function showBulkImportModal() {
  document.getElementById('bulk-import-text').value = '';
  document.getElementById('bulk-import-modal').classList.add('active');
}

function showEditTeamModal(id) {
  const team = teams.find((t) => t.id === id);
  if (!team) return;

  document.getElementById('edit-team-id').value = team.id;
  document.getElementById('edit-team-name').value = team.team_name;
  document.getElementById('edit-team-seed').value = team.seed || '';
  document.getElementById('edit-team-region').value = team.region || '';
  document.getElementById('edit-team-modal').classList.add('active');
}

function showEliminateTeamModal(id, teamName) {
  document.getElementById('eliminate-team-id').value = id;
  document.getElementById('eliminate-team-name-display').textContent = teamName;

  // Populate round options based on tournament type
  if (currentPool) {
    populateRoundSelect('eliminate-team-round', currentPool.tournament_type || 'march_madness', false);
    // Default to current round if set
    if (currentPool.current_round) {
      document.getElementById('eliminate-team-round').value = currentPool.current_round;
    }
  }

  document.getElementById('eliminate-team-modal').classList.add('active');
}

async function handleAddTeam(e) {
  e.preventDefault();

  const team_name = document.getElementById('new-team-name').value.trim();
  const seedVal = document.getElementById('new-team-seed').value;
  const region = document.getElementById('new-team-region').value || undefined;
  const seed = seedVal ? parseInt(seedVal) : undefined;

  try {
    await api.createTeam({ team_name, seed, region });
    closeModal('add-team-modal');
    document.getElementById('add-team-form').reset();
    await loadTeams();
  } catch (error) {
    console.error('Error adding team:', error);
    alert(`Failed to add team: ${error.message}`);
  }
}

async function handleEditTeam(e) {
  e.preventDefault();

  const id = document.getElementById('edit-team-id').value;
  const team_name = document.getElementById('edit-team-name').value.trim();
  const seedVal = document.getElementById('edit-team-seed').value;
  const region = document.getElementById('edit-team-region').value || null;
  const seed = seedVal ? parseInt(seedVal) : null;

  try {
    await api.updateTeam(id, { team_name, seed, region });
    closeModal('edit-team-modal');
    await loadTeams();
  } catch (error) {
    console.error('Error editing team:', error);
    alert(`Failed to update team: ${error.message}`);
  }
}

async function handleEliminateTeam(e) {
  e.preventDefault();

  const id = document.getElementById('eliminate-team-id').value;
  const round = document.getElementById('eliminate-team-round').value;

  try {
    await api.eliminateTeam(id, round);
    closeModal('eliminate-team-modal');
    await loadTeams();
  } catch (error) {
    console.error('Error eliminating team:', error);
    alert(`Failed to eliminate team: ${error.message}`);
  }
}

async function deleteTeam(id, teamName) {
  if (!confirm(`Delete "${teamName}"? This cannot be undone.`)) return;

  try {
    await api.deleteTeam(id);
    await loadTeams();
  } catch (error) {
    console.error('Error deleting team:', error);
    alert(`Failed to delete team: ${error.message}`);
  }
}

async function clearAllTeams() {
  if (!confirm('⚠️ Delete ALL teams from this pool?\n\nThis cannot be undone.')) return;

  try {
    const result = await api.clearTeams();
    alert(`✅ ${result.message}`);
    await loadTeams();
  } catch (error) {
    console.error('Error clearing teams:', error);
    alert('Failed to clear teams');
  }
}

async function forceSyncESPN() {
  const btnDashboard = document.getElementById('force-sync-btn');
  const btnPool = document.getElementById('force-sync-btn-pool');
  const syncTimeElDashboard = document.getElementById('last-sync-time');
  const syncTimeElPool = document.getElementById('last-sync-time-pool');

  // Disable both buttons
  if (btnDashboard) {
    btnDashboard.disabled = true;
    btnDashboard.textContent = '⏳ Syncing...';
  }
  if (btnPool) {
    btnPool.disabled = true;
    btnPool.textContent = '⏳ Syncing...';
  }

  try {
    const result = await api.syncTeams();
    const now = new Date().toLocaleTimeString();

    // Update both sync time displays
    if (syncTimeElDashboard) syncTimeElDashboard.textContent = `Last synced at ${now}`;
    if (syncTimeElPool) syncTimeElPool.textContent = `${now}`;

    alert(`✅ ${result.message}`);
    await loadTeams();
  } catch (error) {
    console.error('Error during ESPN sync:', error);
    alert('Sync failed. Check Railway logs for details.');
  } finally {
    // Re-enable both buttons
    if (btnDashboard) {
      btnDashboard.disabled = false;
      btnDashboard.textContent = '🔄 Force Sync Now';
    }
    if (btnPool) {
      btnPool.disabled = false;
      btnPool.textContent = '🔄 Force Sync Now';
    }
  }
}

async function simulateRoundEndNow() {
  const round = currentPool?.current_round;
  if (!round) {
    alert('No current round set on the pool. Update Pool Settings first.');
    return;
  }

  if (!confirm(`Simulate end of ${round}?\n\nThis will:\n• Send the end-of-round summary to Slack\n• Advance the pool to the next round\n• Announce that picks are open\n\nThis cannot be undone.`)) return;

  const btn = document.getElementById('simulate-round-end-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Running...';

  try {
    const result = await api.simulateRoundEnd();
    alert(`✅ ${result.message}`);
    await loadDashboard();
  } catch (error) {
    console.error('Error simulating round end:', error);
    alert(`Failed: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '🧪 Simulate Round End';
  }
}

function showSimulateGameModal() {
  // Populate round options based on tournament type
  if (currentPool) {
    populateRoundSelect('sim-game-round', currentPool.tournament_type || 'march_madness', false);
    // Default to current round if set
    if (currentPool.current_round) {
      document.getElementById('sim-game-round').value = currentPool.current_round;
    }
  }

  document.getElementById('sim-game-winner').value = '';
  document.getElementById('sim-game-loser').value = '';
  document.getElementById('simulate-game-modal').classList.add('active');
}

async function handleSimulateGame(e) {
  e.preventDefault();
  const winner = document.getElementById('sim-game-winner').value.trim();
  const loser = document.getElementById('sim-game-loser').value.trim();
  const round = document.getElementById('sim-game-round').value;

  if (!winner || !loser) {
    alert('Both winner and loser team names are required.');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '⏳ Running...';

  try {
    const result = await api.simulateGame(winner, loser, round);
    closeModal('simulate-game-modal');
    alert(`✅ ${result.message}`);
    await loadDashboard();
    await loadTeams();
  } catch (error) {
    console.error('Error simulating game:', error);
    alert(`Failed: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Simulation';
  }
}

async function submitBulkImport() {
  const raw = document.getElementById('bulk-import-text').value.trim();

  if (!raw) {
    alert('Please paste some teams first.');
    return;
  }

  // Parse the pasted text
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const parsedTeams = [];

  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim());
    const team_name = parts[0];
    if (!team_name) continue;

    const seed = parts[1] ? parseInt(parts[1]) : undefined;
    const region = parts[2] || undefined;

    parsedTeams.push({
      team_name,
      ...(seed && !isNaN(seed) ? { seed } : {}),
      ...(region ? { region } : {}),
    });
  }

  if (parsedTeams.length === 0) {
    alert('No valid teams found in the pasted text.');
    return;
  }

  try {
    const result = await api.bulkImportTeams({ teams: parsedTeams });
    closeModal('bulk-import-modal');
    alert(`✅ ${result.message}${result.validationErrors && result.validationErrors.length > 0 ? '\n\nWarnings:\n' + result.validationErrors.join('\n') : ''}`);
    await loadTeams();
  } catch (error) {
    console.error('Error bulk importing teams:', error);
    alert(`Failed to import teams: ${error.message}`);
  }
}

// ─── Pool Settings ────────────────────────────────────────────────────────────

// Pool Settings
async function loadPoolSettings() {
  // Always fetch fresh pool data to avoid using cached values
  try {
    currentPool = await api.getPool();
  } catch (error) {
    console.error('Error fetching pool:', error);
    alert('Failed to load pool settings');
    return;
  }

  document.getElementById('pool-name').value = currentPool.name;
  document.getElementById('pool-tournament-type').value = currentPool.tournament_type || 'march_madness';
  document.getElementById('pool-status-select').value = currentPool.status;
  document.getElementById('pool-entry-fee').value = currentPool.entry_fee || '';

  // Update round options based on tournament type
  updateRoundOptions(currentPool.tournament_type || 'march_madness');

  // Now set the current round value after options are populated
  document.getElementById('pool-round').value = currentPool.current_round || '';

  // Load override_date settings
  const overrideDateEnabled = document.getElementById('override-date-enabled');
  const overrideDatePicker = document.getElementById('override-date-picker');
  const overrideDatePickerGroup = document.getElementById('override-date-picker-group');

  if (currentPool.override_date) {
    // Date override is enabled
    overrideDateEnabled.checked = true;
    overrideDatePickerGroup.style.display = 'block';
    // Convert date to YYYY-MM-DD format for input[type=date]
    const dateStr = new Date(currentPool.override_date).toISOString().split('T')[0];
    overrideDatePicker.value = dateStr;
  } else {
    // Date override is disabled
    overrideDateEnabled.checked = false;
    overrideDatePickerGroup.style.display = 'none';
    overrideDatePicker.value = '';
  }

  // Update lock status display
  updateLockStatusDisplay();

  // Update allow next round picks section
  updateAllowNextRoundPicksDisplay();
}

function updateAllowNextRoundPicksDisplay() {
  if (!currentPool) return;

  const allowNextRoundSection = document.getElementById('allowNextRoundPicksSection');
  const allowNextRoundBtn = document.getElementById('allowNextRoundPicksBtn');
  const disableNextRoundBtn = document.getElementById('disableNextRoundPicksBtn');
  const nextRoundStatus = document.getElementById('nextRoundPicksStatus');

  if (currentPool.status === 'active' && currentPool.current_round) {
    allowNextRoundSection.style.display = 'block';

    // Determine next round based on tournament type
    const nextRoundMap = currentPool.tournament_type === 'nba_playoffs'
      ? {
          'First Round': 'Conference Semifinals',
          'Conference Semifinals': 'Conference Finals',
          'Conference Finals': 'NBA Finals',
          'NBA Finals': null
        }
      : {
          'Round of 64': 'Round of 32',
          'Round of 32': 'Sweet Sixteen',
          'Sweet Sixteen': 'Elite Eight',
          'Elite Eight': 'Final Four',
          'Final Four': 'Championship',
          'Championship': null
        };

    const nextRound = nextRoundMap[currentPool.current_round];

    if (currentPool.allow_next_round_picks) {
      // Show status and disable button, hide allow button
      nextRoundStatus.innerHTML = `<span style="background: #ff9800; color: white; padding: 5px 10px; border-radius: 3px; font-weight: bold;">✅ Accepting picks for: ${nextRound}</span>`;
      allowNextRoundBtn.style.display = 'none';
      disableNextRoundBtn.style.display = 'inline-block';
    } else if (nextRound) {
      // Show allow button, hide disable button
      nextRoundStatus.innerHTML = '';
      allowNextRoundBtn.textContent = `Allow ${nextRound} Picks`;
      allowNextRoundBtn.style.display = 'inline-block';
      disableNextRoundBtn.style.display = 'none';
    } else {
      // Final round, hide everything
      allowNextRoundSection.style.display = 'none';
    }
  } else {
    allowNextRoundSection.style.display = 'none';
  }
}

function updateLockStatusDisplay() {
  if (!currentPool) return;

  const statusDisplay = document.getElementById('lock-status-display');
  const lockBtn = document.getElementById('lock-btn');
  const unlockBtn = document.getElementById('unlock-btn');

  if (currentPool.current_round_locked) {
    statusDisplay.textContent = '🔒 Status: LOCKED';
    statusDisplay.style.color = '#d32f2f';
    lockBtn.disabled = true;
    lockBtn.style.opacity = '0.5';
    unlockBtn.disabled = false;
    unlockBtn.style.opacity = '1';
  } else {
    statusDisplay.textContent = '🔓 Status: UNLOCKED';
    statusDisplay.style.color = '#388e3c';
    lockBtn.disabled = false;
    lockBtn.style.opacity = '1';
    unlockBtn.disabled = true;
    unlockBtn.style.opacity = '0.5';
  }
}

function toggleDateOverride() {
  const overrideDateEnabled = document.getElementById('override-date-enabled').checked;
  const overrideDatePickerGroup = document.getElementById('override-date-picker-group');

  if (overrideDateEnabled) {
    overrideDatePickerGroup.style.display = 'block';
  } else {
    overrideDatePickerGroup.style.display = 'none';
  }
}

async function updatePool() {
  // Read values directly from form inputs
  const name = document.getElementById('pool-name').value;
  const current_round = document.getElementById('pool-round').value || null;
  const tournament_type = document.getElementById('pool-tournament-type').value;
  const status = document.getElementById('pool-status-select').value;
  const entry_fee = parseFloat(document.getElementById('pool-entry-fee').value) || null;

  // Read override_date setting
  const overrideDateEnabled = document.getElementById('override-date-enabled').checked;
  const override_date = overrideDateEnabled
    ? document.getElementById('override-date-picker').value || null
    : null;

  console.log('Updating pool with:', { name, current_round, tournament_type, status, entry_fee, override_date }); // Debug log

  try {
    const updated = await api.updatePool(currentPool.id, { name, current_round, tournament_type, status, entry_fee, override_date });
    console.log('Pool updated:', updated); // Debug log
    currentPool = updated; // Update local cache with fresh data
    alert('Pool settings updated');
    loadDashboard();
  } catch (error) {
    console.error('Error updating pool:', error);
    alert('Failed to update pool settings');
  }
}

async function lockCurrentRound() {
  if (!currentPool) {
    alert('No pool loaded');
    return;
  }

  const confirmed = confirm(
    `Lock picks for ${currentPool.current_round}?\n\nParticipants will no longer be able to submit or modify picks for this round.`
  );

  if (!confirmed) return;

  try {
    const updated = await api.updatePool(currentPool.id, { current_round_locked: true });
    currentPool = updated;
    updateLockStatusDisplay();
    alert(`${currentPool.current_round} picks are now LOCKED`);
  } catch (error) {
    console.error('Error locking round:', error);
    alert('Failed to lock round');
  }
}

async function unlockCurrentRound() {
  if (!currentPool) {
    alert('No pool loaded');
    return;
  }

  const confirmed = confirm(
    `Unlock picks for ${currentPool.current_round}?\n\nParticipants will be able to submit or modify picks again.`
  );

  if (!confirmed) return;

  try {
    const updated = await api.updatePool(currentPool.id, { current_round_locked: false });
    currentPool = updated;
    updateLockStatusDisplay();
    alert(`${currentPool.current_round} picks are now UNLOCKED`);
  } catch (error) {
    console.error('Error unlocking round:', error);
    alert('Failed to unlock round');
  }
}

async function allowNextRoundPicks() {
  if (!currentPool) {
    alert('No pool loaded');
    return;
  }

  if (!confirm('Allow participants to submit picks for the next round?\n\nThe current round will continue processing normally.')) {
    return;
  }

  try {
    const data = await api.allowNextRoundPicks();
    alert(`Success! Picks are now open for ${data.nextRound}`);
    // Reload pool to update UI
    await loadPoolSettings();
  } catch (error) {
    console.error('Error enabling next round picks:', error);
    alert('Failed to enable next round picks: ' + error.message);
  }
}

async function disableNextRoundPicks() {
  if (!currentPool) {
    alert('No pool loaded');
    return;
  }

  if (!confirm('Disable next round picks?\n\nBetty will return to accepting picks for the current round only.')) {
    return;
  }

  try {
    const data = await api.disableNextRoundPicks();
    alert('Success! Now accepting picks for current round only');
    // Reload pool to update UI
    await loadPoolSettings();
  } catch (error) {
    console.error('Error disabling next round picks:', error);
    alert('Failed to disable next round picks: ' + error.message);
  }
}

async function clearPool() {
  if (!currentPool) {
    alert('No pool loaded');
    return;
  }

  const confirmed = confirm(
    '⚠️ WARNING: This will DELETE ALL participants and picks from this pool!\n\n' +
    'This action CANNOT be undone.\n\n' +
    'Are you sure you want to continue?'
  );

  if (!confirmed) {
    return;
  }

  try {
    await api.clearPool(currentPool.id);
    alert('✅ Pool cleared successfully. All participants and picks have been deleted.');
    loadDashboard();
  } catch (error) {
    console.error('Error clearing pool:', error);
    alert('Failed to clear pool');
  }
}

// Betty Chat
async function loadTemplates() {
  try {
    const data = await api.getTemplates();
    templates = data;

    const select = document.getElementById('message-template');
    select.innerHTML = '<option value="">-- Select Template --</option>';
    templates.forEach((t) => {
      const option = document.createElement('option');
      option.value = t.id;
      option.textContent = t.name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading templates:', error);
  }
}

function loadTemplate() {
  const templateId = document.getElementById('message-template').value;
  if (!templateId) return;

  const template = templates.find((t) => t.id === templateId);
  if (template) {
    document.getElementById('message-content').value = template.template;
    updateMessagePreview();
  }
}

function toggleMessageTarget() {
  const destination = document.getElementById('message-destination').value;
  const targetGroup = document.getElementById('target-group');
  const manualTargetGroup = document.getElementById('manual-target-group');

  if (destination === 'dm') {
    targetGroup.style.display = 'block';
    manualTargetGroup.style.display = 'block';
    loadParticipantsForMessage();
  } else {
    targetGroup.style.display = 'none';
    manualTargetGroup.style.display = 'none';
  }
}

function toggleManualTarget() {
  const isManual = document.getElementById('manual-target-checkbox').checked;
  const participantSelect = document.getElementById('message-participant');
  const manualInput = document.getElementById('message-target');

  if (isManual) {
    participantSelect.disabled = true;
    participantSelect.value = '';
    manualInput.style.display = 'block';
  } else {
    participantSelect.disabled = false;
    manualInput.style.display = 'none';
    manualInput.value = '';
  }
}

async function loadParticipantsForMessage() {
  try {
    const participants = await api.getParticipants();
    const select = document.getElementById('message-participant');

    select.innerHTML = '<option value="">-- Select Participant --</option>';

    participants.forEach((p) => {
      const option = document.createElement('option');
      option.value = p.slack_user_id;
      option.textContent = `${p.slack_username || p.slack_user_id} (${p.status})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading participants for message:', error);
  }
}

function updateTargetFromParticipant() {
  const participantId = document.getElementById('message-participant').value;
  const manualInput = document.getElementById('message-target');

  // Update the hidden target input with selected participant's Slack ID
  if (participantId) {
    manualInput.value = participantId;
  }
}

function updateMessagePreview() {
  const message = document.getElementById('message-content').value;
  document.getElementById('message-preview-content').textContent = message || 'Message preview will appear here...';
}

async function bettyifyMessage() {
  const messageInput = document.getElementById('message-content');
  const message = messageInput.value.trim();

  if (!message) {
    alert('Please enter a message to Bettyify');
    return;
  }

  try {
    // Show loading state
    const originalPlaceholder = messageInput.placeholder;
    messageInput.placeholder = '✨ Bettyifying your message...';
    messageInput.disabled = true;

    const result = await api.bettyifyMessage(message);

    // Update textarea with Betty's version
    messageInput.value = result.bettyified;
    updateMessagePreview();

    // Show success notification
    console.log('✨ Bettyified!', { original: result.original, bettyified: result.bettyified });

    // Reset state
    messageInput.disabled = false;
    messageInput.placeholder = originalPlaceholder;
    messageInput.focus();
  } catch (error) {
    console.error('Error bettyifying message:', error);
    alert('Failed to bettyify message: ' + error.message);

    // Reset state on error
    messageInput.disabled = false;
    messageInput.placeholder = 'Enter Betty\'s message...';
  }
}

async function sendBettyMessage() {
  const destination = document.getElementById('message-destination').value;
  const isManual = document.getElementById('manual-target-checkbox')?.checked;
  let target = document.getElementById('message-target').value;

  // If not manual, get from participant dropdown
  if (destination === 'dm' && !isManual) {
    const participantId = document.getElementById('message-participant').value;
    if (participantId) {
      target = participantId;
    }
  }

  const message = document.getElementById('message-content').value;

  if (!message) {
    alert('Message cannot be empty');
    return;
  }

  if (destination === 'dm' && !target) {
    alert('Please select a participant or enter a Slack User ID for DM');
    return;
  }

  try {
    await api.sendMessage(destination, message, target);
    alert('✅ Message sent successfully!');
    document.getElementById('message-content').value = '';
    document.getElementById('message-participant').value = '';
    document.getElementById('message-target').value = '';
    document.getElementById('manual-target-checkbox').checked = false;
    toggleManualTarget();
    updateMessagePreview();
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Failed to send message');
  }
}

// Modals
function showAddParticipantModal() {
  document.getElementById('add-participant-modal').classList.add('active');
}

function showBettyMessageModal() {
  document.getElementById('betty-message-modal').classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

async function handleAddParticipant(e) {
  e.preventDefault();

  const slack_user_id = document.getElementById('new-slack-user-id').value;
  const slack_username = document.getElementById('new-slack-username').value;
  const paid = document.getElementById('new-participant-paid').checked;

  try {
    const participant = await api.createParticipant({ slack_user_id, slack_username, paid });
    alert('Participant added successfully');
    closeModal('add-participant-modal');
    document.getElementById('add-participant-form').reset();
    // Reset checkbox to checked (default)
    document.getElementById('new-participant-paid').checked = true;
    loadParticipants();
    loadDashboard();
  } catch (error) {
    console.error('Error adding participant:', error);
    alert(`Failed to add participant: ${error.message}`);
  }
}

async function handleSendBettyMessage(e) {
  e.preventDefault();

  const destination = document.getElementById('modal-message-destination').value;
  const message = document.getElementById('modal-message-content').value;

  try {
    await api.sendMessage(destination, message);
    alert('✅ Message sent successfully!');
    closeModal('betty-message-modal');
    document.getElementById('betty-message-form').reset();
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Failed to send message');
  }
}

// Get rounds array for tournament type
function getRoundsForTournamentType(tournamentType) {
  if (tournamentType === 'nba_playoffs') {
    return [
      'First Round',
      'Conference Semifinals',
      'Conference Finals',
      'NBA Finals'
    ];
  } else {
    return [
      'Round of 64',
      'Round of 32',
      'Sweet Sixteen',
      'Elite Eight',
      'Final Four',
      'Championship'
    ];
  }
}

// Populate a select element with rounds for the given tournament type
function populateRoundSelect(selectId, tournamentType, includeNotStarted = false) {
  const roundSelect = document.getElementById(selectId);
  if (!roundSelect) return;

  const currentValue = roundSelect.value; // Save current selection
  roundSelect.innerHTML = ''; // Clear

  if (includeNotStarted) {
    const notStartedOption = document.createElement('option');
    notStartedOption.value = '';
    notStartedOption.textContent = 'Not Started';
    roundSelect.appendChild(notStartedOption);
  }

  const rounds = getRoundsForTournamentType(tournamentType);
  rounds.forEach(round => {
    const option = document.createElement('option');
    option.value = round;
    option.textContent = round;
    roundSelect.appendChild(option);
  });

  // Restore previous selection if it still exists
  if (currentValue && rounds.includes(currentValue)) {
    roundSelect.value = currentValue;
  } else if (includeNotStarted) {
    roundSelect.value = '';
  }
}

// Update round options based on tournament type
function updateRoundOptions(tournamentType) {
  populateRoundSelect('pool-round', tournamentType, true);
}

// Add event listener for tournament type changes
function initTournamentTypeListener() {
  const tournamentTypeSelect = document.getElementById('pool-tournament-type');
  if (tournamentTypeSelect) {
    tournamentTypeSelect.addEventListener('change', (e) => {
      updateRoundOptions(e.target.value);
    });
  }
}

// Close modal when clicking outside
window.onclick = function (event) {
  if (event.target.classList.contains('modal')) {
    event.target.classList.remove('active');
  }
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  init();
  initTournamentTypeListener();
});
