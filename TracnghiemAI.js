/* QuizCraft Pro - Main Application Logic */

const MAX_DOC_CHARS = 12000;
const AI_RETRY_COUNT = 2;
const AI_RETRY_DELAY_MS = 1500;

// Repair UTF-8 text that was decoded as Windows-1252 by the local server.
function repairMojibakeText(value) {
    if (!value || !/(?:\u00C3|\u00C2|\u00E2|\u00E1[\u00BA\u00BB]|\u00C4|\u00C6|\u00F0\u0178)/.test(value)) return value;
    try {
        const windows1252Bytes = {
            '\u20AC': 0x80, '\u201A': 0x82, '\u0192': 0x83, '\u201E': 0x84,
            '\u2026': 0x85, '\u2020': 0x86, '\u2021': 0x87, '\u02C6': 0x88,
            '\u2030': 0x89, '\u0160': 0x8A, '\u2039': 0x8B, '\u0152': 0x8C,
            '\u017D': 0x8E, '\u2018': 0x91, '\u2019': 0x92, '\u201C': 0x93,
            '\u201D': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
            '\u02DC': 0x98, '\u2122': 0x99, '\u0161': 0x9A, '\u203A': 0x9B,
            '\u0153': 0x9C, '\u017E': 0x9E, '\u0178': 0x9F
        };
        const bytes = Uint8Array.from([...value].map(character =>
            windows1252Bytes[character] ?? character.charCodeAt(0)
        ));
        const repairedText = new TextDecoder('utf-8').decode(bytes);
        return repairedText.includes('\uFFFD') ? value : repairedText;
    } catch (e) {
        return value;
    }
}

function repairPageText(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    textNodes.forEach(textNode => {
        const repairedText = repairMojibakeText(textNode.nodeValue);
        if (repairedText !== textNode.nodeValue) textNode.nodeValue = repairedText;
    });
    root.querySelectorAll?.('[placeholder], [title], [aria-label]').forEach(element => {
        ['placeholder', 'title', 'aria-label'].forEach(attribute => {
            if (element.hasAttribute(attribute)) {
                element.setAttribute(attribute, repairMojibakeText(element.getAttribute(attribute)));
            }
        });
    });
    document.title = repairMojibakeText(document.title);
}

repairPageText();
const textRepairObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        if (mutation.type === 'characterData') {
            const repairedText = repairMojibakeText(mutation.target.nodeValue);
            if (repairedText !== mutation.target.nodeValue) mutation.target.nodeValue = repairedText;
        } else {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.TEXT_NODE) {
                    const repairedText = repairMojibakeText(node.nodeValue);
                    if (repairedText !== node.nodeValue) node.nodeValue = repairedText;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    repairPageText(node);
                }
            });
        }
    });
});
if (document.body) textRepairObserver.observe(document.body, { childList: true, characterData: true, subtree: true });

// --- Toast notifications ---
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    if (type === 'error') {
        container.classList.add('error-lock');
        toast.innerHTML = `<span class="toast-error-icon" aria-hidden="true">!</span>
            <span class="toast-error-content">
                <strong class="toast-error-title">Đã xảy ra lỗi</strong>
                <span class="toast-error-message">${escapeHtml(message)}</span>
            </span>
            <button class="toast-error-ok" type="button" aria-label="Đóng thông báo lỗi">OK</button>`;
        toast.querySelector('.toast-error-ok').addEventListener('click', () => {
            toast.remove();
            container.classList.remove('error-lock');
        });
    } else {
        toast.textContent = message;
    }
    container.appendChild(toast);
    if (type !== 'error') setTimeout(() => toast.remove(), duration);
}

function showAiSuccessModal(message) {
    const modal = document.getElementById('ai-success-modal');
    const messageEl = document.getElementById('ai-success-message');
    if (!modal || !messageEl) return;
    messageEl.textContent = message;
    modal.classList.remove('hide');
    document.getElementById('ai-success-ok')?.focus();
}

const aiSuccessOk = document.getElementById('ai-success-ok');
if (aiSuccessOk) {
    aiSuccessOk.addEventListener('click', () => {
        document.getElementById('ai-success-modal')?.classList.add('hide');
        switchTab(tabPlay, screenPlay);
        prepareQuizScreen();
    });
}

// --- KaTeX formatting ---
function formatMathText(text) {
    if (!text) return "";

    // Parse Markdown images: ![alt text](url)
    let formatted = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        return `<img src="${url.trim()}" alt="${alt.trim()}" style="max-width: 100%; max-height: 250px; border-radius: 8px; margin-top: 10px; display: block;" />`;
    });

    formatted = formatted.replace(/\$([^$]+)\$/g, (match, p1) => {
        try {
            return katex.renderToString(p1.trim(), { displayMode: false, throwOnError: false });
        } catch (e) {
            return match;
        }
    });

    if (!formatted.includes('<span class="katex">')) {
        try {
            if (formatted.includes('\\times') || formatted.includes('\\frac')) {
                return katex.renderToString(text.trim(), { displayMode: false, throwOnError: false });
            }
        } catch (e) {}
    }

    formatted = formatted.replace(/([A-Za-z])_([A-Za-z0-9]+)/g, '$1<sub>$2</sub>');
    return formatted;
}

// --- File text extraction ---
async function extractTextFromFile(file) {
    const fileName = file.name.toLowerCase();
    const fileExtension = fileName.split('.').pop();

    if (fileExtension === 'txt') {
        return await file.text();
    } else if (fileExtension === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    } else if (fileExtension === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;

        let fullText = "";
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            fullText += pageText + "\n\n";
        }
        return fullText;
    }
    throw new Error("Định dạng file không hỗ trợ trích xuất văn bản!");
}

function truncateDocument(text, maxChars = MAX_DOC_CHARS) {
    if (text.length <= maxChars) return { text, truncated: false };
    return {
        text: text.substring(0, maxChars) + "\n\n[... Nội dung đã được cắt bớt do vượt giới hạn ...]",
        truncated: true
    };
}

function updateDocLengthHint(textarea, hintEl) {
    if (!textarea || !hintEl) return;
    const len = textarea.value.length;
    hintEl.textContent = `${len.toLocaleString()} / ${MAX_DOC_CHARS.toLocaleString()} ký tự`;
    hintEl.classList.remove('warning', 'danger');
    if (len > MAX_DOC_CHARS) hintEl.classList.add('danger');
    else if (len > MAX_DOC_CHARS * 0.8) hintEl.classList.add('warning');
}

