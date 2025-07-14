document.addEventListener('DOMContentLoaded', function() {
    // =================================================================
    // 1. ค่าคงที่และตัวแปร
    // =================================================================
    const RENDER_APP_URL = ''; // ใช้บ้านเดียวกัน
    const LIFF_ID = 'YOUR_LIFF_ID'; // <<-- สำคัญมาก: ใส่ LIFF ID ของคุณ

    // --- การอ้างอิงถึง Element ---
    const profilePicture = document.getElementById('profile-picture');
    const displayName = document.getElementById('display-name');
    const profilePictureContainer = document.getElementById('profile-picture-container');
    const displayNameContainer = document.getElementById('display-name-container');
    const assistantList = document.getElementById('assistant-list');
    const errorContainer = document.getElementById('error-container');
    const errorDetails = document.getElementById('error-details');
    
    const pages = document.querySelectorAll('#app-container > main > div[id$="-page"]');
    const navButtons = document.querySelectorAll('.nav-btn');
    
    const saveKnowledgeButton = document.getElementById('saveButton');
    const knowledgeAssistantSelect = document.getElementById('knowledge-assistant-select');
    
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const playgroundAssistantSelect = document.getElementById('playground-assistant-select');
    
    const addAssistantBtn = document.getElementById('add-assistant-btn');
    const createAssistantModal = document.getElementById('create-assistant-modal');
    const cancelCreateBtn = document.getElementById('cancel-create-btn');
    const saveCreateBtn = document.getElementById('save-create-btn');

    // =================================================================
    // 2. ฟังก์ชันหลัก
    // =================================================================

    async function main() {
        try {
            showInfo('กำลังเริ่มต้น LIFF...');
            await liff.init({ liffId: LIFF_ID });

            if (!liff.isLoggedIn()) {
                showInfo('กำลังพาไปล็อกอิน...');
                // ## ส่วนที่แก้ไข: ขอสิทธิ์ที่จำเป็น (profile และ openid) ##
                liff.login({ 
                    redirectUri: window.location.href,
                    scope: 'profile openid' 
                });
                return; 
            }
            
            await liff.ready;
            
            showInfo('ดึงข้อมูลโปรไฟล์...');
            const profile = await liff.getProfile();
            updateProfileUI(profile);

            showInfo('ดึงข้อมูลผู้ช่วย AI...');
            await fetchAndRenderAssistants();

        } catch (error) {
            console.error('LIFF Initialization or Data Fetch failed', error);
            showError(`เกิดข้อผิดพลาดในการเริ่มต้นแอป: ${error.message}`);
        }
    }

    function updateProfileUI(profile) {
        profilePicture.src = profile.pictureUrl;
        profilePicture.classList.remove('hidden');
        profilePictureContainer.classList.remove('skeleton');
        displayName.textContent = profile.displayName;
        displayName.classList.remove('hidden');
        displayNameContainer.classList.remove('skeleton', 'h-5', 'w-32', 'rounded');
    }
    
    function showError(details) {
        if (errorContainer && errorDetails) {
            errorContainer.classList.remove('hidden');
            errorDetails.textContent = details;
        } else {
            console.error("Error display elements not found!");
        }
    }

    function showInfo(message) {
        if (assistantList) {
            assistantList.innerHTML = `<p class="text-center text-slate-500 animate-pulse">${message}</p>`;
        }
    }

    async function fetchAndRenderAssistants() {
        showInfo('กำลังดึงข้อมูล...');
        try {
            const accessToken = liff.getAccessToken();
            if (!accessToken) throw new Error('ไม่สามารถดึง Access Token จาก LIFF ได้');

            const response = await fetch(`${RENDER_APP_URL}/api/assistants`, {
                headers: { 'Authorization': 'Bearer ' + accessToken }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server responded with status ${response.status}` }));
                throw new Error(errorData.error || 'ไม่สามารถดึงข้อมูลผู้ช่วยได้');
            }
            
            if (errorContainer) errorContainer.classList.add('hidden');
            const assistants = await response.json();
            renderAssistants(assistants);
            populateAssistantSelects(assistants);

        } catch (error) {
            console.error('Fetch Assistants Error:', error);
            showError(error.message);
            if (assistantList) assistantList.innerHTML = `<p class="text-center text-red-500">เกิดข้อผิดพลาด กรุณาลองรีเฟรชหน้าแอป</p>`;
        }
    }

    function renderAssistants(assistants) {
        if (!assistantList) return;
        assistantList.innerHTML = '';
        if (assistants.length === 0) {
            assistantList.innerHTML = `<p class="text-center text-slate-500">คุณยังไม่มีผู้ช่วย AI, กด 'สร้างใหม่' เพื่อเริ่มต้น</p>`;
            return;
        }
        assistants.forEach(assistant => {
            const isConnected = assistant.productionConfig && assistant.productionConfig.isDeployed;
            const cardHtml = `
                <div class="bg-white p-4 rounded-lg shadow-sm">
                    <div class="flex justify-between items-center">
                        <div>
                            <p class="font-semibold">${assistant.assistantName}</p>
                            <p class="text-xs text-slate-400">ID: ${assistant.id}</p>
                        </div>
                        ${isConnected 
                            ? `<span class="text-xs font-semibold text-blue-600 bg-blue-100 py-1 px-2 rounded-full">เชื่อมต่อแล้ว</span>` 
                            : `<span class="text-xs font-semibold text-slate-600 bg-slate-100 py-1 px-2 rounded-full">ยังไม่ได้เชื่อมต่อ</span>`
                        }
                    </div>
                    <!-- ปุ่มเชื่อมต่อสามารถเพิ่มกลับเข้ามาได้ในอนาคต -->
                </div>
            `;
            assistantList.insertAdjacentHTML('beforeend', cardHtml);
        });
    }

    function populateAssistantSelects(assistants) {
        knowledgeAssistantSelect.innerHTML = '';
        playgroundAssistantSelect.innerHTML = '';
        if (assistants.length > 0) {
            assistants.forEach(assistant => {
                const option = `<option value="${assistant.id}">${assistant.assistantName}</option>`;
                knowledgeAssistantSelect.insertAdjacentHTML('beforeend', option);
                playgroundAssistantSelect.insertAdjacentHTML('beforeend', option);
            });
        } else {
            const noOption = `<option disabled selected>กรุณาสร้างผู้ช่วยก่อน</option>`;
            knowledgeAssistantSelect.innerHTML = noOption;
            playgroundAssistantSelect.innerHTML = noOption;
        }
    }
    
    function showPage(pageId) {
        pages.forEach(page => page.classList.toggle('hidden', page.id !== pageId));
        navButtons.forEach(btn => {
            const isSelected = btn.getAttribute('data-page') === pageId;
            btn.classList.toggle('text-indigo-600', isSelected);
            btn.classList.toggle('text-slate-500', !isSelected);
        });
    }

    function closeAllModals() {
        if (createAssistantModal) createAssistantModal.classList.add('hidden');
    }

    // =================================================================
    // 3. ฟังก์ชันจัดการ Event (Event Handlers)
    // =================================================================
    async function handleCreateAssistant() {
        const nameInput = document.getElementById('new-assistant-name');
        const statusDiv = document.getElementById('create-status');
        if (!nameInput || !statusDiv) return;

        const assistantName = nameInput.value.trim();
        if (!assistantName) {
            statusDiv.textContent = 'กรุณาตั้งชื่อผู้ช่วย';
            return;
        }
        saveCreateBtn.disabled = true;
        saveCreateBtn.textContent = 'กำลังสร้าง...';
        try {
            const response = await fetch(`${RENDER_APP_URL}/api/assistants`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + liff.getAccessToken()
                },
                body: JSON.stringify({ name: assistantName })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'ไม่สามารถสร้างผู้ช่วยได้' }));
                throw new Error(errorData.error);
            }
            closeAllModals();
            nameInput.value = '';
            await fetchAndRenderAssistants();
        } catch(error) {
            console.error('Create Assistant Error:', error);
            statusDiv.textContent = `เกิดข้อผิดพลาด: ${error.message}`;
        } finally {
            saveCreateBtn.disabled = false;
            saveCreateBtn.textContent = 'สร้างผู้ช่วย';
        }
    }

    // =================================================================
    // 4. การผูก Event Listeners
    // =================================================================
    
    main(); // <-- เริ่มต้นการทำงานทั้งหมด
    
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            showPage(btn.getAttribute('data-page'));
        });
    });

    if (addAssistantBtn) addAssistantBtn.addEventListener('click', () => createAssistantModal.classList.remove('hidden'));
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', closeAllModals);
    if (saveCreateBtn) saveCreateBtn.addEventListener('click', handleCreateAssistant);

    showPage('dashboard-page');
});
