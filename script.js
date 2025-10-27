// =================================================================
// 1. VERİ TABANI VE İLERLEME YÖNETİMİ
//==================================================================

let exerciseDatabase = null;
let exerciseIdList = [];
let currentExerciseId = null;
let completedExercises = new Set();
const PROGRESS_STORAGE_KEY = 'SC_ACADEMY_PROGRESS';
const THEME_STORAGE_KEY = 'SC_ACADEMY_THEME';

// =================================================================
// 2. ANA UYGULAMA MANTIĞI
// =================================================================

// Global Değişkenler
let pyodide = null;
let editor = null;
let currentTheme = 'dark';

// DOM Elementleri
const codeEditorElement = document.getElementById('code-editor');
const consoleOutputElement = document.getElementById('console-output');
const testResultOutputElement = document.getElementById('test-result-output');
const runButton = document.getElementById('run-button');
const solutionButton = document.getElementById('solution-button');
const hintButton = document.getElementById('hint-button');
const nextExerciseButton = document.getElementById('next-exercise-button');
const resetButton = document.getElementById('reset-progress-button');
const resetCodeButton = document.getElementById('reset-code-button'); // Bu satırı kontrol edin
const themeToggleButton = document.getElementById('theme-toggle-button'); // YENİ: Tema butonu
const lessonNav = document.getElementById('lesson-nav');
const lessonTreeContainer = document.getElementById('lesson-tree-container');
const tabHeader = document.querySelector('.tab-header');
const tabPanes = document.querySelectorAll('.tab-pane');

const lessonTitleEl = document.getElementById('lesson-title');
const lessonDescriptionEl = document.getElementById('lesson-description');
const challengeTitleEl = document.getElementById('challenge-title');
const challengeDescriptionEl = document.getElementById('challenge-description');
const challengeHintEl = document.getElementById('challenge-hint');

/**
 * 1. Ace Editörünü Başlatır ve Kısayol Ekler
 */
function initializeAceEditor() {
    editor = ace.edit(codeEditorElement);
    // Temayı başlangıçta loadThemePreference belirleyecek
    // editor.setTheme("ace/theme/vibrant_ink");
    editor.session.setMode("ace/mode/python");
    editor.setFontSize(16);
    editor.session.setUseWrapMode(true);
    editor.commands.addCommand({ name: 'runCode', bindKey: { win: 'Ctrl-Enter', mac: 'Cmd-Enter' }, exec: (e) => { runPythonCode(); }, readOnly: false });

    // YENİ: Editör yüklendikten sonra temayı uygula
    loadThemePreference();
}

/**
 * 2. Konsola mesaj yazdıran yardımcı fonksiyon
 */
function logToConsole(message, type = 'normal') {
    const entry = document.createElement('div');
    entry.className = type;
    entry.textContent = message;
    consoleOutputElement.appendChild(entry);
    consoleOutputElement.scrollTop = consoleOutputElement.scrollHeight;
}

/**
 * 3. Test Sonucu sekmesine mesaj yazdıran yardımcı fonksiyon
 */
function logToTestResult(message, type = 'system') {
    const entry = document.createElement('div');
    entry.className = type;
    entry.textContent = message;
    testResultOutputElement.appendChild(entry);
    testResultOutputElement.scrollTop = testResultOutputElement.scrollHeight;
}

/**
 * 4. Dersi Veri Tabanından Yükleyen Fonksiyon
 */
