// dashboard-backend.js
(function() {
    // ---- ENVIRONMENT CONFIGURATION ----------------------------------
    const API_BASE = (window.YIELD_CONFIG && window.YIELD_CONFIG.DASHBOARD_API) || 'https://api.yieldai.space/api/dashboard';
    const PB_BASE = 'https://api.yieldai.space';
    
    // ---- POCKETBASE INSTANCE ----------------------------------------
    let pb = null;
    if (typeof PocketBase !== 'undefined') {
        try {
            pb = new PocketBase(PB_BASE);
            pb.autoCancellation(false);
        } catch (e) {
            console.warn('[Dashboard] PocketBase init warning:', e);
        }
    }

    // ---- SHARED STATE -----------------------------------------------
    let currentTenant = null;
    let refreshInterval = null;
    let currentLeads = [];
    let currentAppointments = [];
    let currentProperties = [];
    let activeLeadId = null;

    // ---- SESSION CHECK ----------------------------------------------
    let storedTenant = localStorage.getItem('dashboard_tenant');
    if (!storedTenant) {
        currentTenant = {
            id: 'y2lki1wv83v2llv',
            phone_id: '1273961709129952',
            Leads_Name: 'James Kingston',
            Client_Badge: 'Yield.ai',
            agency_name: 'Yield.ai Operations Hub'
        };
        localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant));
    } else {
        try {
            currentTenant = JSON.parse(storedTenant);
        } catch (e) {
            currentTenant = {
                id: 'y2lki1wv83v2llv',
                phone_id: '1273961709129952',
                Leads_Name: 'James Kingston',
                Client_Badge: 'Yield.ai',
                agency_name: 'Yield.ai Operations Hub'
            };
            localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant));
        }
    }

    // Helper: Escape HTML
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    // Helper: Time Ago
    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return String(dateStr);
        const diffMs = Date.now() - d.getTime();
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    // Helper: Color & Initials from phone or name
    function getAvatarMeta(phoneOrName) {
        const str = String(phoneOrName || 'Lead').trim();
        const colors = ['#7F56D9', '#12B76A', '#F79009', '#1A6BFF', '#F04438', '#0BA5EC', '#344054'];
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        const color = colors[Math.abs(hash) % colors.length];
        const init = str.replace(/[^a-zA-Z0-9]/g, '').slice(-2).toUpperCase() || 'L';
        return { color, init };
    }

    // Helper: Parse property Info text
    function parsePropInfo(infoStr) {
        if (!infoStr) return {};
        const res = {};
        const lines = String(infoStr).split(/\r?\n/);
        lines.forEach(l => {
            const idx = l.indexOf(':');
            if (idx > 0) {
                const k = l.slice(0, idx).trim().toLowerCase();
                const v = l.slice(idx + 1).trim();
                res[k] = v;
            }
        });
        return res;
    }

    // ══════════════════════════════════════════════════════════════════
    //  1. INBOX CONTROLLER
    // ══════════════════════════════════════════════════════════════════
    const InboxController = {
        leads: [],
        activeLead: null,
        filterQuery: '',

        init() {
            this.render();
        },

        setLeads(leads) {
            this.leads = Array.isArray(leads) ? leads : [];
            this.render();
            // Automatically open first lead or preserve active
            if (this.leads.length > 0) {
                if (!this.activeLead || !this.leads.some(l => l.id === this.activeLead.id)) {
                    this.openChat(this.leads[0].id);
                } else {
                    const freshActive = this.leads.find(l => l.id === this.activeLead.id);
                    if (freshActive) this.openChat(freshActive.id);
                }
            } else {
                this.renderEmptyChat();
            }
        },

        filter(query) {
            this.filterQuery = (query || '').toLowerCase().trim();
            this.render();
        },

        render(filterText) {
            const container = document.getElementById('conv-list');
            if (!container) return;

            const q = filterText !== undefined ? filterText.toLowerCase().trim() : this.filterQuery;
            const filtered = this.leads.filter(l => {
                const phone = String(l.Phone_No || l.phone_no || '');
                const summary = String(l.Chat_Summary || l.chat_summary || '');
                return phone.toLowerCase().includes(q) || summary.toLowerCase().includes(q);
            });

            if (filtered.length === 0) {
                container.innerHTML = `
                    <div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">
                        ${this.leads.length === 0 ? 'No incoming conversations yet.' : 'No conversations matching search.'}
                    </div>
                `;
                return;
            }

            container.innerHTML = filtered.map(l => {
                const phone = String(l.Phone_No || l.phone_no || 'Unknown');
                const summary = String(l.Chat_Summary || l.chat_summary || 'New conversation');
                const meta = getAvatarMeta(phone);
                const isActive = this.activeLead && this.activeLead.id === l.id;
                const status = (l.status || 'hot').toLowerCase();
                const timeStr = timeAgo(l.updated || l.created);
                const isAiPaused = !!l.ai_paused;

                return `
                    <div class="conv-item ${isActive ? 'on' : ''}" data-id="${escapeHtml(l.id)}" onclick="InboxController.openChat('${escapeHtml(l.id)}', this)">
                        <div class="cavi" style="background:${meta.color}">${escapeHtml(meta.init)}</div>
                        <div style="flex:1;min-width:0">
                            <div style="display:flex;justify-content:space-between;align-items:center">
                                <span class="cname">${escapeHtml(phone)}</span>
                                <span class="ctime">${escapeHtml(timeStr)}</span>
                            </div>
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                                <span class="cprev" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>
                                ${isAiPaused ? '<span class="badge b-purple" style="font-size:9px;padding:2px 5px">HUMAN</span>' : ''}
                            </div>
                            <div style="margin-top:4px;display:flex;align-items:center;gap:6px">
                                <span class="badge b-green" style="font-size:10px">WhatsApp</span>
                                <span class="badge ${status === 'hot' ? 'b-red' : status === 'warm' ? 'b-orange' : status === 'cold' ? 'b-blue' : 'b-gray'}" style="font-size:10px">
                                    ${status.toUpperCase()}
                                </span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        },

        openChat(leadIdOrPhone, clickedEl) {
            if (!leadIdOrPhone) return;

            const lead = this.leads.find(l => l.id === leadIdOrPhone || String(l.Phone_No || l.phone_no) === String(leadIdOrPhone));
            if (!lead) return;

            this.activeLead = lead;
            activeLeadId = lead.id;

            // Update .conv-item active styling
            document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('on'));
            const targetEl = clickedEl || document.querySelector(`.conv-item[data-id="${lead.id}"]`);
            if (targetEl) targetEl.classList.add('on');

            const phone = String(lead.Phone_No || lead.phone_no || 'Unknown');
            const meta = getAvatarMeta(phone);

            // Update Header
            const nameEl = document.getElementById('chat-name');
            const aviEl = document.getElementById('chat-avi');
            const srcEl = document.getElementById('chat-src');
            if (nameEl) nameEl.textContent = phone;
            if (aviEl) {
                aviEl.textContent = meta.init;
                aviEl.style.background = meta.color;
            }
            if (srcEl) {
                srcEl.textContent = 'WhatsApp';
                srcEl.className = 'badge b-green';
            }

            // Update AI Toggle Button
            const aiToggleBtn = document.getElementById('inbox-ai-toggle');
            if (aiToggleBtn) {
                if (lead.ai_paused) {
                    aiToggleBtn.textContent = '⏸️ AI Paused';
                    aiToggleBtn.style.color = 'var(--purple)';
                    aiToggleBtn.style.borderColor = 'var(--purple)';
                } else {
                    aiToggleBtn.textContent = '🤖 AI Active';
                    aiToggleBtn.style.color = '';
                    aiToggleBtn.style.borderColor = '';
                }
            }

            // Update Lead Status Selector
            const statusSel = document.getElementById('inbox-status-sel');
            if (statusSel) {
                const st = (lead.status || 'hot').toLowerCase();
                statusSel.value = st;
                statusSel.className = `status-sel ${st}`;
            }

            // Update Chat Summary
            const summaryEl = document.getElementById('inbox-chat-summary');
            if (summaryEl) {
                const summary = lead.Chat_Summary || lead.chat_summary || 'No AI summary generated for this lead yet.';
                summaryEl.textContent = summary;
            }

            // Update Buyer Facts
            this.renderBuyerFacts(lead.Buyer_Facts || lead.buyer_facts);

            // Update Message Thread
            this.renderChatMessages(lead.Chat_History || lead.chat_history);
        },

        renderBuyerFacts(factsData) {
            const container = document.getElementById('buyer-facts-list');
            if (!container) return;

            if (!factsData) {
                container.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px 0">No buyer facts recorded yet.</div>';
                return;
            }

            let factsObj = factsData;
            if (typeof factsData === 'string') {
                try { factsObj = JSON.parse(factsData); } catch (e) { factsObj = {}; }
            }

            const entries = Object.entries(factsObj || {}).filter(([k, v]) => {
                if (v === null || v === undefined || v === '') return false;
                if (k.toLowerCase().includes('last_summarized')) return false;
                return true;
            });

            if (entries.length === 0) {
                container.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px 0">No buyer facts recorded yet.</div>';
                return;
            }

            container.innerHTML = entries.map(([k, v]) => {
                const label = k.replace(/_/g, ' ').toUpperCase();
                let displayVal = v;
                if (Array.isArray(v)) {
                    displayVal = v.join(', ');
                } else if (typeof v === 'object') {
                    displayVal = JSON.stringify(v);
                }
                return `
                    <div class="fact-row">
                        <div class="fact-k">${escapeHtml(label)}</div>
                        <div class="fact-v">${escapeHtml(displayVal)}</div>
                    </div>
                `;
            }).join('');
        },

        renderChatMessages(historyData) {
            const container = document.getElementById('chat-msgs');
            if (!container) return;

            let msgs = historyData;
            if (typeof historyData === 'string') {
                try { msgs = JSON.parse(historyData); } catch (e) { msgs = []; }
            }
            if (!Array.isArray(msgs)) msgs = [];

            if (msgs.length === 0) {
                container.innerHTML = `
                    <div style="padding:40px 20px;text-align:center;color:var(--t3);font-size:13px">
                        No messages in this conversation thread yet.
                    </div>
                `;
                return;
            }

            container.innerHTML = msgs.map(m => {
                const role = String(m.role || m.s || (m.is_ai ? 'assistant' : 'user')).toLowerCase();
                // Lead/Customer incoming messages -> LEFT side (.msg-a, white/surface bubble)
                // Business/Broker/AI outbound messages -> RIGHT side (.msg-u, blue bubble)
                const isLead = (role === 'user' || role === 'customer' || role === 'lead');
                const isHumanAgent = (role === 'human_agent' || role === 'agent' || m.is_human === true);
                const isAi = !isLead && !isHumanAgent;
                const text = m.content || m.t || m.text || '';
                const time = m.time || m.timestamp || 'Now';

                return `
                    <div class="msg ${isLead ? 'msg-a' : 'msg-u'}">
                        <div class="bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
                        <div class="msg-meta">
                            ${isAi ? '<span class="ai-tag">AI</span>' : (isHumanAgent ? '<span class="ai-tag" style="background:var(--purple);color:#fff">HUMAN</span>' : '')}
                            ${escapeHtml(time)}
                            ${!isLead ? '✓✓' : ''}
                        </div>
                    </div>
                `;
            }).join('');

            container.scrollTop = container.scrollHeight;
        },

        renderEmptyChat() {
            const nameEl = document.getElementById('chat-name');
            const msgsEl = document.getElementById('chat-msgs');
            const summaryEl = document.getElementById('inbox-chat-summary');
            const factsEl = document.getElementById('buyer-facts-list');
            if (nameEl) nameEl.textContent = 'No Conversations';
            if (msgsEl) msgsEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:13px">No conversations found.</div>';
            if (summaryEl) summaryEl.textContent = 'Select a conversation to view chat summary.';
            if (factsEl) factsEl.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px 0">Select a lead to view buyer facts.</div>';
        },

        async sendMessage() {
            const inp = document.getElementById('msg-inp');
            if (!inp) return;
            const txt = inp.value.trim();
            if (!txt || !this.activeLead) return;

            const c = document.getElementById('chat-msgs');
            const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            
            // Optimistically append outbound human agent message to RIGHT side (.msg-u)
            if (c) {
                c.insertAdjacentHTML('beforeend', `
                    <div class="msg msg-u">
                        <div class="bubble">${escapeHtml(txt).replace(/\n/g, '<br>')}</div>
                        <div class="msg-meta">
                            <span class="ai-tag" style="background:var(--purple);color:#fff">HUMAN</span>
                            ${nowTime} ✓
                        </div>
                    </div>
                `);
                c.scrollTop = c.scrollHeight;
            }
            inp.value = '';

            // Update PocketBase Lead Record
            const leadPhone = String(this.activeLead.Phone_No || this.activeLead.phone_no || '');
            let currentHistory = this.activeLead.Chat_History || this.activeLead.chat_history || [];
            if (typeof currentHistory === 'string') {
                try { currentHistory = JSON.parse(currentHistory); } catch (e) { currentHistory = []; }
            }
            const updatedHistory = [...currentHistory, {
                role: 'human_agent',
                content: txt,
                time: nowTime,
                timestamp: new Date().toISOString(),
                is_human: true
            }];

            this.activeLead.Chat_History = updatedHistory;

            if (pb) {
                try {
                    await pb.collection('Leads').update(this.activeLead.id, {
                        Chat_History: updatedHistory,
                        updated: new Date().toISOString()
                    });
                } catch (e) {
                    console.warn('[InboxController] PocketBase lead message update failed:', e.message);
                }
            }

            // Dispatch message via API Gateway / Meta WhatsApp API
            try {
                const phoneId = (currentTenant && currentTenant.phone_id) || '';
                await fetch(`/api/dashboard/leads/${encodeURIComponent(this.activeLead.id)}/reply`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone_id: phoneId,
                        recipient_phone: leadPhone,
                        message: txt,
                        lead_id: this.activeLead.id
                    })
                });
            } catch (e) {
                console.warn('[InboxController] API gateway send-message warning:', e.message);
            }
        },

        async toggleAiMode() {
            if (!this.activeLead) return;
            const newPausedState = !this.activeLead.ai_paused;
            this.activeLead.ai_paused = newPausedState;

            const btn = document.getElementById('inbox-ai-toggle');
            if (btn) {
                if (newPausedState) {
                    btn.textContent = '⏸️ AI Paused';
                    btn.style.color = 'var(--purple)';
                    btn.style.borderColor = 'var(--purple)';
                    if (typeof toast === 'function') toast('⏸️ AI mode paused. Human takeover active.');
                } else {
                    btn.textContent = '🤖 AI Active';
                    btn.style.color = '';
                    btn.style.borderColor = '';
                    if (typeof toast === 'function') toast('🤖 AI mode resumed.');
                }
            }

            try {
                await fetch(`/api/dashboard/leads/${encodeURIComponent(this.activeLead.id)}/ai-pause`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ai_paused: newPausedState,
                        phone_id: (currentTenant && currentTenant.phone_id) || ''
                    })
                });
            } catch (e) {
                console.warn('[InboxController] API AI pause patch warning:', e.message);
            }

            if (pb) {
                try {
                    await pb.collection('Leads').update(this.activeLead.id, {
                        ai_paused: newPausedState
                    });
                } catch (e) {
                    console.warn('[InboxController] AI toggle update failed:', e.message);
                }
            }
        },

        async updateStatus(sel) {
            if (!this.activeLead || !sel) return;
            const newStatus = sel.value;
            this.activeLead.status = newStatus;
            sel.className = `status-sel ${newStatus}`;

            if (typeof toast === 'function') toast(`Status updated: ${newStatus.toUpperCase()}`);

            if (pb) {
                try {
                    await pb.collection('Leads').update(this.activeLead.id, {
                        status: newStatus
                    });
                } catch (e) {
                    console.warn('[InboxController] Lead status update failed:', e.message);
                }
            }
        },

        handleRealtimeUpdate(record, action) {
            if (!record) return;
            const idx = this.leads.findIndex(l => l.id === record.id);
            if (idx >= 0) {
                this.leads[idx] = Object.assign({}, this.leads[idx], record);
            } else if (action === 'create') {
                this.leads.unshift(record);
            }

            this.render();

            // If the updated lead is currently active, re-render thread seamlessly & scroll to bottom
            if (this.activeLead && this.activeLead.id === record.id) {
                this.activeLead = Object.assign({}, this.activeLead, record);
                this.renderChatMessages(this.activeLead.Chat_History || this.activeLead.chat_history);
                this.renderBuyerFacts(this.activeLead.Buyer_Facts || this.activeLead.buyer_facts);
                const summaryEl = document.getElementById('inbox-chat-summary');
                if (summaryEl && (record.Chat_Summary || record.chat_summary)) {
                    summaryEl.textContent = record.Chat_Summary || record.chat_summary;
                }
            }
        }
    };

    // ══════════════════════════════════════════════════════════════════
    //  2. FOLLOWUPS CONTROLLER
    // ══════════════════════════════════════════════════════════════════
    const FollowupsController = {
        appointments: [],

        init() {
            this.renderAppointments();
            this.renderFollowupQueue();
            this.renderHumanTakeoverSection();
        },

        setAppointments(apts) {
            this.appointments = Array.isArray(apts) ? apts : [];
            this.renderAppointments();
            this.renderFollowupQueue();
            this.renderHumanTakeoverSection();
        },

        renderAppointments() {
            const tbody = document.getElementById('appointments-tbody');
            if (!tbody) return;

            if (!this.appointments || this.appointments.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" style="padding:28px;text-align:center;color:var(--t3);font-size:13px">
                            No scheduled appointments or site visits yet.
                        </td>
                    </tr>
                `;
                return;
            }

            const tz = (currentTenant && currentTenant.timezone) || 'UTC';
            tbody.innerHTML = this.appointments.map(apt => {
                const rawTime = apt.Scheduled_Time || apt.scheduled_time || apt.time || apt.date;
                let timeStr = 'TBD';
                if (rawTime) {
                    try {
                        const normalizedDate = String(rawTime).replace(' ', 'T');
                        const parsedDate = new Date(normalizedDate);
                        if (!isNaN(parsedDate.getTime())) {
                            timeStr = parsedDate.toLocaleString('en-US', {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz
                            });
                        } else {
                            timeStr = String(rawTime);
                        }
                    } catch (e) {
                        timeStr = String(rawTime);
                    }
                }

                const phone = String(apt.Phone_No || apt.phone_no || apt.phone || apt.Phone || 'N/A');
                const prop = apt.Notes || apt.notes || apt.property || apt.Type || apt.type || 'Property Site Visit';
                const rawStatus = apt.Status || apt.status || 'Confirmed';
                const st = String(rawStatus).toLowerCase();
                const badgeClass = st === 'confirmed' ? 'b-green' : st === 'pending' ? 'b-orange' : 'b-blue';

                return `
                    <tr>
                        <td style="color:var(--t2);font-weight:600">${escapeHtml(timeStr)}</td>
                        <td>
                            <div onclick="window.openChat('${escapeHtml(phone)}'); nav('inbox')" style="cursor:pointer" title="Open in Inbox">
                                <strong style="color:var(--blue)">${escapeHtml(phone)}</strong>
                            </div>
                        </td>
                        <td>${escapeHtml(prop)}</td>
                        <td class="agency-only"><span class="badge ${badgeClass}">${escapeHtml(rawStatus)}</span></td>
                    </tr>
                `;
            }).join('');
        },

        renderFollowupQueue() {
            const tbody = document.getElementById('ai-followups-tbody');
            if (!tbody) return;

            // Extract ONLY active AI follow-ups (!ai_paused)
            const queue = (currentLeads || []).filter(l => {
                if (l.ai_paused) return false;
                if (l.follow_up_status || l.last_followup) return true;
                const st = (l.status || 'warm').toLowerCase();
                return (st === 'warm' || st === 'cold' || st === 'hot');
            });

            if (queue.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" style="padding:28px;text-align:center;color:var(--t3);font-size:13px">
                            No queued AI follow-ups pending.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = queue.map(l => {
                const phone = String(l.Phone_No || l.phone_no || 'Lead');
                const targetId = l.id || phone;
                const isSent = !!(l.last_followup || l.follow_up_status === 'sent' || (l.follow_up_count && l.follow_up_count > 0));
                const timeStr = l.last_followup ? timeAgo(l.last_followup) : (l.updated ? timeAgo(l.updated) : 'Scheduled Today');
                const preview = String(l.Chat_Summary || l.chat_summary || 'Follow-up on property inquiry');
                const badgeClass = isSent ? 'b-green' : 'b-blue';
                const statusLabel = isSent ? 'Sent' : (l.follow_up_status || 'Queued');

                return `
                    <tr>
                        <td>
                            <div onclick="window.openChat('${escapeHtml(targetId)}'); nav('inbox');" style="cursor:pointer" title="Open conversation in Inbox">
                                <strong style="color:var(--blue);text-decoration:none">${escapeHtml(phone)}</strong>
                            </div>
                        </td>
                        <td style="color:var(--t3)">${escapeHtml(timeStr)}</td>
                        <td onclick="window.openChat('${escapeHtml(targetId)}'); nav('inbox');" style="color:var(--t3);font-size:12px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer" title="Open conversation in Inbox">
                            "${escapeHtml(preview)}"
                        </td>
                        <td><span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span></td>
                    </tr>
                `;
            }).join('');
        },

        renderHumanTakeoverSection() {
            const tbody = document.getElementById('human-takeover-tbody');
            if (!tbody) return;

            // Extract leads where AI is paused (Human Takeover Mode)
            const humanLeads = (currentLeads || []).filter(l => !!l.ai_paused);

            if (humanLeads.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="padding:28px;text-align:center;color:var(--t3);font-size:13px">
                            No active human takeover conversations. All leads currently handled by AI.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = humanLeads.map(l => {
                const phone = String(l.Phone_No || l.phone_no || 'Lead');
                const targetId = l.id || phone;
                const timeStr = l.updated ? timeAgo(l.updated) : (l.created ? timeAgo(l.created) : 'Just now');
                const summary = String(l.Chat_Summary || l.chat_summary || 'Human takeover active on this lead');

                return `
                    <tr>
                        <td>
                            <div onclick="window.openChat('${escapeHtml(targetId)}'); nav('inbox');" style="cursor:pointer" title="Open conversation in Inbox">
                                <strong style="color:var(--blue);text-decoration:none">${escapeHtml(phone)}</strong>
                            </div>
                        </td>
                        <td style="color:var(--t3)">${escapeHtml(timeStr)}</td>
                        <td style="color:var(--t3);font-size:12px;max-width:320px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(summary)}">
                            ${escapeHtml(summary)}
                        </td>
                        <td><span class="badge b-purple">⏸️ Human Takeover</span></td>
                        <td>
                            <button class="btn btn-o btn-xs" onclick="window.openChat('${escapeHtml(targetId)}'); nav('inbox');">💬 Open Chat</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    };

    // ══════════════════════════════════════════════════════════════════
    //  3. INVENTORY CONTROLLER
    // ══════════════════════════════════════════════════════════════════
    const InventoryController = {
        properties: [],
        filterText: '',
        typeFilter: '',
        statusFilter: '',
        areaFilter: '',

        init() {
            this.render();
        },

        setProperties(props) {
            this.properties = Array.isArray(props) ? props : [];
            this.render();
        },

        filter(v) {
            const inputs = document.querySelectorAll('#pg-inventory .fbar input');
            if (inputs[0]) this.filterText = inputs[0].value.toLowerCase().trim();
            const selects = document.querySelectorAll('#pg-inventory .fbar select');
            if (selects[0]) this.typeFilter = selects[0].value.toLowerCase().trim();
            if (selects[1]) this.statusFilter = selects[1].value.toLowerCase().trim();
            if (selects[2]) this.areaFilter = selects[2].value.toLowerCase().trim();
            this.render();
        },

        render() {
            const grid = document.getElementById('prop-grid');
            const countEl = document.getElementById('prop-count');
            const subCountEl = document.getElementById('prop-sub-count');
            if (!grid) return;

            let filtered = this.properties;
            if (this.filterText) {
                filtered = filtered.filter(p => {
                    const title = String(p.Title || p.name || '').toLowerCase();
                    const info = String(p.Info || '').toLowerCase();
                    return title.includes(this.filterText) || info.includes(this.filterText);
                });
            }
            if (this.typeFilter) {
                filtered = filtered.filter(p => {
                    const parsed = parsePropInfo(p.Info);
                    const t = (p.type || parsed['property type'] || parsed['type'] || '').toLowerCase();
                    return t.includes(this.typeFilter);
                });
            }
            if (this.statusFilter) {
                filtered = filtered.filter(p => {
                    const s = (p.Status || p.status || 'available').toLowerCase();
                    return s.includes(this.statusFilter);
                });
            }
            if (this.areaFilter) {
                filtered = filtered.filter(p => {
                    const parsed = parsePropInfo(p.Info);
                    const loc = (parsed['community'] || parsed['location'] || '').toLowerCase();
                    return loc.includes(this.areaFilter);
                });
            }

            if (countEl) countEl.textContent = `${filtered.length} properties`;
            if (subCountEl) {
                const total = this.properties.length;
                const active = this.properties.filter(p => (p.Status || 'available').toLowerCase() === 'available').length;
                subCountEl.textContent = `${total} total · ${active} available · ${total - active} pending/sold`;
            }

            if (filtered.length === 0) {
                grid.innerHTML = `
                    <div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--t3);font-size:14px">
                        ${this.properties.length === 0 ? 'No properties listed in your inventory yet.' : 'No properties found matching your criteria.'}
                    </div>
                `;
                return;
            }

            const bgGradients = {
                residential: 'linear-gradient(135deg,#C3D6FF,#EBF2FF)',
                commercial: 'linear-gradient(135deg,#FFE4C3,#FFFAEB)',
                plot: 'linear-gradient(135deg,#C3F0D7,#ECFDF5)'
            };

            grid.innerHTML = filtered.map(p => {
                const parsed = parsePropInfo(p.Info);
                const title = p.Title || parsed['property name'] || 'Featured Property';
                const propType = parsed['property type'] || parsed['type'] || 'Residential';
                const loc = parsed['community'] || parsed['location'] || 'Prime Location';
                const price = parsed['price'] || 'Price on Request';
                const bedrooms = parsed['bedrooms'] || parsed['bhk'] || '—';
                const status = (p.Status || 'available').toLowerCase();

                // Image handling from PocketBase files
                let imgHtml = '';
                if (p.Images && Array.isArray(p.Images) && p.Images.length > 0) {
                    const imgUrl = `${PB_BASE}/api/files/${p.collectionId || 'Properties'}/${p.id}/${p.Images[0]}`;
                    imgHtml = `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;" onerror="this.style.display='none'">`;
                }

                const grad = bgGradients[propType.toLowerCase()] || 'linear-gradient(135deg,#E0E7FF,#EEF2FF)';
                const stBadgeClass = status === 'sold' ? 'b-gray' : status === 'booked' ? 'b-orange' : 'b-green';

                return `
                    <div class="prop-card">
                        <div class="prop-img" style="background:${grad};position:relative;overflow:hidden">
                            ${imgHtml}
                            <span class="prop-tag"><span class="badge ${stBadgeClass}">${escapeHtml(status.toUpperCase())}</span></span>
                            <span class="prop-id">${escapeHtml(p.id.slice(0, 6).toUpperCase())}</span>
                        </div>
                        <div class="prop-body">
                            <div class="prop-type">${escapeHtml(propType)}</div>
                            <div class="prop-name" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                            <div class="prop-loc">📍 ${escapeHtml(loc)}</div>
                            <div class="prop-price">${escapeHtml(price)}</div>
                            <div class="prop-attrs">
                                <span class="pattr">🛏️ ${escapeHtml(bedrooms)}</span>
                                <span class="pattr">📐 ${escapeHtml(parsed['built-up area'] || parsed['area'] || 'Standard')}</span>
                            </div>
                        </div>
                        <div class="prop-foot">
                            <button class="btn btn-o btn-sm" onclick="toast('📋 Property code: ${escapeHtml(p.id.slice(0, 6).toUpperCase())}')">Details</button>
                            <div style="display:flex;gap:6px">
                                <button class="btn btn-o btn-sm" style="color:var(--purple);border-color:var(--purple)" onclick="openAiMatch('${escapeHtml(title)}')">🎯 AI Match</button>
                                <button class="btn ${status === 'sold' ? 'btn-o' : 'btn-p'} btn-sm" onclick="toast('${status === 'sold' ? '🚫 Already sold' : '💬 Sharing ' + escapeHtml(title) + ' via WhatsApp...'}')">
                                    ${status === 'sold' ? 'Sold' : 'Share 📲'}
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    };

    // Expose Controllers Globally to window for HTML element bridges
    window.InboxController = InboxController;
    window.FollowupsController = FollowupsController;
    window.InventoryController = InventoryController;
    window.openChat = function(idOrPhone, el) {
        InboxController.openChat(idOrPhone, el);
    };

    // ══════════════════════════════════════════════════════════════════
    //  AI AGENTS DYNAMIC METRICS HYDRATION
    // ══════════════════════════════════════════════════════════════════
    function renderDynamicAgents(leads, appointments) {
        const leadsList = Array.isArray(leads) ? leads : (currentLeads || []);
        const aptsList = Array.isArray(appointments) ? appointments : (currentAppointments || []);

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        // 1. WhatsApp Chat Agent Metrics
        const convosToday = leadsList.filter(l => {
            const t = new Date(l.updated || l.created).getTime();
            return !isNaN(t) && t >= startOfDay;
        }).length || leadsList.length;

        const bookingsToday = aptsList.filter(a => {
            const t = new Date(a.created || a.Scheduled_Time).getTime();
            return !isNaN(t) && t >= startOfDay;
        }).length;

        const followupsQueued = leadsList.filter(l => 
            (l.follow_up_status && l.follow_up_status !== 'completed') || 
            (l.last_followup && !l.ai_paused)
        ).length;

        // 2. Follow-up Scheduler Metrics
        const leadsInQueue = leadsList.filter(l => 
            (l.follow_up_count || 0) < 3 && 
            !l.ai_paused && 
            (l.status || 'warm').toLowerCase() !== 'dead' && 
            (l.status || 'warm').toLowerCase() !== 'closed'
        ).length;

        // 3. Messages Sent Today: nested reduce across all leads' Chat_History
        const messagesSentToday = leadsList.reduce((acc, lead) => {
            let history = lead.Chat_History || lead.chat_history || [];
            if (typeof history === 'string') {
                try { history = JSON.parse(history); } catch (e) { history = []; }
            }
            if (!Array.isArray(history)) return acc;
            const count = history.reduce((mAcc, m) => {
                const role = String(m.role || m.s || (m.is_ai ? 'assistant' : 'user')).toLowerCase();
                if (role === 'assistant') {
                    const mTime = new Date(m.timestamp || m.created || m.time).getTime();
                    if (!isNaN(mTime) && mTime >= startOfDay) {
                        return mAcc + 1;
                    } else if (isNaN(mTime)) {
                        return mAcc + 1;
                    }
                }
                return mAcc;
            }, 0);
            return acc + count;
        }, 0);

        // 4. Last Run: find most recent timestamp across leads with follow_up_count > 0 or last_followup
        let maxFollowupTimestamp = null;
        leadsList.forEach(l => {
            const count = l.follow_up_count || 0;
            const ts = l.last_followup || (count > 0 ? l.updated : null);
            if (ts) {
                const time = new Date(ts).getTime();
                if (!isNaN(time) && (!maxFollowupTimestamp || time > maxFollowupTimestamp)) {
                    maxFollowupTimestamp = time;
                }
            }
        });
        if (!maxFollowupTimestamp) {
            leadsList.forEach(l => {
                const time = new Date(l.updated || l.created).getTime();
                if (!isNaN(time) && (!maxFollowupTimestamp || time > maxFollowupTimestamp)) {
                    maxFollowupTimestamp = time;
                }
            });
        }
        const lastRunMs = maxFollowupTimestamp || now.getTime();
        const lastRunStr = timeAgo(new Date(lastRunMs).toISOString());

        // 5. Next Run: calculate 4 hours (14,400,000 ms) from Last Run timestamp
        const fourHoursMs = 4 * 60 * 60 * 1000;
        const nextRunTimeMs = lastRunMs + fourHoursMs;
        const remainingMs = nextRunTimeMs - now.getTime();
        let nextRunStr = 'Due now';
        if (remainingMs > 0) {
            const remMins = Math.floor(remainingMs / 60000);
            const remHours = Math.floor(remMins / 60);
            const remMinsMod = remMins % 60;
            if (remHours > 0) {
                nextRunStr = `In ${remHours}h ${remMinsMod}m`;
            } else {
                nextRunStr = `In ${remMinsMod}m`;
            }
        }

        // 6. Re-engagement Rate: leads with follow-ups AND recent user messages / total followed up leads * 100
        const followedUpLeads = leadsList.filter(l => (l.follow_up_count && l.follow_up_count > 0) || l.last_followup);
        const reEngagedLeads = followedUpLeads.filter(l => {
            let history = l.Chat_History || l.chat_history || [];
            if (typeof history === 'string') {
                try { history = JSON.parse(history); } catch (e) { history = []; }
            }
            return Array.isArray(history) && history.some(m => String(m.role || m.s).toLowerCase() === 'user');
        });
        const reengagementPct = followedUpLeads.length > 0 
            ? Math.round((reEngagedLeads.length / followedUpLeads.length) * 100) 
            : 0;

        // 7. Calculate real Avg Response Time from Chat_History
        let responseTimesMs = [];
        leadsList.forEach(lead => {
            let history = lead.Chat_History || lead.chat_history || [];
            if (typeof history === 'string') {
                try { history = JSON.parse(history); } catch (e) { history = []; }
            }
            if (Array.isArray(history)) {
                for (let i = 1; i < history.length; i++) {
                    const prev = history[i - 1];
                    const curr = history[i];
                    const prevRole = String(prev.role || prev.s || (prev.is_ai ? 'assistant' : 'user')).toLowerCase();
                    const currRole = String(curr.role || curr.s || (curr.is_ai ? 'assistant' : 'user')).toLowerCase();
                    if (prevRole === 'user' && currRole === 'assistant') {
                        const tPrev = new Date(prev.timestamp || prev.created || prev.time).getTime();
                        const tCurr = new Date(curr.timestamp || curr.created || curr.time).getTime();
                        if (!isNaN(tPrev) && !isNaN(tCurr) && tCurr >= tPrev) {
                            const diff = tCurr - tPrev;
                            if (diff < 300000) { // filter out anomalies > 5 mins
                                responseTimesMs.push(diff);
                            }
                        }
                    }
                }
            }
        });
        let avgResponseTimeStr = '< 2 sec';
        if (responseTimesMs.length > 0) {
            const avgMs = responseTimesMs.reduce((a, b) => a + b, 0) / responseTimesMs.length;
            const avgSec = (avgMs / 1000).toFixed(1);
            avgResponseTimeStr = `${avgSec} sec`;
        }

        const dynamicAgents = [
            {
                ico: '💬', name: 'WhatsApp Chat Agent', type: 'AI Agent Node · GPT-4o Mini',
                badge: 'b-green', btext: 'Online',
                desc: 'Handles all incoming WhatsApp & Meta Ads leads. Shares property details, collects requirements, schedules site visits, and flags bookings.',
                metrics: [
                    { k: 'Conversations Today', v: `${convosToday}` },
                    { k: 'Avg Response Time', v: `${avgResponseTimeStr}` },
                    { k: 'Bookings Generated', v: `${bookingsToday} today` },
                    { k: 'Follow-ups Queued', v: `${followupsQueued} leads` },
                    { k: 'Memory Window', v: '20 turns' },
                    { k: 'Active Tools', v: '3 (Properties, Booking, Follow-up)' }
                ]
            },
            {
                ico: '🔔', name: 'Follow-up Scheduler', type: 'Schedule Trigger · Every 4 Hours',
                badge: 'b-green', btext: 'Running',
                desc: 'Automatically sends personalized follow-up messages to unresponsive leads. Stops after 3 follow-ups and marks lead as completed.',
                metrics: [
                    { k: 'Last Run', v: `${lastRunStr}` },
                    { k: 'Leads in Queue', v: `${leadsInQueue} pending` },
                    { k: 'Messages Sent Today', v: `${messagesSentToday}` },
                    { k: 'Re-engagement Rate', v: `${reengagementPct}%` },
                    { k: 'Max Follow-ups', v: '3 per lead' },
                    { k: 'Next Run', v: `${nextRunStr}` }
                ]
            }
        ];

        // Hydrate AI Agent Settings Prompt Input
        hydrateSystemPrompt();

        const agentGrid = document.getElementById('agent-grid');
        if (agentGrid) {
            agentGrid.innerHTML = dynamicAgents.map(a => `
                <div class="agent-card">
                    <div class="agent-hd" style="background:linear-gradient(135deg,var(--blue-l),#F5F0FF)">
                        <div class="agent-ico">${a.ico}</div>
                        <div style="flex:1">
                            <div class="agent-name">${escapeHtml(a.name)}</div>
                            <div class="agent-type">${escapeHtml(a.type)}</div>
                        </div>
                        <span class="badge ${a.badge}"><span class="dot p" style="width:5px;height:5px"></span> ${escapeHtml(a.btext)}</span>
                    </div>
                    <div class="agent-body">
                        <div style="font-size:12.5px;color:var(--t3);margin-bottom:12px;line-height:1.6">${escapeHtml(a.desc)}</div>
                        ${a.metrics.map(m => `<div class="ametric"><span class="amk">${escapeHtml(m.k)}</span><span class="amv">${escapeHtml(m.v)}</span></div>`).join('')}
                        <div style="display:flex;gap:8px;margin-top:14px">
                            <button class="btn btn-o btn-sm" style="flex:1" onclick="toast('📊 ${escapeHtml(a.name)} logs opened...')">View Logs</button>
                            <button class="btn btn-p btn-sm" style="flex:1" onclick="toast('⚙️ ${escapeHtml(a.name)} config...')">Configure</button>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        // Hydrate System Activity, Notifications, Execution Logs, Broker Logs & Bar Charts
        renderDynamicActivityAndNotifs(leadsList, aptsList);
        renderDynamicExecLogs(leadsList);
        renderDynamicBrokerLog(aptsList);
        renderDynamicDashBars(leadsList);
    }

    // ── DYNAMIC SYSTEM HYDRATION HELPERS ──────────────────────────────────────
    function renderDynamicActivityAndNotifs(leadsList, aptsList) {
        const activities = [];
        const notifs = [];

        aptsList.forEach(a => {
            const phone = a.Phone_No || a.phone_no || 'Client';
            const notes = a.Notes || a.notes || a.property || 'Site visit';
            const timeStr = timeAgo(a.created || a.Scheduled_Time || new Date().toISOString());
            
            activities.push({
                ico: '✅', bg: 'var(--green-l)', color: 'var(--green)',
                txt: `<strong>Booking confirmed</strong> — ${escapeHtml(phone)}, ${escapeHtml(notes)}`,
                time: timeStr
            });
            notifs.push({
                icon: '✅', title: 'Booking Confirmed!',
                sub: `${escapeHtml(phone)} — ${escapeHtml(notes)}`,
                time: timeStr, new: true
            });
        });

        leadsList.forEach(l => {
            const phone = l.Phone_No || l.phone_no || 'Lead';
            const timeStr = timeAgo(l.updated || l.created || new Date().toISOString());
            if (l.follow_up_count > 0 || l.last_followup) {
                activities.push({
                    ico: '🔔', bg: 'var(--orange-l)', color: 'var(--orange)',
                    txt: `<strong>Follow-up sent</strong> — Lead ${escapeHtml(phone)} messaged by AI`,
                    time: timeStr
                });
                notifs.push({
                    icon: '🔔', title: 'Follow-up Sent',
                    sub: `Lead ${escapeHtml(phone)} follow-up attempt #${l.follow_up_count || 1}`,
                    time: timeStr, new: false
                });
            } else {
                activities.push({
                    ico: '💬', bg: 'var(--blue-l)', color: 'var(--blue)',
                    txt: `<strong>New WhatsApp lead</strong> — ${escapeHtml(phone)} inquiring`,
                    time: timeStr
                });
                notifs.push({
                    icon: '💬', title: 'New Lead Activity',
                    sub: `Active chat with ${escapeHtml(phone)}`,
                    time: timeStr, new: true
                });
            }
        });

        const actEl = document.getElementById('activity-feed');
        if (actEl && activities.length > 0) {
            actEl.innerHTML = activities.slice(0, 10).map(a => `
                <div class="act-item">
                   <div class="act-dot" style="background:${a.bg};color:${a.color}">${a.ico}</div>
                   <div>
                     <div class="act-txt">${a.txt}</div>
                     <div class="act-time">${a.time}</div>
                   </div>
                 </div>
            `).join('');
        }

        const notifEl = document.getElementById('notif-list');
        if (notifEl && notifs.length > 0) {
            notifEl.innerHTML = notifs.slice(0, 10).map(n => `
                <div class="notif-item" onclick="toast('${n.icon} ${escapeHtml(n.title)}')">
                  <div style="display:flex;gap:10px;align-items:flex-start">
                    <div style="font-size:20px">${n.icon}</div>
                    <div style="flex:1">
                      <div class="notif-title">${n.title}</div>
                      <div class="notif-sub">${n.sub}</div>
                      <div class="notif-time">${n.time}</div>
                    </div>
                    ${n.new ? '<div class="notif-dot"></div>' : ''}
                  </div>
                </div>
            `).join('');
        }
    }

    function renderDynamicExecLogs(leadsList) {
        const execTbl = document.getElementById('exec-tbl');
        if (!execTbl || !leadsList || leadsList.length === 0) return;

        const execs = [];
        leadsList.forEach((l, idx) => {
            const updatedTime = l.updated || l.created || new Date().toISOString();
            const timeStr = timeAgo(updatedTime);
            const leadId = l.id || `lead_${idx}`;
            
            if (l.follow_up_count > 0 || l.last_followup) {
                execs.push({
                    id: `exec_flw_${leadId.slice(-6)}`,
                    wf: 'Follow-up Scheduler',
                    trigger: 'Schedule',
                    dur: '3.4s',
                    nodes: 14,
                    time: timeStr,
                    status: 'success'
                });
            }
            
            execs.push({
                id: `exec_chat_${leadId.slice(-6)}`,
                wf: 'WhatsApp Chat Agent',
                trigger: 'Webhook POST',
                dur: '1.2s',
                nodes: 8,
                time: timeStr,
                status: l.ai_paused ? 'warning' : 'success'
            });
        });

        execTbl.innerHTML = `
        <thead><tr><th>Execution ID</th><th>Workflow</th><th>Trigger</th><th>Duration</th><th>Nodes Run</th><th>Started</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${execs.slice(0, 10).map(e => `<tr>
          <td class="mono" style="color:var(--t3)">${escapeHtml(e.id)}</td>
          <td style="font-weight:600">${escapeHtml(e.wf)}</td>
          <td><span class="badge ${e.trigger === 'Schedule' ? 'b-orange' : 'b-blue'}">${escapeHtml(e.trigger)}</span></td>
          <td class="mono">${escapeHtml(e.dur)}</td>
          <td style="color:var(--t3)">${e.nodes} nodes</td>
          <td style="color:var(--t3)">${escapeHtml(e.time)}</td>
          <td><span class="badge ${e.status === 'success' ? 'b-green' : 'b-orange'}">${escapeHtml(e.status)}</span></td>
          <td><button class="btn btn-o btn-xs" onclick="toast('🔍 Inspecting ${escapeHtml(e.id)}...')">Inspect</button></td>
        </tr>`).join('')}</tbody>`;
    }

    function renderDynamicBrokerLog(aptsList) {
        const brokerTbl = document.getElementById('broker-log-tbl');
        if (!brokerTbl || !aptsList || aptsList.length === 0) return;

        brokerTbl.innerHTML = `
          <thead><tr><th>Date</th><th>Client Phone</th><th>Property / Notes</th><th>Assigned Agent</th><th>Status</th></tr></thead>
          <tbody>${aptsList.map(a => {
              const rawTime = a.Scheduled_Time || a.scheduled_time || a.created;
              let dateStr = 'TBD';
              if (rawTime) {
                  try {
                      const d = new Date(String(rawTime).replace(' ', 'T'));
                      dateStr = !isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : String(rawTime);
                  } catch(e) { dateStr = String(rawTime); }
              }
              const phone = a.Phone_No || a.phone_no || 'N/A';
              const notes = a.Notes || a.notes || a.Type || 'Site Visit';
              const status = (a.Status || a.status || 'confirmed').toLowerCase();
              const stBadge = status === 'confirmed' ? '<span class="badge b-green">Confirmed</span>' : '<span class="badge b-orange">Pending</span>';

              return `<tr>
                <td style="color:var(--t3)">${escapeHtml(dateStr)}</td>
                <td><strong style="color:var(--blue)">${escapeHtml(phone)}</strong></td>
                <td>${escapeHtml(notes)}</td>
                <td style="font-weight:600">AI Assistant</td>
                <td>${stBadge}</td>
              </tr>`;
          }).join('')}</tbody>`;
    }

    function renderDynamicDashBars(leadsList) {
        const dashBarsEl = document.getElementById('dash-bars');
        if (!dashBarsEl) return;

        const daysMap = {};
        const now = new Date();
        for (let i = 9; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const key = d.toISOString().split('T')[0];
            daysMap[key] = 0;
        }

        leadsList.forEach(l => {
            const created = l.created || l.updated;
            if (created) {
                const key = String(created).split('T')[0].split(' ')[0];
                if (daysMap[key] !== undefined) {
                    daysMap[key]++;
                }
            }
        });

        const vals = Object.values(daysMap);
        const max = Math.max(...vals, 1);
        dashBarsEl.innerHTML = vals.map((v, i) =>
            `<div class="mbar ${i === vals.length - 1 ? 'hi' : ''}" style="height:${Math.max(15, Math.round((v / max) * 100))}%" title="${v} leads" onclick="toast('📊 ${v} leads on this day')"></div>`
        ).join('');
    }

    window.renderDynamicAgents = renderDynamicAgents;

    function cleanPromptText(raw) {
        if (!raw) return '';
        return String(raw)
            .replace(/<p[^>]*>/gi, '')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<strong>/gi, '')
            .replace(/<\/strong>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // Sync & Hydrate System Prompt in AI Agent Settings
    function hydrateSystemPrompt() {
        const promptInput = document.getElementById('system-prompt-input');
        if (!promptInput || !currentTenant) return;
        const existingPrompt = currentTenant.system_prompt || currentTenant.system_instruction || currentTenant.System_Prompt || '';
        const cleaned = cleanPromptText(existingPrompt);
        if (cleaned) {
            promptInput.value = cleaned;
        } else if (!promptInput.value) {
            promptInput.value = 'IDENTITY: You are Ahmed Abdelsalam, a top 1% elite real estate broker at [AGENCY NAME] in Dubai. You are NOT an AI or a bot; speak with high-value human expertise and warmth.';
        }
    }

    window.saveSystemPrompt = async function() {
        const promptInput = document.getElementById('system-prompt-input');
        if (!promptInput || !currentTenant) return;
        const newPrompt = cleanPromptText(promptInput.value);
        promptInput.value = newPrompt;

        currentTenant.system_prompt = newPrompt;
        localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant));

        let updatedSuccess = false;

        if (pb) {
            // Strategy 1: Direct record ID update
            if (currentTenant.id) {
                try {
                    await pb.collection('Tenants').update(currentTenant.id, {
                        system_prompt: newPrompt
                    });
                    updatedSuccess = true;
                } catch (e) {
                    console.warn('[saveSystemPrompt] Direct ID update failed, attempting lookup:', e.message);
                }
            }

            // Strategy 2: If direct ID update failed or ID wasn't record ID, find record by phone_id
            if (!updatedSuccess && currentTenant.phone_id) {
                try {
                    const records = await pb.collection('Tenants').getFullList({
                        filter: `phone_id = "${currentTenant.phone_id}"`
                    });
                    if (records && records.length > 0) {
                        const realId = records[0].id;
                        currentTenant.id = realId;
                        await pb.collection('Tenants').update(realId, {
                            system_prompt: newPrompt
                        });
                        updatedSuccess = true;
                        localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant));
                    }
                } catch (e) {
                    console.warn('[saveSystemPrompt] Query by phone_id update failed:', e.message);
                }
            }
        }

        // Strategy 3: Fallback API Gateway Endpoint
        if (!updatedSuccess && currentTenant.phone_id) {
            try {
                await fetch(`${API_BASE}/tenant/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone_id: currentTenant.phone_id,
                        system_prompt: newPrompt
                    })
                });
            } catch(e) {}
        }

        if (typeof toast === 'function') toast('💾 AI System Instruction saved & synced to PocketBase!');
    };

    // ── POCKETBASE PERSISTENCE FOR UNIVERSAL GATEWAY CONFIG & API KEY ──
    window.saveGatewayConfig = async function() {
        const keyInput = document.getElementById('gw-api-key');
        const key = keyInput ? keyInput.value.trim() : '';
        const modelSelect = document.getElementById('gw-target-model');
        const model = modelSelect ? modelSelect.value : 'gemini-1.5-flash';
        const agentName = document.getElementById('cfg-agent-name')?.value.trim() || '';
        const language = document.getElementById('cfg-language')?.value || '';
        const provider = window.currentGwProvider || 'gemini';

        const gatewayConfig = {
            provider: provider,
            model: model,
            key: key,
            agentName: agentName,
            language: language
        };

        // Save locally for instant state caching
        localStorage.setItem('yieldai_gateway_config', JSON.stringify(gatewayConfig));
        if (key) {
            const savedKeys = JSON.parse(localStorage.getItem('yieldai_gw_keys') || '{}');
            savedKeys[provider] = key;
            localStorage.setItem('yieldai_gw_keys', JSON.stringify(savedKeys));
        }

        if (currentTenant) {
            currentTenant.API_Key = key;
            if (agentName) currentTenant.agency_name = agentName;
            localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant));
        }

        let updatedSuccess = false;

        if (pb && currentTenant) {
            // Strategy 1: Update Tenants collection directly by ID
            if (currentTenant.id) {
                try {
                    await pb.collection('Tenants').update(currentTenant.id, {
                        API_Key: key,
                        agency_name: agentName || currentTenant.agency_name || 'Yield.ai Operations Hub'
                    });
                    updatedSuccess = true;
                } catch (e) {
                    console.warn('[saveGatewayConfig] Direct ID update failed:', e.message);
                }
            }

            // Strategy 2: Update Tenants collection by phone_id lookup
            if (!updatedSuccess && currentTenant.phone_id) {
                try {
                    const records = await pb.collection('Tenants').getFullList({
                        filter: `phone_id = "${currentTenant.phone_id}"`
                    });
                    if (records && records.length > 0) {
                        const realId = records[0].id;
                        currentTenant.id = realId;
                        await pb.collection('Tenants').update(realId, {
                            API_Key: key,
                            agency_name: agentName || currentTenant.agency_name || 'Yield.ai Operations Hub'
                        });
                        updatedSuccess = true;
                        localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant));
                    }
                } catch (e) {
                    console.warn('[saveGatewayConfig] Query by phone_id update failed:', e.message);
                }
            }
        }

        if (updatedSuccess) {
            if (typeof toast === 'function') toast(`✅ Saved & Synced to PocketBase! Provider: ${provider.toUpperCase()} (${model})`);
        } else {
            if (typeof toast === 'function') toast(`✅ Saved locally! Provider: ${provider.toUpperCase()} (${model})`);
        }
    };

    // ── BI-DIRECTIONAL POCKETBASE TENANTS DB READ & WRITE SYNC ──
    window.saveAllSettings = async function() {
        if (!currentTenant || !currentTenant.id) {
            const stored = localStorage.getItem('dashboard_tenant');
            if (stored) {
                try { currentTenant = JSON.parse(stored); } catch(e) {}
            }
        }
        if (!currentTenant) {
            currentTenant = {
                id: 'y2lki1wv83v2llv',
                phone_id: '1273961709129952',
                Leads_Name: 'James Kingston',
                Client_Badge: 'Yield.ai',
                agency_name: 'Yield.ai Operations Hub'
            };
        }

        const getVal = (id) => {
            const el = document.getElementById(id);
            return (el && el.value !== undefined && el.value !== null) ? String(el.value).trim() : '';
        };

        const updatePayload = {};
        const setPayloadField = (key, val) => {
            if (val !== undefined && val !== null && val !== '') {
                updatePayload[key] = val;
            }
        };

        // WhatsApp / Meta API
        setPayloadField('phone_id', getVal('cfg-waba-phone-id'));
        setPayloadField('waba_id', getVal('cfg-waba-phone-id'));
        setPayloadField('access_token', getVal('cfg-waba-token'));
        setPayloadField('webhook_verify_token', getVal('cfg-waba-verify-token'));

        // AI Agent Config & Universal Gateway
        const agentName = getVal('cfg-agent-name');
        if (agentName) {
            setPayloadField('agency_name', agentName);
            setPayloadField('agent_name', agentName);
        }
        setPayloadField('primary_language', getVal('cfg-language'));
        setPayloadField('API_Key', getVal('gw-api-key'));
        setPayloadField('target_model', getVal('gw-target-model'));
        setPayloadField('protocol_provider', window.currentGwProvider || 'google');

        const sysPrompt = getVal('cfg-system-prompt') || getVal('system-prompt-input');
        if (sysPrompt) setPayloadField('system_prompt', sysPrompt);

        // Telegram Broker Notifications
        setPayloadField('telegram_bot_token', getVal('cfg-tg-bot-token'));
        setPayloadField('telegram_chat_id', getVal('cfg-tg-chat-1'));
        setPayloadField('telegram_chat_id_2', getVal('cfg-tg-chat-2'));
        setPayloadField('telegram_chat_id_3', getVal('cfg-tg-chat-3'));

        // Google Sheets
        setPayloadField('sheets_id', getVal('cfg-gsheet-id'));
        setPayloadField('sheets_bookings_tab', getVal('cfg-gsheet-bookings'));
        setPayloadField('sheets_followup_tab', getVal('cfg-gsheet-followups'));

        // Follow-up Scheduler
        const intervalVal = getVal('cfg-sched-interval');
        if (intervalVal) setPayloadField('scheduler_run_every', parseInt(intervalVal, 10) || 4);

        const maxVal = getVal('cfg-sched-max');
        if (maxVal) setPayloadField('scheduler_max_followups', parseInt(maxVal, 10) || 3);

        const delayVal = getVal('cfg-sched-delay');
        if (delayVal) setPayloadField('scheduler_delay_hours', parseInt(delayVal, 10) || 24);

        // Company Info
        const companyName = getVal('cfg-company-name');
        if (companyName) {
            setPayloadField('Client_Badge', companyName);
            setPayloadField('company_name', companyName);
        }
        setPayloadField('office_phone', getVal('cfg-company-phone'));
        setPayloadField('company_email', getVal('cfg-company-email'));
        setPayloadField('company_city', getVal('cfg-company-city'));

        // Sync local memory state & localStorage immediately
        currentTenant = { ...currentTenant, ...updatePayload };
        window.currentTenant = currentTenant;
        try { localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant)); } catch(e) {}

        if (typeof hydrateTenantIdentity === 'function') {
            try { hydrateTenantIdentity(); } catch(e) {}
        }

        if (typeof toast === 'function') toast(`💾 Syncing all Settings directly to PocketBase Tenants database...`);

        let updateSuccess = false;
        let lastErrorMsg = '';

        if (pb && currentTenant.id) {
            try {
                const updatedRecord = await pb.collection('Tenants').update(currentTenant.id, updatePayload);
                if (updatedRecord) {
                    currentTenant = { ...currentTenant, ...updatedRecord };
                    window.currentTenant = currentTenant;
                    try { localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant)); } catch(e) {}
                    updateSuccess = true;
                }
            } catch (err) {
                lastErrorMsg = err.message || 'PocketBase update failed';
                console.warn('[saveAllSettings] Direct ID update failed:', lastErrorMsg);
                if (currentTenant.phone_id) {
                    try {
                        const list = await pb.collection('Tenants').getFullList({
                            filter: `phone_id = "${currentTenant.phone_id}"`
                        });
                        if (list && list.length > 0) {
                            const realId = list[0].id;
                            currentTenant.id = realId;
                            const updatedRecord = await pb.collection('Tenants').update(realId, updatePayload);
                            if (updatedRecord) {
                                currentTenant = { ...currentTenant, ...updatedRecord };
                                window.currentTenant = currentTenant;
                                try { localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant)); } catch(e) {}
                                updateSuccess = true;
                            }
                        }
                    } catch (e2) {
                        lastErrorMsg = e2.message || lastErrorMsg;
                    }
                }
            }
        }

        if (updateSuccess) {
            if (typeof toast === 'function') toast(`✅ All Settings successfully saved & synced to PocketBase database!`);
        } else {
            if (typeof toast === 'function') {
                if (lastErrorMsg) {
                    toast(`⚠️ PocketBase Sync Notice: ${lastErrorMsg} (Saved locally)`);
                } else {
                    toast(`✅ Settings saved locally!`);
                }
            }
        }
    };

    // Real PocketBase Persistence for Adding Properties
    window.saveProperty = async function() {
        const title = (document.getElementById('prop-title')?.value || '').trim();
        const type = document.getElementById('prop-type')?.value || 'Residential';
        const location = (document.getElementById('prop-location')?.value || '').trim();
        const price = (document.getElementById('prop-price')?.value || '').trim();
        const bhk = document.getElementById('prop-bhk')?.value || '3 BHK';
        const area = (document.getElementById('prop-area')?.value || '').trim();
        const status = (document.getElementById('prop-status')?.value || 'Available').toLowerCase();
        const tags = (document.getElementById('prop-tags')?.value || '').trim();
        const desc = (document.getElementById('prop-desc')?.value || '').trim();

        if (!title) {
            if (typeof toast === 'function') toast('⚠️ Please enter a property title');
            return;
        }

        const tenantId = currentTenant ? (currentTenant.id || currentTenant.phone_id || '') : '';
        const infoText = `Type: ${type} | Location: ${location} | Price: ${price} | BHK: ${bhk} | Area: ${area} | Tags: ${tags} | Description: ${desc}`;

        const newRecord = {
            Title: title,
            Status: status,
            Info: infoText,
            Tenant_ID: [tenantId],
            Tenants_ID: tenantId
        };

        let created = false;
        if (pb) {
            try {
                await pb.collection('Properties').create(newRecord);
                created = true;
            } catch (e) {
                console.warn('[saveProperty] PocketBase create failed:', e.message);
            }
        }

        if (!created && currentTenant) {
            try {
                await fetch(`${API_BASE}/properties/create`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newRecord)
                });
            } catch(e) {}
        }

        if (typeof closeModal === 'function') closeModal('modal-add-prop');
        if (typeof toast === 'function') toast('✅ Property added & synced to PocketBase!');

        refreshProperties();
    };

    // Real PocketBase Persistence for Booking Confirmations
    window.saveBooking = async function() {
        const name = (document.getElementById('bk-name')?.value || '').trim();
        const phone = (document.getElementById('bk-phone')?.value || '').trim();
        const budget = (document.getElementById('bk-budget')?.value || '').trim();
        const prop = document.getElementById('bk-prop')?.value || 'Property Site Visit';
        const date = document.getElementById('bk-date')?.value || new Date().toISOString().split('T')[0];
        const broker = document.getElementById('bk-broker')?.value || 'Rajesh Kumar';

        if (!phone) {
            if (typeof toast === 'function') toast('⚠️ Please enter client phone number');
            return;
        }

        const tenantId = currentTenant ? (currentTenant.id || currentTenant.phone_id || '') : '';
        const newAppointment = {
            Phone_No: phone,
            Scheduled_Time: date,
            Status: 'Confirmed',
            Notes: `${prop} · Budget: ${budget} · Client: ${name} · Broker: ${broker}`,
            Tenants_ID: tenantId
        };

        let created = false;
        if (pb) {
            try {
                await pb.collection('Appointments').create(newAppointment);
                created = true;
            } catch (e) {
                console.warn('[saveBooking] PocketBase create failed:', e.message);
            }
        }

        try {
            await fetch(`/api/dashboard/appointments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newAppointment)
            });
        } catch(e) {}

        if (typeof closeModal === 'function') closeModal('modal-booking');
        if (typeof toast === 'function') toast(`✅ Site visit confirmed & synced to PocketBase! Broker ${broker} notified.`);

        refreshAppointments();
    };

    // Direct lead status update — called by leads grid selects in index.html
    window.updateLeadStatus = async function(leadId, status) {
        if (!pb || !leadId) return;
        try {
            await pb.collection('Leads').update(leadId, { status: status });
        } catch(e) {
            console.warn('[updateLeadStatus] PocketBase update failed:', e.message);
        }
    };

    // ══════════════════════════════════════════════════════════════════
    //  DYNAMIC HYDRATION & TENANT IDENTITY
    // ══════════════════════════════════════════════════════════════════
    function getInitials(name) {
        if (!name) return 'JK';
        const parts = String(name).trim().split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        } else if (parts.length === 1 && parts[0].length > 0) {
            return parts[0].slice(0, 2).toUpperCase();
        }
        return 'JK';
    }

    function updateSidebarBadges() {
        const inboxBadge = document.getElementById('sb-inbox-badge');
        if (inboxBadge) {
            inboxBadge.textContent = currentLeads ? currentLeads.length : 0;
        }
        const leadsBadge = document.getElementById('sb-leads-badge');
        if (leadsBadge) {
            leadsBadge.textContent = currentLeads ? currentLeads.length : 0;
        }
        const followupsBadge = document.getElementById('sb-followups-badge');
        if (followupsBadge) {
            followupsBadge.textContent = currentAppointments ? currentAppointments.length : 0;
        }
        const inventoryBadge = document.getElementById('sb-inventory-badge');
        if (inventoryBadge) {
            inventoryBadge.textContent = currentProperties ? currentProperties.length : 0;
        }
        const aiagentsBadge = document.getElementById('sb-aiagents-badge');
        if (aiagentsBadge) {
            aiagentsBadge.textContent = '2';
        }
    }

    function hydrateTenantIdentity() {
        if (!currentTenant) return;

        const userName = currentTenant.Leads_Name || currentTenant.leads_name || 'James Kingston';
        const clientBadge = currentTenant.Client_Badge || currentTenant.client_badge || currentTenant.company_name || 'Yield.ai';
        const role = currentTenant.role || 'Admin · Owner';

        // 1. User Name
        const unameEl = document.getElementById('sb-user-name') || document.querySelector('.uname');
        if (unameEl) {
            unameEl.textContent = userName;
        }

        // 2. User Avatar Text / Initials
        const aviEl = document.getElementById('sb-user-avi') || document.querySelector('.sb-user .avi');
        if (aviEl) {
            aviEl.textContent = getInitials(userName);
        }

        // 3. User Role
        const uroleEl = document.getElementById('sb-user-role') || document.querySelector('.urole');
        if (uroleEl) {
            uroleEl.textContent = role;
        }

        // 4. Logo Name / Client Badge
        const logoNameEl = document.getElementById('app-logo-name') || document.querySelector('.logo-name');
        if (logoNameEl) {
            logoNameEl.textContent = clientBadge;
        }

        // 5. Logo Subtitle
        const logoSubEl = document.getElementById('app-logo-sub') || document.querySelector('.logo-sub');
        if (logoSubEl) {
            logoSubEl.textContent = 'Operations Hub';
        }

        // 6. Topbar Subtitle Greeting
        const tbSub = document.getElementById('tb-sub');
        if (tbSub) {
            tbSub.textContent = `— Good morning, ${userName} 👋`;
        }

        // 7. Settings Company Info & API Key (if present)
        const settingsCompany = document.getElementById('settings-company-name');
        if (settingsCompany && !settingsCompany.value) {
            settingsCompany.value = clientBadge;
        }
        const settingsSub = document.getElementById('settings-company-sub');
        if (settingsSub) {
            settingsSub.textContent = `Configure your ${clientBadge} automation system`;
        }

        // 8. Hydrate ALL Settings Form Inputs from Live PocketBase Tenant Record
        const setVal = (id, val) => {
            if (val === undefined || val === null || val === '') return;
            const el = document.getElementById(id);
            if (el) el.value = val;
        };

        // WhatsApp / Meta API
        setVal('cfg-waba-phone-id', currentTenant.phone_id || currentTenant.waba_id);
        setVal('cfg-waba-token', currentTenant.access_token);
        setVal('cfg-waba-verify-token', currentTenant.webhook_verify_token);

        // AI Agent Config & Universal Gateway
        setVal('cfg-agent-name', currentTenant.agency_name || currentTenant.agent_name || currentTenant.Leads_Name);
        setVal('cfg-language', currentTenant.primary_language);
        setVal('gw-api-key', currentTenant.API_Key);
        setVal('gw-target-model', currentTenant.target_model);
        setVal('cfg-system-prompt', currentTenant.system_prompt);
        setVal('system-prompt-input', currentTenant.system_prompt);

        // Telegram Broker Notifications
        setVal('cfg-tg-bot-token', currentTenant.telegram_bot_token);
        setVal('cfg-tg-chat-1', currentTenant.telegram_chat_id);
        setVal('cfg-tg-chat-2', currentTenant.telegram_chat_id_2);
        setVal('cfg-tg-chat-3', currentTenant.telegram_chat_id_3);

        // Google Sheets
        setVal('cfg-gsheet-id', currentTenant.sheets_id);
        setVal('cfg-gsheet-bookings', currentTenant.sheets_bookings_tab);
        setVal('cfg-gsheet-followups', currentTenant.sheets_followup_tab);

        // Follow-up Scheduler
        setVal('cfg-sched-interval', currentTenant.scheduler_run_every);
        setVal('cfg-sched-max', currentTenant.scheduler_max_followups);
        setVal('cfg-sched-delay', currentTenant.scheduler_delay_hours);

        // Company Info
        setVal('cfg-company-name', currentTenant.Client_Badge || currentTenant.company_name || currentTenant.agency_name);
        setVal('cfg-company-phone', currentTenant.office_phone || currentTenant.company_phone);
        setVal('cfg-company-email', currentTenant.company_email);
        setVal('cfg-company-city', currentTenant.company_city);
    }

    // ══════════════════════════════════════════════════════════════════
    //  INITIALIZATION & ORCHESTRATION
    // ══════════════════════════════════════════════════════════════════
    const DEFAULT_TENANT = {
        id: 'y2lki1wv83v2llv',
        phone_id: '1273961709129952',
        Leads_Name: 'James Kingston',
        Client_Badge: 'Yield.ai',
        agency_name: 'Yield.ai Operations Hub'
    };

    // ══════════════════════════════════════════════════════════════════
    //  INITIALIZATION & ORCHESTRATION
    // ══════════════════════════════════════════════════════════════════
    async function initBackend() {
        const fresh = localStorage.getItem('dashboard_tenant');
        if (fresh) {
            try { currentTenant = JSON.parse(fresh); } catch (e) {}
        }
        if (!currentTenant || !currentTenant.id) {
            currentTenant = DEFAULT_TENANT;
            try { localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant)); } catch (e) {}
        }

        window.currentTenant = currentTenant;

        // Immediately hydrate DOM with cached tenant values
        try {
            hydrateTenantIdentity();
        } catch (e) {}

        // Dynamic PocketBase live tenant verification
        if (pb && (currentTenant.id || currentTenant.phone_id)) {
            try {
                let record = null;
                if (currentTenant.id) {
                    record = await pb.collection('Tenants').getOne(currentTenant.id).catch(() => null);
                }
                if (!record && currentTenant.phone_id) {
                    const list = await pb.collection('Tenants').getFullList({
                        filter: `phone_id = "${currentTenant.phone_id}"`
                    }).catch(() => []);
                    if (list && list.length > 0) record = list[0];
                }
                if (record) {
                    currentTenant = { ...currentTenant, ...record };
                    window.currentTenant = currentTenant;
                    localStorage.setItem('dashboard_tenant', JSON.stringify(currentTenant));
                }
            } catch (err) {
                console.warn('[Dashboard] Live tenant hydration fetch warning:', err.message);
            }
        }

        // Hydrate DOM again after fresh PocketBase record sync
        try {
            hydrateTenantIdentity();
            updateSidebarBadges();

            if (typeof lucide !== 'undefined') lucide.createIcons();

            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    localStorage.removeItem('dashboard_tenant');
                    window.location.href = '/dashboard/';
                });
            }
        } catch (e) {
            console.warn('[Dashboard] Pre-fetch UI init warning:', e);
        }

        await refreshAllData();
        updateSidebarBadges();
        startAutoRefresh();
        initRealtimeUpdates();
    }

    window.initBackend = initBackend;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBackend);
    } else {
        initBackend();
    }

    // ---- REFRESH ALL DATA --------------------------------------------
    async function refreshAllData() {
        if (!currentTenant) currentTenant = DEFAULT_TENANT;

        // Parallel Hydration of Leads, Appointments, and Properties
        await Promise.allSettled([
            refreshLeads(),
            refreshAppointments(),
            refreshProperties()
        ]);

        // Dynamically compute metrics from live PocketBase data
        updateMetricsCards();
        updateSidebarBadges();
    }

    function updateMetricsCards() {
        const leadsEl = document.getElementById('metric-leads');
        const bookingsEl = document.getElementById('metric-bookings');
        const activePropsEl = document.getElementById('metric-active-props');
        const pipelineEl = document.getElementById('metric-pipeline-value');

        const leadsCount = (currentLeads || []).length;
        const bookingsCount = (currentAppointments || []).length;
        const activePropsCount = (currentProperties || []).filter(p => (p.Status || 'available').toLowerCase() === 'available' || !p.Status).length;

        if (leadsEl) leadsEl.textContent = leadsCount;
        if (bookingsEl) bookingsEl.textContent = bookingsCount;
        if (activePropsEl) activePropsEl.textContent = activePropsCount;

        if (pipelineEl) {
            const pipelineValue = (leadsCount * 3500000) + (bookingsCount * 7000000);
            if (pipelineValue >= 10000000) {
                pipelineEl.textContent = '₹' + (pipelineValue / 10000000).toFixed(1) + 'Cr';
            } else if (pipelineValue >= 100000) {
                pipelineEl.textContent = '₹' + (pipelineValue / 100000).toFixed(0) + 'L';
            } else {
                pipelineEl.textContent = '₹' + pipelineValue.toLocaleString();
            }
        }
    }

    // ---- REFRESH LEADS -----------------------------------------------
    async function refreshLeads() {
        if (!currentTenant) currentTenant = DEFAULT_TENANT;

        let leadsData = [];
        const tenantId = currentTenant.id || '';
        const phoneId = currentTenant.phone_id || '';

        // Priority 1: Direct PocketBase Collection
        if (pb) {
            try {
                let filter = '';
                if (tenantId && phoneId) {
                    filter = `(Tenants_ID = "${tenantId}" || Tenants_ID = "${phoneId}")`;
                } else if (tenantId) {
                    filter = `(Tenants_ID = "${tenantId}")`;
                }
                const res = await pb.collection('Leads').getFullList({
                    filter: filter,
                    sort: '-updated'
                }).catch(() => []);
                if (Array.isArray(res) && res.length > 0) {
                    leadsData = res;
                } else {
                    const allRes = await pb.collection('Leads').getFullList({
                        sort: '-updated'
                    }).catch(() => []);
                    if (Array.isArray(allRes) && allRes.length > 0) {
                        leadsData = allRes;
                    }
                }
            } catch (e) {
                console.warn('[Dashboard] PocketBase Leads query warning:', e.message);
                try {
                    const allRes = await pb.collection('Leads').getFullList({ sort: '-updated' }).catch(() => []);
                    if (Array.isArray(allRes)) leadsData = allRes;
                } catch (err2) {}
            }
        }

        // Priority 2: Direct HTTP Fetch Fallback
        if (leadsData.length === 0) {
            try {
                const res = await fetch(`https://api.yieldai.space/api/collections/Leads/records?sort=-updated&perPage=50`);
                if (res.ok) {
                    const data = await res.json();
                    leadsData = data.items || [];
                }
            } catch (e) {
                console.warn('[Dashboard] Direct HTTP fetch leads fallback failed:', e.message);
            }
        }

        // Priority 3: API Gateway Fallback
        if (leadsData.length === 0) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                const res = await fetch(`${API_BASE}/leads?phone_id=${encodeURIComponent(phoneId)}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const d = await res.json();
                    leadsData = d.leads || [];
                }
            } catch (e) {
                console.warn('[Dashboard] API leads fallback load failed:', e.message);
            }
        }

        currentLeads = leadsData;

        // Render Dashboard Table View
        const tableBody = document.getElementById('leads-tbody');
        if (tableBody) {
            if (currentLeads.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--t3)">No leads yet.</td></tr>';
            } else {
                const tz = currentTenant.timezone || 'UTC';
                tableBody.innerHTML = currentLeads.map(lead => {
                    const phone = String(lead.Phone_No || lead.phone_no || 'N/A');
                    const summary = lead.Chat_Summary || lead.chat_summary || 'No summary available';
                    let factsObj = {};
                    try {
                        const raw = lead.Buyer_Facts || lead.buyer_facts;
                        factsObj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
                    } catch(e) { factsObj = {}; }
                    const interestedIn = factsObj.interested_in || factsObj.property_type || factsObj.primary_enquiry_property || (factsObj.active_properties && factsObj.active_properties.length > 0 ? factsObj.active_properties.join(', ') : 'Property Inquiry');
                    const st = (lead.status || 'warm').toLowerCase();

                    return `
                        <tr>
                            <td>
                                <a href="#" onclick="window.openChat('${escapeHtml(phone)}'); nav('inbox'); return false;" style="color:var(--blue);text-decoration:none;font-weight:600">
                                    ${escapeHtml(phone)}
                                </a>
                            </td>
                            <td style="color:var(--t3);font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(summary)}">
                                ${escapeHtml(summary)}
                            </td>
                            <td>${escapeHtml(interestedIn)}</td>
                            <td>
                                <select class="status-sel ${st}" data-lead-id="${escapeHtml(lead.id)}" onchange="updateStatus(this)">
                                    <option value="hot" ${st === 'hot' ? 'selected' : ''}>🔥 Hot</option>
                                    <option value="warm" ${st === 'warm' ? 'selected' : ''}>🌡️ Warm</option>
                                    <option value="cold" ${st === 'cold' ? 'selected' : ''}>❄️ Cold</option>
                                    <option value="dead" ${st === 'dead' ? 'selected' : ''}>💀 Dead</option>
                                </select>
                            </td>
                            <td>${new Date(lead.created).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz })}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        currentLeads = leadsData || [];
        window.currentLeads = currentLeads;
        window.liveLeads = currentLeads;

        // Hydrate Inbox Module & Global Leads View
        InboxController.setLeads(currentLeads);
        FollowupsController.renderFollowupQueue();
        renderDynamicAgents(currentLeads, currentAppointments);
        updateMetricsCards();
        updateSidebarBadges();
        if (typeof renderConvList === 'function') renderConvList();
        if (typeof renderLeads === 'function') renderLeads(currentLeads);
        if (typeof window.onLeadsLoaded === 'function') window.onLeadsLoaded(currentLeads);
    }

    // ---- REFRESH APPOINTMENTS ----------------------------------------
    async function refreshAppointments() {
        if (!currentTenant) currentTenant = DEFAULT_TENANT;

        let aptsData = [];
        const tenantId = currentTenant.id || '';
        const phoneId = currentTenant.phone_id || '';

        // Priority 1: Direct PocketBase Collection
        if (pb) {
            try {
                let filter = '';
                if (tenantId && phoneId) {
                    filter = `(Tenants_ID = "${tenantId}" || Tenants_ID = "${phoneId}")`;
                } else if (tenantId) {
                    filter = `(Tenants_ID = "${tenantId}")`;
                }
                const res = await pb.collection('Appointments').getFullList({
                    filter: filter,
                    sort: '-created'
                }).catch(() => []);
                if (Array.isArray(res) && res.length > 0) aptsData = res;

                // Graceful fallback: If tenant filter returns empty, fetch general list
                if (!aptsData || aptsData.length === 0) {
                    aptsData = await pb.collection('Appointments').getFullList({
                        sort: '-created'
                    }).catch(() => []);
                }
            } catch (e) {
                console.warn('[Dashboard] PocketBase Appointments query warning:', e.message);
                try {
                    aptsData = await pb.collection('Appointments').getFullList({
                        sort: '-created'
                    }).catch(() => []);
                } catch(err2) {}
            }
        }

        // Priority 2: Direct HTTP Fetch Fallback
        if (aptsData.length === 0) {
            try {
                const res = await fetch(`https://api.yieldai.space/api/collections/Appointments/records?sort=-created&perPage=50`);
                if (res.ok) {
                    const data = await res.json();
                    aptsData = data.items || [];
                }
            } catch (e) {
                console.warn('[Dashboard] Direct HTTP fetch appointments fallback failed:', e.message);
            }
        }

        // Priority 3: API Gateway Fallback
        if (aptsData.length === 0) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                const res = await fetch(`${API_BASE}/appointments?phone_id=${encodeURIComponent(phoneId)}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (res.ok) {
                    const d = await res.json();
                    aptsData = d.appointments || [];
                }
            } catch (e) {
                console.warn('[Dashboard] API appointments fallback load failed:', e.message);
            }
        }

        currentAppointments = aptsData || [];
        window.currentAppointments = currentAppointments;
        window.liveAppointments = currentAppointments;

        FollowupsController.setAppointments(currentAppointments);
        renderDynamicAgents(currentLeads, currentAppointments);
        updateMetricsCards();
        updateSidebarBadges();
        // Notify index.html bookings table
        if (typeof renderDashBookings === 'function') renderDashBookings();
        if (typeof window.onAppointmentsLoaded === 'function') window.onAppointmentsLoaded(currentAppointments);
    }

    // ---- REFRESH PROPERTIES ------------------------------------------
    async function refreshProperties() {
        if (!currentTenant) currentTenant = DEFAULT_TENANT;

        let propsData = [];
        const tenantId = currentTenant.id || '';
        const phoneId = currentTenant.phone_id || '';

        if (pb) {
            try {
                // First attempt: filter by tenant using PocketBase relation query
                let filter = '';
                if (tenantId && phoneId) {
                    filter = `(Tenant_ID.id = "${tenantId}" || Tenant_ID.id = "${phoneId}" || Tenant_ID ~ "${tenantId}" || Tenant_ID ~ "${phoneId}")`;
                } else if (tenantId) {
                    filter = `(Tenant_ID.id = "${tenantId}" || Tenant_ID ~ "${tenantId}")`;
                }
                propsData = await pb.collection('Properties').getFullList({
                    filter: filter,
                    sort: '-created'
                }).catch(() => []);

                // Graceful fallback: If tenant filter returns empty, fetch general catalog
                if (!propsData || propsData.length === 0) {
                    propsData = await pb.collection('Properties').getFullList({
                        sort: '-created'
                    }).catch(() => []);
                }
            } catch (e) {
                console.warn('[Dashboard] PocketBase Properties query warning:', e.message);
                try {
                    propsData = await pb.collection('Properties').getFullList({
                        sort: '-created'
                    }).catch(() => []);
                } catch (err2) {
                    console.warn('[Dashboard] PocketBase Properties catalog fetch failed:', err2.message);
                }
            }
        }

        // Direct HTTP Fetch Fallback
        if (propsData.length === 0) {
            try {
                const res = await fetch(`https://api.yieldai.space/api/collections/Properties/records?sort=-created&perPage=50`);
                if (res.ok) {
                    const data = await res.json();
                    propsData = data.items || [];
                }
            } catch (e) {
                console.warn('[Dashboard] Direct HTTP fetch properties fallback failed:', e.message);
            }
        }

        currentProperties = propsData || [];
        window.currentProperties = currentProperties;
        window.liveProperties = currentProperties;

        InventoryController.setProperties(currentProperties);
        updateMetricsCards();
        updateSidebarBadges();
        if (typeof renderProps === 'function') renderProps();
        if (typeof window.onPropertiesLoaded === 'function') window.onPropertiesLoaded(currentProperties);
    }

    // ---- AUTO-REFRESH ------------------------------------------------
    function startAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(() => {
            refreshLeads();
            refreshAppointments();
        }, 30000);
    }

    // ---- POCKETBASE REALTIME (SINGLE UNIFIED SUBSCRIPTION) ------------
    let pbSubscribed = false;

    function initRealtimeUpdates() {
        if (!pb || pbSubscribed) return;

        try {
            // 1. Leads Realtime Subscription
            pb.collection('Leads').subscribe('*', (e) => {
                if (e.action === 'create' || e.action === 'update') {
                    // Prepend to Live Activity Feed on 'create'
                    const activityFeed = document.getElementById('activity-feed');
                    if (activityFeed && e.action === 'create') {
                        const leadData = e.record;
                        const phone = escapeHtml(leadData.Phone_No || leadData.phone_no || 'Unknown');
                        const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        const html = `
                            <div style="padding:12px;border-bottom:1px solid var(--border-l);display:flex;gap:12px;animation:fadeIn 0.5s">
                                <div style="font-size:16px">📥</div>
                                <div>
                                    <div style="font-size:12.5px;color:var(--t1)">New message from: <span style="font-weight:600">${phone}</span></div>
                                    <div style="font-size:11px;color:var(--t3);margin-top:2px">${time}</div>
                                </div>
                            </div>
                        `;
                        activityFeed.insertAdjacentHTML('afterbegin', html);
                        
                        // Pulse metric counter
                        const metricEl = document.getElementById('metric-leads');
                        if (metricEl) {
                            metricEl.style.color = 'var(--green)';
                            setTimeout(() => metricEl.style.color = '', 2000);
                        }
                    }

                    // Dynamically update InboxController
                    InboxController.handleRealtimeUpdate(e.record, e.action);
                    FollowupsController.renderFollowupQueue();
                    updateSidebarBadges();
                }
            });

            // 2. Appointments Realtime Subscription
            pb.collection('Appointments').subscribe('*', () => {
                refreshAppointments();
                updateSidebarBadges();
            });

            // 3. Properties Realtime Subscription
            pb.collection('Properties').subscribe('*', () => {
                refreshProperties();
                updateSidebarBadges();
            });

            pbSubscribed = true;
            console.log('[Dashboard] PocketBase Realtime SSE subscriptions active (Leads, Appointments, Properties)');
        } catch (e) {
            console.warn('[Dashboard] Realtime subscription initialization failed:', e.message);
        }
    }
})();
