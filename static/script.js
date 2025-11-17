// ============================================
// DOM Elements Cache
// ============================================
const DOM = {
  sidebar: null,
  closeSidebar: null,
  openSidebar: null,
  chatForm: null,
  chatBox: null,
  userInput: null,
  chatList: null,
  btnNewChat: null,
  toggleTheme: null,
  toggleCircle: null,
  body: null,

  init() {
    this.sidebar = document.getElementById("sidebar");
    this.closeSidebar = document.getElementById("closeSidebar");
    this.openSidebar = document.getElementById("openSidebar");
    this.chatForm = document.getElementById("chatForm");
    this.chatBox = document.getElementById("chatBox");
    this.userInput = document.getElementById("userInput");
    this.chatList = document.getElementById("chatList");
    this.btnNewChat = document.getElementById("btn-new-chat");
    this.toggleTheme = document.getElementById("toggleTheme");
    this.toggleCircle = document.getElementById("toggleCircle");
    this.body = document.body;
  }
};

// ============================================
// State Management
// ============================================
const AppState = {
  currentSession: null,

  setSession(id) {
    this.currentSession = id;
  },

  getSession() {
    return this.currentSession;
  },

  clearSession() {
    this.currentSession = null;
  }
};

// ============================================
// API Service
// ============================================
const API = {
  async getSessions() {
    const res = await fetch("/sessions");
    return await res.json();
  },

  async getSession(id) {
    const res = await fetch(`/session/${id}`);
    return await res.json();
  },

  async generateImage(prompt, sessionId) {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, session_id: sessionId })
    });
    return await res.json();
  },

  async updateStatus(messageId, status) {
    const res = await fetch("/update_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, status })
    });
    return await res.json();
  },

  async regenerateImage(messageId) {
    const res = await fetch("/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId })
    });
    return await res.json();
  }
};