// --- Quiz validation ---
function validateQuizData(arr) {
    if (!Array.isArray(arr)) {
        throw new Error("Dữ liệu phải là mảng JSON.");
    }

    const valid = [];
    const errors = [];

    arr.forEach((item, i) => {
        const num = i + 1;
        if (!item || typeof item !== 'object') {
            errors.push(`Câu ${num}: không phải object hợp lệ`);
            return;
        }
        if (!item.question || typeof item.question !== 'string' || !item.question.trim()) {
            errors.push(`Câu ${num}: thiếu nội dung câu hỏi`);
            return;
        }
        if (!Array.isArray(item.options) || item.options.length < 2) {
            errors.push(`Câu ${num}: cần ít nhất 2 phương án`);
            return;
        }
        const options = item.options.map(o => String(o).trim()).filter(Boolean);
        if (options.length < 2) {
            errors.push(`Câu ${num}: phương án trống`);
            return;
        }
        let correct = item.correct;
        if (typeof correct === 'string') {
            const letter = correct.trim().toUpperCase();
            if (/^[A-D]$/.test(letter)) correct = letter.charCodeAt(0) - 65;
            else correct = parseInt(correct, 10);
        }
        correct = parseInt(correct, 10);
        if (isNaN(correct) || correct < 0 || correct >= options.length) {
            errors.push(`Câu ${num}: chỉ số đáp án đúng không hợp lệ (0-${options.length - 1})`);
            return;
        }
        valid.push({ question: item.question.trim(), options, correct });
    });

    if (valid.length === 0) {
        throw new Error("Không có câu hỏi hợp lệ.\n" + errors.slice(0, 5).join("\n"));
    }

    return { valid, errors, skipped: errors.length };
}

function parseAIResponse(rawText) {
    let cleanedText = rawText
        .replace(/[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
        .replace(/```json/gi, '')
        .replace(/```/gi, '')
        .trim();

    const startIdx = cleanedText.indexOf('[');
    const endIdx = cleanedText.lastIndexOf(']');

    if (startIdx === -1 || endIdx === -1) {
        throw new Error("Không tìm thấy cấu trúc mảng JSON trong phản hồi.");
    }

    const jsonString = cleanedText.substring(startIdx, endIdx + 1);
    return JSON.parse(jsonString);
}

function isHeaderRow(row) {
    const first = String(row[0] || '').toLowerCase();
    return /câu|question|cau|noi dung|nội dung/.test(first);
}

function parseCorrectIndex(val, optionsLen) {
    if (val === undefined || val === null || val === '') return 0;
    const s = String(val).trim().toUpperCase();
    if (/^[A-D]$/.test(s)) return s.charCodeAt(0) - 65;
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 0 && n < optionsLen) return n;
    if (!isNaN(n) && n >= 1 && n <= optionsLen) return n - 1;
    return 0;
}

function parseExcelToQuiz(workbook) {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const questions = [];
    rows.forEach((row, idx) => {
        if (!row || !row[0]) return;
        if (idx === 0 && isHeaderRow(row)) return;

        const question = String(row[0]).trim();
        const options = [row[1], row[2], row[3], row[4]]
            .map(o => String(o || '').trim())
            .filter(Boolean);

        if (!question || options.length < 2) return;

        questions.push({
            question,
            options,
            correct: parseCorrectIndex(row[5], options.length)
        });
    });

    return questions;
}

async function parseUploadedFile(file) {
    const ext = file.name.toLowerCase().split('.').pop();

    if (ext === 'json') {
        const text = await file.text();
        return JSON.parse(text);
    }

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        return parseExcelToQuiz(workbook);
    }

    if (ext === 'docx' || ext === 'pdf' || ext === 'txt') {
        const text = await extractTextFromFile(file);
        return { _isDocument: true, text };
    }

    throw new Error(`Định dạng .${ext} không được hỗ trợ.`);
}

function applyQuizData(rawData, sourceName = 'Bộ đề') {
    const { valid, errors, skipped } = validateQuizData(rawData);
    quizData = valid;
    currentQuizName = sourceName;
    persistOfflineQuiz();
    prepareQuizScreen();

    let msg = `Đã nạp ${valid.length} câu hỏi từ "${sourceName}"`;
    if (skipped > 0) msg += ` (${skipped} câu bị bỏ qua do lỗi)`;
    showToast(msg, skipped > 0 ? 'warning' : 'success');
    return { valid, errors, skipped };
}

// --- Export ---
function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function exportQuizJSON(data, filename) {
    const name = filename || currentQuizName || 'quizcraft-de';
    downloadBlob(JSON.stringify(data, null, 2), `${name}.json`, 'application/json');
    showToast('Đã xuất file JSON!', 'success');
}

