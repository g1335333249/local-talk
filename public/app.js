const socket = io();
const GROUP_ID = "__local_group__";
const appTitle = document.title;
const normalFavicon = document.querySelector("#favicon")?.href || "";
const alertFavicon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#166a6a"/><path d="M16 19h32v20H30L21 47v-8h-5z" fill="white"/><circle cx="49" cy="15" r="11" fill="#b42318"/></svg>');

const state = {
  me: null,
  users: [],
  groups: [],
  selectedIp: null,
  messages: [],
  unreadIps: new Set(),
  replyTo: null,
  pendingAttachments: [],
  forwardingMessage: null,
  titleFlashTimer: null,
  titleFlashOn: false,
  baseTitle: appTitle,
  imageZoom: 1
};

const els = {
  appShell: document.querySelector(".app-shell"),
  favicon: document.querySelector("#favicon"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  sidebarOverlay: document.querySelector("#sidebarOverlay"),
  myAvatar: document.querySelector("#myAvatar"),
  myDisplay: document.querySelector("#myDisplay"),
  myIp: document.querySelector("#myIp"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsMenu: document.querySelector("#settingsMenu"),
  nicknameForm: document.querySelector("#nicknameForm"),
  nicknameInput: document.querySelector("#nicknameInput"),
  notifyButton: document.querySelector("#notifyButton"),
  notifyStatus: document.querySelector("#notifyStatus"),
  onlineCount: document.querySelector("#onlineCount"),
  createGroupButton: document.querySelector("#createGroupButton"),
  userList: document.querySelector("#userList"),
  peerName: document.querySelector("#peerName"),
  peerIp: document.querySelector("#peerIp"),
  pasteHint: document.querySelector("#pasteHint"),
  incomingBanner: document.querySelector("#incomingBanner"),
  emptyState: document.querySelector("#emptyState"),
  incomingNotice: document.querySelector("#incomingNotice"),
  messageList: document.querySelector("#messageList"),
  composer: document.querySelector("#composer"),
  replyBar: document.querySelector("#replyBar"),
  replyTitle: document.querySelector("#replyTitle"),
  cancelReply: document.querySelector("#cancelReply"),
  attachmentTray: document.querySelector("#attachmentTray"),
  formatBold: document.querySelector("#formatBold"),
  formatItalic: document.querySelector("#formatItalic"),
  formatCode: document.querySelector("#formatCode"),
  formatLink: document.querySelector("#formatLink"),
  messageInput: document.querySelector("#messageInput"),
  fileInput: document.querySelector("#fileInput"),
  screenshotButton: document.querySelector("#screenshotButton"),
  imageModal: document.querySelector("#imageModal"),
  imageModalTitle: document.querySelector("#imageModalTitle"),
  imageStage: document.querySelector("#imageStage"),
  imagePreview: document.querySelector("#imagePreview"),
  imageSave: document.querySelector("#imageSave"),
  imageZoomOut: document.querySelector("#imageZoomOut"),
  imageZoomReset: document.querySelector("#imageZoomReset"),
  imageZoomIn: document.querySelector("#imageZoomIn"),
  imageClose: document.querySelector("#imageClose"),
  filePreviewModal: document.querySelector("#filePreviewModal"),
  filePreviewTitle: document.querySelector("#filePreviewTitle"),
  filePreviewClose: document.querySelector("#filePreviewClose"),
  filePreviewBody: document.querySelector("#filePreviewBody"),
  forwardModal: document.querySelector("#forwardModal"),
  forwardClose: document.querySelector("#forwardClose"),
  forwardPreview: document.querySelector("#forwardPreview"),
  forwardUserList: document.querySelector("#forwardUserList"),
  groupModal: document.querySelector("#groupModal"),
  groupForm: document.querySelector("#groupForm"),
  groupClose: document.querySelector("#groupClose"),
  groupNameInput: document.querySelector("#groupNameInput"),
  groupMemberList: document.querySelector("#groupMemberList"),
  closeGuardModal: document.querySelector("#closeGuardModal"),
  closeGuardConfirm: document.querySelector("#closeGuardConfirm")
};

function displayUser(user) {
  return user ? user.nickname || user.ip : "";
}

function avatarText(user) {
  const name = displayUser(user);
  if (!name) return "IP";
  return name
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(iso));
}

function userNameByIp(ip) {
  if (ip === GROUP_ID) return "内网群聊";
  const group = groupById(ip);
  if (group) return group.name;
  if (state.me && ip === state.me.ip) return "我";
  const user = state.users.find((item) => item.ip === ip);
  return user ? displayUser(user) : ip;
}

function isCustomGroupId(id) {
  return typeof id === "string" && id.startsWith("group:");
}

function isGroupId(id) {
  return id === GROUP_ID || isCustomGroupId(id);
}

function groupById(id) {
  return state.groups.find((group) => group.id === id);
}

function groupDisplayName(id) {
  if (id === GROUP_ID) return "内网群聊";
  const group = groupById(id);
  return group ? group.name : id;
}

function messageSummaryText(message) {
  if (!message) return "";
  if (message.type === "text") return (message.text || "").slice(0, 160);
  if (message.type === "screenshot") return `截图：${message.file?.originalName || "图片"}`;
  return `文件：${message.file?.originalName || "文件"}`;
}

function messageReference(message) {
  return {
    id: message.id,
    type: message.type,
    fromIp: message.fromIp,
    text: message.text || "",
    file: message.file || null
  };
}

function renderMe() {
  if (!state.me) return;
  els.myAvatar.textContent = avatarText(state.me);
  els.myDisplay.textContent = displayUser(state.me);
  els.myIp.textContent = state.me.ip;
  els.nicknameInput.value = state.me.nickname || "";
}

function renderNotificationState() {
  if (!("Notification" in window)) {
    els.notifyButton.disabled = true;
    els.notifyButton.textContent = "浏览器不支持通知";
    els.notifyStatus.textContent = "当前浏览器无法弹出系统通知";
    return;
  }

  if (Notification.permission === "granted") {
    els.notifyButton.textContent = "浏览器通知已开启";
    els.notifyStatus.textContent = "收到他人新消息时会弹出通知";
    return;
  }

  if (Notification.permission === "denied") {
    els.notifyButton.textContent = "通知已被浏览器阻止";
    els.notifyStatus.textContent = "需要在浏览器站点权限里手动允许通知";
    return;
  }

  els.notifyButton.textContent = "开启浏览器通知";
  els.notifyStatus.textContent = "收到新消息时可弹出系统通知";
}

function setSidebarOpen(open) {
  els.appShell.classList.toggle("sidebar-open", open);
  els.sidebarToggle.setAttribute("aria-expanded", String(open));
  els.sidebarOverlay.hidden = !open;
}

function unreadCount() {
  return state.unreadIps.size;
}

function selectedPeer() {
  if (state.selectedIp === GROUP_ID) {
    return { ip: GROUP_ID, nickname: "内网群聊", displayName: "内网群聊" };
  }
  const group = groupById(state.selectedIp);
  if (group) {
    return { ip: group.id, nickname: group.name, displayName: group.name };
  }
  return state.users.find((user) => user.ip === state.selectedIp);
}

function titleForSelectedPeer() {
  const peer = selectedPeer();
  if (!state.selectedIp) return appTitle;
  return peer ? displayUser(peer) : state.selectedIp;
}

function applyBaseTitle() {
  state.baseTitle = titleForSelectedPeer();
  if (!state.titleFlashTimer) {
    document.title = state.baseTitle;
  }
}

function startTitleFlash() {
  if (state.titleFlashTimer || unreadCount() === 0) return;
  if (els.favicon) els.favicon.href = alertFavicon;

  state.titleFlashTimer = window.setInterval(() => {
    state.titleFlashOn = !state.titleFlashOn;
    document.title = state.titleFlashOn ? `【新消息】${state.baseTitle}` : state.baseTitle;
  }, 900);
}

function stopTitleFlashIfRead() {
  if (unreadCount() > 0) return;
  if (state.titleFlashTimer) {
    window.clearInterval(state.titleFlashTimer);
    state.titleFlashTimer = null;
  }
  state.titleFlashOn = false;
  applyBaseTitle();
  if (els.favicon && normalFavicon) els.favicon.href = normalFavicon;
}

function renderUsers() {
  const peers = state.users.filter((user) => !state.me || user.ip !== state.me.ip);
  els.onlineCount.textContent = peers.length;
  els.userList.replaceChildren();

  els.userList.append(createGroupRow(peers.length));
  for (const group of state.groups) {
    els.userList.append(createCustomGroupRow(group));
  }

  if (peers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无其他在线用户";
    els.userList.append(empty);
    return;
  }

  for (const user of peers) {
    const button = document.createElement("button");
    button.className = `user-row${user.ip === state.selectedIp ? " active" : ""}`;
    button.type = "button";
    button.addEventListener("click", () => selectPeer(user.ip));

    const dot = document.createElement("span");
    dot.className = "dot";

    const content = document.createElement("span");
    const name = document.createElement("strong");
    name.className = "user-name";
    name.textContent = displayUser(user);
    const ip = document.createElement("span");
    ip.className = "user-ip";
    ip.textContent = user.ip;
    content.append(name, ip);

    button.append(dot, content);
    if (state.unreadIps.has(user.ip)) {
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      button.append(badge);
    }
    els.userList.append(button);
  }
}

function createGroupRow(memberCount) {
  const button = document.createElement("button");
  button.className = `user-row group-row${state.selectedIp === GROUP_ID ? " active" : ""}`;
  button.type = "button";
  button.addEventListener("click", () => selectPeer(GROUP_ID));

  const dot = document.createElement("span");
  dot.className = "dot group-dot";

  const content = document.createElement("span");
  const name = document.createElement("strong");
  name.className = "user-name";
  name.textContent = "内网群聊";
  const meta = document.createElement("span");
  meta.className = "user-ip";
  meta.textContent = `${memberCount + 1} 人在线`;
  content.append(name, meta);

  button.append(dot, content);
  if (state.unreadIps.has(GROUP_ID)) {
    const badge = document.createElement("span");
    badge.className = "unread-badge";
    button.append(badge);
  }
  return button;
}

function createCustomGroupRow(group) {
  const button = document.createElement("button");
  button.className = `user-row group-row custom-group-row${state.selectedIp === group.id ? " active" : ""}`;
  button.type = "button";
  button.addEventListener("click", () => selectPeer(group.id));

  const dot = document.createElement("span");
  dot.className = "dot group-dot";

  const content = document.createElement("span");
  const name = document.createElement("strong");
  name.className = "user-name";
  name.textContent = group.name;
  const meta = document.createElement("span");
  meta.className = "user-ip";
  meta.textContent = `${group.members.length} 人群聊`;
  content.append(name, meta);

  button.append(dot, content);
  if (state.unreadIps.has(group.id)) {
    const badge = document.createElement("span");
    badge.className = "unread-badge";
    button.append(badge);
  }
  return button;
}

function renderChatHeader() {
  const peer = selectedPeer();
  const hasPeer = Boolean(state.selectedIp);
  els.peerName.textContent = peer ? displayUser(peer) : hasPeer ? state.selectedIp : "选择一个在线用户";
  els.peerIp.textContent = state.selectedIp === GROUP_ID
    ? "所有在线用户"
    : isCustomGroupId(state.selectedIp)
      ? `${groupById(state.selectedIp)?.members.length || 0} 人群聊`
      : hasPeer ? state.selectedIp : "";
  els.emptyState.hidden = hasPeer || unreadCount() > 0;
  els.incomingNotice.hidden = hasPeer || unreadCount() === 0;
  els.messageList.hidden = !hasPeer;
  els.composer.hidden = !hasPeer;
  els.pasteHint.hidden = !hasPeer;
  if (!hasPeer) clearReply();
  renderReplyBar();
  renderUnreadPrompts();
  applyBaseTitle();
}

function renderReplyBar() {
  const hasReply = Boolean(state.replyTo && state.selectedIp);
  els.replyBar.hidden = !hasReply;
  if (hasReply) {
    els.replyTitle.textContent = `${userNameByIp(state.replyTo.fromIp)}：${messageSummaryText(state.replyTo)}`;
  }
}

function setReply(message) {
  state.replyTo = messageReference(message);
  renderReplyBar();
  els.messageInput.focus();
}

function clearReply() {
  state.replyTo = null;
  if (els.replyBar) els.replyBar.hidden = true;
}

function addPendingAttachment(file, kind = "file") {
  const attachment = {
    id: crypto.randomUUID(),
    file,
    kind,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : ""
  };
  state.pendingAttachments.push(attachment);
  renderPendingAttachments();
}

function removePendingAttachment(id) {
  const attachment = state.pendingAttachments.find((item) => item.id === id);
  if (attachment && attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== id);
  renderPendingAttachments();
}

function clearPendingAttachments() {
  for (const attachment of state.pendingAttachments) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }
  state.pendingAttachments = [];
  renderPendingAttachments();
}

