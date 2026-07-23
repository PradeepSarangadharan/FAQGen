(function () {
  'use strict';

  const faqList = document.getElementById('faqList');
  const addFaqBtn = document.getElementById('addFaqBtn');
  const clearBtn = document.getElementById('clearBtn');
  const output = document.getElementById('output');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const copyStatus = document.getElementById('copyStatus');
  const validationList = document.getElementById('validationList');
  const template = document.getElementById('faqItemTemplate');

  const importBtn = document.getElementById('importBtn');
  const importArea = document.getElementById('importArea');
  const importInput = document.getElementById('importInput');
  const importParseBtn = document.getElementById('importParseBtn');
  const importCancelBtn = document.getElementById('importCancelBtn');

  const STORAGE_KEY = 'faqgen.items.v1';
  let dragSrcEl = null;

  function loadInitialItems() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (Array.isArray(saved) && saved.length) return saved;
    } catch (e) {
      /* ignore corrupt storage */
    }
    return [
      { q: 'What is a FAQ schema?', a: 'A FAQ schema is structured data (JSON-LD) that tells search engines your page contains a list of questions and answers, which can make it eligible for a rich FAQ result in Google Search.' },
      { q: 'Is this generator free to use?', a: 'Yes, this tool is completely free with no sign-up required.' }
    ];
  }

  function saveItems() {
    const items = collectItems();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function createFaqItem(q, a) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('.faq-question').value = q || '';
    node.querySelector('.faq-answer').value = a || '';

    node.querySelector('.btn-remove').addEventListener('click', () => {
      node.remove();
      refresh();
    });

    node.querySelector('.faq-question').addEventListener('input', refresh);
    node.querySelector('.faq-answer').addEventListener('input', refresh);

    node.addEventListener('dragstart', () => {
      dragSrcEl = node;
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      dragSrcEl = null;
      refresh();
    });
    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.dragging');
      if (!dragging || dragging === node) return;
      const rect = node.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      node.parentNode.insertBefore(dragging, before ? node : node.nextSibling);
    });

    return node;
  }

  function addFaq(q, a, save) {
    faqList.appendChild(createFaqItem(q, a));
    updateIndices();
    if (save !== false) refresh();
  }

  function updateIndices() {
    [...faqList.querySelectorAll('.faq-item')].forEach((item, i) => {
      item.querySelector('.faq-index').textContent = 'Question ' + (i + 1);
    });
  }

  function collectItems() {
    return [...faqList.querySelectorAll('.faq-item')].map((item) => ({
      q: item.querySelector('.faq-question').value.trim(),
      a: item.querySelector('.faq-answer').value.trim()
    }));
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildSchema(items) {
    const validEntries = items.filter((it) => it.q && it.a);
    return {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: validEntries.map((it) => ({
        '@type': 'Question',
        name: it.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: it.a
        }
      }))
    };
  }

  function validate(items) {
    const messages = [];
    const nonEmpty = items.filter((it) => it.q || it.a);

    if (nonEmpty.length === 0) {
      messages.push({ type: 'error', text: 'Add at least one question and answer.' });
      return messages;
    }

    let hasIncomplete = false;
    let hasDuplicateQuestion = false;
    const seen = new Set();

    items.forEach((it) => {
      if ((it.q && !it.a) || (!it.q && it.a)) hasIncomplete = true;
      if (it.q) {
        const key = it.q.trim().toLowerCase();
        if (seen.has(key)) hasDuplicateQuestion = true;
        seen.add(key);
      }
      if (/<[^>]+>/.test(it.a)) {
        messages.push({ type: 'warn', text: 'Answers should be plain text — HTML tags found will be included literally, which Google recommends against for anything beyond basic formatting.' });
      }
    });

    const complete = items.filter((it) => it.q && it.a);

    if (complete.length === 0) {
      messages.push({ type: 'error', text: 'Every question needs a matching answer before it will appear in the schema.' });
    } else {
      messages.push({ type: 'ok', text: complete.length + ' question' + (complete.length === 1 ? '' : 's') + ' will be included in the schema.' });
    }

    if (hasIncomplete) {
      messages.push({ type: 'warn', text: 'Some entries are missing a question or answer and will be excluded from the output.' });
    }

    if (hasDuplicateQuestion) {
      messages.push({ type: 'warn', text: 'Duplicate questions detected — consider making each question unique.' });
    }

    return messages;
  }

  function renderValidation(messages) {
    validationList.innerHTML = '';
    messages.forEach((m) => {
      const li = document.createElement('li');
      li.className = m.type;
      const icon = m.type === 'ok' ? '✓' : m.type === 'error' ? '✕' : '⚠';
      li.textContent = icon + ' ' + m.text;
      validationList.appendChild(li);
    });
  }

  function renderOutput(schema) {
    const json = JSON.stringify(schema, null, 2);
    const scriptTag = '<script type="application/ld+json">\n' + json + '\n<\/script>';
    output.textContent = scriptTag;
    return scriptTag;
  }

  function refresh() {
    updateIndices();
    const items = collectItems();
    const schema = buildSchema(items);
    renderOutput(schema);
    renderValidation(validate(items));
    saveItems();
  }

  addFaqBtn.addEventListener('click', () => addFaq('', ''));

  clearBtn.addEventListener('click', () => {
    if (faqList.children.length === 0) return;
    if (!confirm('Remove all questions and start over?')) return;
    faqList.innerHTML = '';
    addFaq('', '');
  });

  copyBtn.addEventListener('click', async () => {
    const text = output.textContent;
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = 'Copied to clipboard!';
    } catch (e) {
      const range = document.createRange();
      range.selectNode(output);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      copyStatus.textContent = 'Press Ctrl+C / Cmd+C to copy (auto-copy unavailable).';
    }
    setTimeout(() => { copyStatus.textContent = ''; }, 2500);
  });

  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([output.textContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'faq-schema.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener('click', () => {
    importArea.classList.toggle('hidden');
  });

  importCancelBtn.addEventListener('click', () => {
    importInput.value = '';
    importArea.classList.add('hidden');
  });

  importParseBtn.addEventListener('click', () => {
    const html = importInput.value.trim();
    if (!html) return;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pairs = [];

    const headings = doc.body.querySelectorAll('h1, h2, h3, h4, h5, h6, dt, strong, b');
    headings.forEach((heading) => {
      const questionText = heading.textContent.trim();
      if (!questionText || !/\?\s*$/.test(questionText)) return;

      let answerParts = [];
      let sibling = heading.nextElementSibling;
      const stopTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DT']);
      while (sibling && !stopTags.has(sibling.tagName)) {
        const t = sibling.textContent.trim();
        if (t) answerParts.push(t);
        sibling = sibling.nextElementSibling;
      }
      const answerText = answerParts.join(' ').trim();
      if (answerText) pairs.push({ q: questionText, a: answerText });
    });

    if (pairs.length === 0) {
      alert('No question/answer pairs were detected. Try pasting content where questions end in "?" and are followed by paragraph text.');
      return;
    }

    faqList.innerHTML = '';
    pairs.forEach((p) => addFaq(p.q, p.a, false));
    refresh();

    importInput.value = '';
    importArea.classList.add('hidden');
  });

  const initialItems = loadInitialItems();
  initialItems.forEach((it) => addFaq(it.q, it.a, false));
  refresh();
})();
