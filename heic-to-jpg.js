(function () {
  'use strict';

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const selectFilesBtn = document.getElementById('selectFilesBtn');
  const qualityRange = document.getElementById('qualityRange');
  const qualityValue = document.getElementById('qualityValue');
  const fileListHeader = document.getElementById('fileListHeader');
  const fileList = document.getElementById('fileList');
  const convertAllBtn = document.getElementById('convertAllBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const itemTemplate = document.getElementById('fileItemTemplate');

  // entries: { id, file, name, status, node, resultBlob, resultUrl }
  const entries = [];
  let nextId = 1;

  function isHeicFile(file) {
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.heif') ||
      file.type === 'image/heic' || file.type === 'image/heif';
  }

  function outputName(originalName) {
    const dot = originalName.lastIndexOf('.');
    const base = dot > -1 ? originalName.slice(0, dot) : originalName;
    return base + '.jpg';
  }

  function updateHeaderVisibility() {
    fileListHeader.classList.toggle('hidden', entries.length === 0);
    const anyDone = entries.some((e) => e.status === 'done');
    downloadZipBtn.disabled = !anyDone;
  }

  function setStatus(entry, text, cssClass) {
    const statusEl = entry.node.querySelector('.file-status');
    statusEl.textContent = text;
    statusEl.className = 'file-status' + (cssClass ? ' ' + cssClass : '');
  }

  function addFiles(fileArray) {
    const heicFiles = fileArray.filter(isHeicFile);
    if (heicFiles.length === 0 && fileArray.length > 0) {
      alert('Please select .heic or .heif files.');
      return;
    }

    heicFiles.forEach((file) => {
      const node = itemTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector('.file-name').textContent = file.name;

      const entry = {
        id: nextId++,
        file,
        name: file.name,
        status: 'waiting',
        node,
        resultBlob: null,
        resultUrl: null
      };

      node.querySelector('.btn-convert-one').addEventListener('click', () => convertEntry(entry));
      node.querySelector('.btn-remove-file').addEventListener('click', () => removeEntry(entry));

      fileList.appendChild(node);
      entries.push(entry);
    });

    updateHeaderVisibility();
  }

  function removeEntry(entry) {
    if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
    entry.node.remove();
    const idx = entries.indexOf(entry);
    if (idx > -1) entries.splice(idx, 1);
    updateHeaderVisibility();
  }

  async function convertEntry(entry) {
    if (entry.status === 'converting' || entry.status === 'done') return;
    entry.status = 'converting';
    setStatus(entry, 'Converting…');
    setConvertButtonDisabled(entry, true);

    try {
      const quality = Number(qualityRange.value) / 100;
      const result = await window.heic2any({
        blob: entry.file,
        toType: 'image/jpeg',
        quality
      });
      const blob = Array.isArray(result) ? result[0] : result;
      entry.resultBlob = blob;
      entry.resultUrl = URL.createObjectURL(blob);
      entry.status = 'done';

      setStatus(entry, 'Converted ✓', 'done');

      const img = entry.node.querySelector('.file-thumb-img');
      const placeholder = entry.node.querySelector('.file-thumb-placeholder');
      img.src = entry.resultUrl;
      img.hidden = false;
      placeholder.hidden = true;

      const downloadLink = entry.node.querySelector('.btn-download-one');
      downloadLink.href = entry.resultUrl;
      downloadLink.download = outputName(entry.name);
      downloadLink.classList.remove('hidden');

      const convertBtn = entry.node.querySelector('.btn-convert-one');
      convertBtn.textContent = 'Re-convert';
    } catch (err) {
      entry.status = 'error';
      setStatus(entry, 'Failed to convert: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    } finally {
      setConvertButtonDisabled(entry, false);
      updateHeaderVisibility();
    }
  }

  function setConvertButtonDisabled(entry, disabled) {
    entry.node.querySelector('.btn-convert-one').disabled = disabled;
  }

  async function convertAll() {
    const pending = entries.filter((e) => e.status === 'waiting' || e.status === 'error');
    for (const entry of pending) {
      await convertEntry(entry);
    }
  }

  async function downloadZip() {
    const done = entries.filter((e) => e.status === 'done' && e.resultBlob);
    if (done.length === 0) return;

    downloadZipBtn.disabled = true;
    downloadZipBtn.textContent = 'Zipping…';

    try {
      const zip = new window.JSZip();
      done.forEach((entry) => {
        zip.file(outputName(entry.name), entry.resultBlob);
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'converted-jpgs.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      downloadZipBtn.textContent = 'Download All (ZIP)';
      updateHeaderVisibility();
    }
  }

  function clearAll() {
    if (entries.length === 0) return;
    if (!confirm('Remove all files?')) return;
    entries.slice().forEach(removeEntry);
  }

  selectFilesBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files || []));
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files : []);
    addFiles(files);
  });

  qualityRange.addEventListener('input', () => {
    qualityValue.textContent = qualityRange.value + '%';
  });

  convertAllBtn.addEventListener('click', convertAll);
  downloadZipBtn.addEventListener('click', downloadZip);
  clearAllBtn.addEventListener('click', clearAll);

  updateHeaderVisibility();
})();
