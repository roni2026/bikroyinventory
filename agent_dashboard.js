// REPLACE THIS WITH YOUR ACTUAL EXTENSION ID
const EXTENSION_ID = "ekgafjcgocdpjfeiheikonnaceepodlc"; 

const agentsList = [
    "Mehedi", "Yeamin", "Utsow", "Udoy", "Salahuddin", "Halal", 
    "Jisan", "Sarnali", "Asif", "Anik", "Riazul", "Sonjoy", "Roni"
];

const elements = {
    status: document.getElementById('connection-status'),
    selector: document.getElementById('agent-selector'),
    grid: document.getElementById('dashboard-grid'),
    queues: document.getElementById('main-queue-stats'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    btnRefresh: document.getElementById('btn-refresh'),
    // Log elements
    btnLog: document.getElementById('btn-log'),
    logModal: document.getElementById('log-modal'),
    closeLog: document.getElementById('close-log'),
    logTableBody: document.getElementById('log-table-body'),
    emptyLogMsg: document.getElementById('empty-log-msg'),
    clearLogBtn: document.getElementById('clear-log-btn')
};

// --- Init ---
function init() {
    renderSelector();
    checkExtension();
    setInterval(fetchData, 2000); // Auto-refresh every 2s
}

// 1. Check Extension Connection
function checkExtension() {
    if(!EXTENSION_ID || EXTENSION_ID.length < 10) {
        elements.status.textContent = "Config Error: No ID";
        return;
    }
    
    try {
        chrome.runtime.sendMessage(EXTENSION_ID, { action: "handshake" }, (response) => {
            if (chrome.runtime.lastError || !response) {
                elements.status.textContent = "Extension Not Found";
                elements.status.className = "text-xs px-2 py-1 rounded bg-red-900 text-red-200";
            } else {
                elements.status.textContent = "Connected";
                elements.status.className = "text-xs px-2 py-1 rounded bg-green-900 text-green-200 font-bold";
                fetchData();
            }
        });
    } catch(e) { console.log("Cannot reach extension"); }
}

// 2. Fetch Data
function fetchData() {
    if(elements.status.textContent.includes("Not Found")) return;

    chrome.runtime.sendMessage(EXTENSION_ID, { action: "getData" }, (res) => {
        if (!res) return;
        
        updateControls(res.isRunning);
        
        if (res.selectedAgents) {
            document.querySelectorAll('.agent-cb').forEach(cb => {
                if(res.selectedAgents.includes(cb.value)) cb.checked = true;
            });
        }

        renderGrid(res.agentData);
        renderQueues(res.reviewCounts);
        
        // Store logs globally
        window.sessionLogs = res.sessionLogs || [];
    });
}

// 3. Actions
elements.btnStart.addEventListener('click', () => {
    const selected = Array.from(document.querySelectorAll('.agent-cb:checked')).map(cb => cb.value);
    if(selected.length === 0) return alert("Select at least one agent");
    chrome.runtime.sendMessage(EXTENSION_ID, { action: "command", command: "start", payload: selected }, fetchData);
});

elements.btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage(EXTENSION_ID, { action: "command", command: "stop" }, fetchData);
});

elements.btnRefresh.addEventListener('click', () => {
    chrome.runtime.sendMessage(EXTENSION_ID, { action: "command", command: "refresh" }, fetchData);
});

// --- Log Modal Logic ---
elements.btnLog.addEventListener('click', () => {
    renderLogs(window.sessionLogs);
    elements.logModal.classList.remove('hidden');
    elements.logModal.classList.add('visible');
});

elements.closeLog.addEventListener('click', () => {
    elements.logModal.classList.remove('visible');
    elements.logModal.classList.add('hidden');
});

elements.clearLogBtn.addEventListener('click', () => {
    if(confirm("Clear log history?")) {
        chrome.runtime.sendMessage(EXTENSION_ID, { action: "command", command: "clearLogs" }, () => {
             renderLogs([]);
             window.sessionLogs = [];
        });
    }
});

function renderLogs(logs) {
    elements.logTableBody.innerHTML = '';
    if(!logs || logs.length === 0) {
        elements.emptyLogMsg.classList.remove('hidden');
        return;
    }
    elements.emptyLogMsg.classList.add('hidden');
    
    logs.forEach(log => {
        const isAlert = log.type === 'alert';
        const row = document.createElement('tr');
        // Highlight red if it's an alert
        row.className = `border-b border-gray-700 ${isAlert ? 'bg-red-900/20 hover:bg-red-900/30' : 'bg-gray-800 hover:bg-gray-700'}`;
        
        row.innerHTML = `
            <th scope="row" class="px-6 py-4 font-medium ${isAlert ? 'text-red-300' : 'text-white'} whitespace-nowrap font-mono">
                ${log.time}
            </th>
            <td class="px-6 py-4 font-bold font-mono ${isAlert ? 'text-red-300' : 'text-blue-400'}">
                ${log.agent}
            </td>
            <td class="px-6 py-4 font-mono ${isAlert ? 'text-red-200' : 'text-gray-300'}">
                ${log.msg || '-'}
            </td>
        `;
        elements.logTableBody.appendChild(row);
    });
}

