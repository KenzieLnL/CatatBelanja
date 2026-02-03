import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "firebase/auth";
import { getFirestore, collection, doc, deleteDoc, onSnapshot, addDoc, writeBatch } from "firebase/firestore";
import { createIcons, icons } from 'lucide';
import { firebaseConfig, appId } from './config.js';
import './style.css';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global State
let user = null;
let draftItems = [];
let sessions = [];
let historyData = [];
let activeSessionId = null;
let temporaryPrices = {};

const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const now = new Date();

// DOM Elements
const filterMonth = document.getElementById('filterMonth');
const filterYear = document.getElementById('filterYear');
const itemDateInput = document.getElementById('itemDate');

// Helper: Format IDR
const formatIDR = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

// Helper: Toast
const showToast = (msg) => {
    const toast = document.getElementById('toast');
    document.getElementById('toastMsg').innerText = msg;
    toast.classList.remove('translate-y-32');
    setTimeout(() => toast.classList.add('translate-y-32'), 2500);
};

// Initialize Lucide Icons
createIcons({ icons });

// Initialize UI
itemDateInput.value = now.toISOString().split('T')[0];

monthNames.forEach((m, i) => {
    const opt = document.createElement('option'); opt.value = i; opt.text = m;
    if (i === now.getMonth()) opt.selected = true;
    filterMonth.appendChild(opt);
});

for (let i = now.getFullYear() - 1; i <= now.getFullYear() + 1; i++) {
    const opt = document.createElement('option'); opt.value = i; opt.text = i;
    if (i === now.getFullYear()) opt.selected = true;
    filterYear.appendChild(opt);
}

// Authentication
onAuthStateChanged(auth, async (u) => {
    user = u;
    if (user) {
        document.getElementById('loadingScreen').classList.add('hidden');
        setupListeners();
    } else {
        // Auto sign-in anonymously if no custom token logic is needed here
        // If you still need the custom token injection logic, you'd need to provide it via config or environment variables
        try {
            await signInAnonymously(auth);
        } catch (error) {
            console.error("Auth Error:", error);
            showToast("Gagal Login: " + error.message);
        }
    }
});

function setupListeners() {
    onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'sessions'), (snap) => {
        sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderSessions();
        if (activeSessionId) renderDetail();
    }, (err) => console.error(err));

    onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'history'), (snap) => {
        historyData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAllHistoryUI();
    }, (err) => console.error(err));
}

function renderAllHistoryUI() {
    renderTotals();
    renderHistory();
}

function getLastPrice(name) {
    const matches = historyData
        .filter(h => h.name.toLowerCase() === name.toLowerCase())
        .sort((a, b) => b.timestamp - a.timestamp);
    return matches.length > 0 ? matches[0].price : null;
}

// --- DRAF LOGIC ---
document.getElementById('draftForm').onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('itemName').value;
    const dateValue = document.getElementById('itemDate').value;

    const item = {
        id: Date.now().toString(),
        name: name,
        qty: document.getElementById('itemQty').value,
        unit: document.getElementById('itemUnit').value,
        lastPrice: getLastPrice(name),
        selectedDate: dateValue
    };
    draftItems.push(item);

    document.getElementById('itemName').value = "";
    renderDraft();
};

