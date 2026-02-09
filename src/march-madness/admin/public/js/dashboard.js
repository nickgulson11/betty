// Dashboard functionality

// Check authentication
if (!localStorage.getItem('admin_token')) {
  window.location.href = '/admin/index.html';
}

// Global state
let currentPool = null;
let participants = [];
let picks = [];
let templates = [];

// Initialize dashboard
async function init() {
  await loadDashboard();
  await loadTemplates();
  setupEventListeners();
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
      loadPicks();
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

    // Update stats
    const activeCount = participants.filter((p) => p.status === 'active').length;
    const eliminatedCount = participants.filter((p) => p.status === 'eliminated').length;
    const picksSubmitted = picks.length;
    const activeParticipantsCount = participants.filter((p) => p.status === 'active').length;

    document.getElementById('total-participants').textContent = participants.length;
    document.getElementById('active-participants').textContent = activeCount;
    document.getElementById('eliminated-participants').textContent = eliminatedCount;
    document.getElementById('current-round').textContent = currentPool.current_round || 'Not Started';
    document.getElementById('pool-status').textContent = currentPool.status.charAt(0).toUpperCase() + currentPool.status.slice(1);
    document.getElementById('picks-submitted').textContent = `${picksSubmitted}/${activeParticipantsCount}`;

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
      <td>${pick.participant_id.substring(0, 8)}...</td>
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
  document.getElementById('pool-round').value = currentPool.current_round || '';
  document.getElementById('pool-status-select').value = currentPool.status;
  document.getElementById('pool-entry-fee').value = currentPool.entry_fee || '';
}

async function updatePool() {
  // Read values directly from form inputs
  const name = document.getElementById('pool-name').value;
  const current_round = document.getElementById('pool-round').value || null;
  const status = document.getElementById('pool-status-select').value;
  const entry_fee = parseFloat(document.getElementById('pool-entry-fee').value) || null;

  console.log('Updating pool with:', { name, current_round, status, entry_fee }); // Debug log

  try {
    const updated = await api.updatePool(currentPool.id, { name, current_round, status, entry_fee });
    console.log('Pool updated:', updated); // Debug log
    currentPool = updated; // Update local cache with fresh data
    alert('Pool settings updated');
    loadDashboard();
  } catch (error) {
    console.error('Error updating pool:', error);
    alert('Failed to update pool settings');
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

// Close modal when clicking outside
window.onclick = function (event) {
  if (event.target.classList.contains('modal')) {
    event.target.classList.remove('active');
  }
};

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);
