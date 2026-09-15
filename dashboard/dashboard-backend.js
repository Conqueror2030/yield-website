// dashboard-backend.js
(function() {
    // ---- ENVIRONMENT CONFIGURATION ----------------------------------
    const API_BASE = (window.YIELD_CONFIG && window.YIELD_CONFIG.DASHBOARD_API) || 'https://api.yieldai.space/api/dashboard';
    
    // ---- STATE ------------------------------------------------------
    let currentTenant = null;
    let refreshInterval = null;
    let currentLeads = [];
    let currentAppointments = [];

    // ---- SESSION CHECK ----------------------------------------------
    const storedTenant = localStorage.getItem('dashboard_tenant');
    const isLoginPage = window.location.pathname.endsWith('index.html') || 
                        window.location.pathname === '/dashboard' || 
                        window.location.pathname === '/dashboard/';
                        
    if (!storedTenant) {
        if (!isLoginPage) {
            window.location.href = '/dashboard/index.html';
        }
        return;
    }
    try {
        currentTenant = JSON.parse(storedTenant);
    } catch (e) {
        if (!isLoginPage) {
            window.location.href = '/dashboard/index.html';
        }
        return;
    }

    // ---- INITIALIZATION ---------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof lucide !== 'undefined') lucide.createIcons();
        
        // Populate Tenant UI
        const tbSub = document.getElementById('tb-sub');
        if (tbSub && currentTenant) {
            tbSub.textContent = `— Good morning, ${currentTenant.leads_name || 'Client'} 👋`;
        }

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('dashboard_tenant');
                window.location.href = '/dashboard/';
            });
        }

        refreshAllData();
        startAutoRefresh();
        initRealtimeUpdates();
    });

    // ---- REFRESH ALL DATA --------------------------------------------
    async function refreshAllData() {
        if (!currentTenant) return;

        // Load metrics
        try {
            const res = await fetch(`${API_BASE}/metrics?phone_id=${encodeURIComponent(currentTenant.phone_id)}`);
            if (res.ok) {
                const data = await res.json();
                const m = data.metrics;
                
                const leadsEl = document.getElementById('metric-leads');
                const bookingsEl = document.getElementById('metric-bookings');
                const pipelineEl = document.getElementById('metric-pipeline-value');
                
                const leadsCount = m.leads_captured || 0;
                if (leadsEl) leadsEl.textContent = leadsCount;
                if (bookingsEl) bookingsEl.textContent = Math.floor(leadsCount * 0.1); // simulated 10% booking rate
                if (pipelineEl) {
                    const pipelineValue = leadsCount * 7000000; // 70L avg deal value
                    if (pipelineValue >= 10000000) {
                        pipelineEl.textContent = '₹' + (pipelineValue / 10000000).toFixed(1) + 'Cr';
                    } else if (pipelineValue >= 100000) {
                        pipelineEl.textContent = '₹' + (pipelineValue / 100000).toFixed(0) + 'L';
                    } else {
                        pipelineEl.textContent = '₹' + pipelineValue.toLocaleString();
                    }
                }
            }
        } catch (e) {
            console.warn('[Dashboard] Metrics load failed:', e.message);
        }

        // Load leads
        await refreshLeads();

        // Load appointments
        await refreshAppointments();
    }

    // ---- REFRESH LEADS FEED ------------------------------------------
    async function refreshLeads() {
        if (!currentTenant) return;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(`${API_BASE}/leads?phone_id=${encodeURIComponent(currentTenant.phone_id)}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            currentLeads = data.leads || [];

            // Render Table View for Live Leads Feed
            const tableBody = document.getElementById('leads-tbody');
            if (tableBody) {
                if (currentLeads.length === 0) {
                    tableBody.innerHTML = '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--t3)">No leads yet.</td></tr>';
                } else {
                    const tz = currentTenant.timezone || 'UTC';
                    tableBody.innerHTML = currentLeads.map(lead => {
                        const facts = lead.buyer_facts || {};
                        const factsStr = typeof facts === 'object' ? JSON.stringify(facts) : String(facts || '');
                        const interestedIn = factsStr && factsStr !== '{}' ? 'Multiple' : 'General Inquiry';
                        
                        return `
                            <tr>
                                <td><a href="#" onclick="nav('leads')" style="color:var(--blue);text-decoration:none;font-weight:600">${escapeHtml(lead.phone_no || 'N/A')}</a></td>
                                <td style="color:var(--t3);font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(lead.chat_summary || '')}">${escapeHtml(lead.chat_summary || 'No summary available')}</td>
                                <td>${interestedIn}</td>
                                <td>
                                    <select class="status-sel ${lead.status || 'warm'}">
                                        <option value="hot" ${lead.status === 'hot' ? 'selected' : ''}>🔥 Hot</option>
                                        <option value="warm" ${lead.status === 'warm' || !lead.status ? 'selected' : ''}>🌡️ Warm</option>
                                        <option value="cold" ${lead.status === 'cold' ? 'selected' : ''}>❄️ Cold</option>
                                        <option value="dead" ${lead.status === 'dead' ? 'selected' : ''}>💀 Dead</option>
                                    </select>
                                </td>
                                <td>${new Date(lead.created).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz })}</td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        } catch (e) {
            console.warn('[Dashboard] Leads load failed:', e.message);
        }
    }

    // ---- REFRESH APPOINTMENTS FEED ------------------------------------
    async function refreshAppointments() {
        if (!currentTenant) return;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(`${API_BASE}/appointments?phone_id=${encodeURIComponent(currentTenant.phone_id)}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            currentAppointments = data.appointments || [];
            
            // Re-render recent bookings table if applicable
            // (Currently dashboard.html has a dummy renderDashBookings function we can override or just let it be)
        } catch (e) {
            console.warn('[Dashboard] Appointments load failed:', e.message);
        }
    }

    // ---- AUTO-REFRESH ------------------------------------------------
    function startAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(() => {
            refreshLeads();
            refreshAppointments();
        }, 30000);
    }

    // ---- POCKETBASE REALTIME -----------------------------------------
    let pb = null;
    let pbHeartbeat = null;
    let pbConnected = false;

    function initRealtimeUpdates() {
        const pbUrl = 'https://api.yieldai.space';
        try {
            if (typeof PocketBase === 'undefined') return;
            pb = new PocketBase(pbUrl);
            pb.collection('Leads').subscribe('*', (e) => {
                if (e.action === 'create' || e.action === 'update') {
                    refreshLeads();
                    
                    // Add to live activity feed
                    const activityFeed = document.getElementById('activity-feed');
                    if (activityFeed && e.action === 'create') {
                        const leadData = e.record;
                        const time = new Date().toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});
                        const html = `
                            <div style="padding:12px;border-bottom:1px solid var(--border-l);display:flex;gap:12px;animation:fadeIn 0.5s">
                                <div style="font-size:16px">📥</div>
                                <div>
                                    <div style="font-size:12.5px;color:var(--t1)">New lead captured: <span style="font-weight:600">${escapeHtml(leadData.phone_no)}</span></div>
                                    <div style="font-size:11px;color:var(--t3);margin-top:2px">${time}</div>
                                </div>
                            </div>
                        `;
                        activityFeed.insertAdjacentHTML('afterbegin', html);
                        
                        // Also pulse the metric counter
                        const metricEl = document.getElementById('metric-leads');
                        if (metricEl) {
                            metricEl.style.color = 'var(--green)';
                            setTimeout(() => metricEl.style.color = '', 2000);
                        }
                    }
                }
            });
            pbConnected = true;
            console.log('[Dashboard] PocketBase realtime subscription active');
        } catch (e) {
            console.warn('[Dashboard] Realtime subscription failed:', e.message);
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();