function renderPendingAttachments() {
  els.attachmentTray.replaceChildren();
  els.attachmentTray.hidden = state.pendingAttachments.length === 0;

  for (const attachment of state.pendingAttachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";

    if (attachment.previewUrl) {
      const img = document.createElement("img");
      img.src = attachment.previewUrl;
      img.alt = attachment.file.name;
      chip.append(img);
    } else {
      const icon = document.createElement("div");
      icon.className = "attachment-icon";
      icon.textContent = "FILE";
      chip.append(icon);
    }

    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = attachment.file.name;
    const size = document.createElement("span");
    size.textContent = formatSize(attachment.file.size);
    info.append(name, size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "移除附件";
    remove.textContent = "×";
    remove.addEventListener("click", () => removePendingAttachment(attachment.id));

    chip.append(info, remove);
    els.attachmentTray.append(chip);
  }
}

function firstUnreadIp() {
  return [...state.unreadIps].find((ip) => ip !== state.selectedIp) || [...state.unreadIps][0];
}

function senderName(ip) {
  if (ip === GROUP_ID) return "内网群聊";
  const group = groupById(ip);
  if (group) return group.name;
  const sender = state.users.find((user) => user.ip === ip);
  return sender ? displayUser(sender) : ip;
}

function renderUnreadPrompts() {
  els.incomingNotice.replaceChildren();
  els.incomingBanner.replaceChildren();
  els.incomingBanner.hidden = true;
  els.incomingNotice.hidden = Boolean(state.selectedIp) || unreadCount() === 0;
  if (unreadCount() === 0) return;

  const fromIp = firstUnreadIp();
  const name = senderName(fromIp);
  const moreCount = unreadCount() - 1;

  const button = document.createElement("button");
  button.className = "notice-card";
  button.type = "button";
  button.addEventListener("click", () => selectPeer(fromIp));

  const title = document.createElement("strong");
  title.textContent = isGroupId(fromIp) ? `${name} 有新消息` : `${name} 给你发送了消息`;
  const subtitle = document.createElement("span");
  subtitle.textContent = moreCount > 0
    ? `还有 ${moreCount} 个会话有新消息，点击打开此聊天`
    : "点击打开聊天";

  if (!state.selectedIp) {
    button.append(title, subtitle);
    els.incomingNotice.append(button);
    return;
  }

  const bannerButton = document.createElement("button");
  bannerButton.className = "banner-button";
  bannerButton.type = "button";
  bannerButton.addEventListener("click", () => selectPeer(fromIp));

  const bannerTitle = document.createElement("strong");
  bannerTitle.textContent = isGroupId(fromIp) ? `${name} 有新消息` : `${name} 给你发送了消息`;
  const action = document.createElement("span");
  action.textContent = "打开";
  bannerButton.append(bannerTitle, action);
  els.incomingBanner.append(bannerButton);
  els.incomingBanner.hidden = false;
}

function messageBelongsToSelected(message) {
  if (!state.me || !state.selectedIp) return false;
  if (isGroupId(state.selectedIp)) return message.toIp === state.selectedIp;
  return [message.fromIp, message.toIp].includes(state.me.ip) &&
    [message.fromIp, message.toIp].includes(state.selectedIp);
}

function renderMessages() {
  els.messageList.replaceChildren();

  for (const message of state.messages.filter(messageBelongsToSelected)) {
    const row = document.createElement("div");
    row.className = `message${message.fromIp === state.me.ip ? " mine" : ""}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (message.forwarded) {
      const forwarded = document.createElement("div");
      forwarded.className = "forwarded-label";
      forwarded.textContent = `转发自 ${userNameByIp(message.forwardedFromIp)}`;
      bubble.append(forwarded);
    }

    if (message.quote) {
      bubble.append(createQuoteBlock(message.quote));
    }

    if (message.type === "text") {
      bubble.append(renderMarkdown(message.text));
    } else if (message.type === "screenshot") {
      const button = document.createElement("button");
      button.className = "image-message-button";
      button.type = "button";
      button.addEventListener("click", () => openImageModal(message.file));
      const img = document.createElement("img");
      img.className = "screenshot";
      img.src = message.file.url;
      img.alt = message.file.originalName || "截图";
      button.append(img);
      bubble.append(button);
    } else {
      const card = document.createElement("div");
      card.className = "file-card";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = message.file.originalName;
      const size = document.createElement("span");
      size.textContent = formatSize(message.file.size);
      info.append(name, size);
      const actions = document.createElement("div");
      actions.className = "file-card-actions";
      if (canPreviewFile(message.file)) {
        const preview = document.createElement("button");
        preview.className = "preview-button";
        preview.type = "button";
        preview.textContent = "预览";
        preview.addEventListener("click", () => openFilePreview(message.file));
        actions.append(preview);
      }
      const download = document.createElement("a");
      download.className = "download-button";
      download.href = message.file.url;
      download.download = message.file.originalName;
      download.textContent = "下载";
      actions.append(download);
      card.append(info, actions);
      bubble.append(card);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${userNameByIp(message.fromIp)} · ${formatTime(message.createdAt)}`;
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const reply = document.createElement("button");
    reply.type = "button";
    reply.textContent = "回复";
    reply.addEventListener("click", () => setReply(message));
    const forward = document.createElement("button");
    forward.type = "button";
    forward.textContent = "转发";
    forward.addEventListener("click", () => openForwardModal(message));
    actions.append(reply, forward);
    row.append(bubble, actions, meta);
    els.messageList.append(row);
  }

  scrollMessagesToBottom();
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (match[2]) {
      const code = document.createElement("code");
      code.textContent = match[2];
      parent.append(code);
    } else if (match[4]) {
      const strong = document.createElement("strong");
      strong.textContent = match[4];
      parent.append(strong);
    } else if (match[6]) {
      const em = document.createElement("em");
      em.textContent = match[6];
      parent.append(em);
    } else if (match[8] && match[9]) {
      const link = document.createElement("a");
      link.textContent = match[8];
      link.href = safeMarkdownUrl(match[9]);
      link.target = "_blank";
      link.rel = "noreferrer";
      parent.append(link);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function safeMarkdownUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (error) {
    return "#";
  }
  return "#";
}

function appendMarkdownLine(parent, line) {
  const heading = line.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    const level = String(Math.min(3, heading[1].length + 3));
    const title = document.createElement(`h${level}`);
    appendInlineMarkdown(title, heading[2]);
    parent.append(title);
    return;
  }

  const quote = line.match(/^>\s?(.+)$/);
  if (quote) {
    const blockquote = document.createElement("blockquote");
    appendInlineMarkdown(blockquote, quote[1]);
    parent.append(blockquote);
    return;
  }

  const listItem = line.match(/^[-*]\s+(.+)$/);
  if (listItem) {
    const item = document.createElement("div");
    item.className = "markdown-list-item";
    const bullet = document.createElement("span");
    bullet.textContent = "•";
    const body = document.createElement("span");
    appendInlineMarkdown(body, listItem[1]);
    item.append(bullet, body);
    parent.append(item);
    return;
  }

  const paragraph = document.createElement("p");
  appendInlineMarkdown(paragraph, line);
  parent.append(paragraph);
}

function renderMarkdown(text) {
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-body";
  const lines = String(text || "").split("\n");
  let inCode = false;
  let codeLines = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.append(code);
        wrapper.append(pre);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === "") {
      wrapper.append(document.createElement("br"));
      continue;
    }

    appendMarkdownLine(wrapper, line);
  }

  if (codeLines.length > 0) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeLines.join("\n");
    pre.append(code);
    wrapper.append(pre);
  }

  return wrapper;
}

