const LIFF_ID = 'YOUR_LIFF_ID_HERE'; // เปลี่ยนเป็น LIFF ID จริงของคุณ

document.addEventListener('DOMContentLoaded', async () => {
    await initializeLIFF();
    handleNavigation();
    setupCreateAssistantModal();
    await loadAssistants();
});

async function initializeLIFF() {
    try {
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
            liff.login({ redirectUri: window.location.href });
            return;
        }

        const profile = await liff.getProfile();
        document.getElementById('profile-picture').src = profile.pictureUrl;
        document.getElementById('display-name').textContent = profile.displayName;

        // Show loaded profile
        document.getElementById('profile-picture').classList.remove('hidden');
        document.getElementById('profile-picture-container').classList.remove('skeleton');
        document.getElementById('display-name').classList.remove('hidden');
        document.getElementById('display-name-container').classList.remove('skeleton');
    } catch (err) {
        console.error('LIFF initialization failed', err);
        alert('ไม่สามารถโหลดข้อมูลผู้ใช้จาก LINE ได้');
    }
}

function handleNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[id$="-page"]').forEach(page => page.classList.add('hidden'));
            document.getElementById(btn.dataset.page).classList.remove('hidden');
            navButtons.forEach(b => b.classList.remove('text-indigo-600'));
            btn.classList.add('text-indigo-600');
        });
    });
}

async function loadAssistants() {
    const listContainer = document.getElementById('assistant-list');
    listContainer.innerHTML = '';

    try {
        const token = liff.getIDToken();
        const response = await fetch('/api/assistants', {
            headers: { Authorization: `Bearer ${token}` }
        });

        const assistants = await response.json();
        if (assistants.length === 0) {
            listContainer.innerHTML = '<p class="text-sm text-slate-500">ยังไม่มีผู้ช่วย AI</p>';
            return;
        }

        assistants.forEach(assistant => {
            const card = document.createElement('div');
            card.className = 'bg-white p-4 rounded-lg shadow-sm';
            card.innerHTML = `<p class="font-bold text-slate-900">${assistant.assistantName}</p><p class="text-sm text-slate-500">สร้างเมื่อ: ${assistant.createdAt?.toDate ? assistant.createdAt.toDate().toLocaleString() : 'เร็วๆ นี้'}</p>`;
            listContainer.appendChild(card);
        });

        // อัปเดต dropdowns
        updateAssistantSelects(assistants);
    } catch (error) {
        console.error('โหลดผู้ช่วยล้มเหลว:', error);
        listContainer.innerHTML = '<p class="text-sm text-red-500">เกิดข้อผิดพลาดในการโหลดผู้ช่วย</p>';
    }
}

function updateAssistantSelects(assistants) {
    const selects = [document.getElementById('knowledge-assistant-select'), document.getElementById('playground-assistant-select')];
    selects.forEach(select => {
        select.innerHTML = '';
        assistants.forEach(a => {
            const option = document.createElement('option');
            option.value = a.id;
            option.textContent = a.assistantName;
            select.appendChild(option);
        });
    });
}

function setupCreateAssistantModal() {
    const modal = document.getElementById('create-assistant-modal');
    const openBtn = document.getElementById('add-assistant-btn');
    const cancelBtn = document.getElementById('cancel-create-btn');
    const saveBtn = document.getElementById('save-create-btn');
    const nameInput = document.getElementById('new-assistant-name');
    const statusDiv = document.getElementById('create-status');

    openBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        nameInput.value = '';
        statusDiv.textContent = '';
    });

    cancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    saveBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            statusDiv.textContent = 'กรุณากรอกชื่อผู้ช่วย';
            return;
        }

        try {
            const token = liff.getIDToken();
            const res = await fetch('/api/assistants', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'ไม่สามารถสร้างผู้ช่วยได้');
            }

            modal.classList.add('hidden');
            await loadAssistants();
        } catch (err) {
            console.error('สร้างผู้ช่วยล้มเหลว', err);
            statusDiv.textContent = err.message;
        }
    });
}