// ============================================
// UI Components
// ============================================
const UI = {
  createLoadingMessage() {
    const div = document.createElement("div");
    div.className = "self-start max-w-lg magic-response my-2";
    div.innerHTML = `
      <div class="magic-icon-loading flex items-center gap-2 text-gray-600">
        <img src="/static/sources/magic-wand-unscreen.gif" alt="Loading" class="w-8 h-8">
        <p>H&C is casting a spell for the image, please wait for a moment...</p>
      </div>`;
    return div;
  },

  createErrorMessage(text) {
    const div = document.createElement("div");
    div.className = "text-red-500 p-3 rounded-xl bg-red-50";
    div.textContent = text;
    return div;
  },

  createToolbarButton(icon, title, action) {
    const btn = document.createElement("button");
    btn.className = "p-2 hover:bg-purple-100 rounded-full transition";
    btn.title = title;
    btn.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i>`;
    btn.dataset.action = action;
    return btn;
  },

  scrollToBottom() {
    DOM.chatBox.scrollTop = DOM.chatBox.scrollHeight;
  },

  clearInput() {
    DOM.userInput.value = "";
  }
};

// ============================================
// Message Renderer
// ============================================
const MessageRenderer = {
  render(msg) {
    const div = document.createElement("div");
    div.className = msg.sender === "user" ? "text-right my-2" : "text-left my-2";

    if (msg.text && !msg.image_url) {
      this.renderTextMessage(div, msg);
    }

    if (msg.image_url) {
      this.renderImageMessage(div, msg);
    }

    DOM.chatBox.appendChild(div);
  },

  renderTextMessage(container, msg) {
    const p = document.createElement("p");
    p.className = msg.sender === "user"
      ? "inline-block bg-purple-600 text-white px-3 py-2 rounded-xl"
      : "inline-block bg-gray-200 px-3 py-2 rounded-xl";
    p.textContent = msg.text;
    container.appendChild(p);
  },

  renderImageMessage(container, msg) {
    const imgContainer = document.createElement("div");
    imgContainer.className = "flex flex-col items-start max-w-lg mt-2";
    imgContainer.dataset.messageId = msg.id;

    const img = document.createElement("img");
    img.src = msg.image_url;
    img.className = "rounded-xl shadow-md border border-purple-200 max-w-lg w-full";
    imgContainer.appendChild(img);

    const toolbar = this.createToolbar(msg);
    imgContainer.appendChild(toolbar);
    container.appendChild(imgContainer);
  },

  createToolbar(msg) {
    const toolbar = document.createElement("div");
    toolbar.className = "flex gap-3 mt-2 text-gray-500";

    const buttons = [
      { icon: "heart", title: "Thích", action: "like" },
      { icon: "thumbs-down", title: "Không thích", action: "dislike" },
      { icon: "refresh-ccw", title: "Tạo lại", action: "refresh" },
      { icon: "copy", title: "Sao chép ảnh", action: "copy" },
      { icon: "download", title: "Tải xuống", action: "download" }
    ];

    buttons.forEach(btnConfig => {
      const btn = UI.createToolbarButton(btnConfig.icon, btnConfig.title, btnConfig.action);
      btn.addEventListener("click", (e) => this.handleToolbarAction(e, msg));
      toolbar.appendChild(btn);
    });

    return toolbar;
  },

  async handleToolbarAction(e, msg) {
    const btn = e.currentTarget;
    const action = btn.dataset.action;
    const messageId = btn.closest("[data-message-id]").dataset.messageId;

    try {
      switch (action) {
        case "like":
        case "dislike":
          await this.handleLikeDislike(btn, messageId, action);
          break;
        case "refresh":
          await this.handleRefresh(messageId);
          break;
        case "copy":
          await this.handleCopy(btn, msg);
          break;
        case "download":
          this.handleDownload(msg);
          break;
      }
    } catch (err) {
      console.error(`Error handling ${action}:`, err);
    }
  },

  async handleLikeDislike(btn, messageId, action) {
    const status = action === "like" ? "positive" : "negative";
    await API.updateStatus(messageId, status);
    
    // Reset all buttons, highlight current
    btn.closest(".flex").querySelectorAll("button").forEach(b => {
      b.classList.remove("text-purple-600");
    });
    btn.classList.add("text-purple-600");
  },

  async handleRefresh(messageId) {
    const loadingMsg = UI.createLoadingMessage();
    DOM.chatBox.appendChild(loadingMsg);
    UI.scrollToBottom();

    try {
      const data = await API.regenerateImage(messageId);
      loadingMsg.remove();

      this.render({
        sender: "bot",
        image_url: data.image_url,
        text: "🔄 New image was generated from the old prompt!",
        id: data.message_id
      });

      this.render({
        sender: "bot",
        text: "💥 Boom! Image is generated, do you want H&C to help you with anything else?"
      });

      lucide.createIcons();
      UI.scrollToBottom();
    } catch (err) {
      loadingMsg.replaceWith(UI.createErrorMessage("⚠️ Error occurs when generating"));
    }
  },

  async handleCopy(btn, msg) {
    try {
      const imgBlob = await fetch(msg.image_url).then(r => r.blob());
      await navigator.clipboard.write([
        new ClipboardItem({ [imgBlob.type]: imgBlob })
      ]);
      btn.classList.add("text-green-600");
      btn.title = "Coppied!";
      setTimeout(() => {
        btn.classList.remove("text-green-600");
        btn.title = "Coppy";
      }, 2000);
    } catch (err) {
      alert("⚠️ Cannot coppy!");
    }
  },

  handleDownload(msg) {
    const link = document.createElement("a");
    link.href = msg.image_url;
    link.download = "generated_image.png";
    link.click();
  }
};

// ============================================
// Session Manager
// ============================================
const SessionManager = {
  async loadSessions() {
    try {
      const sessions = await API.getSessions();
      this.renderSessionList(sessions);
    } catch (err) {
      console.error("Error loading sessions:", err);
    }
  },

  renderSessionList(sessions) {
    DOM.chatList.innerHTML = "";
    
    sessions.slice().reverse().forEach(session => {
      const li = document.createElement("li");
      li.className = "p-2 rounded-lg bg-purple-50 hover:bg-gradient-to-r hover:from-blue-100 hover:to-purple-100 cursor-pointer transition";
      li.textContent = session.title;
      li.onclick = () => this.loadSession(session.id);
      DOM.chatList.appendChild(li);
    });
  },

  async loadSession(id) {
    try {
      const data = await API.getSession(id);
      AppState.setSession(id);
      
      DOM.chatBox.innerHTML = "";
      data.messages.forEach(msg => MessageRenderer.render(msg));
      lucide.createIcons();
      UI.scrollToBottom();
    } catch (err) {
      console.error("Error loading session:", err);
    }
  },

  createNewSession() {
    AppState.clearSession();
    DOM.chatBox.innerHTML = `
      <div class="self-start bg-white/80 border border-purple-200 rounded-2xl p-3 max-w-lg shadow-sm">
        👋 Hello! I am H&C, your AI assistant. Please enter your art image description that you want me to generate!
      </div>`;
  }
};

// ============================================
// Theme Manager
// ============================================
const ThemeManager = {
  init() {
    this.loadTheme();
    this.setupToggle();
  },

  loadTheme() {
    const isDark = localStorage.getItem("theme") === "dark";
    this.applyTheme(isDark);
    DOM.toggleTheme.checked = isDark;
  },

  setupToggle() {
    DOM.toggleTheme.addEventListener("change", () => {
      const isDark = DOM.toggleTheme.checked;
      this.applyTheme(isDark);
      localStorage.setItem("theme", isDark ? "dark" : "light");
      lucide.createIcons();
    });
  },

  applyTheme(isDark) {
    if (isDark) {
      DOM.body.classList.add("dark");
      DOM.toggleCircle.style.transform = "translateX(32px)";
      DOM.toggleTheme.parentElement.querySelector("div").style.backgroundColor = "#5A60C8";
    } else {
      DOM.body.classList.remove("dark");
      DOM.toggleCircle.style.transform = "translateX(0)";
      DOM.toggleTheme.parentElement.querySelector("div").style.backgroundColor = "#d1d5db";
    }
  }
};

// ============================================
// Sidebar Manager
// ============================================
const SidebarManager = {
  init() {
    DOM.closeSidebar.addEventListener("click", () => this.hide());
    DOM.openSidebar.addEventListener("click", () => this.show());
  },

  hide() {
    DOM.sidebar.classList.add("hidden");
    DOM.openSidebar.classList.remove("hidden");
  },

  show() {
    DOM.sidebar.classList.remove("hidden");
    DOM.openSidebar.classList.add("hidden");
  }
};

// ============================================
// Chat Handler
// ============================================
const ChatHandler = {
  init() {
    DOM.chatForm.addEventListener("submit", (e) => this.handleSubmit(e));
    DOM.btnNewChat.addEventListener("click", () => SessionManager.createNewSession());
  },

  async handleSubmit(e) {
    e.preventDefault();
    
    const text = DOM.userInput.value.trim();
    if (!text) return;

    // Render user message
    MessageRenderer.render({ sender: "user", text });
    UI.clearInput();

    // Show loading
    const loadingMsg = UI.createLoadingMessage();
    DOM.chatBox.appendChild(loadingMsg);
    UI.scrollToBottom();

    try {
      const data = await API.generateImage(text, AppState.getSession());
      AppState.setSession(data.session_id);

      loadingMsg.remove();

      MessageRenderer.render({
        sender: "bot",
        image_url: data.image_url,
        text: "🪄 Image is generated, do you want H&C to help you with anything else?",
        id: data.message_id
      });

      MessageRenderer.render({
        sender: "bot",
        text: "💥 Boom! Image is generated, do you want H&C to help you with anything else?"
      });

      lucide.createIcons();
      UI.scrollToBottom();
      await SessionManager.loadSessions();
    } catch (err) {
      loadingMsg.replaceWith(UI.createErrorMessage("⚠️ Error occurs when generating!"));
      console.error("Error generating image:", err);
    }
  }
};

// ============================================
// Application Initialization
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  
  DOM.init();
  ThemeManager.init();
  SidebarManager.init();
  ChatHandler.init();
  SessionManager.loadSessions();
});

// ============================
// Instruction Popup
// ============================

const instructBtn = document.getElementById("instructBtn");
const instructionPopup = document.getElementById("instructionPopup");
const closeInstruction = document.getElementById("closeInstruction");

const slider = document.getElementById("instructionSlider");
const nextBtn = document.getElementById("nextInstruction");
const prevBtn = document.getElementById("prevInstruction");

let currentSlide = 0;
const totalSlides = slider.children.length;

function updateSlide() {
  const offset = -currentSlide * 100;
  slider.style.transform = `translateX(${offset}%)`;
}

instructBtn.addEventListener("click", () => {
  instructionPopup.classList.remove("hidden");
  currentSlide = 0;
  updateSlide();
});

closeInstruction.addEventListener("click", () => {
  instructionPopup.classList.add("hidden");
});

nextBtn.addEventListener("click", () => {
  currentSlide = (currentSlide + 1) % totalSlides;
  updateSlide();
});

prevBtn.addEventListener("click", () => {
  currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
  updateSlide();
});
