document.addEventListener('DOMContentLoaded', function() {
    // ## แก้ไขแค่ 2 บรรทัดนี้ ##
    const RENDER_APP_URL = ''; // ใช้บ้านเดียวกัน ไม่ต้องใส่ URL
    const LIFF_ID = '2007746118-q42ABEk3'; // <<-- สำคัญ: ใส่ LIFF ID ของคุณ

    // --- อ้างอิงถึง Element ---
    const debugAuthBtn = document.getElementById('debug-auth-btn');
    const debugOutputContainer = document.getElementById('debug-output-container');
    const debugOutput = document.getElementById('debug-output');

    /**
     * ฟังก์ชันเริ่มต้น LIFF
     */
    async function main() {
        try {
            await liff.init({ liffId: LIFF_ID });
            if (!liff.isLoggedIn()) {
                // ถ้ายังไม่ล็อกอิน ให้ไปหน้าล็อกอินของ LINE
                // แล้วจะไม่ทำงานใดๆ ต่อจนกว่าจะล็อกอินเสร็จ
                liff.login({ redirectUri: window.location.href });
            }
        } catch (error) {
            console.error('LIFF Init Error:', error);
            alert('LIFF Initialization Failed. Please check your LIFF ID.');
        }
    }

    /**
     * ฟังก์ชันสำหรับเรียก API วินิจฉัย
     */
    async function handleDebugAuth() {
        debugOutputContainer.classList.remove('hidden');
        debugOutput.textContent = 'กำลังตรวจสอบ...';

        try {
            // รอให้ liff.init เสร็จก่อน
            await liff.ready;
            
            const accessToken = liff.getAccessToken();
            if (!accessToken) {
                debugOutput.textContent = 'Error: ไม่พบ Access Token, กรุณาลองรีเฟรชหน้าแอป';
                return;
            }

            const response = await fetch(`${RENDER_APP_URL}/api/debug-auth`, {
                headers: { 'Authorization': 'Bearer ' + accessToken }
            });

            const result = await response.json();
            
            // แสดงผลลัพธ์แบบ JSON ที่อ่านง่าย
            debugOutput.textContent = JSON.stringify(result, null, 2);

        } catch (error) {
            console.error('Debug Auth Error:', error);
            debugOutput.textContent = `เกิดข้อผิดพลาดในการเรียก API: ${error.message}`;
        }
    }

    // --- เริ่มต้นการทำงานและผูก Event ---
    main();
    
    if (debugAuthBtn) {
        debugAuthBtn.addEventListener('click', handleDebugAuth);
    }
});
