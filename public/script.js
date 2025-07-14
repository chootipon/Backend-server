document.addEventListener('DOMContentLoaded', function() {
    // =================================================================
    // 1. ค่าคงที่และตัวแปร (Constants and Variables)
    // =================================================================
    
    // ## ส่วนที่แก้ไข: ทำให้เรียก API ในบ้านตัวเอง ##
    const RENDER_APP_URL = ''; // ไม่ต้องใส่อะไรเลย มันจะเรียกหา URL ปัจจุบันโดยอัตโนมัติ
    const LIFF_ID = '2007746118-q42ABEk3'; // <<-- สำคัญมาก: ใส่ LIFF ID ของคุณ

    // --- การอ้างอิงถึง Element ต่างๆ ในหน้าเว็บ ---
    const profilePicture = document.getElementById('profile-picture');
    const displayName = document.getElementById('display-name');
    const profilePictureContainer = document.getElementById('profile-picture-container');
    const displayNameContainer = document.getElementById('display-name-container');
    const assistantList = document.getElementById('assistant-list');
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
    const connectModal = document.getElementById('connect-modal');
    const webhookModal = document.getElementById('webhook-modal');
    const cancelConnectBtn = document.getElementById('cancel-connect-btn');
    const saveConnectBtn = document.getElementById('save-connect-btn');
    const closeWebhookModalBtn = document.getElementById('close-webhook-modal-btn');


    // =================================================================
    // 2. ฟังก์ชันหลัก (Core Functions)
    // =================================================================
    async function main() {
        try {
            await liff.init({ liffId: LIFF_ID });
            if (!liff.isLoggedIn()) {
                liff.login({ redirectUri: window.location.href });
                return; 
            }
            const profile = await liff.getProfile();
            updateProfileUI(profile);
            await fetchAndRenderAssistants();
        } catch (error) {
            console.error('LIFF Initialization or Data Fetch failed', error);
            alert('เกิดข้อผิดพลาดในการเริ่มต้นแอป โปรดตรวจสอบ LIFF ID และการตั้งค่า');
        }
    }

    function updateProfileUI(profile) {
        profilePicture.src = profile.pictureUrl;
        profilePicture.classList.remove('hidden');
        profilePictureContainer.classList.remove('skeleton', 'skeleton-avatar');
        displayName.textContent = profile.displayName;
        displayName.classList.remove('hidden');
        displayNameContainer.classList.remove('skeleton', 'skeleton-text', 'w-32');
    }

    async function fetchAndRenderAssistants() {
        assistantList.innerHTML = `<div class="bg-white p-4 rounded-lg shadow-sm skeleton animate-pulse"><div class="h-4 bg-slate-200 rounded w-3/4 mb-2"></div><div class="h-3 bg-slate-200 rounded w-1/2"></div></div>`;
        try {
            const response = await fetch(`${RENDER_APP_URL}/api/assistants`, {
                headers: { 'Authorization': 'Bearer ' + liff.getAccessToken() }
            });
            if (!response.ok) throw new Error('ไม่สามารถดึงข้อมูลผู้ช่วยได้');
            const assistants = await response.json();
            renderAssistants(assistants);
            populateAssistantSelects(assistants);
        } catch (error) {
            console.error('Fetch Assistants Error:', error);
            assistantList.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
        }
    }

    function renderAssistants(assistants) {
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
                    <div class="mt-3 pt-3 border-t border-slate-100">
                        <button data-assistant-id="${assistant.id}" class="connect-btn w-full bg-slate-800 text-white text-sm font-medium py-2 px-3 rounded-lg hover:bg-slate-900 flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"></path></svg>
                            <span>${isConnected ? 'จัดการการเชื่อมต่อ' : 'เชื่อมต่อกับ LINE OA'}</span>
                        </button>
                    </div>
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
        createAssistantModal.classList.add('hidden');
        connectModal.classList.add('hidden');
        webhookModal.classList.add('hidden');
    }

    // =================================================================
    // 3. ฟังก์ชันจัดการ Event (Event Handlers)
    // =================================================================
    async function handleCreateAssistant() {
        const nameInput = document.getElementById('new-assistant-name');
        const statusDiv = document.getElementById('create-status');
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
            if (!response.ok) throw new Error('ไม่สามารถสร้างผู้ช่วยได้');
            closeAllModals();
            nameInput.value = '';
            await fetchAndRenderAssistants();
        } catch (error) {
            console.error('Create Assistant Error:', error);
            statusDiv.textContent = 'เกิดข้อผิดพลาดในการสร้าง';
        } finally {
            saveCreateBtn.disabled = false;
            saveCreateBtn.textContent = 'สร้างผู้ช่วย';
        }
    }

    async function handleSaveKnowledge() {
        const titleInput = document.getElementById('knowledgeTitle');
        const contentInput = document.getElementById('knowledgeContent');
        const statusDiv = document.getElementById('status');
        const assistantId = knowledgeAssistantSelect.value;
        const title = titleInput.value.trim();
        const content = contentInput.value.trim();
        if (!assistantId || !title || !content) {
            statusDiv.textContent = 'กรุณากรอกข้อมูลให้ครบถ้วน';
            statusDiv.className = 'text-center text-sm mt-2 text-red-600';
            return;
        }
        saveKnowledgeButton.disabled = true;
        saveKnowledgeButton.textContent = 'กำลังบันทึก...';
        statusDiv.textContent = 'กำลังบันทึกข้อมูล...';
        statusDiv.className = 'text-center text-sm mt-2 text-slate-600';
        try {
            const response = await fetch(`${RENDER_APP_URL}/api/add-knowledge`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + liff.getAccessToken()
                },
                body: JSON.stringify({ assistantId, title, content }),
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const result = await response.json();
            statusDiv.textContent = result.message;
            statusDiv.className = 'text-center text-sm mt-2 text-green-600';
            titleInput.value = '';
            contentInput.value = '';
        } catch (error) {
            statusDiv.textContent = `เกิดข้อผิดพลาด: ${error.message}`;
            statusDiv.className = 'text-center text-sm mt-2 text-red-600';
        } finally {
            saveKnowledgeButton.disabled = false;
            saveKnowledgeButton.textContent = 'บันทึกความรู้';
        }
    }
    
    async function handleChatSubmit(event) {
        event.preventDefault();
        const userInput = chatInput.value.trim();
        const assistantId = playgroundAssistantSelect.value;
        if (!userInput || !assistantId) return;
        addMessageToChat('user', userInput);
        chatInput.value = '';
        addMessageToChat('loading', '');
        try {
            const response = await fetch(`${RENDER_APP_URL}/api/test-chat`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + liff.getAccessToken()
                },
                body: JSON.stringify({ assistantId, message: userInput }),
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            
            const result = await response.json();
            addMessageToChat('ai', result.reply);

        } catch (error) {
            addMessageToChat('ai', `ขออภัยค่ะ เกิดข้อผิดพลาด: ${error.message}`);
        }
    }
    
    async function handleSaveConnection() {
        const assistantId = document.getElementById('connect-assistant-id').value;
        const accessToken = document.getElementById('channel-access-token').value.trim();
        const channelSecret = document.getElementById('channel-secret').value.trim();
        const statusDiv = document.getElementById('connect-status');
        if (!assistantId || !accessToken || !channelSecret) {
            statusDiv.textContent = 'กรุณากรอกข้อมูลให้ครบทุกช่อง';
            return;
        }
        saveConnectBtn.disabled = true;
        saveConnectBtn.textContent = 'กำลังเชื่อมต่อ...';
        statusDiv.textContent = 'กำลังเชื่อมต่อ...';
        try {
            const response = await fetch(`${RENDER_APP_URL}/api/connect-assistant`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + liff.getAccessToken()
                },
                body: JSON.stringify({ assistantId, accessToken, channelSecret }),
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const result = await response.json();
            document.getElementById('webhook-url-display').textContent = result.webhookUrl;
            connectModal.classList.add('hidden');
            webhookModal.classList.remove('hidden');
            await fetchAndRenderAssistants();
        } catch (error) {
            statusDiv.textContent = `เกิดข้อผิดพลาด: ${error.message}`;
        } finally {
            saveConnectBtn.disabled = false;
            saveConnectBtn.textContent = 'บันทึกและเชื่อมต่อ';
        }
    }

    function openConnectModal(assistantId) {
        document.getElementById('connect-assistant-id').value = assistantId;
        connectModal.classList.remove('hidden');
    }

    function addMessageToChat(sender, text) {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) loadingIndicator.remove();

        let messageHtml = '';
        const sanitizedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        if (sender === 'user') {
            messageHtml = `<div class="flex items-start gap-2.5 justify-end"><div class="flex flex-col gap-1"><div class="bg-indigo-500 text-white rounded-s-xl rounded-ee-xl p-3"><p class="text-sm">${sanitizedText}</p></div></div></div>`;
        } else if (sender === 'ai') {
            messageHtml = `<div class="flex items-start gap-2.5"><div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-600">AI</div><div class="flex flex-col gap-1"><div class="bg-slate-100 rounded-e-xl rounded-es-xl p-3"><p class="text-sm text-slate-900">${sanitizedText}</p></div></div></div>`;
        } else if (sender === 'loading') {
            messageHtml = `<div id="loading-indicator" class="flex items-start gap-2.5"><div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center font-bold text-indigo-600">AI</div><div class="flex flex-col gap-1"><div class="bg-slate-100 rounded-e-xl rounded-es-xl p-3 flex items-center gap-2"><span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span><span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span><span class="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span></div></div></div>`;
        }

        chatMessages.insertAdjacentHTML('beforeend', messageHtml);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // =================================================================
    // 4. การผูก Event Listeners (Event Listeners Binding)
    // =================================================================
    
    main(); // <-- เริ่มต้นการทำงานทั้งหมด

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            showPage(btn.getAttribute('data-page'));
        });
    });

    if (saveKnowledgeButton) saveKnowledgeButton.addEventListener('click', handleSaveKnowledge);
    if (chatForm) chatForm.addEventListener('submit', handleChatSubmit);
    
    addAssistantBtn.addEventListener('click', () => createAssistantModal.classList.remove('hidden'));
    cancelCreateBtn.addEventListener('click', closeAllModals);
    saveCreateBtn.addEventListener('click', handleCreateAssistant);

    assistantList.addEventListener('click', function(event) {
        const connectButton = event.target.closest('.connect-btn');
        if (connectButton) {
            const assistantId = connectButton.getAttribute('data-assistant-id');
            openConnectModal(assistantId);
        }
    });
    
    cancelConnectBtn.addEventListener('click', closeAllModals);
    saveConnectBtn.addEventListener('click', handleSaveConnection);
    closeWebhookModalBtn.addEventListener('click', closeAllModals);

    // --- แสดงหน้าแรกเมื่อเริ่มต้น ---
    showPage('dashboard-page');
});
