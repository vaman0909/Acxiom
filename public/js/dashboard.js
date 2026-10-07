// Dashboard Charts and Metric Loading using Chart.js

let leadChartInstance = null;
let pipelineChartInstance = null;
let trendChartInstance = null;

async function loadDashboardData(range = 'all') {
  try {
    const res = await fetch(`/dashboard-data/stats?range=${range}`);
    if (!res.ok) {
      if (res.status === 401) window.location.href = '/login';
      throw new Error('Failed to fetch dashboard metrics');
    }
    const json = await res.json();
    const data = json.data;

    // 1. Populate KPI Cards
    document.getElementById('statTotalCustomers').textContent = data.cards.totalCustomers;
    document.getElementById('statTotalLeads').textContent = data.cards.totalLeads;
    document.getElementById('statOpenLeads').textContent = data.cards.openLeads;
    document.getElementById('statTotalOpps').textContent = data.cards.totalOpps;
    document.getElementById('statOpenOpps').textContent = data.cards.openOpps;
    document.getElementById('statWonOpps').textContent = data.cards.wonOpps;
    document.getElementById('statLostOpps').textContent = data.cards.lostOpps;
    document.getElementById('statPipelineVal').textContent = '$' + Number(data.cards.totalPipelineValue).toLocaleString();
    document.getElementById('statWeightedVal').textContent = '$' + Number(data.cards.weightedPipelineValue).toLocaleString();
    document.getElementById('statPendingFollowups').textContent = data.cards.pendingFollowUps;

    // 2. Render Charts
    renderLeadStatusChart(data.charts.leadStatus);
    renderPipelineStageChart(data.charts.opportunityStages);
    renderMonthlyTrendChart(data.charts.monthlyTrend);

    // 3. Render Recent Activities
    renderRecentActivities(data.recentActivities);

    // 4. Render Upcoming Followups
    renderUpcomingFollowups(data.upcomingFollowups);
  } catch (err) {
    console.error('Error loading dashboard:', err);
    showToast(err.message, 'danger');
  }
}

function renderLeadStatusChart(statusData) {
  const ctx = document.getElementById('leadStatusChart').getContext('2d');
  const labels = Object.keys(statusData);
  const values = Object.values(statusData);

  if (leadChartInstance) leadChartInstance.destroy();

  leadChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: [
          '#3b82f6', // New - blue
          '#06b6d4', // Contacted - cyan
          '#f59e0b', // Qualified - amber
          '#10b981', // Converted - emerald
          '#ef4444'  // Lost - red
        ],
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 15, font: { family: 'Plus Jakarta Sans', weight: '600' } }
        }
      },
      cutout: '70%'
    }
  });
}

function renderPipelineStageChart(stageData) {
  const ctx = document.getElementById('pipelineStageChart').getContext('2d');
  const labels = stageData.map(s => s.stage);
  const amounts = stageData.map(s => s.amount);

  if (pipelineChartInstance) pipelineChartInstance.destroy();

  pipelineChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Pipeline Value ($)',
        data: amounts,
        backgroundColor: [
          'rgba(59, 130, 246, 0.85)',
          'rgba(245, 158, 11, 0.85)',
          'rgba(139, 92, 246, 0.85)',
          'rgba(16, 185, 129, 0.85)',
          'rgba(239, 68, 68, 0.85)'
        ],
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => '$' + (value >= 1000 ? (value / 1000) + 'k' : value)
          },
          grid: { color: '#f1f5f9' }
        },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function renderMonthlyTrendChart(trendData) {
  const ctx = document.getElementById('monthlyTrendChart').getContext('2d');
  const labels = trendData.map(t => t.month);
  const wonData = trendData.map(t => t.wonAmount);
  const pipelineData = trendData.map(t => t.pipelineAmount);

  if (trendChartInstance) trendChartInstance.destroy();

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Won Revenue ($)',
          data: wonData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5
        },
        {
          label: 'Open Pipeline ($)',
          data: pipelineData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.05)',
          fill: true,
          tension: 0.35,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => '$' + (v >= 1000 ? (v / 1000) + 'k' : v) },
          grid: { color: '#f1f5f9' }
        },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: { position: 'top', align: 'end' }
      }
    }
  });
}

function renderRecentActivities(activities) {
  const container = document.getElementById('recentActivitiesContainer');
  if (!activities || activities.length === 0) {
    container.innerHTML = '<p class="text-muted small p-3 text-center mb-0">No recent activities logged.</p>';
    return;
  }

  container.innerHTML = activities.map(a => `
    <div class="d-flex align-items-start gap-3 p-3 border-bottom border-light">
      <div class="badge bg-light text-primary border p-2 rounded-circle" style="width: 38px; height: 38px; display:flex; align-items:center; justify-content:center;">
        <i class="bi bi-${a.ActivityType === 'Call' ? 'telephone-fill' : (a.ActivityType === 'Meeting' ? 'people-fill' : (a.ActivityType === 'Email' ? 'envelope-fill' : 'check2-square'))}"></i>
      </div>
      <div class="flex-grow-1">
        <div class="d-flex justify-content-between">
          <strong class="text-dark fs-6">${a.Subject}</strong>
          <small class="text-muted">${a.ActivityDate}</small>
        </div>
        <p class="text-secondary small mb-1">${a.Description || 'No description provided.'}</p>
        <div class="small text-muted">
          <span>By: ${a.AssignedUserName || 'System'}</span>
          ${a.CustomerName ? ` &bull; <span class="fw-semibold text-primary">${a.CustomerName}</span>` : ''}
          ${a.LeadName ? ` &bull; <span class="fw-semibold text-info">${a.LeadName}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function renderUpcomingFollowups(followups) {
  const container = document.getElementById('upcomingFollowupsContainer');
  if (!followups || followups.length === 0) {
    container.innerHTML = '<p class="text-muted small p-3 text-center mb-0">No pending follow-ups scheduled.</p>';
    return;
  }

  container.innerHTML = followups.map(f => `
    <div class="d-flex align-items-center justify-content-between p-3 border-bottom border-light">
      <div>
        <div class="fw-bold text-dark">${f.Subject}</div>
        <div class="small text-muted">
          <i class="bi bi-calendar-event me-1 text-primary"></i> ${f.FollowUpDate} &bull; Type: <strong>${f.FollowUpType}</strong>
          ${f.CustomerName ? ` &bull; ${f.CustomerName}` : ''}
        </div>
      </div>
      <div>
        <button class="btn btn-sm btn-outline-success" onclick="quickCompleteFollowup(${f.FollowUpId})">
          <i class="bi bi-check-lg"></i> Done
        </button>
      </div>
    </div>
  `).join('');
}

async function quickCompleteFollowup(id) {
  try {
    await apiFetch(`/followups-data/${id}/complete`, {
      method: 'PUT',
      body: JSON.stringify({ remarks: 'Completed from Dashboard' })
    });
    showToast('Follow-up marked as Completed!', 'success');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDashboardData();

  // Date Range filter buttons
  document.querySelectorAll('.filter-range-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-range-btn').forEach(b => b.classList.remove('btn-primary', 'text-white'));
      btn.classList.add('btn-primary', 'text-white');
      loadDashboardData(btn.dataset.range);
    });
  });
});