function createQuoteBlock(quote) {
  const block = document.createElement("div");
  block.className = "quote-block";
  const title = document.createElement("strong");
  title.textContent = userNameByIp(quote.fromIp);
  const summary = document.createElement("span");
  summary.textContent = messageSummaryText(quote);
  block.append(title, summary);
  return block;
}

function scrollMessagesToBottom() {
  if (els.messageList.hidden) return;

  const scroll = () => {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  };

  scroll();
  requestAnimationFrame(scroll);
  window.setTimeout(scroll, 80);

  for (const image of els.messageList.querySelectorAll("img")) {
    if (!image.complete) {
      image.addEventListener("load", scroll, { once: true });
      image.addEventListener("error", scroll, { once: true });
    }
  }
}

function applyImageZoom() {
  const percent = Math.round(state.imageZoom * 100);
  els.imagePreview.style.width = `${Math.round(els.imagePreview.naturalWidth * state.imageZoom)}px`;
  els.imagePreview.style.height = "auto";
  els.imageZoomReset.textContent = `${percent}%`;
}

function setImageZoom(nextZoom) {
  state.imageZoom = Math.min(4, Math.max(0.1, nextZoom));
  applyImageZoom();
}

function fitImageToStage() {
  const naturalWidth = els.imagePreview.naturalWidth || 1;
  const naturalHeight = els.imagePreview.naturalHeight || 1;
  const stageBox = els.imageStage.getBoundingClientRect();
  const padding = 48;
  const availableWidth = Math.max(120, stageBox.width - padding);
  const availableHeight = Math.max(120, stageBox.height - padding);
  state.imageZoom = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
  applyImageZoom();
}