function exportQuizExcel(data, filename) {
    const name = filename || currentQuizName || 'quizcraft-de';
    const rows = [['Câu hỏi', 'A', 'B', 'C', 'D', 'Đáp án đúng (0-3)']];
    data.forEach(q => {
        rows.push([
            q.question,
            q.options[0] || '',
            q.options[1] || '',
            q.options[2] || '',
            q.options[3] || '',
            q.correct
        ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DeTracNghiem');
    XLSX.writeFile(wb, `${name}.xlsx`);
    showToast('Đã xuất file Excel!', 'success');
}

// --- LocalStorage: saved quizzes & history ---
function loadSavedQuizzes() {
    try {
        return JSON.parse(localStorage.getItem('quizcraft_saved') || '[]');
    } catch { return []; }
}

function saveSavedQuizzes(list) {
    localStorage.setItem('quizcraft_saved', JSON.stringify(list));
}

function loadQuizHistory() {
    try {
        return JSON.parse(localStorage.getItem('quizcraft_history') || '[]');
    } catch { return []; }
}

function saveQuizHistory(list) {
    const trimmed = list.slice(0, 50);
    localStorage.setItem('quizcraft_history', JSON.stringify(trimmed));
}

function saveCurrentQuiz(name) {
    const quizName = name || currentQuizName || `Bộ đề ${new Date().toLocaleDateString('vi-VN')}`;
    const saved = loadSavedQuizzes();
    saved.unshift({
        id: Date.now().toString(36),
        name: quizName,
        date: new Date().toISOString(),
        data: quizData,
        timePerQuestion
    });
    saveSavedQuizzes(saved.slice(0, 30));
    renderSavedQuizzes();
    showToast(`Đã lưu "${quizName}"`, 'success');
}

function loadSavedQuiz(id) {
    const item = loadSavedQuizzes().find(q => q.id === id);
    if (!item) return;
    quizData = item.data;
    currentQuizName = item.name;
    timePerQuestion = item.timePerQuestion || 30;
    persistOfflineQuiz();
    switchTab(tabPlay, screenPlay);
    prepareQuizScreen();
    showToast(`Đã tải "${item.name}"`, 'info');
}

function deleteSavedQuiz(id) {
    const saved = loadSavedQuizzes().filter(q => q.id !== id);
    saveSavedQuizzes(saved);
    renderSavedQuizzes();
    showToast('Đã xóa bộ đề', 'info');
}

function addHistoryEntry(scoreVal, total) {
    const history = loadQuizHistory();
    history.unshift({
        date: new Date().toISOString(),
        quizName: currentQuizName,
        participantName: participantName || 'Không xác định',
        score: scoreVal,
        total,
        percentage: Math.round((scoreVal / total) * 100)
    });
    saveQuizHistory(history);
    renderHistory();
}

function renderSavedQuizzes() {
    const container = document.getElementById('saved-quizzes-list');
    if (!container) return;
    const saved = loadSavedQuizzes();

    if (saved.length === 0) {
        container.innerHTML = '<div class="empty-state">Chưa có bộ đề đã lưu</div>';
        return;
    }

    container.innerHTML = saved.map(item => `
        <div class="saved-item">
            <div class="saved-item-info">
                <div class="saved-item-name">${escapeHtml(item.name)}</div>
                <div class="saved-item-meta">${item.data.length} câu · ${new Date(item.date).toLocaleString('vi-VN')}</div>
            </div>
            <div class="saved-item-actions">
                <button class="icon-btn" title="Tải bộ đề" onclick="loadSavedQuiz('${item.id}')">▶</button>
                <button class="icon-btn danger" title="Xóa" onclick="deleteSavedQuiz('${item.id}')">🗑</button>
            </div>
        </div>
    `).join('');
}

function renderHistory() {
    const container = document.getElementById('history-list');
    if (!container) return;
    const history = loadQuizHistory();

    if (history.length === 0) {
        container.innerHTML = '<div class="empty-state">Chưa có lịch sử làm bài</div>';
        return;
    }

    container.innerHTML = history.slice(0, 10).map(item => `
        <div class="history-item">
            <div class="history-item-info">
                <div class="saved-item-name">${escapeHtml(item.quizName)}</div>
                <div class="history-item-meta">Người tham gia: ${escapeHtml(item.participantName || 'Không xác định')} · ${new Date(item.date).toLocaleString('vi-VN')}</div>
            </div>
            <div style="font-weight:900;color:${item.percentage >= 80 ? 'var(--success)' : item.percentage >= 50 ? 'var(--cyan)' : 'var(--danger)'}">
                ${item.score}/${item.total} (${item.percentage}%)
            </div>
        </div>
    `).join('');
}

function persistOfflineQuiz() {
    try {
        localStorage.setItem('quizcraft_offline_quiz', JSON.stringify({
            quizData,
            currentQuizName,
            timePerQuestion
        }));
    } catch (e) {}
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- BGM & sounds ---
const bgmTracks = {
    track1: 'https://files.catbox.moe/bu2wyo.mp3',
    track2: 'https://files.catbox.moe/gc1hpt.mp3',
    track3: 'https://files.catbox.moe/u868lk.mp3'
};

const bgmAudio = document.getElementById('bgm-audio');
let isBgmPlaying = false;
let audioCtx = null;

const answerSoundTracks = {
    correct: 'https://files.catbox.moe/wkfhut.mp3',
    wrong: 'https://files.catbox.moe/ndrwao.mp3'
};

const endingMusicTracks = {
    ending: 'https://files.catbox.moe/h1cbfh.mp3'
};

const bgmSelect = document.getElementById('bgm-select');
const soundBtn = document.getElementById('sound-btn');
const soundIcon = document.getElementById('sound-icon');
const soundText = document.getElementById('sound-text');
let activeEndingAudio = null;

function stopEndingMusic() {
    if (activeEndingAudio) {
        activeEndingAudio.pause();
        activeEndingAudio.currentTime = 0;
        activeEndingAudio = null;
    }
}

function pauseBgmForEnding() {
    if (bgmAudio) {
        bgmAudio.pause();
        bgmAudio.currentTime = 0;
    }
    setBgmButtonState(false);
    stopEndingMusic();
}

function initAudioContext() {
    if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function setBgmButtonState(playing) {
    if (!soundBtn) return;
    isBgmPlaying = playing;
    soundBtn.classList.toggle('active', playing);
    if (soundIcon) soundIcon.innerText = playing ? '▶' : '⏸';
    if (soundText) soundText.innerText = playing ? 'Tắt Nhạc' : 'Bật Nhạc';
}

function startBgmIfAllowed() {
    if (!bgmAudio) return;
    initAudioContext();

    const currentTrack = bgmTracks[bgmSelect?.value] || bgmTracks.track1;
    if (bgmAudio.src !== currentTrack) bgmAudio.src = currentTrack;
    bgmAudio.volume = 0.28;
    bgmAudio.loop = true;

    const playPromise = bgmAudio.play();
    if (playPromise && typeof playPromise.then === 'function') {
        playPromise
            .then(() => setBgmButtonState(true))
            .catch(() => {
                setBgmButtonState(false);
                showToast('Không thể phát nhạc tự động do chính sách trình duyệt.', 'warning');
            });
    } else {
        setBgmButtonState(true);
    }
}

if (bgmSelect) {
    bgmSelect.addEventListener('change', (e) => {
        const selectedTrack = e.target.value;
        if (bgmTracks[selectedTrack]) {
            bgmAudio.src = bgmTracks[selectedTrack];
            if (isBgmPlaying) {
                bgmAudio.play().catch(err => console.warn(err));
            }
        }
    });
}

if (soundBtn) {
    soundBtn.addEventListener('click', async () => {
        initAudioContext();
        if (isBgmPlaying) {
            bgmAudio.pause();
            setBgmButtonState(false);
        } else {
            try {
                startBgmIfAllowed();
            } catch (err) {
                showToast('Không thể phát nhạc tự động do chính sách trình duyệt.', 'warning');
            }
        }
    });
}

function playSoundTrack(url, volume = 0.75, loop = false, onEndedCleanup = null) {
    if (!url) return null;

    try {
        const audio = new Audio(url);
        audio.preload = 'auto';
        audio.crossOrigin = 'anonymous';
        audio.volume = volume;
        audio.loop = loop;
        audio.muted = false;
        audio.addEventListener('ended', () => {
            if (onEndedCleanup) onEndedCleanup();
        }, { once: true });

        const playAttempt = () => {
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.catch(() => {
                    setTimeout(() => {
                        audio.play().catch(() => console.warn('Không thể phát âm thanh từ đường dẫn:', url));
                    }, 180);
                });
            }
        };

        playAttempt();
        return audio;
    } catch (e) {
        console.warn(e);
        return null;
    }
}

function playSyntheticSound(type, percentage = 0) {
    try {
        if (type === 'correct') {
            if (bgmAudio && !bgmAudio.paused) bgmAudio.volume = 0.2;
            playSoundTrack(answerSoundTracks.correct, 0.9);
            setTimeout(() => {
                if (bgmAudio && !bgmAudio.paused) bgmAudio.volume = 0.28;
            }, 500);
            return;
        }

        if (type === 'wrong') {
            if (bgmAudio && !bgmAudio.paused) bgmAudio.volume = 0.2;
            playSoundTrack(answerSoundTracks.wrong, 0.9);
            setTimeout(() => {
                if (bgmAudio && !bgmAudio.paused) bgmAudio.volume = 0.28;
            }, 500);
            return;
        }

        if (type === 'victory') {
            activeEndingAudio = playSoundTrack(endingMusicTracks.ending, 0.75, false, () => {
                activeEndingAudio = null;
            });
            if (activeEndingAudio) {
                activeEndingAudio.play().catch(() => console.warn('Không phát được nhạc kết thúc:', endingMusicTracks.ending));
            }
            return;
        }

        initAudioContext();
        const now = audioCtx.currentTime;

        if (type === 'correct') {
            [523.25, 659.25, 783.99].forEach((freq, index) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + index * 0.08);
                gain.gain.setValueAtTime(0.0001, now + index * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.08 + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.26);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(now + index * 0.08);
                osc.stop(now + index * 0.08 + 0.28);
            });
        } else if (type === 'wrong') {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, now);
            osc.frequency.exponentialRampToValueAtTime(90, now + 0.28);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.22, now + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.34);

            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(140, now + 0.06);
            osc2.frequency.exponentialRampToValueAtTime(62, now + 0.25);
            gain2.gain.setValueAtTime(0.0001, now + 0.06);
            gain2.gain.exponentialRampToValueAtTime(0.12, now + 0.09);
            gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
            osc2.connect(gain2); gain2.connect(audioCtx.destination);
            osc2.start(now + 0.06); osc2.stop(now + 0.30);
        } else if (type === 'victory') {
            [{ f: 392.0, t: 0.00, d: 0.16 }, { f: 523.25, t: 0.12, d: 0.16 }, { f: 659.25, t: 0.24, d: 0.16 }, { f: 783.99, t: 0.36, d: 0.22 }, { f: 1046.50, t: 0.58, d: 0.42 }].forEach(note => {
                const noteOsc = audioCtx.createOscillator();
                const noteGain = audioCtx.createGain();
                noteOsc.type = 'triangle';
                noteOsc.frequency.setValueAtTime(note.f, now + note.t);
                noteGain.gain.setValueAtTime(0.0001, now + note.t);
                noteGain.gain.exponentialRampToValueAtTime(0.2, now + note.t + 0.04);
                noteGain.gain.exponentialRampToValueAtTime(0.0001, now + note.t + note.d);
                noteOsc.connect(noteGain); noteGain.connect(audioCtx.destination);
                noteOsc.start(now + note.t); noteOsc.stop(now + note.t + note.d);
            });
        }
    } catch (e) { console.warn(e); }
}

// --- Quiz state ---
let quizData = [{
    question: "Công thức nào sau đây biểu diễn đúng tính chất tỉ lệ thức của hai tỉ số?",
    options: ["a \\times x = b \\times y", "a \\times y = b \\times x", "x \\times y = a \\times b", "\\frac{x}{y} = \\frac{a}{b}"],
    correct: 1
}];

let currentQuizName = 'Bộ đề mẫu';
let currentIdx = 0;
let score = 0;
let streak = 0;
let isAnswered = false;
let timePerQuestion = 30;
let timerInterval = null;
let autoNextTimeout = null;
let endTimeStamp = 0;
let pausedTimerMs = null;

const tabPlay = document.getElementById('tab-play');
const tabAi = document.getElementById('tab-ai');
const tabUpload = document.getElementById('tab-upload');
const tabLibrary = document.getElementById('tab-library');

const screenPlay = document.getElementById('screen-play');
const screenAi = document.getElementById('screen-ai');
const screenUpload = document.getElementById('screen-upload');
const screenLibrary = document.getElementById('screen-library');

const startScreen = document.getElementById('start-screen');
const startGameBtn = document.getElementById('start-game-btn');
const totalQuestionsTag = document.getElementById('total-questions-tag');
const participantNameInput = document.getElementById('participant-name');
const participantNameDisplay = document.getElementById('participant-name-display');
let participantName = '';

const quizBody = document.getElementById('quiz-body');
const resultBody = document.getElementById('result-body');
const questionText = document.getElementById('question-text');
const optionsGroup = document.getElementById('options-group');
const nextBtn = document.getElementById('next-btn');
const progressFill = document.getElementById('progress-fill');
const autoNextBar = document.getElementById('auto-next-bar');
const questionTracker = document.getElementById('question-tracker');
const scoreLive = document.getElementById('score-live');
const streakCount = document.getElementById('streak-count');
const timerBadge = document.getElementById('timer-badge');
const timeLeftEl = document.getElementById('time-left');

function switchTab(tab, screen) {
    if (tab !== tabPlay) {
        stopEndingMusic();
    }

    [tabPlay, tabAi, tabUpload, tabLibrary].forEach(t => t && t.classList.remove('active'));
    [screenPlay, screenAi, screenUpload, screenLibrary].forEach(s => s && s.classList.add('hide'));
    tab.classList.add('active');
    screen.classList.remove('hide');

    if (tab !== tabPlay) {
        if (timerInterval) {
            pausedTimerMs = Math.max(0, endTimeStamp - Date.now());
            clearInterval(timerInterval);
            timerInterval = null;
        }
        clearTimeout(autoNextTimeout);
    } else if (pausedTimerMs !== null && !quizBody.classList.contains('hide') && !isAnswered) {
        startQuestionTimer(pausedTimerMs);
        pausedTimerMs = null;
    }
    if (tab === tabLibrary) {
        renderSavedQuizzes();
        renderHistory();
    }
}

if (tabPlay) tabPlay.addEventListener('click', () => switchTab(tabPlay, screenPlay));
if (tabAi) tabAi.addEventListener('click', () => switchTab(tabAi, screenAi));
if (tabUpload) tabUpload.addEventListener('click', () => switchTab(tabUpload, screenUpload));
if (tabLibrary) tabLibrary.addEventListener('click', () => switchTab(tabLibrary, screenLibrary));

function prepareQuizScreen() {
    stopEndingMusic();
    clearInterval(timerInterval);
    clearTimeout(autoNextTimeout);
    pausedTimerMs = null;
    totalQuestionsTag.innerText = quizData.length;
    const nameEl = document.getElementById('quiz-name-tag');
    if (nameEl) nameEl.innerText = currentQuizName;
    startScreen.classList.remove('hide');
    quizBody.classList.add('hide');
    resultBody.classList.add('hide');
}

if (startGameBtn) {
    startGameBtn.addEventListener('click', () => {
        participantName = participantNameInput ? participantNameInput.value.trim() : '';
        if (!participantName) {
            showToast('Vui lòng nhập tên người tham gia trước khi làm bài.', 'warning');
            participantNameInput?.focus();
            return;
        }
        initAudioContext();
        const trackKeys = Object.keys(bgmTracks);
        const randomTrackKey = trackKeys[Math.floor(Math.random() * trackKeys.length)];
        if (bgmSelect) bgmSelect.value = randomTrackKey;
        bgmAudio.src = bgmTracks[randomTrackKey];
        startBgmIfAllowed();
        currentIdx = 0; score = 0; streak = 0;
        if (participantNameDisplay) participantNameDisplay.innerText = `👤 ${participantName}`;
        startScreen.classList.add('hide');
        resultBody.classList.add('hide');
        quizBody.classList.remove('hide');
        renderQuestion();
    });
}

function startQuestionTimer(durationMs = timePerQuestion * 1000) {
    clearInterval(timerInterval);
    endTimeStamp = Date.now() + durationMs;
    updateTimerDisplay();
    timerInterval = setInterval(updateTimerDisplay, 200);
}

function updateTimerDisplay() {
    if (isAnswered) return;
    const remaining = Math.max(0, Math.ceil((endTimeStamp - Date.now()) / 1000));
    timeLeftEl.innerText = `${remaining}s`;
    timerBadge.classList.toggle('warning', remaining <= 5 && remaining > 0);
    if (remaining <= 0) {
        clearInterval(timerInterval);
        handleTimeOut();
    }
}

function handleTimeOut() {
    if (isAnswered) return;
    isAnswered = true;
    playSyntheticSound('wrong');
    streak = 0;
    const q = quizData[currentIdx];
    const allOptions = optionsGroup.children;
    if (allOptions[q.correct]) allOptions[q.correct].classList.add('correct');
    Array.from(allOptions).forEach(opt => opt.classList.add('disabled'));
    streakCount.innerText = streak;
    triggerAutoNext();
}

function getLiveScoreDisplay() {
    const answered = isAnswered ? currentIdx + 1 : currentIdx;
    const denom = Math.max(answered, 1);
    return `${score}/${denom} (${Math.round((score / denom) * 100)}%)`;
}

function renderQuestion() {
    clearTimeout(autoNextTimeout);
    clearInterval(timerInterval);
    isAnswered = false;
    nextBtn.disabled = true;
    nextBtn.innerText = "CÂU TIẾP THEO ➔ (Tự chuyển sau 3s)";
    autoNextBar.classList.add('hide');
    autoNextBar.style.transform = 'scaleX(1)';
    optionsGroup.innerHTML = '';

    const q = quizData[currentIdx];
    questionText.innerHTML = formatMathText(q.question);
    questionTracker.innerText = `CÂU HỎI ${currentIdx + 1} / ${quizData.length}`;
    scoreLive.innerText = getLiveScoreDisplay();
    streakCount.innerText = streak;
    progressFill.style.width = `${(currentIdx / quizData.length) * 100}%`;

    q.options.forEach((opt, idx) => {
        const btn = document.createElement('div');
        btn.className = 'option-card';
        btn.innerHTML = `<span>${formatMathText(opt)}</span><span class="icon"></span>`;
        btn.addEventListener('click', () => selectOption(idx, btn));
        optionsGroup.appendChild(btn);
    });

    startQuestionTimer();
}

function selectOption(idx, el) {
    if (isAnswered) return;
    isAnswered = true;
    clearInterval(timerInterval);

    const q = quizData[currentIdx];
    const allOptions = optionsGroup.children;
    Array.from(allOptions).forEach(opt => opt.classList.add('disabled'));

    let isFinalQuestion = currentIdx === quizData.length - 1;

    if (idx === q.correct) {
        score++; streak++;
        el.classList.add('correct');
        playSyntheticSound('correct');
    } else {
        streak = 0;
        el.classList.add('wrong');
        allOptions[q.correct].classList.add('correct');
        playSyntheticSound('wrong');
    }

    scoreLive.innerText = getLiveScoreDisplay();
    streakCount.innerText = streak;
    triggerAutoNext();
}

function triggerAutoNext() {
    nextBtn.disabled = false;
    autoNextBar.classList.remove('hide');
    autoNextBar.style.transition = 'none';
    autoNextBar.style.transform = 'scaleX(1)';
    setTimeout(() => {
        autoNextBar.style.transition = 'transform 3s linear';
        autoNextBar.style.transform = 'scaleX(0)';
    }, 50);
    autoNextTimeout = setTimeout(goToNextQuestion, 3000);
}

function goToNextQuestion() {
    clearTimeout(autoNextTimeout);
    currentIdx++;
    if (currentIdx < quizData.length) renderQuestion();
    else showResults();
}

if (nextBtn) nextBtn.addEventListener('click', goToNextQuestion);

function triggerSimpleConfetti() {
    if (typeof confetti !== 'function') return;
    const colors = ['#7c3aed', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#f43f5e', '#3b82f6', '#ffffff'];
    const now = performance.now();
    for (let i = 0; i < 35; i++) {
        const t = now + Math.random() * 3000;
        const x = Math.random();
        const y = Math.random() * 0.7 + 0.1;
        const count = 40 + Math.floor(Math.random() * 100);
        const spread = 50 + Math.random() * 100;
        setTimeout(() => {
            confetti({
                particleCount: count,
                spread,
                origin: { x, y },
                startVelocity: 40 + Math.random() * 40,
                scalar: 0.9 + Math.random() * 0.8,
                ticks: 180 + Math.random() * 120,
                colors,
                gravity: 0.6 + Math.random() * 0.4
            });
        }, Math.max(0, t - now));
    }
}

function triggerFinalCelebration(percentage) {
    if (percentage >= 80) {
        triggerSimpleConfetti();
    }
    if (!activeEndingAudio) {
        playSyntheticSound('victory', percentage);
    }
}

function showResults() {
    clearInterval(timerInterval);
    clearTimeout(autoNextTimeout);
    quizBody.classList.add('hide');
    resultBody.classList.remove('hide');
    const percentage = (score / quizData.length) * 100;
    document.getElementById('final-score').innerText = `${score}/${quizData.length}`;
    document.getElementById('final-participant').innerText = `Người tham gia: ${participantName}`;
    addHistoryEntry(score, quizData.length);

    pauseBgmForEnding();
    triggerFinalCelebration(percentage);

    const titleEl = document.getElementById('result-title');
    const msgEl = document.getElementById('final-msg');
    const congratsTag = document.getElementById('congrats-tag');

    if (percentage >= 80) {
        congratsTag.innerText = "🏆 XUẤT SẮC ĐỈNH CAO";
        titleEl.innerText = "CHÚC MỪNG BẠN!";
        msgEl.innerText = "🚀 Kiến thức của bạn thật đỉnh cao! Bạn đã chinh phục bài thi một cách hoàn hảo!";
    } else if (percentage >= 50) {
        congratsTag.innerText = "🎉 BÀI THI THÀNH CÔNG";
        titleEl.innerText = "KẾT QUẢ RẤT TỐT!";
        msgEl.innerText = "⭐ Kết quả khá ấn tượng! Bạn đã vượt qua thử thách thành công.";
    } else {
        congratsTag.innerText = "💪 HÃY CỐ GẮNG HƠN";
        titleEl.innerText = "CỐ LÊN BẠN ƠI!";
        msgEl.innerText = "📚 Thất bại là mẹ thành công! Hãy ôn tập lại một chút và thử lại nhé!";
    }
}

const restartBtn = document.getElementById('restart-btn');
if (restartBtn) restartBtn.addEventListener('click', prepareQuizScreen);

const exportJsonBtn = document.getElementById('export-json-btn');
const exportExcelBtn = document.getElementById('export-excel-btn');
const saveQuizBtn = document.getElementById('save-quiz-btn');

if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => exportQuizJSON(quizData));
if (exportExcelBtn) exportExcelBtn.addEventListener('click', () => exportQuizExcel(quizData));
if (saveQuizBtn) saveQuizBtn.addEventListener('click', () => {
    const name = prompt('Tên bộ đề:', currentQuizName);
    if (name !== null) saveCurrentQuiz(name.trim() || currentQuizName);
});

// --- File Upload Tab ---
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const uploadStatus = document.getElementById('upload-status');

async function handleFileUpload(file) {
    if (!file) return;
    uploadStatus.classList.remove('hide');
    uploadStatus.innerHTML = `<span class="spinner"></span> Đang xử lý "${escapeHtml(file.name)}"...`;

    try {
        const parsed = await parseUploadedFile(file);

        if (parsed && parsed._isDocument) {
            uploadStatus.innerHTML = `📄 Đã trích xuất ${parsed.text.length.toLocaleString()} ký tự từ tài liệu.<br>
                <button class="btn-secondary btn-sm" style="margin-top:10px" id="send-to-ai-btn">🤖 Chuyển sang tab AI để tạo đề</button>`;
            document.getElementById('send-to-ai-btn').addEventListener('click', () => {
                aiDoc.value = parsed.text;
                updateDocLengthHint(aiDoc, document.getElementById('ai-doc-hint'));
                switchTab(tabAi, screenAi);
                showToast('Đã chuyển nội dung sang tab AI', 'info');
            });
            return;
        }

        applyQuizData(parsed, file.name.replace(/\.[^.]+$/, ''));
        switchTab(tabPlay, screenPlay);
        uploadStatus.innerHTML = `✅ Nạp thành công <b>${quizData.length}</b> câu hỏi từ <b>${escapeHtml(file.name)}</b>`;
    } catch (err) {
        uploadStatus.innerHTML = `❌ Lỗi: ${escapeHtml(err.message)}`;
        showToast('Lỗi đọc file: ' + err.message, 'error');
    }
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        handleFileUpload(e.target.files[0]);
        e.target.value = '';
    });
}