function loadExercise(id) {
    if (!exerciseDatabase) { logToConsole(`Veri tabanı henüz yüklenmedi.`, 'error'); return; }
    const exercise = exerciseDatabase[id];
    if (!exercise) { logToConsole(`Hata: '${id}' ID'li ders veri tabanında bulunamadı.`, 'error'); return; }
    currentExerciseId = id;
    lessonTitleEl.textContent = exercise.title;
    lessonDescriptionEl.innerHTML = exercise.lesson_html;
    challengeTitleEl.textContent = exercise.challenge.title;
    challengeDescriptionEl.innerHTML = exercise.challenge.description;
    challengeHintEl.style.display = 'none';
    if (exercise.challenge.hint && exercise.challenge.hint.trim() !== '') { challengeHintEl.innerHTML = exercise.challenge.hint; } else { challengeHintEl.innerHTML = 'Bu ders için ipucu bulunmuyor.'; }
    if (editor) { editor.setValue(exercise.default_code, 1); editor.focus(); }
    const allNavItems = lessonNav.querySelectorAll('li.exercise-item');
    allNavItems.forEach(item => item.classList.remove('active'));
    const activeLink = lessonNav.querySelector(`li[data-id="${id}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
        const parentList = activeLink.closest('.exercise-list');
        const parentHeader = parentList?.previousElementSibling;
        document.querySelectorAll('.topic-header').forEach(h => { if (h !== parentHeader) { h.classList.remove('active'); h.nextElementSibling?.classList.remove('expanded'); } });
        parentHeader?.classList.add('active');
        parentList?.classList.add('expanded');
    }
    // Her yeni ders yüklendiğinde Konsol sekmesine geç
    switchToTab('console-output');
    testResultOutputElement.innerHTML = '<span class="system">Kodu çalıştırdıktan sonra test sonucu burada görünecek.</span>'; // Test sonucunu temizle
}

/**
 * 5. Pyodide'ı (Python) Başlatan Ana Fonksiyon
 */
async function initializePyodide() {
    try {
        pyodide = await loadPyodide();
        pyodide.setStdout({ batched: (msg) => logToConsole(msg, 'normal') });
        pyodide.setStderr({ batched: (msg) => logToConsole(msg, 'error') });
        logToConsole('Python ortamı başarıyla yüklendi. [secure_runtime] Hazır.', 'system');
        runButton.disabled = false;
        runButton.textContent = '► Kodu Çalıştır';
    } catch (error) {
        logToConsole(`Python ortamı yüklenirken hata oluştu: ${error}`, 'error');
        runButton.textContent = 'Hata'; // Butonda hata belirt
    }
}

/**
 * 6. Python Kodunu Çalıştıran ve Doğrulayan Fonksiyon
 */
async function runPythonCode() {
    if (!pyodide || !editor || !currentExerciseId) {
        logToConsole('Çalışma ortamı henüz hazır değil.', 'system');
        return;
    }

    consoleOutputElement.innerHTML = '';
    testResultOutputElement.innerHTML = ''; // Test sonucunu temizle

    runButton.disabled = true;
    runButton.textContent = 'Çalışıyor...';

    const userCode = editor.getValue();
    const solutionCode = exerciseDatabase[currentExerciseId]?.solution;

    let userOutputLines = [];
    let userError = false;

    // 1. Kullanıcı Kodunu Çalıştır ve Çıktısını KONSOL'a Yönlendir
    pyodide.setStdout({ batched: (msg) => { userOutputLines.push(msg); logToConsole(msg, 'normal'); } });
    pyodide.setStderr({ batched: (msg) => { userOutputLines.push(msg); logToConsole(msg, 'error'); userError = true; } }); // Hata varsa işaretle

    try {
        await pyodide.runPythonAsync(userCode);
    } catch (error) {
        userError = true;
        // Hata zaten stderr tarafından konsola yazdırıldı
        logToTestResult(`Kodunuz çalışırken hata oluştu:\n${error}`, 'failure'); // Hata detayını Test Sonucuna da yaz
    } finally {
        runButton.disabled = false;
        runButton.textContent = '► Kodu Çalıştır';
        // Orijinal G/Ç'yi geri yükle (her zaman)
        pyodide.setStdout({ batched: (msg) => logToConsole(msg, 'normal') });
        pyodide.setStderr({ batched: (msg) => logToConsole(msg, 'error') });
    }

    // 2. Kullanıcı kodu hata verdiyse veya çözüm yoksa, Test Sonucu sekmesine yaz ve bitir
    if (userError || !solutionCode) {
        if (!solutionCode) logToTestResult('Bu alıştırma için otomatik kontrol bulunmuyor.', 'system');
        // Hata mesajı zaten catch bloğunda Test Sonucuna yazıldı.
        switchToTab('test-result-output');
        return;
    }

    // 3. Çözüm Kodunu Gizlice Çalıştır ve Çıktısını Yakala
    let solutionOutputLines = [];
    let solutionError = false;
    // G/Ç'yi SESSİZCE yakala
    pyodide.setStdout({ batched: (msg) => solutionOutputLines.push(msg) });
    pyodide.setStderr({ batched: (msg) => { solutionOutputLines.push(msg); solutionError = true; } });

    try {
        await pyodide.runPythonAsync(solutionCode);
    } catch (e) {
        logToTestResult('Dahili Hata: Çözüm kodu çalıştırılamadı. Lütfen yöneticiye bildirin.', 'system');
        solutionError = true;
    } finally {
        // Orijinal G/Ç'yi geri yükle
        pyodide.setStdout({ batched: (msg) => logToConsole(msg, 'normal') });
        pyodide.setStderr({ batched: (msg) => logToConsole(msg, 'error') });
    }

    // 4. Çözüm kodunda hata varsa karşılaştırma yapma
    if (solutionError) {
        switchToTab('test-result-output');
        return;
    }

    // 5. Çıktıları Karşılaştır ve Test Sonucu Sekmesine Yaz
    const userResult = userOutputLines.join('\n').trim();
    const solutionResult = solutionOutputLines.join('\n').trim();

    if (userResult === solutionResult) { // Boş çıktıyı da doğru kabul edebiliriz (eğer çözüm de boşsa)
        logToTestResult("[✓] Doğru! Tebrikler.", 'success');
        completedExercises.add(currentExerciseId);
        saveProgressToStorage();
        updateCheckmark(currentExerciseId);
    } else {
        logToTestResult("[X] Hatalı. Çıktı beklenenden farklı.", 'failure');
        logToTestResult("\nBeklenen Çıktı:", 'system');
        logToTestResult(solutionResult || "(Beklenen çıktı yoktu)", 'normal');
        logToTestResult("\nSizin Çıktınız:", 'system');
        logToTestResult(userResult || "(Sizin çıktınız yoktu)", 'normal');
    }

    switchToTab('test-result-output');
}


/**
 * 7. Kullanıcıya Çözümü Gösteren Fonksiyon
 */
function showSolution() {
    if (!editor || !currentExerciseId) { logToConsole('Önce bir ders yüklenmeli.', 'system'); return; }
    const solution = exerciseDatabase[currentExerciseId]?.solution;
    if (solution) {
        const userConfirmed = confirm('Mevcut kodunuzun üzerine çözümün yazılmasını istiyor musunuz?\nBu işlem geri alınamaz.');
        if (userConfirmed) { editor.setValue(solution, 1); logToConsole('Çözüm editöre yüklendi.', 'system'); }
    } else { logToConsole('Bu ders için bir çözüm bulunamadı.', 'error'); }
}

/**
 * 8. Kullanıcıya İpucunu Gösteren Fonksiyon
 */
function showHint() {
    if (challengeHintEl.innerHTML && challengeHintEl.innerHTML.trim() !== '' && challengeHintEl.innerHTML !== 'Bu ders için ipucu bulunmuyor.') {
        challengeHintEl.style.display = 'block';
    } else { logToConsole('Bu ders için bir ipucu bulunamadı.', 'system'); }
}

/**
 * 9. Sonraki Alıştırmayı Yükleyen Fonksiyon
 */
function loadNextExercise() {
    if (!currentExerciseId) { logToConsole('Önce bir ders seçmelisiniz.', 'system'); return; }
    const currentIndex = exerciseIdList.indexOf(currentExerciseId);
    if (currentIndex === -1) { logToConsole('Hata: Mevcut ders dizinde bulunamadı.', 'error'); return; }
    if (currentIndex < exerciseIdList.length - 1) {
        const nextId = exerciseIdList[currentIndex + 1];
        loadExercise(nextId);
    } else {
        logToConsole('Tebrikler! Tüm alıştırmaları tamamladınız.', 'system');
        alert('Tebrikler! Bu bölümdeki tüm alıştırmaları tamamladınız.');
    }
}

/**
 * YENİ FONKSİYON: Editördeki Kodu Başlangıç Haline Sıfırlar
 */
function resetCode() {
    if (!editor || !currentExerciseId) {
        logToConsole('Önce bir ders yüklenmeli.', 'system');
        return;
    }

    const defaultCode = exerciseDatabase[currentExerciseId]?.default_code;

    if (defaultCode !== undefined) { // default_code boş string olabilir, o yüzden undefined kontrolü
        const userConfirmed = confirm(
            'Editördeki mevcut kodunuz silinecek ve alıştırmanın başlangıç kodu yüklenecektir.\nEmin misiniz?'
        );

        if (userConfirmed) {
            editor.setValue(defaultCode, 1); // Kodu sıfırla ve imleci sona taşı
            logToConsole('Kod başlangıç haline sıfırlandı.', 'system');
        }
    } else {
        logToConsole('Bu ders için başlangıç kodu bulunamadı.', 'error');
    }
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        if (editor) editor.setTheme("ace/theme/chrome"); // Açık Ace teması
    } else {
        document.body.classList.remove('light-theme');
        if (editor) editor.setTheme("ace/theme/vibrant_ink"); // Koyu Ace teması
    }
    currentTheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
}

function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
}

function loadThemePreference() {
    const preferredTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'dark'; // Varsayılan karanlık
    applyTheme(preferredTheme);
}

/**
 * 10. Sekmeler Arası Geçiş Yapan Fonksiyon
 */
function switchToTab(targetId) {
    document.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
    tabPanes.forEach(pane => pane.classList.remove('active'));
    const targetTab = document.querySelector(`.tab-item[data-target="${targetId}"]`);
    const targetPane = document.getElementById(targetId);
    if (targetTab && targetPane) { targetTab.classList.add('active'); targetPane.classList.add('active'); }
}

/**
 * 11. Olay Dinleyicilerini Ayarlayan Fonksiyon
 */
function setupEventListeners() {
    runButton.addEventListener('click', runPythonCode);
    solutionButton.addEventListener('click', showSolution);
    hintButton.addEventListener('click', showHint);
    nextExerciseButton.addEventListener('click', loadNextExercise);
    resetButton.addEventListener('click', resetProgress);
    resetCodeButton.addEventListener('click', resetCode);
    themeToggleButton.addEventListener('click', toggleTheme);

    // Akordeon menü tıklama mantığı
    lessonNav.addEventListener('click', (event) => {
        const clickedTopic = event.target.closest('.topic-header');
        const clickedItem = event.target.closest('.exercise-item');
        if (clickedItem) { loadExercise(clickedItem.dataset.id); return; }
        if (clickedTopic) {
            const listToToggle = clickedTopic.nextElementSibling;
            const isAlreadyOpen = clickedTopic.classList.contains('active');
            document.querySelectorAll('.topic-header').forEach(h => { h.classList.remove('active'); h.nextElementSibling?.classList.remove('expanded'); });
            if (!isAlreadyOpen) { clickedTopic.classList.add('active'); listToToggle?.classList.add('expanded'); }
        }
    });

    // Sekme tıklama mantığı
    tabHeader.addEventListener('click', (event) => {
        if (event.target.classList.contains('tab-item')) {
            const targetId = event.target.dataset.target;
            switchToTab(targetId);
        }
    });
}

/**
 * 12. Sol Menüdeki Ders Ağacını Oluşturan Fonksiyon
 */
function populateLessonTree(exerciseArray) {
    const topics = new Map();
    for (const ex of exerciseArray) { if (!topics.has(ex.topic_name)) { topics.set(ex.topic_name, []); } topics.get(ex.topic_name).push(ex); }
    lessonTreeContainer.innerHTML = '';
    for (const [topicName, exercises] of topics.entries()) {
        const topicHeader = document.createElement('li'); topicHeader.className = 'topic-header'; topicHeader.textContent = topicName; lessonTreeContainer.appendChild(topicHeader);
        const exerciseList = document.createElement('ul'); exerciseList.className = 'exercise-list';
        for (const ex of exercises) {
            const exerciseItem = document.createElement('li'); exerciseItem.className = 'exercise-item'; exerciseItem.dataset.id = ex.id; exerciseItem.textContent = `${ex.title} (${ex.difficulty})`;
            if (completedExercises.has(ex.id)) { exerciseItem.classList.add('completed'); }
            exerciseList.appendChild(exerciseItem);
        }
        lessonTreeContainer.appendChild(exerciseList);
    }
}

/**
 * İlerleme (Progress) Yönetimi Fonksiyonları
 */
function saveProgressToStorage() { localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(Array.from(completedExercises))); }
function loadProgressFromStorage() { const storedProgress = localStorage.getItem(PROGRESS_STORAGE_KEY); if (storedProgress) { completedExercises = new Set(JSON.parse(storedProgress)); } }
function updateCheckmark(exerciseId) { const item = lessonNav.querySelector(`li[data-id="${exerciseId}"]`); if (item) { item.classList.add('completed'); } }
function resetProgress() {
    const userConfirmed = confirm('Tüm ilerlemenizi sıfırlamak istediğinizden emin misiniz?\nBu işlem geri alınamaz.');
    if (userConfirmed) {
        localStorage.removeItem(PROGRESS_STORAGE_KEY); completedExercises.clear();
        document.querySelectorAll('.exercise-item.completed').forEach(item => { item.classList.remove('completed'); });
        logToConsole('İlerleme başarıyla sıfırlandı.', 'system');
    }
}

/**
 * 13. Veri Tabanını 'fetch' ile yükleyen ve işleyen fonksiyon
 */
async function loadDatabase() {
    try {
        const response = await fetch('database.json');
        if (!response.ok) { throw new Error(`HTTP hatası! Durum: ${response.status}`); }
        const exerciseArray = await response.json();
        exerciseDatabase = exerciseArray.reduce((acc, ex) => { acc[ex.id] = ex; return acc; }, {});
        exerciseIdList = exerciseArray.map(ex => ex.id);
        populateLessonTree(exerciseArray); // Artık ilerlemeyi de dikkate alıyor
        logToConsole('Alıştırma veri tabanı başarıyla yüklendi ve işlendi.', 'system');
        if (exerciseIdList.length > 0) { loadExercise(exerciseIdList[0]); }
    } catch (error) { logToConsole(`Veri tabanı yüklenemedi: ${error}`, 'error'); }
}

/**
 * 14. Ana Başlatma Fonksiyonu
 */
async function main() {
    loadProgressFromStorage(); // İlerlemeyi yükle
    // loadThemePreference(); // YENİ: Temayı editörden ÖNCE yükle (ama editör null olabilir) -> initializeAceEditor'a taşındı
    initializeAceEditor(); // Bu fonksiyon içinde loadThemePreference çağrılıyor
    setupEventListeners();
    await Promise.all([ initializePyodide(), loadDatabase() ]);
    logToConsole('Platform tamamen hazır.', 'system');
}

// Sayfa yüklendiğinde 'main' fonksiyonunu çalıştır
document.addEventListener('DOMContentLoaded', main);