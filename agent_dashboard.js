// REPLACE THIS WITH YOUR ACTUAL EXTENSION ID FROM chrome://extensions
const EXTENSION_ID = "lbhpnfjignnkgobcdgbahbfagnailmlp"; 

const agentsList = [
    "Mehedi", "Yeamin", "Utsow", "Udoy", "Salahuddin", "Halal", 
    "Jisan", "Sarnali", "Asif", "Anik", "Riazul", "Sonjoy", "Roni"
];

const elements = {
    status: document.getElementById('connection-status'),
    selector: document.getElementById('agent-selector'),
    grid: document.getElementById('dashboard-grid'),
    queues: document.getElementById('queue-stats'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    btnRefresh: document.getElementById('btn-refresh')
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
    
    // We send a 'handshake' to see if extension is listening
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
    } catch(e) {
        console.log("Cannot reach extension");
    }
}

// 2. Fetch Data
function fetchData() {
    if(elements.status.textContent.includes("Not Found")) return;

    chrome.runtime.sendMessage(EXTENSION_ID, { action: "getData" }, (res) => {
        if (!res) return;
        
        updateControls(res.isRunning);
        
        // Sync checkboxes from storage if we haven't touched them
        if (res.selectedAgents) {
            document.querySelectorAll('.agent-cb').forEach(cb => {
                if(res.selectedAgents.includes(cb.value)) cb.checked = true;
            });
        }

        renderGrid(res.agentData);
        renderQueues(res.reviewCounts);
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
    const keys = ['member', 'listing_fee', 'general', 'fraud'];
    
    keys.forEach(k => {
        if(counts[k] !== undefined) {
            const isHigh = counts[k] > 50;
            const div = document.createElement('div');
            div.className = `flex flex-col px-3 py-1 rounded border ${isHigh ? 'bg-red-900/30 border-red-500 text-red-200' : 'bg-gray-800 border-gray-700 text-gray-300'}`;
            div.innerHTML = `<span class="text-[10px] uppercase opacity-70">${k.replace('_',' ')}</span><span class="font-mono font-bold">${counts[k]}</span>`;
            elements.queues.appendChild(div);
        }
    });
}

function renderGrid(data) {
    if(!data) return;
    elements.grid.innerHTML = '';
    
    Object.keys(data).sort().forEach(name => {
        const agent = data[name];
        const card = document.createElement('div');
        card.className = "bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-500 transition relative overflow-hidden";
        card.innerHTML = `
            <div class="flex justify-between items-start mb-3 relative z-10">
                <h3 class="text-lg font-bold text-white">${name}</h3>
                <span class="text-xs bg-gray-900 px-2 py-1 rounded text-purple-400 font-mono border border-gray-700">${agent.permissions || '-'}</span>
            </div>
            <div class="grid grid-cols-2 gap-3 relative z-10">
                <div class="bg-gray-900/50 rounded p-2 text-center">
                    <div class="text-2xl font-bold text-blue-400 font-mono">${agent.thisHourAds || 0}</div>
                    <div class="text-[10px] uppercase text-gray-500">This Hour</div>
                </div>
                <div class="bg-gray-900/50 rounded p-2 text-center">
                    <div class="text-2xl font-bold text-green-400 font-mono">${agent.cumulativeNewAds || 0}</div>
                    <div class="text-[10px] uppercase text-gray-500">Session</div>
                </div>
            </div>
        `;
        elements.grid.appendChild(card);
    });
}

init();