if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFileUpload(e.dataTransfer.files[0]);
    });
}

// --- AI Integration ---
const aiProviderSelect = document.getElementById('ai-provider');
const aiKeyInput = document.getElementById('ai-key');
const aiModelSelect = document.getElementById('ai-model');
const aiDoc = document.getElementById('ai-doc');
const aiCustomPrompt = document.getElementById('ai-custom-prompt');
const aiCount = document.getElementById('ai-count');
const aiTimer = document.getElementById('ai-timer');
const aiGenBtn = document.getElementById('ai-gen-btn');
const aiFileInput = document.getElementById('ai-file-input');
const btnUploadAiDoc = document.getElementById('btn-upload-ai-doc');
const aiDocHint = document.getElementById('ai-doc-hint');

if (btnUploadAiDoc) btnUploadAiDoc.addEventListener('click', () => aiFileInput.click());

if (aiFileInput) {
    aiFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';
        btnUploadAiDoc.innerText = "⏳ Đang đọc file...";
        try {
            const text = await extractTextFromFile(file);
            aiDoc.value = text;
            updateDocLengthHint(aiDoc, aiDocHint);
            btnUploadAiDoc.innerText = "📂 Đã tải file thành công!";
            setTimeout(() => { btnUploadAiDoc.innerText = "📂 Tải file Word/PDF vào đây"; }, 3000);
            if (text.length > MAX_DOC_CHARS) {
                showToast(`Tài liệu dài ${text.length.toLocaleString()} ký tự — sẽ tự cắt khi gửi AI`, 'warning');
            }
        } catch (err) {
            showToast('Lỗi đọc file: ' + err.message, 'error');
            btnUploadAiDoc.innerText = "📂 Tải file Word/PDF vào đây";
        }
    });
}

