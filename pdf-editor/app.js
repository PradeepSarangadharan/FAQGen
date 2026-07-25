(function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;

  // ---- DOM refs ----
  const dropzone = document.getElementById('dropzone');
  const chooseFileBtn = document.getElementById('chooseFileBtn');
  const fileInput = document.getElementById('fileInput');
  const editorShell = document.getElementById('editorShell');
  const pagesScroll = document.getElementById('pagesScroll');
  const pageIndicator = document.getElementById('pageIndicator');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const zoomLabel = document.getElementById('zoomLabel');
  const undoBtn = document.getElementById('undoBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const newFileBtn = document.getElementById('newFileBtn');
  const exportBtn = document.getElementById('exportBtn');
  const propertyPanel = document.getElementById('propertyPanel');
  const imageInput = document.getElementById('imageInput');
  const statusToast = document.getElementById('statusToast');

  // ---- State ----
  let pdfDocProxy = null;      // pdf.js document
  let originalBytes = null;    // ArrayBuffer of the loaded file
  let numPages = 0;
  let zoom = 1.2;
  let currentTool = 'select';
  let selectedAnnotId = null;
  let annIdCounter = 1;
  let pendingImage = null;     // {dataUrl, mime, naturalW, naturalH} awaiting placement
  let history = [];            // undo stack of serialized states

  // Per-page state, keyed by page number (1-based)
  // pages[n] = { wrap, canvas, textLayerEl, annotLayerEl, viewportAtZoom, pageWidthPt, pageHeightPt, textItems: [{transform,width,height,fontName}], annotations: [] }
  const pages = {};

  const DEFAULTS = {
    text: { fontSize: 14, color: '#1c1f26', bold: false, italic: false },
    shape: { stroke: '#dc2626', strokeWidth: 2, fill: '#dc2626', fillOpacity: 0 },
    highlight: { color: '#fde047', opacity: 0.45 },
    comment: { color: '#fbbf24' }
  };
  let toolDefaults = JSON.parse(JSON.stringify(DEFAULTS));

  function toast(msg) {
    statusToast.textContent = msg;
    statusToast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => statusToast.classList.add('hidden'), 2200);
  }

  // ============================================================
  // File loading
  // ============================================================

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  chooseFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadFile(fileInput.files[0]);
  });
  newFileBtn.addEventListener('click', () => {
    if (!confirm('Open a new PDF? Unsaved changes to the current file will be lost.')) return;
    resetEditor();
  });

  function resetEditor() {
    pdfDocProxy = null;
    originalBytes = null;
    numPages = 0;
    history = [];
    Object.keys(pages).forEach((k) => delete pages[k]);
    pagesScroll.innerHTML = '';
    editorShell.classList.add('hidden');
    dropzone.classList.remove('hidden');
    fileInput.value = '';
  }

  async function loadFile(file) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast('Please choose a PDF file.');
      return;
    }
    try {
      originalBytes = await file.arrayBuffer();
      pdfDocProxy = await pdfjsLib.getDocument({ data: originalBytes.slice(0) }).promise;
      numPages = pdfDocProxy.numPages;
      dropzone.classList.add('hidden');
      editorShell.classList.remove('hidden');
      await renderAllPages();
      setTool('select');
      renderPropertyPanel();
      scrollToPage(1);
    } catch (err) {
      console.error(err);
      toast('Could not open that PDF.');
    }
  }

  // ============================================================
  // Rendering pages
  // ============================================================

  async function renderAllPages() {
    pagesScroll.innerHTML = '';
    for (let n = 1; n <= numPages; n++) {
      await renderPage(n);
    }
    updatePageIndicator();
  }

  async function renderPage(n) {
    const page = await pdfDocProxy.getPage(n);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: zoom });

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.dataset.page = String(n);
    wrap.style.width = viewport.width + 'px';
    wrap.style.height = viewport.height + 'px';

    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const coverLayerEl = document.createElement('div');
    coverLayerEl.className = 'cover-layer';
    coverLayerEl.style.width = viewport.width + 'px';
    coverLayerEl.style.height = viewport.height + 'px';

    const textLayerEl = document.createElement('div');
    textLayerEl.className = 'text-layer';
    textLayerEl.style.width = viewport.width + 'px';
    textLayerEl.style.height = viewport.height + 'px';
    textLayerEl.style.setProperty('--scale-factor', String(zoom));

    const annotLayerEl = document.createElement('div');
    annotLayerEl.className = 'annot-layer';
    annotLayerEl.style.width = viewport.width + 'px';
    annotLayerEl.style.height = viewport.height + 'px';

    wrap.appendChild(canvas);
    wrap.appendChild(coverLayerEl);
    wrap.appendChild(textLayerEl);
    wrap.appendChild(annotLayerEl);
    pagesScroll.appendChild(wrap);

    const textContent = await page.getTextContent();
    const textDivs = [];
    await pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport,
      textDivs
    }).promise;

    textDivs.forEach((div, i) => {
      const item = textContent.items[i];
      if (!item || item.str === undefined) return;
      div.dataset.origText = item.str;
      div.dataset.idx = String(i);
      div.addEventListener('input', () => {
        const p = pages[n];
        if (p && p.textEdits[i]) p.textEdits[i].text = div.textContent;
      });
    });

    const textFonts = textContent.items.map((it) => detectFontInfo(page, it.fontName));

    const existing = pages[n];
    pages[n] = {
      wrap,
      canvas,
      coverLayerEl,
      textLayerEl,
      annotLayerEl,
      pageWidthPt: baseViewport.width,
      pageHeightPt: baseViewport.height,
      textItems: textContent.items.map((it) => ({
        transform: it.transform,
        width: it.width,
        height: it.height,
        fontName: it.fontName
      })),
      textFonts,
      textDivs,
      textEdits: existing ? existing.textEdits : {},
      annotations: existing ? existing.annotations : []
    };

    // Re-render any existing floating annotations for this page (e.g. after zoom change)
    pages[n].annotations.forEach((ann) => mountAnnotationEl(n, ann));

    // Reapply any text edits carried over from before this re-render (e.g. a zoom change)
    applyTextEditsToPage(n);

    wireLayerEvents(n);
    applyToolLayerState(n);
  }

  function detectFontInfo(page, fontName) {
    try {
      const fontObj = page.commonObjs.get(fontName);
      const raw = (fontObj && fontObj.fallbackName) || '';
      return {
        family: classifyFamily(raw),
        bold: !!(fontObj && fontObj.bold),
        italic: !!(fontObj && fontObj.italic)
      };
    } catch (e) {
      return { family: 'sans-serif', bold: false, italic: false };
    }
  }

  function classifyFamily(raw) {
    const s = (raw || '').toLowerCase();
    if (s.includes('monospace') || s.includes('courier')) return 'monospace';
    if (s.includes('serif') && !s.includes('sans-serif')) return 'serif';
    return 'sans-serif';
  }

  function updatePageIndicator() {
    pageIndicator.textContent = `Page 1 / ${numPages}`;
  }

  function scrollToPage(n) {
    const p = pages[n];
    if (p) p.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function currentVisiblePage() {
    // Determine which page is most in view within pagesScroll
    const scrollBox = document.getElementById('pagesScroll');
    const boxTop = scrollBox.getBoundingClientRect().top;
    let best = 1, bestDist = Infinity;
    for (let n = 1; n <= numPages; n++) {
      const r = pages[n].wrap.getBoundingClientRect();
      const dist = Math.abs(r.top - boxTop);
      if (dist < bestDist) { bestDist = dist; best = n; }
    }
    return best;
  }

  prevPageBtn.addEventListener('click', () => {
    const n = Math.max(1, currentVisiblePage() - 1);
    scrollToPage(n);
  });
  nextPageBtn.addEventListener('click', () => {
    const n = Math.min(numPages, currentVisiblePage() + 1);
    scrollToPage(n);
  });

  // ============================================================
  // Zoom
  // ============================================================

  async function setZoom(z) {
    zoom = Math.max(0.4, Math.min(3, z));
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    if (!pdfDocProxy) return;
    const visible = currentVisiblePage();
    await renderAllPages();
    scrollToPage(visible);
  }
  zoomInBtn.addEventListener('click', () => setZoom(zoom + 0.15));
  zoomOutBtn.addEventListener('click', () => setZoom(zoom - 0.15));

  // ============================================================
  // Tool switching
  // ============================================================

  const toolButtons = [...document.querySelectorAll('.tool-btn[data-tool]')];
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'image') {
        imageInput.click();
        return;
      }
      setTool(btn.dataset.tool);
    });
  });

  function setTool(tool) {
    currentTool = tool;
    toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    selectAnnotation(null);
    for (let n = 1; n <= numPages; n++) applyToolLayerState(n);
    renderPropertyPanel();
  }

  function applyToolLayerState(n) {
    const p = pages[n];
    if (!p) return;
    p.textLayerEl.classList.toggle('tool-active', currentTool === 'edit');
    p.annotLayerEl.classList.toggle('select-active', currentTool === 'select');
    p.annotLayerEl.classList.toggle('tool-active', currentTool !== 'select' && currentTool !== 'edit');
  }

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        pendingImage = {
          dataUrl: reader.result,
          mime: file.type,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight
        };
        setTool('image');
        toast('Click on the page to place the image.');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    imageInput.value = '';
  });

  // ============================================================
  // Undo
  // ============================================================

  function pushHistory() {
    const snapshot = {};
    for (let n = 1; n <= numPages; n++) {
      snapshot[n] = {
        annotations: JSON.parse(JSON.stringify(pages[n].annotations)),
        textEdits: JSON.parse(JSON.stringify(pages[n].textEdits))
      };
    }
    history.push(snapshot);
    if (history.length > 40) history.shift();
  }

  function undo() {
    const snap = history.pop();
    if (!snap) { toast('Nothing to undo.'); return; }
    for (let n = 1; n <= numPages; n++) {
      const p = pages[n];
      p.annotLayerEl.innerHTML = '';
      p.annotations = snap[n].annotations;
      p.annotations.forEach((ann) => mountAnnotationEl(n, ann));
      p.textEdits = snap[n].textEdits;
      applyTextEditsToPage(n);
    }
    selectedTextSpan = null;
    selectAnnotation(null);
    renderPropertyPanel();
  }
  undoBtn.addEventListener('click', undo);

  document.addEventListener('keydown', (e) => {
    if (!editorShell || editorShell.classList.contains('hidden')) return;
    const active = document.activeElement;
    const isEditing = active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (active && active.isContentEditable) {
        // The browser's own contenteditable undo can revert an entire in-place
        // text edit in one step (it doesn't track granular history the way a
        // real editor does). Swallow it here instead of letting that happen.
        e.preventDefault();
        return;
      }
      if (isEditing) return; // let native undo behave normally inside textareas/inputs
      e.preventDefault();
      undo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotId && !isEditing) {
      e.preventDefault();
      deleteSelected();
    }
  });
  deleteBtn.addEventListener('click', deleteSelected);

  function deleteSelected() {
    if (!selectedAnnotId) { toast('Nothing selected.'); return; }
    pushHistory();
    for (let n = 1; n <= numPages; n++) {
      const p = pages[n];
      const idx = p.annotations.findIndex((a) => a.id === selectedAnnotId);
      if (idx !== -1) {
        p.annotations.splice(idx, 1);
        const el = p.annotLayerEl.querySelector(`[data-id="${selectedAnnotId}"]`);
        if (el) el.remove();
      }
    }
    selectAnnotation(null);
    renderPropertyPanel();
  }

  // ============================================================
  // Coordinate helpers
  // px <-> pt conversions use the current `zoom`. All stored
  // annotation geometry is in PDF points (top-left origin, y-down)
  // so it stays correct across zoom changes and at export time.
  // ============================================================

  function ptToPx(v) { return v * zoom; }
  function pxToPt(v) { return v / zoom; }

  // ============================================================
  // Floating annotation creation (drag-to-draw on annot layer)
  // ============================================================

  function wireLayerEvents(n) {
    const p = pages[n];

    p.annotLayerEl.addEventListener('pointerdown', (e) => {
      if (e.target !== p.annotLayerEl) return; // clicks on children handled separately
      const rect = p.annotLayerEl.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;

      if (currentTool === 'text') {
        createTextAnnotation(n, pxToPt(startX), pxToPt(startY));
        return;
      }
      if (currentTool === 'comment') {
        createCommentAnnotation(n, pxToPt(startX), pxToPt(startY));
        return;
      }
      if (currentTool === 'image') {
        if (!pendingImage) { imageInput.click(); return; }
        const w = Math.min(180, pendingImage.naturalW);
        const h = w * (pendingImage.naturalH / pendingImage.naturalW);
        createImageAnnotation(n, pxToPt(startX), pxToPt(startY), pxToPt(w), pxToPt(h));
        pendingImage = null;
        setTool('select');
        return;
      }
      if (['rect', 'ellipse', 'highlight'].includes(currentTool)) {
        dragCreateBox(n, currentTool, e, rect, startX, startY);
        return;
      }
      if (['line', 'arrow'].includes(currentTool)) {
        dragCreateLine(n, currentTool, e, rect, startX, startY);
        return;
      }
    });
  }

  function dragCreateBox(n, type, downEvt, rect, startX, startY) {
    const p = pages[n];
    const preview = document.createElement('div');
    preview.style.position = 'absolute';
    preview.style.left = startX + 'px';
    preview.style.top = startY + 'px';
    preview.style.border = '1.5px dashed ' + (type === 'highlight' ? '#ca8a04' : toolDefaults.shape.stroke);
    if (type === 'highlight') preview.style.background = 'rgba(253, 224, 71, 0.35)';
    preview.style.pointerEvents = 'none';
    p.annotLayerEl.appendChild(preview);

    function onMove(e) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x = Math.min(cx, startX), y = Math.min(cy, startY);
      const w = Math.abs(cx - startX), h = Math.abs(cy - startY);
      preview.style.left = x + 'px';
      preview.style.top = y + 'px';
      preview.style.width = w + 'px';
      preview.style.height = h + 'px';
    }
    function onUp(e) {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const x = Math.min(cx, startX), y = Math.min(cy, startY);
      let w = Math.abs(cx - startX), h = Math.abs(cy - startY);
      preview.remove();
      if (w < 6 || h < 6) { w = 80; h = 40; }
      if (type === 'highlight') {
        createHighlightAnnotation(n, pxToPt(x), pxToPt(y), pxToPt(w), pxToPt(h));
      } else {
        createShapeAnnotation(n, type, pxToPt(x), pxToPt(y), pxToPt(w), pxToPt(h));
      }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function dragCreateLine(n, type, downEvt, rect, startX, startY) {
    const p = pages[n];
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    const lineEl = document.createElementNS(svgNS, 'line');
    lineEl.setAttribute('stroke', toolDefaults.shape.stroke);
    lineEl.setAttribute('stroke-width', String(toolDefaults.shape.strokeWidth));
    svg.appendChild(lineEl);
    p.annotLayerEl.appendChild(svg);

    function update(x2, y2) {
      lineEl.setAttribute('x1', startX);
      lineEl.setAttribute('y1', startY);
      lineEl.setAttribute('x2', x2);
      lineEl.setAttribute('y2', y2);
    }
    update(startX, startY);

    function onMove(e) {
      update(e.clientX - rect.left, e.clientY - rect.top);
    }
    function onUp(e) {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const x2 = e.clientX - rect.left, y2 = e.clientY - rect.top;
      svg.remove();
      if (Math.hypot(x2 - startX, y2 - startY) < 6) return;
      createLineAnnotation(n, type, pxToPt(startX), pxToPt(startY), pxToPt(x2), pxToPt(y2));
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // ============================================================
  // Annotation model + mounting
  // ============================================================

  function newId() { return 'a' + annIdCounter++; }

  function addAnnotation(n, ann) {
    pushHistory();
    pages[n].annotations.push(ann);
    mountAnnotationEl(n, ann);
    selectAnnotation(ann.id, n);
  }

  function createTextAnnotation(n, x, y) {
    const ann = {
      id: newId(), type: 'text', x, y, w: 180, h: DEFAULTS.text.fontSize * 1.4,
      text: 'New text', fontSize: toolDefaults.text.fontSize,
      color: toolDefaults.text.color, bold: toolDefaults.text.bold, italic: toolDefaults.text.italic
    };
    addAnnotation(n, ann);
    setTool('select');
    const el = pages[n].annotLayerEl.querySelector(`[data-id="${ann.id}"] .annot-text`);
    if (el) {
      el.focus();
      document.execCommand && document.execCommand('selectAll', false, null);
    }
  }

  function createCommentAnnotation(n, x, y) {
    const ann = { id: newId(), type: 'comment', x, y, w: 22, h: 22, text: '', color: toolDefaults.comment.color };
    addAnnotation(n, ann);
    setTool('select');
    const popup = pages[n].annotLayerEl.querySelector(`[data-id="${ann.id}"] textarea`);
    if (popup) popup.focus();
  }

  function createImageAnnotation(n, x, y, w, h) {
    const ann = { id: newId(), type: 'image', x, y, w, h, dataUrl: pendingImage.dataUrl, mime: pendingImage.mime };
    addAnnotation(n, ann);
  }

  function createShapeAnnotation(n, shapeType, x, y, w, h) {
    const ann = {
      id: newId(), type: shapeType, x, y, w, h,
      stroke: toolDefaults.shape.stroke, strokeWidth: toolDefaults.shape.strokeWidth,
      fill: toolDefaults.shape.fill, fillOpacity: toolDefaults.shape.fillOpacity
    };
    addAnnotation(n, ann);
    setTool('select');
  }

  function createLineAnnotation(n, type, x1, y1, x2, y2) {
    const ann = {
      id: newId(), type, x1, y1, x2, y2,
      stroke: toolDefaults.shape.stroke, strokeWidth: toolDefaults.shape.strokeWidth
    };
    addAnnotation(n, ann);
    setTool('select');
  }

  function createHighlightAnnotation(n, x, y, w, h) {
    const ann = { id: newId(), type: 'highlight', x, y, w, h, color: toolDefaults.highlight.color, opacity: toolDefaults.highlight.opacity };
    addAnnotation(n, ann);
    setTool('select');
  }

  function mountAnnotationEl(n, ann) {
    const p = pages[n];
    let el = p.annotLayerEl.querySelector(`[data-id="${ann.id}"]`);
    if (el) el.remove();

    el = document.createElement('div');
    el.className = 'annot annot-' + (['line', 'arrow'].includes(ann.type) ? 'shape' : ann.type);
    el.dataset.id = ann.id;
    positionEl(el, ann);

    if (ann.type === 'text') {
      const inner = document.createElement('div');
      inner.className = 'annot-text';
      inner.contentEditable = 'true';
      inner.style.width = '100%';
      inner.style.height = '100%';
      inner.style.fontSize = ptToPx(ann.fontSize) + 'px';
      inner.style.color = ann.color;
      inner.style.fontWeight = ann.bold ? '700' : '400';
      inner.style.fontStyle = ann.italic ? 'italic' : 'normal';
      inner.style.fontFamily = 'Helvetica, Arial, sans-serif';
      inner.textContent = ann.text;
      inner.addEventListener('input', () => { ann.text = inner.textContent; });
      inner.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.appendChild(inner);
    } else if (ann.type === 'image') {
      const img = document.createElement('img');
      img.src = ann.dataUrl;
      el.appendChild(img);
    } else if (ann.type === 'rect' || ann.type === 'ellipse') {
      el.style.border = ptToPx(ann.strokeWidth) + 'px solid ' + ann.stroke;
      el.style.borderRadius = ann.type === 'ellipse' ? '50%' : '2px';
      el.style.background = hexToRgba(ann.fill, ann.fillOpacity);
    } else if (ann.type === 'line' || ann.type === 'arrow') {
      renderLineSvg(el, ann);
    } else if (ann.type === 'highlight') {
      el.style.background = hexToRgba(ann.color, ann.opacity);
      el.style.mixBlendMode = 'multiply';
    } else if (ann.type === 'comment') {
      el.textContent = '💬';
      el.style.background = ann.color;
      if (ann._open) el.appendChild(buildCommentPopup(n, ann));
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        ann._open = !ann._open;
        mountAnnotationEl(n, ann);
      });
    }

    if (ann.type !== 'text') {
      el.style.cursor = 'move';
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'annot-remove hidden';
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = 'Delete';
    removeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectAnnotation(ann.id, n);
      deleteSelected();
    });
    el.appendChild(removeBtn);

    const handle = document.createElement('div');
    handle.className = 'resize-handle hidden';
    el.appendChild(handle);

    wireAnnotInteractions(n, ann, el, handle, removeBtn);
    p.annotLayerEl.appendChild(el);
    return el;
  }

  function buildCommentPopup(n, ann) {
    const popup = document.createElement('div');
    popup.className = 'comment-popup';
    popup.addEventListener('pointerdown', (e) => e.stopPropagation());
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.placeholder = 'Add a comment...';
    ta.value = ann.text || '';
    ta.addEventListener('input', () => { ann.text = ta.value; });
    popup.appendChild(ta);
    return popup;
  }

  function renderLineSvg(el, ann) {
    const x1 = ptToPx(ann.x1), y1 = ptToPx(ann.y1), x2 = ptToPx(ann.x2), y2 = ptToPx(ann.y2);
    const minX = Math.min(x1, x2), minY = Math.min(y1, y2);
    el.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.style.position = 'absolute';
    svg.style.left = '0'; svg.style.top = '0';
    svg.style.width = '100%'; svg.style.height = '100%';
    svg.style.overflow = 'visible';
    const markerId = 'arrowhead-' + ann.id;
    if (ann.type === 'arrow') {
      const defs = document.createElementNS(svgNS, 'defs');
      const marker = document.createElementNS(svgNS, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerWidth', '8');
      marker.setAttribute('markerHeight', '8');
      marker.setAttribute('refX', '6');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M0,0 L0,6 L7,3 z');
      path.setAttribute('fill', ann.stroke);
      marker.appendChild(path);
      defs.appendChild(marker);
      svg.appendChild(defs);
    }
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x1 - minX);
    line.setAttribute('y1', y1 - minY);
    line.setAttribute('x2', x2 - minX);
    line.setAttribute('y2', y2 - minY);
    line.setAttribute('stroke', ann.stroke);
    line.setAttribute('stroke-width', String(ptToPx(ann.strokeWidth)));
    if (ann.type === 'arrow') line.setAttribute('marker-end', `url(#${markerId})`);
    svg.appendChild(line);
    el.appendChild(svg);
  }

  function positionEl(el, ann) {
    if (ann.type === 'line' || ann.type === 'arrow') {
      const minX = Math.min(ann.x1, ann.x2), minY = Math.min(ann.y1, ann.y2);
      const maxX = Math.max(ann.x1, ann.x2), maxY = Math.max(ann.y1, ann.y2);
      el.style.left = ptToPx(minX) + 'px';
      el.style.top = ptToPx(minY) + 'px';
      el.style.width = ptToPx(maxX - minX) + 'px';
      el.style.height = ptToPx(maxY - minY) + 'px';
    } else {
      el.style.left = ptToPx(ann.x) + 'px';
      el.style.top = ptToPx(ann.y) + 'px';
      el.style.width = ptToPx(ann.w) + 'px';
      el.style.height = ptToPx(ann.h) + 'px';
    }
  }

  function hexToRgba(hex, opacity) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  // ---- drag / resize ----

  function wireAnnotInteractions(n, ann, el, handle, removeBtn) {
    el.addEventListener('pointerdown', (e) => {
      if (currentTool !== 'select') return;
      if (e.target === handle) return;
      e.stopPropagation();
      selectAnnotation(ann.id, n);
      if (ann.type === 'text' && e.target.isContentEditable) return; // allow text caret placement
      if (ann.type === 'comment' && ann._open) return;

      pushHistory();
      const startPx = { x: e.clientX, y: e.clientY };
      const orig = ann.type === 'line' || ann.type === 'arrow'
        ? { x1: ann.x1, y1: ann.y1, x2: ann.x2, y2: ann.y2 }
        : { x: ann.x, y: ann.y };

      function onMove(ev) {
        const dxPt = pxToPt(ev.clientX - startPx.x);
        const dyPt = pxToPt(ev.clientY - startPx.y);
        if (ann.type === 'line' || ann.type === 'arrow') {
          ann.x1 = orig.x1 + dxPt; ann.y1 = orig.y1 + dyPt;
          ann.x2 = orig.x2 + dxPt; ann.y2 = orig.y2 + dyPt;
        } else {
          ann.x = orig.x + dxPt; ann.y = orig.y + dyPt;
        }
        positionEl(el, ann);
        if (ann.type === 'line' || ann.type === 'arrow') renderLineSvg(el, ann);
      }
      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });

    handle.addEventListener('pointerdown', (e) => {
      if (currentTool !== 'select') return;
      e.stopPropagation();
      pushHistory();
      const startPx = { x: e.clientX, y: e.clientY };
      const orig = { w: ann.w, h: ann.h };
      function onMove(ev) {
        const dW = pxToPt(ev.clientX - startPx.x);
        const dH = pxToPt(ev.clientY - startPx.y);
        ann.w = Math.max(10, orig.w + dW);
        ann.h = Math.max(10, orig.h + dH);
        positionEl(el, ann);
      }
      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp, { once: true });
    });
  }

  function selectAnnotation(id, pageNum) {
    selectedAnnotId = id;
    for (let n = 1; n <= numPages; n++) {
      const p = pages[n];
      if (!p) continue;
      [...p.annotLayerEl.querySelectorAll('.annot')].forEach((el) => {
        const isSel = el.dataset.id === id;
        el.classList.toggle('selected', isSel);
        const handle = el.querySelector('.resize-handle');
        const rm = el.querySelector('.annot-remove');
        if (handle) handle.classList.toggle('hidden', !isSel);
        if (rm) rm.classList.toggle('hidden', !isSel);
      });
    }
    renderPropertyPanel();
  }

  function findAnnotation(id) {
    for (let n = 1; n <= numPages; n++) {
      const p = pages[n];
      if (!p) continue;
      const ann = p.annotations.find((a) => a.id === id);
      if (ann) return { ann, pageNum: n };
    }
    return null;
  }

  // Click empty overlay area deselects (only for select tool)
  pagesScroll.addEventListener('pointerdown', (e) => {
    if (currentTool === 'select' && e.target.classList.contains('annot-layer')) {
      selectAnnotation(null);
    }
  });

  // ============================================================
  // Text-layer editing ("Edit Text": click original text to retype)
  // ============================================================

  document.addEventListener('click', (e) => {
    const span = e.target.closest ? e.target.closest('.text-layer span') : null;
    if (!span || currentTool !== 'edit') return;
    if (span.getAttribute('contenteditable') === 'true') return;
    document.querySelectorAll('.text-layer span[contenteditable="true"]').forEach((s) => {
      s.removeAttribute('contenteditable');
      s.classList.remove('span-editing');
    });
    pushHistory();
    beginEditingSpan(span);
  });

  let selectedTextSpan = null;

  function beginEditingSpan(span) {
    const wrap = span.closest('.page-wrap');
    const n = wrap ? Number(wrap.dataset.page) : null;
    const p = pages[n];
    const i = Number(span.dataset.idx);
    const fontInfo = (p.textFonts && p.textFonts[i]) || { family: 'sans-serif', bold: false, italic: false };
    const existing = p.textEdits[i];
    const bold = existing ? existing.bold : fontInfo.bold;
    const italic = existing ? existing.italic : fontInfo.italic;
    const color = existing ? existing.color : '#1c1f26';

    span.setAttribute('contenteditable', 'true');
    span.classList.add('span-editing', 'span-edited');
    span.dataset.edited = 'true';
    span.dataset.bold = String(bold);
    span.dataset.italic = String(italic);
    span.dataset.color = color;
    // Clear the width-fitting scaleX pdf.js applies to the original text — it
    // was tuned for the old content and visibly distorts/squishes the glyphs
    // as the replacement text grows or shrinks.
    span.style.transform = 'none';
    applySpanFontStyle(span, fontInfo.family, bold, italic, color);

    p.textEdits[i] = { text: span.textContent, bold, italic, color };
    addCoverForItem(n, i);

    span.focus();
    selectedTextSpan = { span, pageNum: n };
    renderPropertyPanel();
  }

  function applySpanFontStyle(span, family, bold, italic, color) {
    span.style.fontFamily = family === 'serif'
      ? 'Georgia, "Times New Roman", Times, serif'
      : family === 'monospace'
        ? '"Courier New", Courier, monospace'
        : 'Helvetica, Arial, sans-serif';
    span.style.fontWeight = bold ? '700' : '400';
    span.style.fontStyle = italic ? 'italic' : 'normal';
    span.style.color = color;
    span.style.webkitTextFillColor = color;
  }

  // Mirrors the export-time cover rectangle exactly (see drawFloatingAnnotation's
  // sibling logic in exportPdf) so the live preview matches the final PDF.
  function addCoverForItem(n, i) {
    const p = pages[n];
    if (p.coverLayerEl.querySelector(`[data-idx="${i}"]`)) return;
    const item = p.textItems[i];
    if (!item) return;
    const [a, b, c, d, e, f] = item.transform;
    const fontSize = Math.hypot(a, b) || Math.hypot(c, d) || 10;
    const width = item.width || fontSize;
    const height = item.height || fontSize * 1.15;
    const rectX = e - 0.5;
    const rectYBottom = f - height * 0.28;
    const rectW = width + 4;
    const rectH = height * 1.1;
    const topDownTopPt = p.pageHeightPt - (rectYBottom + rectH);

    const cover = document.createElement('div');
    cover.className = 'text-cover';
    cover.dataset.idx = String(i);
    cover.style.left = ptToPx(rectX) + 'px';
    cover.style.top = ptToPx(topDownTopPt) + 'px';
    cover.style.width = ptToPx(rectW) + 'px';
    cover.style.height = ptToPx(rectH) + 'px';
    p.coverLayerEl.appendChild(cover);
  }

  // Rebuilds every text span's visible state (edited or original) from
  // pages[n].textEdits — the durable source of truth. Used after a re-render
  // (e.g. zoom change) and after undo, so live edits always survive both.
  function applyTextEditsToPage(n) {
    const p = pages[n];
    p.coverLayerEl.innerHTML = '';
    p.textDivs.forEach((span, i) => {
      span.removeAttribute('contenteditable');
      span.classList.remove('span-editing');
      const edit = p.textEdits[i];
      if (edit) {
        const fontInfo = (p.textFonts && p.textFonts[i]) || { family: 'sans-serif' };
        span.textContent = edit.text;
        span.dataset.edited = 'true';
        span.dataset.bold = String(edit.bold);
        span.dataset.italic = String(edit.italic);
        span.dataset.color = edit.color;
        span.style.transform = 'none';
        span.classList.add('span-edited');
        applySpanFontStyle(span, fontInfo.family, edit.bold, edit.italic, edit.color);
        addCoverForItem(n, i);
      } else {
        span.textContent = span.dataset.origText;
        delete span.dataset.edited;
        span.classList.remove('span-edited');
        span.style.color = '';
        span.style.webkitTextFillColor = '';
        span.style.fontWeight = '';
        span.style.fontStyle = '';
        span.style.fontFamily = '';
      }
    });
  }

  function updateSpanEditState(span, patch) {
    const wrap = span.closest('.page-wrap');
    const n = Number(wrap.dataset.page);
    const p = pages[n];
    const i = Number(span.dataset.idx);
    const fontInfo = (p.textFonts && p.textFonts[i]) || { family: 'sans-serif' };
    const cur = p.textEdits[i] || { text: span.textContent, bold: false, italic: false, color: '#1c1f26' };
    const next = Object.assign({}, cur, patch);
    p.textEdits[i] = next;
    span.dataset.bold = String(next.bold);
    span.dataset.italic = String(next.italic);
    span.dataset.color = next.color;
    applySpanFontStyle(span, fontInfo.family, next.bold, next.italic, next.color);
  }

  // ============================================================
  // Property panel
  // ============================================================

  function renderPropertyPanel() {
    propertyPanel.innerHTML = '';

    const sel = selectedAnnotId ? findAnnotation(selectedAnnotId) : null;

    if (sel) {
      buildAnnotationProperties(sel.ann, sel.pageNum);
      return;
    }
    if (currentTool === 'edit' && selectedTextSpan && selectedTextSpan.span.isConnected) {
      buildTextSpanProperties(selectedTextSpan.span);
      return;
    }
    if (currentTool === 'text') {
      buildDefaultTextProperties();
      return;
    }
    if (['rect', 'ellipse', 'line', 'arrow'].includes(currentTool)) {
      buildDefaultShapeProperties();
      return;
    }
    if (currentTool === 'highlight') {
      buildDefaultHighlightProperties();
      return;
    }
    const hint = document.createElement('p');
    hint.className = 'property-hint';
    hint.textContent = currentTool === 'edit'
      ? 'Click any text on the page to edit it in place.'
      : 'Select a tool or an object to see its properties here.';
    propertyPanel.appendChild(hint);
  }

  function panelTitle(text) {
    const h = document.createElement('h3');
    h.textContent = text;
    propertyPanel.appendChild(h);
  }

  function colorRow(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'property-row';
    const l = document.createElement('label');
    l.textContent = label;
    const input = document.createElement('input');
    input.type = 'color';
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    row.appendChild(l); row.appendChild(input);
    propertyPanel.appendChild(row);
  }

  function rangeRow(label, value, min, max, step, onChange, formatFn) {
    const row = document.createElement('div');
    row.className = 'property-row';
    const l = document.createElement('label');
    l.textContent = label + (formatFn ? ' — ' + formatFn(value) : '');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step; input.value = value;
    input.addEventListener('input', () => {
      onChange(Number(input.value));
      if (formatFn) l.textContent = label + ' — ' + formatFn(Number(input.value));
    });
    row.appendChild(l); row.appendChild(input);
    propertyPanel.appendChild(row);
  }

  function toggleRow(options) {
    const row = document.createElement('div');
    row.className = 'property-row property-toggle-row';
    options.forEach((opt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool-btn';
      b.textContent = opt.label;
      b.setAttribute('aria-pressed', String(opt.active));
      b.addEventListener('click', () => opt.onClick());
      row.appendChild(b);
    });
    propertyPanel.appendChild(row);
  }

  function buildAnnotationProperties(ann, pageNum) {
    panelTitle(ann.type[0].toUpperCase() + ann.type.slice(1) + ' properties');
    const rerender = () => mountAnnotationEl(pageNum, ann);

    if (ann.type === 'text') {
      rangeRow('Font size', ann.fontSize, 8, 72, 1, (v) => { ann.fontSize = v; rerender(); }, (v) => v + 'pt');
      colorRow('Text color', ann.color, (v) => { ann.color = v; rerender(); });
      toggleRow([
        { label: 'B', active: ann.bold, onClick: () => { ann.bold = !ann.bold; rerender(); renderPropertyPanel(); } },
        { label: 'I', active: ann.italic, onClick: () => { ann.italic = !ann.italic; rerender(); renderPropertyPanel(); } }
      ]);
    } else if (ann.type === 'rect' || ann.type === 'ellipse') {
      colorRow('Border color', ann.stroke, (v) => { ann.stroke = v; rerender(); });
      rangeRow('Border width', ann.strokeWidth, 0, 10, 0.5, (v) => { ann.strokeWidth = v; rerender(); }, (v) => v + 'pt');
      colorRow('Fill color', ann.fill, (v) => { ann.fill = v; rerender(); });
      rangeRow('Fill opacity', ann.fillOpacity, 0, 1, 0.05, (v) => { ann.fillOpacity = v; rerender(); }, (v) => Math.round(v * 100) + '%');
    } else if (ann.type === 'line' || ann.type === 'arrow') {
      colorRow('Line color', ann.stroke, (v) => { ann.stroke = v; rerender(); });
      rangeRow('Line width', ann.strokeWidth, 1, 10, 0.5, (v) => { ann.strokeWidth = v; rerender(); }, (v) => v + 'pt');
    } else if (ann.type === 'highlight') {
      colorRow('Highlight color', ann.color, (v) => { ann.color = v; rerender(); });
      rangeRow('Opacity', ann.opacity, 0.1, 0.9, 0.05, (v) => { ann.opacity = v; rerender(); }, (v) => Math.round(v * 100) + '%');
    } else if (ann.type === 'comment') {
      colorRow('Note color', ann.color, (v) => { ann.color = v; rerender(); });
    } else if (ann.type === 'image') {
      const note = document.createElement('p');
      note.className = 'property-note';
      note.textContent = 'Drag to move, use the corner handle to resize.';
      propertyPanel.appendChild(note);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-secondary';
    delBtn.style.width = '100%';
    delBtn.style.marginTop = '8px';
    delBtn.textContent = 'Delete object';
    delBtn.addEventListener('click', deleteSelected);
    propertyPanel.appendChild(delBtn);
  }

  function buildTextSpanProperties(span) {
    panelTitle('Edit text');
    const note = document.createElement('p');
    note.className = 'property-note';
    note.textContent = 'Type directly on the page. Formatting below applies only to your edited text.';
    propertyPanel.appendChild(note);

    const currentColor = span.dataset.color || '#1c1f26';
    colorRow('Text color', currentColor, (v) => {
      updateSpanEditState(span, { color: v });
    });
    toggleRow([
      {
        label: 'B', active: span.dataset.bold === 'true',
        onClick: () => {
          updateSpanEditState(span, { bold: span.dataset.bold !== 'true' });
          renderPropertyPanel();
        }
      },
      {
        label: 'I', active: span.dataset.italic === 'true',
        onClick: () => {
          updateSpanEditState(span, { italic: span.dataset.italic !== 'true' });
          renderPropertyPanel();
        }
      }
    ]);
  }

  function buildDefaultTextProperties() {
    panelTitle('Add text');
    rangeRow('Font size', toolDefaults.text.fontSize, 8, 72, 1, (v) => toolDefaults.text.fontSize = v, (v) => v + 'pt');
    colorRow('Text color', toolDefaults.text.color, (v) => toolDefaults.text.color = v);
    const note = document.createElement('p');
    note.className = 'property-note';
    note.textContent = 'Click anywhere on the page to place a text box.';
    propertyPanel.appendChild(note);
  }

  function buildDefaultShapeProperties() {
    panelTitle('Shape style');
    colorRow('Stroke color', toolDefaults.shape.stroke, (v) => toolDefaults.shape.stroke = v);
    rangeRow('Stroke width', toolDefaults.shape.strokeWidth, 0.5, 10, 0.5, (v) => toolDefaults.shape.strokeWidth = v, (v) => v + 'pt');
    if (currentTool === 'rect' || currentTool === 'ellipse') {
      colorRow('Fill color', toolDefaults.shape.fill, (v) => toolDefaults.shape.fill = v);
      rangeRow('Fill opacity', toolDefaults.shape.fillOpacity, 0, 1, 0.05, (v) => toolDefaults.shape.fillOpacity = v, (v) => Math.round(v * 100) + '%');
    }
    const note = document.createElement('p');
    note.className = 'property-note';
    note.textContent = 'Click and drag on the page to draw.';
    propertyPanel.appendChild(note);
  }

  function buildDefaultHighlightProperties() {
    panelTitle('Highlight style');
    colorRow('Color', toolDefaults.highlight.color, (v) => toolDefaults.highlight.color = v);
    rangeRow('Opacity', toolDefaults.highlight.opacity, 0.1, 0.9, 0.05, (v) => toolDefaults.highlight.opacity = v, (v) => Math.round(v * 100) + '%');
    const note = document.createElement('p');
    note.className = 'property-note';
    note.textContent = 'Click and drag over text to highlight it.';
    propertyPanel.appendChild(note);
  }

  // ============================================================
  // Export
  // ============================================================

  exportBtn.addEventListener('click', exportPdf);

  async function exportPdf() {
    if (!originalBytes) return;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Preparing…';
    try {
      const pdfDoc = await PDFDocument.load(originalBytes.slice(0));
      const fontCache = {};
      const FONT_GROUPS = {
        serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
        monospace: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
        'sans-serif': [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique]
      };
      async function getFont(bold, italic, family) {
        const fam = FONT_GROUPS[family] ? family : 'sans-serif';
        const key = fam + '|' + (bold ? 'b' : '') + (italic ? 'i' : '');
        if (fontCache[key]) return fontCache[key];
        const [regular, boldFont, italicFont, boldItalicFont] = FONT_GROUPS[fam];
        let std = regular;
        if (bold && italic) std = boldItalicFont;
        else if (bold) std = boldFont;
        else if (italic) std = italicFont;
        const f = await pdfDoc.embedFont(std);
        fontCache[key] = f;
        return f;
      }

      const imageCache = {};
      async function getImage(ann) {
        if (imageCache[ann.dataUrl]) return imageCache[ann.dataUrl];
        const bytes = dataUrlToBytes(ann.dataUrl);
        const img = ann.mime === 'image/png'
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
        imageCache[ann.dataUrl] = img;
        return img;
      }

      const pdfPages = pdfDoc.getPages();

      for (let n = 1; n <= numPages; n++) {
        const pdfPage = pdfPages[n - 1];
        const { height: pageH } = pdfPage.getSize();
        const p = pages[n];

        // 1. Text-layer edits: cover original glyphs, draw replacement.
        for (const [idxStr, edit] of Object.entries(p.textEdits)) {
          const i = Number(idxStr);
          const item = p.textItems[i];
          if (!item) continue;
          const newText = edit.text;
          const [a, b, c, d, e, f] = item.transform;
          const fontSize = Math.hypot(a, b) || Math.hypot(c, d) || 10;
          const width = item.width || (newText.length * fontSize * 0.5);
          const height = item.height || fontSize * 1.15;

          pdfPage.drawRectangle({
            x: e - 0.5,
            y: f - height * 0.28,
            width: width + 4,
            height: height * 1.1,
            color: rgb(1, 1, 1)
          });

          if (newText.trim().length) {
            const fontInfo = (p.textFonts && p.textFonts[i]) || { family: 'sans-serif' };
            const [r, g, bl] = hexToRgbTriplet(edit.color || '#1c1f26');
            const font = await getFont(edit.bold, edit.italic, fontInfo.family);
            pdfPage.drawText(newText, { x: e, y: f, size: fontSize, font, color: rgb(r, g, bl) });
          }
        }

        // 2. Floating annotations, in the order they were created.
        for (const ann of p.annotations) {
          await drawFloatingAnnotation(pdfPage, pageH, ann, getFont, getImage);
        }
      }

      const bytes = await pdfDoc.save();
      downloadBytes(bytes, suggestFileName());
      toast('PDF downloaded.');
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + err.message);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = 'Download PDF';
    }
  }

  async function drawFloatingAnnotation(pdfPage, pageH, ann, getFont, getImage) {
    if (ann.type === 'text') {
      const font = await getFont(ann.bold, ann.italic);
      const [r, g, b] = hexToRgbTriplet(ann.color);
      const lines = String(ann.text || '').split('\n');
      let cursorY = pageH - ann.y - ann.fontSize;
      for (const line of lines) {
        pdfPage.drawText(line, { x: ann.x, y: cursorY, size: ann.fontSize, font, color: rgb(r, g, b), maxWidth: ann.w });
        cursorY -= ann.fontSize * 1.25;
      }
    } else if (ann.type === 'image') {
      const img = await getImage(ann);
      pdfPage.drawImage(img, {
        x: ann.x,
        y: pageH - ann.y - ann.h,
        width: ann.w,
        height: ann.h
      });
    } else if (ann.type === 'rect' || ann.type === 'ellipse') {
      const [sr, sg, sb] = hexToRgbTriplet(ann.stroke);
      const [fr, fg, fb] = hexToRgbTriplet(ann.fill);
      const opts = {
        x: ann.x,
        y: pageH - ann.y - ann.h,
        width: ann.w,
        height: ann.h,
        borderColor: rgb(sr, sg, sb),
        borderWidth: ann.strokeWidth,
        color: rgb(fr, fg, fb),
        opacity: ann.fillOpacity
      };
      if (ann.fillOpacity <= 0) delete opts.color;
      if (ann.type === 'ellipse') {
        pdfPage.drawEllipse({
          x: ann.x + ann.w / 2,
          y: pageH - ann.y - ann.h / 2,
          xScale: ann.w / 2,
          yScale: ann.h / 2,
          borderColor: rgb(sr, sg, sb),
          borderWidth: ann.strokeWidth,
          color: opts.color,
          opacity: ann.fillOpacity
        });
      } else {
        pdfPage.drawRectangle(opts);
      }
    } else if (ann.type === 'line' || ann.type === 'arrow') {
      const [sr, sg, sb] = hexToRgbTriplet(ann.stroke);
      const start = { x: ann.x1, y: pageH - ann.y1 };
      const end = { x: ann.x2, y: pageH - ann.y2 };
      pdfPage.drawLine({ start, end, thickness: ann.strokeWidth, color: rgb(sr, sg, sb) });
      if (ann.type === 'arrow') {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = 6 + ann.strokeWidth * 2;
        const p1 = {
          x: end.x - headLen * Math.cos(angle - Math.PI / 7),
          y: end.y - headLen * Math.sin(angle - Math.PI / 7)
        };
        const p2 = {
          x: end.x - headLen * Math.cos(angle + Math.PI / 7),
          y: end.y - headLen * Math.sin(angle + Math.PI / 7)
        };
        pdfPage.drawLine({ start: end, end: p1, thickness: ann.strokeWidth, color: rgb(sr, sg, sb) });
        pdfPage.drawLine({ start: end, end: p2, thickness: ann.strokeWidth, color: rgb(sr, sg, sb) });
      }
    } else if (ann.type === 'highlight') {
      const [r, g, b] = hexToRgbTriplet(ann.color);
      pdfPage.drawRectangle({
        x: ann.x,
        y: pageH - ann.y - ann.h,
        width: ann.w,
        height: ann.h,
        color: rgb(r, g, b),
        opacity: ann.opacity,
        blendMode: 'Multiply'
      });
    } else if (ann.type === 'comment') {
      const [r, g, b] = hexToRgbTriplet(ann.color);
      const cx = ann.x + ann.w / 2, cy = pageH - ann.y - ann.h / 2;
      pdfPage.drawEllipse({ x: cx, y: cy, xScale: ann.w / 2, yScale: ann.h / 2, color: rgb(r, g, b) });
      if (ann.text && ann.text.trim().length) {
        const font = await getFont(false, false);
        pdfPage.drawText(ann.text, {
          x: ann.x + ann.w + 4,
          y: pageH - ann.y - 10,
          size: 8,
          font,
          color: rgb(0.15, 0.15, 0.15),
          maxWidth: 180
        });
      }
    }
  }

  function hexToRgbTriplet(hex) {
    const h = (hex || '#000000').replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255
    ];
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function suggestFileName() {
    const base = fileInput.files[0] ? fileInput.files[0].name.replace(/\.pdf$/i, '') : 'document';
    return base + '-edited.pdf';
  }

  // Keyboard shortcuts for tool switching
  document.addEventListener('keydown', (e) => {
    if (!editorShell || editorShell.classList.contains('hidden')) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
    const map = { v: 'select', e: 'edit', t: 'text' };
    if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
  });
})();