function renderDraft() {
    const container = document.getElementById('draftContainer');
    const countEl = document.getElementById('draftCount');
    const saveBtn = document.getElementById('btnSaveSession');

    countEl.innerText = draftItems.length;
    saveBtn.disabled = draftItems.length === 0;

    if (draftItems.length === 0) {
        container.innerHTML = `<div class="flex-grow flex items-center justify-center text-gray-300 text-xs italic">Belum ada item ditambahkan</div>`;
        return;
    }

    container.innerHTML = draftItems.map((item, idx) => `
        <div class="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100 group">
            <div class="flex items-center gap-2">
                 <div class="w-6 h-6 bg-white rounded-full flex items-center justify-center text-[10px] font-bold text-blue-500">${idx + 1}</div>
                 <div>
                    <span class="text-sm font-bold text-gray-700">${item.name}</span>
                    <span class="text-[10px] text-gray-400 block">${item.qty} ${item.unit} • Untuk: ${item.selectedDate}</span>
                 </div>
            </div>
            <button data-action="remove-draft" data-idx="${idx}" class="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                <i data-lucide="minus-circle" width="18" height="18"></i>
            </button>
        </div>
    `).join('');

    // Add event listeners for dynamic buttons
    container.querySelectorAll('button[data-action="remove-draft"]').forEach(btn => {
        btn.onclick = () => window.removeFromDraft(parseInt(btn.getAttribute('data-idx')));
    });

    createIcons({ icons });
}

window.removeFromDraft = (idx) => {
    draftItems.splice(idx, 1);
    renderDraft();
};

document.getElementById('btnSaveSession').onclick = async () => {
    if (draftItems.length === 0) return;

    const refDate = new Date(draftItems[0].selectedDate);
    const dateStr = refDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    const sessionData = {
        items: draftItems,
        createdAt: refDate.getTime(),
        dateStr: dateStr,
        isoDate: draftItems[0].selectedDate,
        status: 'pending'
    };

    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'sessions'), sessionData);
    draftItems = [];
    renderDraft();
    showToast("Kartu Belanja Baru Tersimpan!");
};

// --- SESSIONS RENDER ---
function renderSessions() {
    const container = document.getElementById('sessionContainer');
    if (sessions.length === 0) {
        container.innerHTML = `<div class="col-span-full py-10 text-center text-gray-400 text-sm border-2 border-dashed rounded-3xl">Belum ada kartu belanja tersimpan.</div>`;
        return;
    }
    container.innerHTML = sessions.map(s => `
        <div class="glass-card session-card p-5 rounded-3xl cursor-pointer relative overflow-hidden" data-session-id="${s.id}">
            <div class="absolute top-0 right-0 p-4">
                 <button data-action="delete-session" data-id="${s.id}" class="text-gray-300 hover:text-red-500 transition-colors">
                    <i data-lucide="trash-2" width="14" height="14"></i>
                 </button>
            </div>
            <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center">
                    <i data-lucide="shopping-cart" width="20" height="20"></i>
                </div>
                <div>
                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sesi Belanja</p>
                    <p class="text-sm font-black text-gray-800">${s.dateStr}</p>
                </div>
            </div>
            <div class="space-y-1 mb-4">
                ${s.items.slice(0, 3).map(i => `<p class="text-[11px] text-gray-500 flex justify-between"><span>• ${i.name}</span> <span class="text-gray-400 font-medium">${i.qty} ${i.unit}</span></p>`).join('')}
                ${s.items.length > 3 ? `<p class="text-[10px] text-blue-500 font-bold mt-1">+ ${s.items.length - 3} item lainnya</p>` : ''}
            </div>
            <div class="pt-4 border-t flex justify-between items-center">
                <span class="text-[10px] bg-blue-100 text-blue-600 px-3 py-1 rounded-full font-bold uppercase">${s.items.length} Barang</span>
                <span class="text-xs text-blue-600 font-bold flex items-center gap-1">Input Harga <i data-lucide="arrow-right" width="14" height="14"></i></span>
            </div>
        </div>
    `).join('');

    // Add listners
    container.querySelectorAll('.session-card').forEach(card => {
        card.onclick = () => window.openDetail(card.getAttribute('data-session-id'));
    });
    container.querySelectorAll('button[data-action="delete-session"]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            window.deleteSession(btn.getAttribute('data-id'));
        };
    });

    createIcons({ icons });
}

// --- DETAIL ACTIONS ---
window.openDetail = (id) => {
    activeSessionId = id;
    temporaryPrices = {};
    document.getElementById('sessions-section').classList.add('hidden');
    document.getElementById('detail-section').classList.remove('hidden');
    document.getElementById('detail-section').scrollIntoView({ behavior: 'smooth' });
    renderDetail();
};