if (aiDoc) {
    aiDoc.addEventListener('input', () => updateDocLengthHint(aiDoc, aiDocHint));
    updateDocLengthHint(aiDoc, aiDocHint);
}

const aiModelOptions = {
    groq: [
        { val: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
        { val: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant (Nhanh)" },
        { val: "openai/gpt-oss-120b", name: "GPT-OSS 120B (OpenAI - Mạnh)" },
        { val: "openai/gpt-oss-20b", name: "GPT-OSS 20B (OpenAI - Nhanh)" }
    ],
    gemini: [
        { val: "gemini-3.6-flash", name: "Gemini 3.6 Flash (Thế hệ mới — Khuyên dùng)" },
        { val: "gemini-3.5-flash", name: "Gemini 3.5 Flash (GA — Agentic & Coding)" },
        { val: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite (Nhanh & Tiết kiệm)" }
    ],
    openrouter: [
        { val: "openai/gpt-oss-20b:free", name: "GPT-OSS 20B (Miễn phí - Nhanh)" },
        { val: "openai/gpt-oss-120b:free", name: "GPT-OSS 120B (Miễn phí - Mạnh)" },
        { val: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Miễn phí)" },
        { val: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (Suy luận)" }
    ],
    mistral: [
        { val: "mistral-small-latest", name: "Mistral Small (Khuyên dùng)" },
        { val: "mistral-large-latest", name: "Mistral Large" },
        { val: "open-mistral-nemo", name: "Mistral Nemo" }
    ],
    huggingface: [
        { val: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen 2.5 7B Instruct (Miễn phí)" },
        { val: "Qwen/Qwen3-8B", name: "Qwen 3 8B (Miễn phí)" },
        { val: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B Instruct" },
        { val: "microsoft/Phi-3.5-mini-instruct", name: "Microsoft Phi-3.5 Mini" },
        { val: "HuggingFaceH4/zephyr-7b-beta", name: "Zephyr 7B Beta" }
    ]
};

const openRouterFallbacks = [
    "openai/gpt-oss-20b:free",
    "openai/gpt-oss-120b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-r1:free"
];

function updateModelList() {
    const provider = aiProviderSelect.value;
    aiModelSelect.innerHTML = '';
    (aiModelOptions[provider] || []).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.val;
        opt.innerText = m.name;
        aiModelSelect.appendChild(opt);
    });
    aiKeyInput.value = localStorage.getItem(`key_${provider}`) || '';
}

if (aiProviderSelect) {
    aiProviderSelect.addEventListener('change', updateModelList);
    updateModelList();
}

if (aiKeyInput) {
    aiKeyInput.addEventListener('input', () => {
        localStorage.setItem(`key_${aiProviderSelect.value}`, aiKeyInput.value.trim());
    });
}

function formatApiError(status, data, provider) {
    const msg = data?.error?.message || data?.error || data?.message || JSON.stringify(data).substring(0, 200);
    if (status === 401 || status === 403) return `[${provider}] API Key không hợp lệ hoặc hết hạn.`;
    if (status === 402) return `[${provider}] Tài khoản chưa có billing hoặc tín dụng API. Hãy kiểm tra gói dịch vụ hoặc chuyển sang provider khác.`;
    if (status === 429) return `[${provider}] Vượt giới hạn request (rate limit). Thử lại sau vài phút.`;
    if (status === 404) {
        if (provider === 'mistral') return '[Mistral] Model không tồn tại hoặc chưa được bật cho API key này. Hãy chọn model khác.';
        return `[${provider}] Model không tồn tại hoặc đã bị gỡ. Hãy chọn model khác trong danh sách và thử lại.`;
    }
    if (status >= 500) return `[${provider}] Lỗi server (${status}). Đang thử lại...`;
    return `[${provider}] Lỗi ${status}: ${msg}`;
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function fetchOpenAICompatible(endpoint, headers, model, systemInstruction, prompt, provider = 'API') {
    let res;
    try {
        res = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1
            })
        });
    } catch (error) {
        throw new Error(`[${provider}] Không thể kết nối API. Kiểm tra mạng, API key hoặc quyền truy cập model.`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(formatApiError(res.status, data, provider));
    return data.choices[0].message.content;
}

async function fetchAIQuizOnce(provider, apiKey, model, prompt) {
    const systemInstruction = "Bạn là một bộ máy trích xuất và tạo cấu trúc JSON thuần túy. YÊU CẦU: Chỉ trả về mảng dữ liệu JSON bắt đầu bằng dấu [ và kết thúc bằng dấu ]. Tuyệt đối không viết thêm bất kỳ lời giải thích nào khác.";

    if (provider === 'groq' || provider === 'openrouter' || provider === 'mistral') {
        let endpoint = "https://api.groq.com/openai/v1/chat/completions";
        let headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };

        if (provider === 'openrouter') {
            endpoint = "https://openrouter.ai/api/v1/chat/completions";
            headers["HTTP-Referer"] = window.location.href;
            headers["X-Title"] = "QuizCraft Pro";
        } else if (provider === 'mistral') {
            endpoint = "https://api.mistral.ai/v1/chat/completions";
        }

        return fetchOpenAICompatible(endpoint, headers, model, systemInstruction, prompt, provider);
    }

    if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemInstruction + "\n\n" + prompt }] }],
                generationConfig: { temperature: 0.1 }
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(formatApiError(res.status, data, 'Gemini'));
        return data.candidates[0].content.parts[0].text;
    }

    if (provider === 'huggingface') {
        return fetchOpenAICompatible(
            'https://router.huggingface.co/v1/chat/completions',
            { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            model,
            systemInstruction,
            prompt,
            'HuggingFace'
        );
    }

    throw new Error(`Provider "${provider}" không được hỗ trợ.`);
}

