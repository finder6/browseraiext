// background.js - service worker
// 点击图标 -> 为当前标签页打开分析页

chrome.action.onClicked.addListener((tab) => {
  const base = chrome.runtime.getURL('analyze.html');
  if (!tab || !tab.id || !tab.url || !/^https?:/i.test(tab.url)) {
    // 不支持的页面（chrome:// 等），打开分析页并提示
    chrome.tabs.create({ url: base + '?error=unsupported-page' });
    return;
  }
  chrome.tabs.create({ url: base + '?tabId=' + tab.id });
});

// 应分析页请求，监听目标标签页主框架的响应头（用于 Web 指纹）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'getHeaders') {
    const tabId = msg.tabId;
    let done = false;
    const listener = (details) => {
      if (details.tabId === tabId && details.type === 'main_frame' && !done) {
        done = true;
        try { chrome.webRequest.onHeadersReceived.removeListener(listener); } catch (e) {}
        try { sendResponse({ statusLine: details.statusLine, headers: details.responseHeaders || [] }); } catch (e) {}
      }
    };
    chrome.webRequest.onHeadersReceived.addListener(listener, { urls: ['<all_urls>'] }, ['responseHeaders']);
    setTimeout(() => {
      if (!done) {
        done = true;
        try { chrome.webRequest.onHeadersReceived.removeListener(listener); } catch (e) {}
        try { sendResponse({ error: 'timeout' }); } catch (e) {}
      }
    }, 10000);
    return true; // 异步 sendResponse
  }
});
