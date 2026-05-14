/**
 * CloudCDN concierge chat widget.
 *
 * Extracted from the inline <script> in cdn/en/index.html (locale-agnostic;
 * the same file is served on /, /fr/, /de/, etc. via the SHARED_PREFIXES
 * mapping at /shared/widgets/chat.js).
 *
 * Loaded with `defer` so the chat widget DOM (the trigger button + panel)
 * is parsed before this script attaches event listeners.
 *
 * Security notes:
 *   - Server-supplied AI text is HTML-escaped before any innerHTML write
 *     (see formatMarkdown / escapeHtml below — Sprint 13 fix).
 *   - Markdown link URLs are validated via isSafeUrl(): only http/https/
 *     mailto/relative/fragment are allowed; javascript:/data:/vbscript:
 *     etc. are rewritten to '#'.
 */
(() => {
    const $ = (s) => document.querySelector(s);
    const trigger = $('#chat-trigger');
    const win = $('#chat-window');
    const closeBtn = $('#chat-close');
    const resetBtn = $('#chat-reset');
    const input = $('#chat-input');
    const sendBtn = $('#chat-send');
    const messagesEl = $('#chat-messages');
    const quickReplies = $('#quick-replies');

    let history = [];
    let sending = false;
    let queryCount = 0;
    let abortController = null;
    const SESSION_LIMIT = 100;

    // --- Open / Close ---
    function openChat() {
      win.classList.add('open');
      trigger.classList.add('hidden');
      input.focus();
    }
    function closeChat() {
      win.classList.remove('open');
      trigger.classList.remove('hidden');
    }

    trigger.addEventListener('click', openChat);
    closeBtn.addEventListener('click', closeChat);

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', (e) => {
      // Ctrl+K or Cmd+K to toggle
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        win.classList.contains('open') ? closeChat() : openChat();
      }
      // Escape to close
      if (e.key === 'Escape' && win.classList.contains('open')) {
        e.preventDefault();
        closeChat();
      }
    });

    // --- New conversation ---
    resetBtn.addEventListener('click', () => {
      history = [];
      queryCount = 0;
      messagesEl.innerHTML = '<div class="msg msg-ai">Hi! I\'m the CloudCDN Concierge. Ask me about pricing, setup, performance, or anything about our edge CDN.</div>';
      quickReplies.style.display = 'flex';
      input.disabled = false;
      sendBtn.disabled = false;
      input.placeholder = 'Ask anything about CloudCDN...';
      input.focus();
    });

    // --- Quick replies ---
    quickReplies.addEventListener('click', (e) => {
      const btn = e.target.closest('.quick-reply');
      if (btn) sendMessage(btn.dataset.msg);
    });

    // --- Send ---
    sendBtn.addEventListener('click', () => sendMessage(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });

    async function sendMessage(text) {
      text = (text || '').trim();
      if (!text || sending) return;

      sending = true;
      sendBtn.disabled = true;
      input.value = '';
      quickReplies.style.display = 'none';

      // Remove any previous follow-ups
      const oldFollowUps = messagesEl.querySelectorAll('.follow-ups');
      oldFollowUps.forEach(el => el.remove());

      appendMessage('user', text);
      history.push({ role: 'user', content: text });

      // Skeleton loading
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton';
      skeleton.setAttribute('role', 'status');
      skeleton.setAttribute('aria-label', 'Concierge is thinking');
      skeleton.innerHTML = '<div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div>';
      messagesEl.appendChild(skeleton);
      scrollToBottom();

      // Stop button
      const stopBtn = document.createElement('button');
      stopBtn.className = 'stop-btn';
      stopBtn.innerHTML = '<span class="stop-square"></span> Stop generating';
      messagesEl.appendChild(stopBtn);

      abortController = new AbortController();
      stopBtn.addEventListener('click', () => {
        if (abortController) abortController.abort();
      });

      // Prepare streaming message container
      const aiMsg = document.createElement('div');
      aiMsg.className = 'msg msg-ai';
      aiMsg.style.display = 'none';
      messagesEl.appendChild(aiMsg);

      let fullText = '';
      let sources = [];
      let confidence = 'low';
      let remaining = null;
      let followUps = [];
      let streamStarted = false;

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: history.slice(-10) }),
          signal: abortController.signal,
        });

        // Handle non-streaming error responses (429, 400, 500)
        const ct = res.headers.get('Content-Type') || '';
        if (!res.ok || (ct.includes('application/json') && !ct.includes('text/event-stream'))) {
          skeleton.remove();
          stopBtn.remove();
          aiMsg.remove();
          const data = await res.json();
          if (res.status === 429 || data.error === 'limit_reached') {
            appendMessage('ai', data.message || 'The Concierge has reached its monthly limit. Please try again next month.');
            hideWidget();
          } else {
            appendMessage('ai', 'Sorry, something went wrong. Please try again.');
          }
          sending = false;
          sendBtn.disabled = false;
          return;
        }

        // Stream SSE
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);

                if (eventType === 'metadata') {
                  sources = parsed.sources || [];
                  confidence = parsed.confidence || 'low';
                  remaining = parsed.remaining;
                } else if (eventType === 'token') {
                  if (!streamStarted) {
                    streamStarted = true;
                    skeleton.remove();
                    aiMsg.style.display = '';
                  }
                  fullText += parsed.text;
                  renderStream(aiMsg, fullText);
                  scrollToBottom();
                } else if (eventType === 'done') {
                  followUps = parsed.followUps || [];
                } else if (eventType === 'error') {
                  throw new Error(parsed.error);
                }
              } catch (parseErr) {
                if (parseErr.message === 'Stream interrupted') throw parseErr;
              }
              eventType = '';
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // User stopped generation
        } else {
          if (!streamStarted) {
            skeleton.remove();
            aiMsg.remove();
            appendMessage('ai', 'Unable to reach the Concierge. Please check your connection.');
          }
        }
      }

      skeleton.remove();
      stopBtn.remove();

      // Strip FOLLOW_UPS line from displayed text
      const cleanText = fullText.replace(/\n?FOLLOW_UPS:.*$/, '').trim();

      if (cleanText) {
        // Final render without cursor
        aiMsg.style.display = '';
        aiMsg.innerHTML = formatMarkdown(cleanText);
        addCodeCopyButtons(aiMsg);

        // Sources
        if (sources.length > 0) {
          const srcEl = document.createElement('div');
          srcEl.className = 'msg-sources';
          sources.forEach((s) => {
            const tag = document.createElement('span');
            tag.className = 'msg-source-tag';
            tag.textContent = s.replace(/\.md$/, '');
            srcEl.appendChild(tag);
          });
          aiMsg.appendChild(srcEl);
        }

        // Confidence
        const confEl = document.createElement('div');
        confEl.className = 'msg-confidence';
        confEl.innerHTML = `<span class="confidence-dot confidence-${confidence}"></span> ${confidence} confidence`;
        aiMsg.appendChild(confEl);

        // Feedback
        const fbEl = document.createElement('div');
        fbEl.className = 'msg-feedback';
        fbEl.innerHTML = `
          <button class="feedback-btn" data-vote="up" aria-label="Helpful"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg></button>
          <button class="feedback-btn" data-vote="down" aria-label="Not helpful"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg></button>
        `;
        fbEl.querySelectorAll('.feedback-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            fbEl.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
          });
        });
        aiMsg.appendChild(fbEl);

        history.push({ role: 'assistant', content: cleanText });
        queryCount++;

        // Follow-up suggestions
        if (followUps.length > 0) {
          const fuEl = document.createElement('div');
          fuEl.className = 'follow-ups';
          followUps.forEach((q) => {
            const btn = document.createElement('button');
            btn.className = 'follow-up-btn';
            btn.textContent = q;
            btn.addEventListener('click', () => {
              fuEl.remove();
              sendMessage(q);
            });
            fuEl.appendChild(btn);
          });
          messagesEl.appendChild(fuEl);
        }
      } else if (!aiMsg.innerHTML) {
        aiMsg.remove();
      }

      scrollToBottom();

      if (queryCount >= SESSION_LIMIT) {
        appendMessage('ai', 'You\'ve reached the session limit. Click the refresh button above to start a new conversation.');
        hideWidget();
        sending = false;
        sendBtn.disabled = false;
        return;
      }

      sending = false;
      sendBtn.disabled = false;
      abortController = null;
      input.focus();
    }

    // --- Render streaming text with cursor ---
    function renderStream(el, text) {
      const clean = text.replace(/\n?FOLLOW_UPS:.*$/, '');
      el.innerHTML = formatMarkdown(clean) + '<span class="streaming-cursor"></span>';
    }

    // --- Append static message ---
    function appendMessage(role, text) {
      const div = document.createElement('div');
      div.className = `msg msg-${role}`;
      if (role === 'ai') {
        div.innerHTML = formatMarkdown(text);
      } else {
        div.textContent = text;
      }
      messagesEl.appendChild(div);
      scrollToBottom();
    }

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideWidget() {
      sendBtn.disabled = true;
      input.disabled = true;
      input.placeholder = 'Concierge unavailable';
    }

    // --- Code copy buttons ---
    function addCodeCopyButtons(container) {
      container.querySelectorAll('pre').forEach((pre) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'code-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const btn = document.createElement('button');
        btn.className = 'code-copy';
        btn.textContent = 'Copy';
        btn.addEventListener('click', () => {
          const code = pre.textContent;
          navigator.clipboard.writeText(code).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          });
        });
        wrapper.appendChild(btn);
      });
    }

    // --- Markdown renderer ---
    // Allow http(s), mailto, fragments, and relative URLs. Reject any
    // other scheme (javascript:, data:, vbscript:, file:) by collapsing
    // it to '#' so a Markdown-link attack ([click](javascript:alert(1)))
    // can't reintroduce inline JS once we've HTML-escaped the body.
    function isSafeUrl(url) {
      const t = String(url || '').trim().toLowerCase();
      if (!t) return false;
      if (t.startsWith('http://') || t.startsWith('https://')) return true;
      if (t.startsWith('mailto:')) return true;
      if (t.startsWith('#') || t.startsWith('/') || t.startsWith('./') || t.startsWith('../')) return true;
      // Anything else with a colon before the first slash is a scheme we
      // haven't allowlisted — reject.
      const firstSlash = t.indexOf('/');
      const firstColon = t.indexOf(':');
      if (firstColon === -1 || (firstSlash !== -1 && firstColon > firstSlash)) return true;
      return false;
    }

    function formatMarkdown(text) {
      if (!text) return '';

      // Escape ALL HTML special characters up front. Markdown markers
      // (* _ # ` [ ] ( ) | -) are not HTML-special, so the transforms
      // below still recognize them. Any attacker-supplied <script>,
      // <img onerror=...>, or other raw HTML is neutralized to text.
      // Fixes: js/xss-through-dom (innerHTML on AI output).
      text = escapeHtml(text);

      // Protect code blocks. Content was escaped above so do NOT re-escape.
      const codeBlocks = [];
      text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        codeBlocks.push(`<pre><code${lang ? ` data-lang="${lang}"` : ''}>${code.trim()}</code></pre>`);
        return `\x00CB${codeBlocks.length - 1}\x00`;
      });

      // Tables (cell content already escaped).
      text = text.replace(/(?:^|\n)((?:\|.+\|\n)+)/g, (_, tableBlock) => {
        const rows = tableBlock.trim().split('\n');
        if (rows.length < 2) return tableBlock;

        let html = '<table>';
        rows.forEach((row, i) => {
          // Skip separator row
          if (/^\|[\s-:|]+\|$/.test(row)) return;
          const cells = row.split('|').filter((c, j, a) => j > 0 && j < a.length - 1);
          const tag = i === 0 ? 'th' : 'td';
          html += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
        });
        html += '</table>';
        return html;
      });

      text = text
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Headings
        .replace(/^### (.+)$/gm, '<strong style="display:block;margin:0.5em 0 0.25em;font-size:0.85em;color:var(--accent-text);">$1</strong>')
        .replace(/^## (.+)$/gm, '<strong style="display:block;margin:0.5em 0 0.25em;color:var(--accent-text);">$1</strong>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Links — validate scheme; reject anything not in the allowlist.
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
          const safe = isSafeUrl(url) ? url : '#';
          return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        })
        // Bullet lists
        .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
        // Numbered lists
        .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
        // Wrap consecutive <li> in <ul>
        .replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>')
        // Line breaks
        .replace(/\n/g, '<br>');

      // Restore code blocks
      text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

      return text;
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
})();