function openImageModal(file) {
  els.imagePreview.src = file.url;
  els.imagePreview.alt = file.originalName || "图片预览";
  els.imageModalTitle.textContent = file.originalName || "图片预览";
  els.imageSave.href = file.url;
  els.imageSave.download = file.originalName || "image.png";
  els.imageModal.hidden = false;
  const fitAndResetScroll = () => {
    fitImageToStage();
    els.imageStage.scrollTop = 0;
    els.imageStage.scrollLeft = 0;
  };
  if (els.imagePreview.complete && els.imagePreview.naturalWidth > 0) {
    requestAnimationFrame(fitAndResetScroll);
  } else {
    els.imagePreview.addEventListener("load", fitAndResetScroll, { once: true });
  }
}

function closeImageModal() {
  els.imageModal.hidden = true;
  els.imagePreview.removeAttribute("src");
}

function fileExtension(file) {
  const name = (file && file.originalName) || "";
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function canPreviewFile(file) {
  return [".pdf", ".docx", ".xlsx", ".txt", ".md", ".csv", ".log"].includes(fileExtension(file));
}

function uploadFilenameFromUrl(url) {
  return String(url || "").split("/").pop();
}

async function openFilePreview(file) {
  els.filePreviewTitle.textContent = file.originalName || "文件预览";
  els.filePreviewBody.replaceChildren();
  els.filePreviewBody.classList.remove("file-preview-empty");
  els.filePreviewBody.textContent = "正在生成预览...";
  els.filePreviewModal.hidden = false;

  const filename = uploadFilenameFromUrl(file.url);
  const response = await fetch(`/api/preview/${filename}`);
  if (!response.ok) {
    els.filePreviewBody.classList.add("file-preview-empty");
    els.filePreviewBody.textContent = "当前文件暂不支持预览，请下载后查看。";
    return;
  }

  const preview = await response.json();
  els.filePreviewTitle.textContent = preview.name || file.originalName || "文件预览";
  els.filePreviewBody.replaceChildren();

  if (preview.kind === "pdf") {
    const frame = document.createElement("iframe");
    frame.src = preview.url;
    frame.title = preview.name || "PDF 预览";
    els.filePreviewBody.append(frame);
    return;
  }

  if (preview.kind === "spreadsheet") {
    if (!preview.rows || preview.rows.length === 0) {
      els.filePreviewBody.classList.add("file-preview-empty");
      els.filePreviewBody.textContent = "表格为空。";
      return;
    }
    const table = document.createElement("table");
    table.className = "file-preview-table";
    for (const row of preview.rows) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        td.textContent = cell == null ? "" : String(cell);
        tr.append(td);
      }
      table.append(tr);
    }
    els.filePreviewBody.append(table);
    return;
  }

  const pre = document.createElement("pre");
  pre.textContent = preview.text || "没有可预览文本。";
  els.filePreviewBody.append(pre);
}