async function fetchAIQuizWithRetry(provider, apiKey, model, prompt) {
    let lastError = null;
    const fallbackModels = openRouterFallbacks;
    const modelsToTry = provider === 'openrouter'
        ? [model, ...fallbackModels.filter(m => m !== model)]
        : [model];

    for (const tryModel of modelsToTry) {
        for (let attempt = 0; attempt <= AI_RETRY_COUNT; attempt++) {
            try {
                if (attempt > 0) {
                    aiGenBtn.innerHTML = `<span class="spinner"></span> Thử lại lần ${attempt + 1} (${tryModel})...`;
                    await sleep(AI_RETRY_DELAY_MS * attempt);
                }
                return await fetchAIQuizOnce(provider, apiKey, tryModel, prompt);
            } catch (err) {
                lastError = err;
                console.warn(`AI attempt ${attempt + 1} failed:`, err.message);
                if (err.message.includes('401') || err.message.includes('402') || err.message.includes('403') || err.message.includes('API Key')) break;
            }
        }
    }
    throw lastError || new Error('Không thể kết nối AI sau nhiều lần thử.');
}

if (aiGenBtn) {
    aiGenBtn.addEventListener('click', async () => {
        const provider = aiProviderSelect.value;
        const apiKey = aiKeyInput.value.trim();
        const model = aiModelSelect.value;
        let doc = aiDoc.value.trim();
        const userPrompt = aiCustomPrompt.value.trim();
        const count = parseInt(aiCount.value) || 10;
        const timerVal = parseInt(aiTimer.value) || 30;

        if (!apiKey) return showToast(`Vui lòng nhập API Key cho ${provider.toUpperCase()}!`, 'warning');
        if (!doc) return showToast('Vui lòng nhập Nội dung/Tài liệu chính!', 'warning');

        const { text: trimmedDoc, truncated } = truncateDocument(doc);
        if (truncated) {
            showToast(`Tài liệu đã cắt còn ${MAX_DOC_CHARS.toLocaleString()} ký tự để phù hợp giới hạn AI`, 'warning');
            doc = trimmedDoc;
        }

        timePerQuestion = timerVal;
        aiGenBtn.disabled = true;
        aiGenBtn.innerHTML = `<span class="spinner"></span> Đang kết nối ${provider.toUpperCase()} (${model})...`;

        const fullPrompt = `Hãy tạo chính xác ${count} câu hỏi trắc nghiệm khách quan dựa hoàn toàn vào tài liệu sau. Trả về ĐÚNG định dạng Mảng JSON mẫu bên dưới, không markdown code, không chữ thừa.

TÀI LIỆU CHÍNH:
"${doc}"

${userPrompt ? `YÊU CẦU BỔ SUNG: ${userPrompt}` : ''}

CẤU TRÚC JSON MẪU:
[
  {
    "question": "Câu hỏi?",
    "options": ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
    "correct": 0
  }
]`;

        try {
            const rawText = await fetchAIQuizWithRetry(provider, apiKey, model, fullPrompt);
            const parsed = parseAIResponse(rawText);
            const { valid, skipped } = validateQuizData(parsed);

            quizData = valid;
            currentQuizName = `AI ${provider} - ${new Date().toLocaleDateString('vi-VN')}`;
            persistOfflineQuiz();
            showAiSuccessModal(`Đã tạo thành công ${valid.length} câu hỏi${skipped ? ` (${skipped} câu lỗi bỏ qua)` : ''}. Nhấn OK để bắt đầu làm bài.`);
        } catch (err) {
            showToast('Lỗi AI: ' + err.message, 'error', 6000);
        } finally {
            aiGenBtn.disabled = false;
            aiGenBtn.innerText = "⚡ BẮT ĐẦU TẠO CÂU HỎI BẰNG AI";
        }
    });
}