window.closeDetail = () => {
    activeSessionId = null;
    document.getElementById('sessions-section').classList.remove('hidden');
    document.getElementById('detail-section').classList.add('hidden');
    document.body.scrollIntoView({ behavior: 'smooth' });
};

// Bind button clicks in HTML to window functions if needed, or add listeners here
document.getElementById('btnBackDetail').onclick = window.closeDetail;
document.getElementById('btnCancelDetail').onclick = window.closeDetail;
document.getElementById('btnFinishSession').onclick = () => window.finishSession();

function renderDetail() {
    const session = sessions.find(s => s.id === activeSessionId);
    if (!session) { window.closeDetail(); return; }

    document.getElementById('detailTitle').innerText = `Input Harga ${session.dateStr}`;
    document.getElementById('detailDate').innerText = `Pastikan harga sesuai struk belanja`;
    updateLiveTotal();

    const container = document.getElementById('detailItemsContainer');
    container.innerHTML = session.items.map(item => {
        const lastPrice = getLastPrice(item.name);
        return `
        <div id="row-${item.id}" class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100 transition-all duration-300">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 shadow-sm border border-slate-100">
                    <i data-lucide="tag" width="18" height="18"></i>
                </div>
                <div>
                    <p class="font-black text-gray-800 text-sm leading-none mb-1">${item.name}</p>
                    <p class="text-[11px] text-gray-400 font-medium">${item.qty} ${item.unit}</p>
                </div>
            </div>
            
            <div class="flex flex-col items-end gap-1">
                <div class="relative flex items-center">
                    <span class="absolute left-3 text-[10px] font-black text-gray-300">Rp</span>
                    <input type="text" inputmode="numeric" placeholder="0" 
                        data-action="price-input" data-item-id="${item.id}" data-last-price="${lastPrice || 0}"
                        class="price-input bg-white border-2 border-transparent focus:ring-2 focus:ring-blue-100 outline-none pl-9 pr-4 py-3 rounded-2xl text-sm font-black w-40 shadow-sm transition-all">
                </div>
                ${lastPrice ? `
                    <p class="text-[9px] font-bold text-gray-400 flex items-center gap-1">
                        <i data-lucide="info" width="10" height="10"></i> Harga Terakhir: ${formatIDR(lastPrice)}
                    </p>
                ` : '<p class="text-[9px] font-bold text-blue-400 italic">Belum ada data harga</p>'}
            </div>
        </div>
    `}).join('');

    container.querySelectorAll('input[data-action="price-input"]').forEach(input => {
        input.oninput = (e) => window.handlePriceDetail(
            input.getAttribute('data-item-id'),
            e.target.value,
            parseFloat(input.getAttribute('data-last-price'))
        );
    });

    createIcons({ icons });
}

window.handlePriceDetail = (itemId, val, lastPrice) => {
    const raw = val.replace(/\D/g, "");
    const currentPrice = parseInt(raw) || 0;
    temporaryPrices[itemId] = currentPrice;

    // Use event.target if triggered by event, otherwise we need to find the input
    // Since we call this from oninput handler, event.target might not be reliable if we called it directly. 
    // But let's find the input by ID 
    // Wait, I didn't give ID to input. Let's find via querySelector in the row
    const row = document.getElementById(`row-${itemId}`);
    const input = row.querySelector('input');

    input.value = raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

    if (currentPrice === 0) {
        input.className = "price-input bg-white border-2 border-transparent focus:ring-2 focus:ring-blue-100 outline-none pl-9 pr-4 py-3 rounded-2xl text-sm font-black w-40 shadow-sm transition-all";
        row.classList.remove('price-up', 'price-down');
    } else if (lastPrice > 0) {
        if (currentPrice > lastPrice) {
            input.className = "price-input bg-white border-2 border-red-500 text-red-600 outline-none pl-9 pr-4 py-3 rounded-2xl text-sm font-black w-40 shadow-sm transition-all";
            row.classList.add('price-up');
            row.classList.remove('price-down');
        } else {
            input.className = "price-input bg-white border-2 border-green-500 text-green-600 outline-none pl-9 pr-4 py-3 rounded-2xl text-sm font-black w-40 shadow-sm transition-all";
            row.classList.add('price-down');
            row.classList.remove('price-up');
        }
    }
    updateLiveTotal();
};