function closeFilePreview() {
  els.filePreviewModal.hidden = true;
  els.filePreviewBody.replaceChildren();
}

function openForwardModal(message) {
  state.forwardingMessage = messageReference(message);
  els.forwardPreview.textContent = messageSummaryText(state.forwardingMessage);
  renderForwardUsers();
  els.forwardModal.hidden = false;
}

function closeForwardModal() {
  state.forwardingMessage = null;
  els.forwardModal.hidden = true;
  els.forwardUserList.replaceChildren();
}

function renderForwardUsers() {
  els.forwardUserList.replaceChildren();
  const peers = state.users.filter((user) => !state.me || user.ip !== state.me.ip);

  const groupButton = document.createElement("button");
  groupButton.type = "button";
  groupButton.addEventListener("click", () => forwardMessageTo(GROUP_ID));
  const groupName = document.createElement("strong");
  groupName.textContent = "内网群聊";
  const groupMeta = document.createElement("span");
  groupMeta.textContent = "转发给所有在线用户";
  groupButton.append(groupName, groupMeta);
  els.forwardUserList.append(groupButton);

  for (const group of state.groups) {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => forwardMessageTo(group.id));
    const name = document.createElement("strong");
    name.textContent = group.name;
    const meta = document.createElement("span");
    meta.textContent = `${group.members.length} 人群聊`;
    button.append(name, meta);
    els.forwardUserList.append(button);
  }

  if (peers.length === 0) {
    return;
  }

  for (const user of peers) {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => forwardMessageTo(user.ip));
    const name = document.createElement("strong");
    name.textContent = displayUser(user);
    const ip = document.createElement("span");
    ip.textContent = user.ip;
    button.append(name, ip);
    els.forwardUserList.append(button);
  }
}

