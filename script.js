document.addEventListener('DOMContentLoaded', function() {
    // =================================================================
    // 1. ค่าคงที่และตัวแปร
    // =================================================================
    const RENDER_APP_URL = ''; // ใช้บ้านเดียวกัน ไม่ต้องใส่ URL
    const LIFF_ID = '2007746118-q42ABEk3'; // <<-- สำคัญมาก: ใส่ LIFF ID ของคุณ

    // --- อ้างอิงถึง Element ---
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
            // แสดงสถานะว่ากำลังเริ่มต้น
            showInfo('กำลังเริ่มต้น LIFF...');
            await liff.init({ liffId: LIFF_ID });

            if (!liff.isLoggedIn()) {
                showInfo('กำลังพาไปล็อกอิน...');
                liff.login({ redirectUri: window.location.href });
                return; 
            }
            
            // รอให้ liff.ready ทำงานเสร็จสมบูรณ์
            await liff.ready;
            
            showInfo('ดึงข้อมูลโปรไฟล์...');
            const profile = await liff.getProfile();
            updateProfileUI(profile);

            showInfo('ดึงข้อมูลผู้ช่วย AI...');
            await fetchAndRenderAssistants();

        } catch (error) {
            console.error('LIFF Initialization or Data Fetch failed', error);
            showError('เกิดข้อผิดพลาดในการเริ่มต้นแอป', `โปรดตรวจสอบ LIFF ID และการตั้งค่า\n${error.message}`);
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
    function showError(title, details) {
        errorContainer.classList.remove('hidden');
        errorContainer.querySelector('h3').textContent = title;
        errorDetails.textContent = details;
    }

    /**
     * แสดงสถานะการทำงานบนหน้าจอ (สำหรับ Debug)
     */
    function showInfo(message) {
        assistantList.innerHTML = `<p class="text-center text-slate-500 animate-pulse">${message}</p>`;
    }

    /**
     * ดึงข้อมูลผู้ช่วย AI จาก Backend และสั่งให้แสดงผล
     */
    async function fetchAndRenderAssistants() {
        assistantList.innerHTML = `<div class="bg-white p-4 rounded-lg shadow-sm skeleton animate-pulse h-20"></div>`;
        try {
            // ## ส่วนที่แก้ไข: ตรวจสอบ Access Token ก่อนเสมอ ##
            const accessToken = liff.getAccessToken();
            if (!accessToken) {
                // นี่คือจุดที่เคยเป็นปัญหา
                throw new Error('ไม่สามารถดึง Access Token จาก LIFF ได้ในตอนนี้');
            }

            // แสดง Token ที่จะใช้ส่ง (เพื่อการวินิจฉัย)
            console.log("Sending API request with Access Token:", accessToken.substring(0, 15) + "...");

            const response = await fetch(`${RENDER_APP_URL}/api/assistants`, {
                headers: { 'Authorization': 'Bearer ' + accessToken }
            });

            if (!response.ok) {
                // พยายามอ่าน response เพื่อดู error ที่แท้จริงจาก server
                const errorData = await response.json().catch(() => ({ error: `Server responded with status ${response.status}` }));
                throw new Error(errorData.error || 'ไม่สามารถดึงข้อมูลผู้ช่วยได้');
            }
            
            // ถ้าสำเร็จ ให้ซ่อนกล่อง Error
            errorContainer.classList.add('hidden');
            const assistants = await response.json();
            renderAssistants(assistants);

        } catch (error) {
            console.error('Fetch Assistants Error:', error);
            showError('เกิดข้อผิดพลาดในการดึงข้อมูล', error.message);
            assistantList.innerHTML = `<p class="text-center text-red-500">เกิดข้อผิดพลาด กรุณาลองรีเฟรชหน้าแอป</p>`;
        }
    }

    /**
     * สร้าง HTML สำหรับรายการผู้ช่วย AI
     */
    function renderAssistants(assistants) {
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

    // =================================================================
    // 3. การผูก Event Listeners
    // =================================================================
    
    main(); // <-- เริ่มต้นการทำงานทั้งหมด
});