function updateLiveTotal() {
    const total = Object.values(temporaryPrices).reduce((a, b) => a + b, 0);
    document.getElementById('detailTotalLive').innerText = formatIDR(total);
}

window.finishSession = async () => {
    const session = sessions.find(s => s.id === activeSessionId);
    if (!session) return;

    const batch = writeBatch(db);
    const historyRef = collection(db, 'artifacts', appId, 'users', user.uid, 'history');

    const finalTimestamp = new Date(session.isoDate || session.createdAt).getTime();

    session.items.forEach(item => {
        const price = temporaryPrices[item.id] || 0;
        const newDoc = doc(historyRef);
        batch.set(newDoc, {
            ...item,
            price: price,
            sessionDate: session.dateStr,
            timestamp: finalTimestamp
        });
    });

    batch.delete(doc(db, 'artifacts', appId, 'users', user.uid, 'sessions', activeSessionId));

    await batch.commit();
    showToast(`Belanja Berhasil Dicatat!`);
    window.closeDetail();
};

function renderHistory() {
    const m = parseInt(filterMonth.value);
    const y = parseInt(filterYear.value);

    const filtered = historyData.filter(i => {
        const d = new Date(i.timestamp);
        return d.getMonth() === m && d.getFullYear() === y;
    }).sort((a, b) => b.timestamp - a.timestamp);

    const container = document.getElementById('historyContainer');
    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center py-10 bg-white rounded-3xl border border-dashed text-gray-400 text-xs italic">Belum ada riwayat belanja untuk ${monthNames[m]} ${y}.</div>`;
        return;
    }

    container.innerHTML = filtered.map(item => `
        <div class="bg-white p-4 rounded-2xl border border-gray-100 flex justify-between items-center shadow-sm hover:shadow-md transition-shadow group">
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300"><i data-lucide="check" width="14" height="14"></i></div>
                <div>
                    <p class="text-xs font-black text-gray-800 leading-none">${item.name}</p>
                    <p class="text-[10px] text-gray-400 font-medium">${item.qty} ${item.unit} • ${new Date(item.timestamp).toLocaleDateString('id-ID')}</p>
                </div>
            </div>
            <div class="flex items-center gap-4">
                <p class="text-sm font-black text-blue-600">${formatIDR(item.price)}</p>
                <button data-action="delete-history" data-id="${item.id}" class="text-gray-200 hover:text-red-500 transition-colors">
                    <i data-lucide="trash" width="14" height="14"></i>
                </button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('button[data-action="delete-history"]').forEach(btn => {
        btn.onclick = () => window.deleteItem(btn.getAttribute('data-id'), 'history');
    });

    createIcons({ icons });
}

function renderTotals() {
    const m = parseInt(filterMonth.value);
    const y = parseInt(filterYear.value);
    document.getElementById('labelMonth').innerText = `${monthNames[m]}`;

    const total = historyData
        .filter(i => {
            const d = new Date(i.timestamp);
            return d.getMonth() === m && d.getFullYear() === y;
        })
        .reduce((s, i) => s + i.price, 0);
    document.getElementById('totalMonth').innerText = formatIDR(total);
}

window.deleteSession = async (id) => {
    if (confirm("Hapus kartu belanja ini?")) {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'sessions', id));
    }
};

window.deleteItem = async (id, coll) => {
    if (confirm("Hapus data riwayat ini?")) {
        await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, coll, id));
    }
};

filterMonth.onchange = () => renderAllHistoryUI();
filterYear.onchange = () => renderAllHistoryUI();