function openGroupModal() {
  renderGroupMembers();
  els.groupNameInput.value = "";
  els.groupModal.hidden = false;
  els.groupNameInput.focus();
}

function closeGroupModal() {
  els.groupModal.hidden = true;
  els.groupMemberList.replaceChildren();
}

function showCloseGuard() {
  els.closeGuardModal.hidden = false;
  els.closeGuardConfirm.focus();
}

function hideCloseGuard() {
  els.closeGuardModal.hidden = true;
}

function renderGroupMembers() {
  els.groupMemberList.replaceChildren();
  const peers = state.users.filter((user) => !state.me || user.ip !== state.me.ip);

  if (peers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无可邀请的在线用户";
    els.groupMemberList.append(empty);
    return;
  }

  for (const user of peers) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = user.ip;
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = displayUser(user);
    const ip = document.createElement("span");
    ip.textContent = user.ip;
    text.append(name, ip);
    label.append(checkbox, text);
    els.groupMemberList.append(label);
  }
}

function createSelectedGroup() {
  const members = [...els.groupMemberList.querySelectorAll("input[type='checkbox']:checked")]
    .map((input) => input.value);

  if (members.length === 0) {
    alert("请选择至少 1 个在线用户");
    return;
  }

  socket.emit("group:create", {
    name: els.groupNameInput.value,
    members
  }, (result) => {
    if (result && result.ok === false) {
      alert(result.error || "创建群聊失败");
      return;
    }
    closeGroupModal();
    if (result && result.group) {
      selectPeer(result.group.id);
    }
  });
}

function forwardMessageTo(toIp) {
  if (!state.forwardingMessage) return;
  socket.emit("message:forward", {
    toIp,
    message: state.forwardingMessage
  }, (result) => {
    if (result && result.ok === false) {
      alert(result.error || "转发失败");
      return;
    }
    closeForwardModal();
  });
}

async function selectPeer(ip) {
  state.selectedIp = ip;
  state.unreadIps.delete(ip);
  stopTitleFlashIfRead();
  setSidebarOpen(false);
  renderUsers();
  renderChatHeader();

  const response = await fetch(`/api/messages/${encodeURIComponent(ip)}`);
  state.messages = await response.json();
  renderMessages();
  els.messageInput.focus();
}

function addMessage(message) {
  const exists = state.messages.some((item) => item.id === message.id);
  if (!exists) state.messages.push(message);
  const incomingPrivate = state.me && message.toIp === state.me.ip && message.fromIp !== state.me.ip;
  const incomingGroup = state.me && isGroupId(message.toIp) && message.fromIp !== state.me.ip;
  const incoming = incomingPrivate || incomingGroup;
  const unreadKey = incomingGroup ? message.toIp : message.fromIp;
  const shouldAlert = incoming && (document.visibilityState !== "visible" || unreadKey !== state.selectedIp);
  if (shouldAlert) {
    state.unreadIps.add(unreadKey);
    startTitleFlash();
  }
  if (incoming) {
    notifyIncomingMessage(message);
  }
  renderMessages();
  renderUsers();
  renderChatHeader();
}

async function uploadFile(file, kind = "file", quote = state.replyTo) {
  if (!state.selectedIp || !file) return;
  const body = new FormData();
  body.append("toIp", state.selectedIp);
  body.append("kind", kind);
  if (quote) {
    body.append("quote", JSON.stringify(quote));
  }
  body.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "上传失败" }));
    alert(error.error || "上传失败");
  }
}

function sendTextMessage(text, quote = state.replyTo) {
  return new Promise((resolve, reject) => {
    socket.emit("message:send", { toIp: state.selectedIp, text, quote }, (response) => {
      if (response && response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve();
    });
  });
}

function focusEditorAtEnd() {
  els.messageInput.focus();
  const range = document.createRange();
  range.selectNodeContents(els.messageInput);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectedEditorText() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !els.messageInput.contains(selection.anchorNode)) {
    return "";
  }
  return selection.toString();
}

