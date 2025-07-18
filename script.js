document.addEventListener('DOMContentLoaded', function() {
    // =================================================================
    // 1. ค่าคงที่และตัวแปร
    // =================================================================
    const RENDER_APP_URL = ''; // ใช้บ้านเดียวกัน
    const LIFF_ID = '2007746118-q42ABEk3'; // <<-- สำคัญมาก: ใส่ LIFF ID ของคุณ

    // --- การอ้างอิงถึง Element ---
    const profilePicture = document.getElementById('profile-picture');
    const displayName = document.getElementById('display-name');
    const profilePictureContainer = document.getElementById('profile-picture-container');
    const displayNameContainer = document.getElementById('display-name-container');
    const assistantList = document.getElementById('assistant-list');
    const errorContainer = document.getElementById('error-container');
    const errorDetails = document.getElementById('error-details');
    const addAssistantBtn = document.getElementById('add-assistant-btn');

    // =================================================================
    // 2. ฟังก์ชันหลัก
    // =================================================================

    /**
     * ฟังก์ชันเริ่มต้นการทำงานทั้งหมด
     */
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
            
            // ## ส่วนที่แก้ไข: รอให้ liff.ready ทำงานเสร็จสมบูรณ์ ##
            // เพื่อให้แน่ใจว่าทุกอย่างพร้อมใช้งาน
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

    /**
     * อัปเดต UI ด้วยข้อมูลโปรไฟล์จาก LINE
     */
    function updateProfileUI(profile) {
        profilePicture.src = profile.pictureUrl;
        profilePicture.classList.remove('hidden');
        profilePictureContainer.classList.remove('skeleton');
        displayName.textContent = profile.displayName;
        displayName.classList.remove('hidden');
        displayNameContainer.classList.remove('skeleton', 'h-5', 'w-32', 'rounded');
    }
    
    /**
     * แสดงข้อความ Error บนหน้าจอ
     */
    function showError(details) {
        if (errorContainer && errorDetails) {
            errorContainer.classList.remove('hidden');
            errorDetails.textContent = details;
        } else {
            console.error("Error display elements not found!");
        }
    }

    /**
     * แสดงสถานะการทำงานบนหน้าจอ
     */
    function showInfo(message) {
        if (assistantList) {
            assistantList.innerHTML = `<p class="text-center text-slate-500 animate-pulse">${message}</p>`;
        }
    }

    /**
     * ดึงข้อมูลผู้ช่วย AI จาก Backend และสั่งให้แสดงผล
     */
    async function fetchAndRenderAssistants() {
        showInfo('กำลังดึงข้อมูล...');
        try {
            // ## ส่วนที่แก้ไข: ตรวจสอบ Access Token ก่อนเสมอ ##
            const accessToken = liff.getAccessToken();
            if (!accessToken) {
                // นี่คือจุดที่เคยเป็นปัญหา
                throw new Error('ไม่สามารถดึง Access Token จาก LIFF ได้ในตอนนี้');
            }

            const response = await fetch(`${RENDER_APP_URL}/api/assistants`, {
                headers: { 'Authorization': 'Bearer ' + accessToken }
            });

            if (!response.ok) {
                // พยายามอ่าน error message จาก server ก่อน
                const errorData = await response.json().catch(() => ({ error: `Server responded with status ${response.status}` }));
                throw new Error(errorData.error || 'ไม่สามารถดึงข้อมูลผู้ช่วยได้');
            }
            
            if (errorContainer) errorContainer.classList.add('hidden');
            const assistants = await response.json();
            renderAssistants(assistants);

        } catch (error) {
            console.error('Fetch Assistants Error:', error);
            showError(error.message);
            if (assistantList) assistantList.innerHTML = `<p class="text-center text-red-500">เกิดข้อผิดพลาด กรุณาลองรีเฟรชหน้าแอป</p>`;
        }
    }

    /**
     * สร้าง HTML สำหรับรายการผู้ช่วย AI
     */
    function renderAssistants(assistants) {
        if (!assistantList) return;
        assistantList.innerHTML = '';
        if (assistants.length === 0) {
            assistantList.innerHTML = `<p class="text-center text-slate-500">คุณยังไม่มีผู้ช่วย AI, กด 'สร้างใหม่' เพื่อเริ่มต้น</p>`;
            return;
        }
        assistants.forEach(assistant => {
            const cardHtml = `<div class="bg-white p-4 rounded-lg shadow-sm"><p class="font-semibold">${assistant.assistantName}</p></div>`;
            assistantList.insertAdjacentHTML('beforeend', cardHtml);
        });
    }

    /**
     * จัดการการสร้างผู้ช่วย AI ใหม่
     */
    async function handleCreateAssistant() {
        const assistantName = prompt("กรุณาตั้งชื่อผู้ช่วย AI ใหม่:");
        if (!assistantName || assistantName.trim() === '') return;

        showInfo('กำลังสร้างผู้ช่วยใหม่...');
        try {
             const response = await fetch(`${RENDER_APP_URL}/api/assistants`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + liff.getAccessToken()
                },
                body: JSON.stringify({ name: assistantName.trim() })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: `Server responded with status ${response.status}` }));
                throw new Error(errorData.error || 'ไม่สามารถสร้างผู้ช่วยได้');
            }
            await fetchAndRenderAssistants();
        } catch(error) {
            console.error('Create Assistant Error:', error);
            showError(error.message);
        }
    }

    // =================================================================
    // 3. การผูก Event Listeners
    // =================================================================
    
    main(); // <-- เริ่มต้นการทำงานทั้งหมด
    
    if (addAssistantBtn) {
        addAssistantBtn.addEventListener('click', handleCreateAssistant);
    }
});