// --- PWA Service Worker ---
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed:', err));
    });
}

// --- Init ---
try {
    const offline = JSON.parse(localStorage.getItem('quizcraft_offline_quiz') || 'null');
    if (offline && offline.quizData && offline.quizData.length > 0) {
        quizData = offline.quizData;
        currentQuizName = offline.currentQuizName || currentQuizName;
        timePerQuestion = offline.timePerQuestion || 30;
    }
} catch (e) {}

prepareQuizScreen();
renderSavedQuizzes();
renderHistory();
persistOfflineQuiz();

const saveFromLibraryBtn = document.getElementById('save-from-library-btn');
if (saveFromLibraryBtn) {
    saveFromLibraryBtn.addEventListener('click', () => {
        const name = prompt('Tên bộ đề:', currentQuizName);
        if (name !== null) saveCurrentQuiz(name.trim() || currentQuizName);
    });
}

const exportJsonLibraryBtn = document.getElementById('export-json-library-btn');
const exportExcelLibraryBtn = document.getElementById('export-excel-library-btn');
if (exportJsonLibraryBtn) exportJsonLibraryBtn.addEventListener('click', () => exportQuizJSON(quizData));
if (exportExcelLibraryBtn) exportExcelLibraryBtn.addEventListener('click', () => exportQuizExcel(quizData));

// --- Settings Modal ---
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const settingsSave = document.getElementById('settings-save');

function openSettingsModal() {
    if (settingsModal) settingsModal.classList.remove('hide');
}

function closeSettingsModal() {
    if (settingsModal) settingsModal.classList.add('hide');
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettingsModal);
}

if (settingsClose) {
    settingsClose.addEventListener('click', closeSettingsModal);
}

if (settingsOverlay) {
    settingsOverlay.addEventListener('click', closeSettingsModal);
}

if (settingsSave) {
    settingsSave.addEventListener('click', () => {
        closeSettingsModal();
        showToast('Cài đặt đã được lưu thành công!', 'success');
    });
}

// Expose for inline onclick handlers
window.loadSavedQuiz = loadSavedQuiz;
window.deleteSavedQuiz = deleteSavedQuiz;
window.saveCurrentQuiz = saveCurrentQuiz;
window.exportQuizJSON = exportQuizJSON;
window.exportQuizExcel = exportQuizExcel;