function replaceEditorSelection(node) {
  els.messageInput.focus();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !els.messageInput.contains(selection.anchorNode)) {
    els.messageInput.append(node);
    focusEditorAtEnd();
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function applyInlineFormat(tagName, placeholder) {
  const selected = selectedEditorText() || placeholder;
  const node = document.createElement(tagName);
  node.textContent = selected;
  replaceEditorSelection(node);
}

function insertMarkdownLink() {
  const selected = selectedEditorText() || "链接文本";
  const link = document.createElement("a");
  link.textContent = selected;
  link.href = "https://";
  link.target = "_blank";
  link.rel = "noreferrer";
  replaceEditorSelection(link);
}

function nodeMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node;
  const tag = element.tagName.toLowerCase();
  const content = [...element.childNodes].map(nodeMarkdown).join("");

  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "em" || tag === "i") return `*${content}*`;
  if (tag === "code") return element.closest("pre") ? content : `\`${content}\``;
  if (tag === "a") return `[${content}](${element.getAttribute("href") || ""})`;
  if (tag === "blockquote") return `> ${content.trim()}\n`;
  if (tag === "pre") return `\`\`\`\n${element.textContent || ""}\n\`\`\`\n`;
  if (tag === "h4") return `# ${content}\n`;
  if (tag === "h5") return `## ${content}\n`;
  if (tag === "h6") return `### ${content}\n`;
  if (element.classList.contains("markdown-list-item")) {
    const spans = [...element.querySelectorAll(":scope > span")];
    return `- ${nodeMarkdown(spans[1] || element).trim()}\n`;
  }
  if (tag === "div" || tag === "p") return `${content}\n`;
  return content;
}

function editorMarkdown() {
  return [...els.messageInput.childNodes].map(nodeMarkdown).join("").trim();
}

function clearEditor() {
  els.messageInput.replaceChildren();
}

function maybeRenderEditorMarkdown() {
  const text = els.messageInput.textContent || "";
  const hasMarkdownSyntax = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))|(^|\n)(#{1,3}\s+|>\s+|[-*]\s+)/.test(text);
  if (!hasMarkdownSyntax) return;

  const rendered = renderMarkdown(text);
  els.messageInput.replaceChildren(...rendered.childNodes);
  focusEditorAtEnd();
}

async function captureScreenshot() {
  if (!state.selectedIp) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert("当前浏览器不支持截图发送");
    return;
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  stream.getTracks().forEach((track) => track.stop());

  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" });
    addPendingAttachment(file, "screenshot");
  }, "image/png");
}

async function requestNotifications() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  renderNotificationState();
}

function notifyIncomingMessage(message) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const targetKey = isGroupId(message.toIp) ? message.toIp : message.fromIp;
  if (document.visibilityState === "visible" && targetKey === state.selectedIp) return;

  const sender = state.users.find((user) => user.ip === message.fromIp);
  const title = isGroupId(message.toIp)
    ? `${groupDisplayName(message.toIp)} · ${sender ? displayUser(sender) : message.fromIp}`
    : `Local Talk · ${sender ? displayUser(sender) : message.fromIp}`;
  const body = message.type === "text"
    ? message.text.slice(0, 120)
    : message.type === "screenshot"
      ? "发来一张截图"
      : `发来文件：${message.file.originalName}`;
  const notification = new Notification(title, {
    body,
    tag: message.fromIp
  });
  notification.onclick = () => {
    window.focus();
    selectPeer(targetKey);
    notification.close();
  };
}

async function uploadPastedImages(event) {
  if (!state.selectedIp || !event.clipboardData) return;
  const files = [];

  for (const item of event.clipboardData.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  if (files.length === 0) {
    const text = event.clipboardData.getData("text/plain");
    if (text) {
      event.preventDefault();
      replaceEditorSelection(document.createTextNode(text));
      maybeRenderEditorMarkdown();
    }
    return;
  }
  event.preventDefault();

  for (const file of files) {
    const ext = file.type.split("/")[1] || "png";
    const namedFile = new File([file], `paste-${Date.now()}.${ext}`, { type: file.type });
    addPendingAttachment(namedFile, "screenshot");
  }
}

function setSettingsOpen(open) {
  els.settingsMenu.hidden = !open;
  els.settingsButton.setAttribute("aria-expanded", String(open));
}

els.settingsButton.addEventListener("click", () => {
  setSettingsOpen(els.settingsMenu.hidden);
});

els.sidebarToggle.addEventListener("click", () => {
  setSidebarOpen(!els.appShell.classList.contains("sidebar-open"));
});

els.sidebarOverlay.addEventListener("click", () => {
  setSidebarOpen(false);
});

window.addEventListener("resize", () => {
  if (window.matchMedia("(min-width: 781px)").matches) {
    setSidebarOpen(false);
  }
  if (!els.imageModal.hidden && els.imagePreview.naturalWidth > 0) {
    fitImageToStage();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.selectedIp) {
    state.unreadIps.delete(state.selectedIp);
    renderUsers();
  }
  stopTitleFlashIfRead();
});

document.addEventListener("click", (event) => {
  if (els.settingsMenu.hidden) return;
  if (event.target === els.settingsButton || els.settingsMenu.contains(event.target)) return;
  setSettingsOpen(false);
});

els.nicknameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  socket.emit("nickname:update", els.nicknameInput.value);
  setSettingsOpen(false);
});