// --- Helpers ---
function renderSelector() {
    elements.selector.innerHTML = agentsList.map(name => `
        <label class="flex items-center space-x-3 p-2 rounded hover:bg-gray-800 cursor-pointer">
            <input type="checkbox" value="${name}" class="agent-cb w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded">
            <span class="text-gray-300">${name}</span>
        </label>
    `).join('');
}

function updateControls(isRunning) {
    if(isRunning) {
        elements.btnStart.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Tracking...';
        elements.btnStart.disabled = true;
        elements.btnStart.classList.add('opacity-50', 'cursor-not-allowed');
        elements.btnStop.disabled = false;
        elements.btnStop.classList.remove('opacity-50');
    } else {
        elements.btnStart.innerHTML = '<i class="fas fa-play"></i> Start Tracking';
        elements.btnStart.disabled = false;
        elements.btnStart.classList.remove('opacity-50', 'cursor-not-allowed');
        elements.btnStop.disabled = true;
        elements.btnStop.classList.add('opacity-50');
    }
}

function renderQueues(counts) {
    if(!counts) return;
    elements.queues.innerHTML = '';
    
    const keys = ['member', 'listing_fee', 'general', 'manager', 'fraud', 'edited', 'verification'];
    const labels = { 'member': 'Mem', 'listing_fee': 'List', 'general': 'Gen', 'manager': 'Mgr', 'fraud': 'Frd', 'edited': 'Edit', 'verification': 'Ver' };
    
    keys.forEach(k => {
        if(counts[k] !== undefined) {
            const isHigh = counts[k] > 50;
            const div = document.createElement('div');
            div.className = `flex flex-col items-center justify-center p-2 rounded-lg border w-24 h-16 ${isHigh ? 'bg-red-900/30 border-red-500/50 text-red-400' : 'bg-indigo-900/20 border-indigo-700/50 text-indigo-300'}`;
            div.innerHTML = `
                <span class="text-[10px] uppercase opacity-70 font-semibold mb-1">${labels[k] || k}</span>
                <span class="text-xl font-bold font-mono leading-none">${counts[k]}</span>
            `;
            elements.queues.appendChild(div);
        }
    });
}

function renderGrid(data) {
    if(!data) return;
    elements.grid.innerHTML = '';
    const now = Date.now();
    
    Object.keys(data).sort().forEach(name => {
        const agent = data[name];
        
        // --- INACTIVITY LOGIC START ---
        const lastActive = agent.lastActiveTime || now;
        const inactiveMs = now - lastActive;
        const inactiveMins = Math.floor(inactiveMs / 60000);
        const isInactive = inactiveMins >= 15;

        // Change card style if inactive
        const cardClass = isInactive 
            ? "bg-red-900/20 border-red-500 border rounded-xl p-4 transition relative overflow-hidden" 
            : "bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-gray-500 transition relative overflow-hidden";
        
        // Create Badge
        let inactiveBadge = '';
        if(isInactive) {
            inactiveBadge = `<span class="ml-2 text-[10px] bg-red-600 text-white px-2 py-0.5 rounded animate-pulse font-bold">Inactive: ${inactiveMins}m</span>`;
        }
        // --- INACTIVITY LOGIC END ---

        const card = document.createElement('div');
        card.className = cardClass;
        card.innerHTML = `
            <div class="flex justify-between items-center mb-4 relative z-10">
                <div class="flex items-center">
                    <h3 class="text-lg font-bold text-white tracking-wide">${name}</h3>
                    ${inactiveBadge}
                </div>
                <span class="text-[10px] bg-gray-900 px-2 py-0.5 rounded text-purple-400 font-mono border border-gray-700 tracking-widest">${agent.permissions || '-'}</span>
            </div>
            
            <div class="grid grid-cols-3 gap-2 relative z-10">
                <div class="bg-gray-900/50 rounded-lg p-2 text-center border border-gray-700/30">
                    <div class="text-2xl font-bold text-blue-500 font-mono">${agent.thisHourAds || 0}</div>
                    <div class="text-[9px] uppercase text-gray-500 font-semibold tracking-wider">This Hr</div>
                </div>
                 <div class="bg-gray-900/50 rounded-lg p-2 text-center border border-gray-700/30">
                    <div class="text-2xl font-bold text-purple-500 font-mono">${agent.lastHourAds || 0}</div>
                    <div class="text-[9px] uppercase text-gray-500 font-semibold tracking-wider">Last Hr</div>
                </div>
                <div class="bg-gray-900/50 rounded-lg p-2 text-center border border-gray-700/30">
                    <div class="text-2xl font-bold text-green-500 font-mono">${agent.cumulativeNewAds || 0}</div>
                    <div class="text-[9px] uppercase text-gray-500 font-semibold tracking-wider">Total</div>
                </div>
            </div>
        `;
        elements.grid.appendChild(card);
    });
}

init();
