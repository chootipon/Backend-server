// script.js

// เริ่มต้น LIFF app
async function initializeLiff() {
  try {
    await liff.init({ liffId: "2007746118-q42ABEk3" });  // <-- แก้เป็น LIFF ID ของคุณ
    if (!liff.isLoggedIn()) {
      liff.login(); // ถ้ายังไม่ login ให้ไป login ก่อน
    } else {
      console.log("LIFF logged in");
      await loadUserProfile();
      await loadAssistants();
      setupEventListeners();
    }
  } catch (error) {
    console.error("LIFF initialization failed", error);
  }
}

// ดึง access token จาก LIFF
function getAccessToken() {
  try {
    const token = liff.getAccessToken();
    if (!token) throw new Error("No access token found");
    return token;
  } catch (error) {
    console.error("Failed to get access token", error);
    return null;
  }
}

// โหลดข้อมูลผู้ใช้จาก LIFF profile
async function loadUserProfile() {
  try {
    const profile = await liff.getProfile();
    document.getElementById("display-name").textContent = profile.displayName;
    const imgEl = document.getElementById("profile-picture");
    imgEl.src = profile.pictureUrl;
    imgEl.classList.remove("hidden");
    document.getElementById("display-name").classList.remove("hidden");
    document.getElementById("display-name-container").classList.remove("skeleton");
    document.getElementById("profile-picture-container").classList.remove("skeleton");
  } catch (error) {
    console.error("Failed to load profile", error);
  }
}

// โหลดรายชื่อผู้ช่วยจาก backend
async function loadAssistants() {
  try {
    const token = getAccessToken();
    if (!token) throw new Error("No token for API");

    const response = await fetch("https://backend-server-yr22.onrender.com/api/assistants", {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const assistants = await response.json();

    if (!Array.isArray(assistants)) {
      throw new Error("Invalid response format");
    }

    const listEl = document.getElementById("assistant-list");
    listEl.innerHTML = ""; // เคลียร์ก่อน

    if (assistants.length === 0) {
      listEl.innerHTML = `<p class="text-slate-500">ยังไม่มีผู้ช่วย AI</p>`;
      return;
    }

    assistants.forEach(assistant => {
      const div = document.createElement("div");
      div.className = "bg-white p-4 rounded-lg shadow-sm";
      div.textContent = assistant.name;
      listEl.appendChild(div);
    });

  } catch (error) {
    console.error("โหลดผู้ช่วยล้มเหลว:", error);
    const listEl = document.getElementById("assistant-list");
    listEl.innerHTML = `<p class="text-red-600">ไม่สามารถโหลดผู้ช่วยได้</p>`;
  }
}

// สร้างผู้ช่วยใหม่
async function createAssistant(name) {
  try {
    const token = getAccessToken();
    if (!token) throw new Error("No token for API");

    const response = await fetch("https://backend-server-yr22.onrender.com/api/assistants", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      let errMsg = `HTTP error! status: ${response.status}`;
      try {
        const errData = await response.json();
        if (errData.message) errMsg = errData.message;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const newAssistant = await response.json();
    console.log("สร้างผู้ช่วยสำเร็จ:", newAssistant);

    // โหลดผู้ช่วยใหม่ทั้งหมดหลังสร้างเสร็จ
    await loadAssistants();
    closeCreateModal();

  } catch (error) {
    console.error("สร้างผู้ช่วยล้มเหลว:", error);
    document.getElementById("create-status").textContent = error.message;
  }
}

// ตั้ง event listener ปุ่มสร้างผู้ช่วย
function setupEventListeners() {
  document.getElementById("add-assistant-btn").addEventListener("click", () => {
    document.getElementById("create-assistant-modal").classList.remove("hidden");
    document.getElementById("new-assistant-name").value = "";
    document.getElementById("create-status").textContent = "";
  });

  document.getElementById("cancel-create-btn").addEventListener("click", closeCreateModal);

  document.getElementById("save-create-btn").addEventListener("click", () => {
    const nameInput = document.getElementById("new-assistant-name");
    const name = nameInput.value.trim();
    if (name.length === 0) {
      document.getElementById("create-status").textContent = "กรุณากรอกชื่อผู้ช่วย";
      return;
    }
    createAssistant(name);
  });
}

function closeCreateModal() {
  document.getElementById("create-assistant-modal").classList.add("hidden");
}

// เรียก initialize ตอนโหลดหน้าเว็บ
window.addEventListener("load", () => {
  initializeLiff();
});