els.notifyButton.addEventListener("click", () => {
  requestNotifications();
});

els.createGroupButton.addEventListener("click", openGroupModal);

els.groupClose.addEventListener("click", closeGroupModal);

els.groupModal.addEventListener("click", (event) => {
  if (event.target === els.groupModal) {
    closeGroupModal();
  }
});

els.groupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createSelectedGroup();
});

els.closeGuardConfirm.addEventListener("click", hideCloseGuard);

els.closeGuardModal.addEventListener("click", (event) => {
  if (event.target === els.closeGuardModal) {
    hideCloseGuard();
  }
});

els.cancelReply.addEventListener("click", clearReply);

els.formatBold.addEventListener("click", () => applyInlineFormat("strong", "加粗文本"));

els.formatItalic.addEventListener("click", () => applyInlineFormat("em", "斜体文本"));

els.formatCode.addEventListener("click", () => applyInlineFormat("code", "code"));

els.formatLink.addEventListener("click", insertMarkdownLink);

els.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = editorMarkdown();
  const attachments = [...state.pendingAttachments];
  if ((!text && attachments.length === 0) || !state.selectedIp) return;
  const quote = state.replyTo;
  clearEditor();
  clearPendingAttachments();
  clearReply();

  try {
    if (text) await sendTextMessage(text, quote);
    for (const attachment of attachments) {
      await uploadFile(attachment.file, attachment.kind, quote);
    }
  } catch (error) {
    alert(error.message || "发送失败");
  }
});

els.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.composer.requestSubmit();
  }
});

els.messageInput.addEventListener("input", maybeRenderEditorMarkdown);

els.messageInput.addEventListener("paste", uploadPastedImages);

els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files[0]) {
    addPendingAttachment(els.fileInput.files[0], "file");
  }
  els.fileInput.value = "";
});

els.screenshotButton.addEventListener("click", () => {
  captureScreenshot().catch((error) => {
    if (error && error.name !== "NotAllowedError") {
      alert("截图失败");
    }
  });
});

els.imageZoomOut.addEventListener("click", () => {
  setImageZoom(state.imageZoom - 0.25);
});

els.imageZoomReset.addEventListener("click", () => {
  setImageZoom(1);
});

els.imageZoomIn.addEventListener("click", () => {
  setImageZoom(state.imageZoom + 0.25);
});

els.imageClose.addEventListener("click", closeImageModal);

els.filePreviewClose.addEventListener("click", closeFilePreview);

els.filePreviewModal.addEventListener("click", (event) => {
  if (event.target === els.filePreviewModal) {
    closeFilePreview();
  }
});

els.forwardClose.addEventListener("click", closeForwardModal);

els.forwardModal.addEventListener("click", (event) => {
  if (event.target === els.forwardModal) {
    closeForwardModal();
  }
});

els.imageModal.addEventListener("click", (event) => {
  if (event.target === els.imageModal || event.target === els.imageStage) {
    closeImageModal();
  }
});

els.imageStage.addEventListener("wheel", (event) => {
  if (els.imageModal.hidden || !event.ctrlKey) return;
  event.preventDefault();
  setImageZoom(state.imageZoom + (event.deltaY > 0 ? -0.1 : 0.1));
});

document.addEventListener("keydown", (event) => {
  const closeShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w";
  if (closeShortcut) {
    event.preventDefault();
    event.stopPropagation();
    showCloseGuard();
    return;
  }

  if (event.key === "Escape" && !els.imageModal.hidden) {
    closeImageModal();
  } else if (event.key === "Escape" && !els.filePreviewModal.hidden) {
    closeFilePreview();
  } else if (event.key === "Escape" && !els.forwardModal.hidden) {
    closeForwardModal();
  } else if (event.key === "Escape" && !els.groupModal.hidden) {
    closeGroupModal();
  } else if (event.key === "Escape" && !els.closeGuardModal.hidden) {
    hideCloseGuard();
  }
}, true);

window.addEventListener("beforeunload", (event) => {
  event.preventDefault();
  event.returnValue = "";
});

socket.on("me", (me) => {
  state.me = me;
  renderMe();
  renderUsers();
  renderNotificationState();
});

socket.on("users:list", (users) => {
  state.users = users;
  renderUsers();
  renderChatHeader();
  renderUnreadPrompts();
  if (!els.forwardModal.hidden) renderForwardUsers();
  if (!els.groupModal.hidden) renderGroupMembers();
});

socket.on("groups:list", (groups) => {
  state.groups = Array.isArray(groups) ? groups : [];
  renderUsers();
  renderChatHeader();
  renderUnreadPrompts();
  if (!els.forwardModal.hidden) renderForwardUsers();
});

socket.on("message:new", addMessage);
