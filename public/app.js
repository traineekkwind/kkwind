/**
 * ==============================================================================
 * EXAMSECURE PRO - MAIN FRONTEND APPLICATION (SPA)
 * ==============================================================================
 * 1. 3-Role Access: Student (เธเธฑเธเน€เธฃเธตเธขเธ), Teacher (เธญเธฒเธเธฒเธฃเธขเน), Admin (เธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธ)
 * 2. Teacher Course Management: เธเธฑเธ”เธเธฒเธฃเธฃเธฒเธขเธงเธดเธเธฒเธเธญเธเธเธฃเธนเนเธ•เนเธฅเธฐเธเธ
 * 3. Classroom Targeting: เธเธณเธซเธเธ”เธฃเธฐเธ”เธฑเธเธเธฑเนเธ (Year), เนเธเธเธเธงเธดเธเธฒ (Dept), เธซเนเธญเธเน€เธฃเธตเธขเธ (Room)
 * 4. Student Auto-Filtering: เธเธฑเธเน€เธฃเธตเธขเธเน€เธซเนเธเน€เธเธเธฒเธฐเธเนเธญเธชเธญเธเธเธญเธเธเธฅเธธเนเธกเธ•เธเน€เธญเธ
 * 5. Excel Import & Export (SheetJS Engine): เธเธณเน€เธเนเธฒเธเนเธญเธชเธญเธ & เธชเนเธเธญเธญเธเธเธฐเนเธเธเธเธณเนเธเธเธซเนเธญเธ
 * 6. Anti-Cheating Engine: Fullscreen, Split-Screen Detect, Tab Switch Telemetry
 * 7. Custom In-App Modal Dialogs: No more native browser popups!
 */

function isValidUUID(str) {
    return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// Global App State
const state = {
    currentAddQuestionImage: null,
    supabaseClient: null,
    currentUser: null, // { role, id, name, year, dept, room }
    currentExam: null,
    questions: [],
    currentView: 'view-auth',
    currentQuestionIndex: 0,
    answers: {}, // { [questionId]: selectedOptionId }
    examTimer: null,
    remainingSeconds: 0,
    antiCheat: {
        tabSwitches: 0,
        fullscreenExits: 0,
        isMonitoring: false
    },
    teacherCurrentTab: 'courses',
    courses: [],
    excelParsedQuestions: [],
    realtimeAlertsEnabled: localStorage.getItem('EXAM_REALTIME_NOTIFICATIONS') !== 'false',
    realtimeAlertsSoundEnabled: localStorage.getItem('EXAM_REALTIME_SOUND') !== 'false',
    realtimeChannel: null,
    globalRealtimeChannel: null,
    liveFeedLogs: []
};

// ==============================================================================
// QUESTION IMAGE & FORMATTING HELPERS
// ==============================================================================
window.openImageZoomModal = function(imgSrc) {
    const modal = document.getElementById('modal-image-zoom');
    const target = document.getElementById('image-zoom-target');
    if (!modal || !target || !imgSrc) return;

    target.src = imgSrc;
    modal.classList.remove('hidden');
};

window.closeImageZoomModal = function() {
    const modal = document.getElementById('modal-image-zoom');
    if (modal) modal.classList.add('hidden');
};

window.parseQuestionTextAndImage = function(rawText, explicitImgUrl) {
    let text = rawText || '';
    let image = explicitImgUrl || null;

    if (!image && text) {
        const match = text.match(/\[img:\s*(data:image\/[^;]+;base64,[^\]]+|https?:\/\/[^\]]+)\]/i);
        if (match) {
            image = match[1];
            text = text.replace(match[0], '').trim();
        }
    }

    return { text, image };
};

window.handleQuestionImageSelect = function(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('เธเธฃเธธเธ“เธฒเน€เธฅเธทเธญเธเนเธเธฅเนเธฃเธนเธเธ เธฒเธเน€เธ—เนเธฒเธเธฑเนเธ (JPG, PNG, WebP)', 'warning');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Compress using canvas to max 1000px
            const maxDimension = 1000;
            let width = img.width;
            let height = img.height;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.82);
            state.currentAddQuestionImage = compressedBase64;

            // Update UI preview
            const previewEl = document.getElementById('q-image-preview');
            const nameEl = document.getElementById('q-image-preview-name');
            const containerEl = document.getElementById('q-image-preview-container');
            const uploadBoxEl = document.getElementById('q-image-upload-box');

            if (previewEl) previewEl.src = compressedBase64;
            if (nameEl) nameEl.textContent = file.name;
            if (containerEl) containerEl.classList.remove('hidden');
            if (uploadBoxEl) uploadBoxEl.classList.add('hidden');

            showToast('เธญเธฑเธเนเธซเธฅเธ”เนเธฅเธฐเธเธตเธเธญเธฑเธ”เธฃเธนเธเธ เธฒเธเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง!', 'success');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.removeTeacherQuestionImage = function() {
    state.currentAddQuestionImage = null;
    const input = document.getElementById('teacher-add-q-image-input');
    const containerEl = document.getElementById('q-image-preview-container');
    const uploadBoxEl = document.getElementById('q-image-upload-box');

    if (input) input.value = '';
    if (containerEl) containerEl.classList.add('hidden');
    if (uploadBoxEl) uploadBoxEl.classList.remove('hidden');
};

window.fillQuickChoices = function(type) {
    const optA = document.getElementById('teacher-add-opt-a');
    const optB = document.getElementById('teacher-add-opt-b');
    const optC = document.getElementById('teacher-add-opt-c');
    const optD = document.getElementById('teacher-add-opt-d');

    if (type === 'ABCD') {
        if (optA) optA.value = 'A';
        if (optB) optB.value = 'B';
        if (optC) optC.value = 'C';
        if (optD) optD.value = 'D';
    } else if (type === 'THAI') {
        if (optA) optA.value = 'เธ';
        if (optB) optB.value = 'เธ';
        if (optC) optC.value = 'เธ';
        if (optD) optD.value = 'เธ';
    } else if (type === 'TF') {
        if (optA) optA.value = 'เธ–เธนเธ (True)';
        if (optB) optB.value = 'เธเธดเธ” (False)';
        if (optC) optC.value = '';
        if (optD) optD.value = '';
    }
};


// ==============================================================================
// 1. SUPABASE INITIALIZATION & CONFIG (ADMIN ONLY)
// ==============================================================================

function cleanSupabaseUrl(rawUrl) {
    if (!rawUrl) return '';
    let url = String(rawUrl).trim();
    // เธ–เนเธฒเธเธนเนเนเธเนเธงเธฒเธ URL เธซเธเนเธฒ Dashboard เน€เธเนเธ https://supabase.com/dashboard/project/ividsfcwvhngsojtzwjt...
    const dashboardMatch = url.match(/dashboard\/project\/([a-zA-Z0-9_-]+)/);
    if (dashboardMatch && dashboardMatch[1]) {
        return `https://${dashboardMatch[1]}.supabase.co`;
    }
    // เธ–เนเธฒเธเธนเนเนเธเนเธกเธต path เธ•เนเธญเธ—เนเธฒเธข เน€เธเนเธ https://ividsfcwvhngsojtzwjt.supabase.co/settings/api-keys
    const coMatch = url.match(/(https?:\/\/[a-zA-Z0-9_-]+\.supabase\.co)/);
    if (coMatch && coMatch[1]) {
        return coMatch[1];
    }
    // เธ•เธฑเธ” trailing slash
    return url.replace(/\/+$/, '');
}

function getSupabaseCredentials() {
    const savedUrl = localStorage.getItem('EXAM_SUPABASE_URL');
    const savedKey = localStorage.getItem('EXAM_SUPABASE_ANON_KEY');

    return {
        url: cleanSupabaseUrl(savedUrl) || window.SUPABASE_URL || 'https://ividsfcwvhngsojtzwjt.supabase.co',
        key: (savedKey ? savedKey.trim() : '') || window.SUPABASE_ANON_KEY || 'sb_publishable_7uhXNfvOOImPUONxRwId4w_4uONoAnO'
    };
}

function initSupabase() {
    const creds = getSupabaseCredentials();
    try {
        if (window.supabase && typeof window.supabase.createClient === 'function') {
            const cleanUrl = cleanSupabaseUrl(creds.url);
            state.supabaseClient = window.supabase.createClient(cleanUrl, creds.key);
            console.log('[Supabase] Initialized with:', cleanUrl);
            initGlobalRealtimeSync();
            fetchCloudDataToLocal();
            syncLocalDataToSupabase();
        } else {
            console.warn('[Supabase] SDK not loaded yet.');
        }
    } catch (e) {
        console.error('[Supabase] Init Error:', e);
    }
}

async function fetchCloudDataToLocal() {
    if (!isSupabaseConfigured() || !state.supabaseClient) return;
    try {
        // 1. เธ”เธถเธเธเนเธญเธกเธนเธฅเธฃเธฒเธขเธเธทเนเธญเธญเธฒเธเธฒเธฃเธขเนเธเธฒเธเธเธฅเธฒเธงเธ”เนเธฅเธเธกเธทเธญเธ–เธทเธญ/เธ—เธธเธเธญเธธเธเธเธฃเธ“เน
        const { data: dbTeachers, error: tErr } = await state.supabaseClient
            .from('teachers')
            .select('*');
        if (!tErr && Array.isArray(dbTeachers) && dbTeachers.length > 0) {
            localStorage.setItem('EXAM_LOCAL_TEACHERS', JSON.stringify(dbTeachers));
        }

        // 2. เธ”เธถเธเธฃเธฒเธขเธงเธดเธเธฒ
        const { data: dbCourses, error: cErr } = await state.supabaseClient
            .from('courses')
            .select('*');
        if (!cErr && Array.isArray(dbCourses) && dbCourses.length > 0) {
            localStorage.setItem('EXAM_LOCAL_COURSES', JSON.stringify(dbCourses));
            state.courses = dbCourses;
        }

        // 3. เธ”เธถเธเธเธธเธ”เธเนเธญเธชเธญเธ
        const { data: dbExams, error: eErr } = await state.supabaseClient
            .from('exams')
            .select('*');
        if (!eErr && Array.isArray(dbExams) && dbExams.length > 0) {
            localStorage.setItem('EXAM_LOCAL_EXAMS', JSON.stringify(dbExams));
            state.localExams = dbExams;
        }
    } catch (e) {
        console.warn('[Supabase Cloud Fetch Notice]', e);
    }
}

async function syncLocalDataToSupabase() {
    if (!isSupabaseConfigured() || !state.supabaseClient) return;
    try {
        // 0. Sync teachers from local to Supabase
        const localTeachers = getLocalTeachers();
        if (localTeachers.length > 0) {
            for (const t of localTeachers) {
                await state.supabaseClient.from('teachers').upsert({
                    id: t.id,
                    teacher_code: t.teacher_code || t.code,
                    name: t.name,
                    department: t.department || t.dept || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ',
                    password: t.password || 'teacher1234'
                }, { onConflict: 'id' });
            }
        }

        // 1. Sync courses from local to Supabase
        const localCourses = getLocalCourses();
        if (localCourses.length > 0) {
            for (const c of localCourses) {
                await state.supabaseClient.from('courses').upsert({
                    id: c.id,
                    course_code: c.course_code,
                    course_name: c.course_name,
                    description: c.description || '',
                    target_year: c.target_year || 'เธ—เธฑเนเธเธซเธกเธ”',
                    target_department: c.target_department || 'เธ—เธฑเนเธเธซเธกเธ”',
                    teacher_id: c.teacher_id || '11111111-0000-0000-0000-000000000001',
                    teacher_name: c.teacher_name || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ'
                }, { onConflict: 'id' });
            }
        }

        // 2. Sync exams from local to Supabase
        const localExams = getLocalExams();
        if (localExams.length > 0) {
            for (const e of localExams) {
                await state.supabaseClient.from('exams').upsert({
                    id: e.id,
                    course_id: e.course_id || null,
                    teacher_name: e.teacher_name || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ',
                    title: e.title,
                    description: e.description || '',
                    duration_minutes: Number(e.duration_minutes) || 60,
                    is_active: e.is_active !== false,
                    max_tab_switches_allowed: Number(e.max_tab_switches_allowed) || 3,
                    target_year: e.target_year || 'เธ—เธฑเนเธเธซเธกเธ”',
                    target_department: e.target_department || 'เธ—เธฑเนเธเธซเธกเธ”',
                    target_room: e.target_room || 'เธ—เธฑเนเธเธซเธกเธ”'
                }, { onConflict: 'id' });
            }
        }

        // 3. Sync questions from local to Supabase
        const localQuestions = getLocalQuestions();
        if (localQuestions.length > 0) {
            for (const q of localQuestions) {
                await state.supabaseClient.from('questions').upsert({
                    id: q.id,
                    exam_id: q.exam_id,
                    question_text: q.question_text,
                    options: q.options,
                    points: Number(q.points) || 1.0,
                    order_seq: q.order_seq || 0
                }, { onConflict: 'id' });
            }
        }
        console.log('[Supabase Sync] Local data synchronized to cloud successfully');
    } catch (err) {
        console.warn('[Supabase Sync Notice]', err);
    }
}

// ==============================================================================
// 1.2 HYBRID DATA STORE (LOCALSTORAGE + SUPABASE OFFLINE-FIRST)
// ==============================================================================

function isSupabaseConfigured() {
    const creds = getSupabaseCredentials();
    return creds.url && !creds.url.includes('your-project-id.supabase.co') && creds.key && !creds.key.includes('.dummy');
}

function getLocalCourses() {
    try {
        const raw = localStorage.getItem('EXAM_LOCAL_COURSES');
        if (raw) {
            const list = JSON.parse(raw);
            // Clean dummy records
            return list.filter(c => c.id !== '33333333-3333-3333-3333-333333333331');
        }
    } catch (e) {}
    return [];
}

function saveLocalCourse(course) {
    const list = getLocalCourses();
    const idx = list.findIndex(c => c.id === course.id);
    if (idx >= 0) {
        list[idx] = course;
    } else {
        list.unshift(course);
    }
    localStorage.setItem('EXAM_LOCAL_COURSES', JSON.stringify(list));
    state.courses = list;
    broadcastAppEvent('course_updated', course);
}

function deleteLocalCourse(courseId) {
    const list = getLocalCourses().filter(c => c.id !== courseId);
    localStorage.setItem('EXAM_LOCAL_COURSES', JSON.stringify(list));
    state.courses = list;
    broadcastAppEvent('course_deleted', { courseId });
}

function getLocalExams() {
    try {
        const raw = localStorage.getItem('EXAM_LOCAL_EXAMS');
        if (raw) {
            const list = JSON.parse(raw);
            // Clean dummy records
            return list.filter(e => e.id !== '11111111-1111-1111-1111-111111111111');
        }
    } catch (e) {}
    return [];
}

function saveLocalExam(exam) {
    const list = getLocalExams();
    const idx = list.findIndex(e => e.id === exam.id);
    if (idx >= 0) {
        list[idx] = exam;
    } else {
        list.unshift(exam);
    }
    localStorage.setItem('EXAM_LOCAL_EXAMS', JSON.stringify(list));
    state.localExams = list;
    broadcastAppEvent('exam_updated', exam);
}

function deleteLocalExam(examId) {
    const list = getLocalExams().filter(e => e.id !== examId);
    localStorage.setItem('EXAM_LOCAL_EXAMS', JSON.stringify(list));
    state.localExams = list;
    broadcastAppEvent('exam_deleted', { examId });
}

function getLocalQuestions(examId) {
    try {
        const raw = localStorage.getItem('EXAM_LOCAL_QUESTIONS');
        if (raw) {
            const all = JSON.parse(raw).filter(q => !q.id?.startsWith('22222222-'));
            if (examId) return all.filter(q => q.exam_id === examId);
            return all;
        }
    } catch (e) {}
    return [];
}

function saveLocalQuestion(qObj) {
    const list = getLocalQuestions();
    list.unshift(qObj);
    localStorage.setItem('EXAM_LOCAL_QUESTIONS', JSON.stringify(list));
    broadcastAppEvent('question_updated', qObj);
}

function getLocalSubmissions() {
    try {
        const raw = localStorage.getItem('EXAM_LOCAL_SUBMISSIONS');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

function saveLocalSubmission(sub) {
    const list = getLocalSubmissions();
    list.unshift(sub);
    localStorage.setItem('EXAM_LOCAL_SUBMISSIONS', JSON.stringify(list));
    broadcastAppEvent('student_submission', sub);
}

function getLocalStudents() {
    try {
        const raw = localStorage.getItem('EXAM_LOCAL_STUDENTS');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

function saveLocalStudent(student) {
    const list = getLocalStudents();
    const idx = list.findIndex(s => s.id === student.id || (s.code && s.code === student.code));
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...student, updated_at: new Date().toISOString() };
    } else {
        student.id = student.id || generatePseudoUUID();
        student.created_at = student.created_at || new Date().toISOString();
        list.unshift(student);
    }
    localStorage.setItem('EXAM_LOCAL_STUDENTS', JSON.stringify(list));
    broadcastAppEvent('student_roster_updated', student);
}

function deleteLocalStudent(studentId) {
    const list = getLocalStudents().filter(s => s.id !== studentId);
    localStorage.setItem('EXAM_LOCAL_STUDENTS', JSON.stringify(list));
    broadcastAppEvent('student_roster_updated', { studentId });
}

function getLocalTeachers() {
    try {
        const raw = localStorage.getItem('EXAM_LOCAL_TEACHERS');
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

function saveLocalTeacher(teacher) {
    const list = getLocalTeachers();
    const idx = list.findIndex(t => t.id === teacher.id || (t.teacher_code && t.teacher_code === teacher.teacher_code));
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...teacher, updated_at: new Date().toISOString() };
    } else {
        teacher.id = teacher.id || generatePseudoUUID();
        teacher.created_at = teacher.created_at || new Date().toISOString();
        list.unshift(teacher);
    }
    localStorage.setItem('EXAM_LOCAL_TEACHERS', JSON.stringify(list));
    broadcastAppEvent('teacher_roster_updated', teacher);
}

function deleteLocalTeacher(teacherId) {
    const list = getLocalTeachers().filter(t => t.id !== teacherId);
    localStorage.setItem('EXAM_LOCAL_TEACHERS', JSON.stringify(list));
    broadcastAppEvent('teacher_roster_updated', { teacherId });
}

// ==============================================================================
// 1.3 REAL-TIME MULTI-CHANNEL AUTO-SYNC ENGINE (NO REFRESH NEEDED)
// ==============================================================================

const _processedAppEventIds = new Set();

function broadcastAppEvent(eventType, payload = {}) {
    const eventId = `evt_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const message = {
        eventId: eventId,
        type: eventType,
        payload: payload,
        timestamp: Date.now(),
        senderId: state.currentUser?.id || 'sys'
    };

    console.log('[Broadcasting Realtime Event]:', eventType, message);

    // 1. HTML5 BroadcastChannel (Zero-latency instant cross-tab sync)
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            if (!state.globalBroadcastChannel) {
                state.globalBroadcastChannel = new BroadcastChannel('exam_global_realtime_sync');
                state.globalBroadcastChannel.onmessage = (event) => {
                    handleIncomingAppSync(event.data);
                };
            }
            state.globalBroadcastChannel.postMessage(message);
        }
    } catch (e) {
        console.warn('[BroadcastChannel send warning]', e);
    }

    // 2. LocalStorage Storage Event (Cross-window backup with unique trigger)
    try {
        localStorage.setItem('EXAM_REALTIME_SYNC_SIGNAL', JSON.stringify({
            ...message,
            _uid: Date.now() + '_' + Math.random()
        }));
    } catch (e) {}

    // 3. Supabase Realtime WebSocket (Network-wide cross-device sync)
    if (state.globalRealtimeChannel) {
        try {
            state.globalRealtimeChannel.send({
                type: 'broadcast',
                event: 'app_event',
                payload: message
            }).catch(() => {});
        } catch (e) {}
    }
}

function handleIncomingAppSync(message) {
    if (!message || !message.type) return;

    // Deduplication by Event ID
    if (message.eventId) {
        if (_processedAppEventIds.has(message.eventId)) {
            return; // Already processed by another channel
        }
        _processedAppEventIds.add(message.eventId);
        setTimeout(() => _processedAppEventIds.delete(message.eventId), 5000);
    }

    const { type, payload } = message;
    console.log('[Realtime Auto-Sync Received & Dispatched]:', type, payload);

    // 1. Exam / Course / Question Data Updated (Created, Modified, Deleted)
    if (type === 'exam_updated' || type === 'exam_deleted' || type === 'course_updated' || type === 'course_deleted' || type === 'question_updated') {
        // A. Student Lobby: Auto-refresh available exams without reload (Protected: Only in lobby, never during active exam!)
        const isStudentLobby = state.currentView === 'view-student-lobby' || (document.getElementById('view-student-lobby') && !document.getElementById('view-student-lobby').classList.contains('hidden'));
        if (isStudentLobby) {
            console.log('[Realtime] Auto-updating Student Lobby cards...');
            loadStudentLobby();
            if (type === 'exam_updated') {
                showToast(`๐”” เธกเธตเธเธธเธ”เธเนเธญเธชเธญเธเนเธซเธกเนเน€เธเธดเธ”เนเธซเนเน€เธเนเธฒเธชเธญเธ: "${payload.title || 'เธเธธเธ”เธเนเธญเธชเธญเธ'}"`, 'info');
            }
        }

        // B. Teacher Portal: Auto-refresh courses, exams, and selects if teacher is active
        const isTeacherView = state.currentView === 'view-teacher' || (document.getElementById('view-teacher') && !document.getElementById('view-teacher').classList.contains('hidden'));
        if (isTeacherView) {
            console.log('[Realtime] Auto-updating Teacher Dashboard...');
            loadTeacherCourses();
            loadTeacherExamsList();
            populateTeacherExamSelects();
        }
    }

    // 2. Student Submission Event
        // 1.1 Student Retake Unlocked Event (เธญเธฒเธเธฒเธฃเธขเนเธเธฅเธ”เธฅเนเธญเธเนเธซเนเธชเธญเธเนเธซเธกเน)
    if (type === 'student_retake_unlocked') {
        const isStudentLobby = state.currentView === 'view-student-lobby' || (document.getElementById('view-student-lobby') && !document.getElementById('view-student-lobby').classList.contains('hidden'));
        if (isStudentLobby && state.currentUser?.role === 'student') {
            const currentStudentId = state.currentUser.id;
            const currentStudentCode = state.currentUser.student_code || state.currentUser.code;
            if (!payload || payload.studentId === currentStudentId || payload.studentId === currentStudentCode) {
                loadStudentLobby();
                showToast('เธญเธฒเธเธฒเธฃเธขเนเนเธ”เนเธเธฅเธ”เธฅเนเธญเธเนเธซเนเธเธธเธ“เน€เธเนเธฒเธ—เธณเธเนเธญเธชเธญเธเนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธเนเธฅเนเธง!', 'success');
            }
        }
    }

    if (type === 'student_submission') {
        const isTeacherView = state.currentView === 'view-teacher' || (document.getElementById('view-teacher') && !document.getElementById('view-teacher').classList.contains('hidden'));
        if (isTeacherView) {
            console.log('[Realtime] Student submitted exam, auto-updating submissions table...');
            loadTeacherSubmissions();
            const studentName = payload.student_name || 'เธเธฑเธเน€เธฃเธตเธขเธ';
            const examTitle = payload.exam_title || 'เธเธธเธ”เธเนเธญเธชเธญเธ';
            const scoreText = `${payload.total_score}/${payload.max_score} (${payload.percentage}%)`;
            showToast(`๐“ ${studentName} เธชเนเธเธเนเธญเธชเธญเธ "${examTitle}" เนเธฅเนเธง [${scoreText}]`, 'success');
        }
    }

    // 3. Student Roster Updated Event
    if (type === 'student_roster_updated') {
        const isTeacherView = state.currentView === 'view-teacher' || (document.getElementById('view-teacher') && !document.getElementById('view-teacher').classList.contains('hidden'));
        if (isTeacherView) {
            console.log('[Realtime] Student roster updated, refreshing table...');
            loadTeacherStudentsList();
        }
    }

    // 4. Anti-Cheating Event
    if (type === 'student_cheat_event') {
        handleIncomingCheatingAlert(payload);
    }
}

function initGlobalRealtimeSync() {
    // 1. BroadcastChannel Listener
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            if (!state.globalBroadcastChannel) {
                state.globalBroadcastChannel = new BroadcastChannel('exam_global_realtime_sync');
            }
            state.globalBroadcastChannel.onmessage = (event) => {
                handleIncomingAppSync(event.data);
            };
        }
    } catch (e) {
        console.warn('[BroadcastChannel init warning]', e);
    }

    // 2. LocalStorage Storage Event Listener
    if (!window._globalSyncStorageListenerAttached) {
        window.addEventListener('storage', (e) => {
            if (e.key === 'EXAM_REALTIME_SYNC_SIGNAL' && e.newValue) {
                try {
                    const data = JSON.parse(e.newValue);
                    handleIncomingAppSync(data);
                } catch (err) {}
            }
        });
        window._globalSyncStorageListenerAttached = true;
    }

    // 3. Supabase Realtime WebSocket Listener
    if (state.supabaseClient && isSupabaseConfigured()) {
        try {
            if (state.globalRealtimeChannel) {
                state.supabaseClient.removeChannel(state.globalRealtimeChannel);
            }
            state.globalRealtimeChannel = state.supabaseClient
                .channel('exam_global_realtime_sync')
                .on('broadcast', { event: 'app_event' }, (payload) => {
                    handleIncomingAppSync(payload.payload || payload);
                })
                .subscribe((status) => {
                    console.log('[Global Realtime Channel Subscribed]:', status);
                });
        } catch (e) {}
    }

    // 4. Window Focus Auto-Sync (When user returns to tab, seamlessly check for latest data)
    if (!window._windowFocusSyncAttached) {
        window.addEventListener('focus', () => {
            if (state.currentView === 'view-student-lobby' && state.currentUser?.role === 'student') {
                loadStudentLobby();
            } else if (state.currentView === 'view-teacher') {
                loadTeacherCourses();
                loadTeacherExamsList();
                loadTeacherSubmissions();
            }
        });
        window._windowFocusSyncAttached = true;
    }
}

// ==============================================================================
// 2. VIEW NAVIGATION & USER BAR
// ==============================================================================

function showView(viewId) {
    state.currentView = viewId;

    const views = [
        'view-auth',
        'view-student-lobby',
        'view-student-exam',
        'view-student-result',
        'view-teacher',
        'view-admin'
    ];

    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === viewId) {
                el.classList.remove('hidden');
                el.classList.add('animate-fade-in');
            } else {
                el.classList.add('hidden');
                el.classList.remove('animate-fade-in');
            }
        }
    });

    updateUserInfoBar();
}

function updateUserInfoBar() {
    const bar = document.getElementById('user-info-bar');
    const nameEl = document.getElementById('current-user-name');
    const roleBadge = document.getElementById('current-user-role-badge');

    if (!bar) return;

    if (state.currentUser) {
        bar.classList.remove('hidden');
        if (nameEl) nameEl.textContent = state.currentUser.name;
        if (roleBadge) {
            if (state.currentUser.role === 'admin') {
                roleBadge.textContent = 'โ๏ธ เนเธญเธ”เธกเธดเธ';
                roleBadge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 border border-purple-300';
            } else if (state.currentUser.role === 'teacher') {
                roleBadge.textContent = `๐‘จโ€๐ซ ${state.currentUser.name}`;
                roleBadge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300';
            } else {
                roleBadge.textContent = `๐‘จโ€๐“ ${state.currentUser.year} ${state.currentUser.room}`;
                roleBadge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 border border-blue-300';
            }
        }
    } else {
        bar.classList.add('hidden');
    }
}

window.goToHome = function() {
    if (!state.currentUser) {
        showView('view-auth');
    } else if (state.currentUser.role === 'student') {
        if (!state.antiCheat.isMonitoring) loadStudentLobby();
    } else if (state.currentUser.role === 'teacher') {
        loadTeacherDashboard();
    } else if (state.currentUser.role === 'admin') {
        loadAdminDashboard();
    }
};

// ==============================================================================
// 3. AUTHENTICATION & LOGIN (3 ROLES)
// ==============================================================================

window.setLoginRoleTab = function(role) {
    const tabStudent = document.getElementById('tab-login-student');
    const tabTeacher = document.getElementById('tab-login-teacher');
    const tabAdmin = document.getElementById('tab-login-admin');

    const formStudent = document.getElementById('form-login-student');
    const formTeacher = document.getElementById('form-login-teacher');
    const formAdmin = document.getElementById('form-login-admin');

    [tabStudent, tabTeacher, tabAdmin].forEach(tab => {
        if (tab) {
            tab.classList.remove('border-indigo-600', 'border-emerald-600', 'border-purple-600', 'text-indigo-600', 'text-emerald-600', 'text-purple-600');
            tab.classList.add('border-transparent', 'text-slate-400');
        }
    });

    if (formStudent) formStudent.classList.add('hidden');
    if (formTeacher) formTeacher.classList.add('hidden');
    if (formAdmin) formAdmin.classList.add('hidden');

    if (role === 'student') {
        if (tabStudent) {
            tabStudent.classList.add('border-indigo-600', 'text-indigo-600');
            tabStudent.classList.remove('border-transparent', 'text-slate-400');
        }
        if (formStudent) formStudent.classList.remove('hidden');
    } else if (role === 'teacher') {
        if (tabTeacher) {
            tabTeacher.classList.add('border-emerald-600', 'text-emerald-600');
            tabTeacher.classList.remove('border-transparent', 'text-slate-400');
        }
        if (formTeacher) formTeacher.classList.remove('hidden');
    } else if (role === 'admin') {
        if (tabAdmin) {
            tabAdmin.classList.add('border-purple-600', 'text-purple-600');
            tabAdmin.classList.remove('border-transparent', 'text-slate-400');
        }
        if (formAdmin) formAdmin.classList.remove('hidden');
    }
};

function setupAuthEvents() {
    const tabStudent = document.getElementById('tab-login-student');
    const tabTeacher = document.getElementById('tab-login-teacher');
    const tabAdmin = document.getElementById('tab-login-admin');

    const formStudent = document.getElementById('form-login-student');
    const formTeacher = document.getElementById('form-login-teacher');
    const formAdmin = document.getElementById('form-login-admin');

    if (tabStudent) tabStudent.onclick = () => window.setLoginRoleTab('student');
    if (tabTeacher) tabTeacher.onclick = () => window.setLoginRoleTab('teacher');
    if (tabAdmin) tabAdmin.onclick = () => window.setLoginRoleTab('admin');

    window.toggleStudentPasswordVisibility = function() {
        const input = document.getElementById('student-login-pass-input');
        const icon = document.getElementById('student-pass-eye-icon');
        if (!input || !icon) return;
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'fas fa-eye-slash text-xs text-indigo-600';
        } else {
            input.type = 'password';
            icon.className = 'fas fa-eye text-xs';
        }
    };

    // 3.1 เธเธญเธฃเนเธกเธเธฑเธเน€เธฃเธตเธขเธ (เธฅเนเธญเธเธญเธดเธเธ”เนเธงเธข เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ/เธเธทเนเธญ เนเธฅเธฐ เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ 13 เธซเธฅเธฑเธ)
    if (formStudent) {
        formStudent.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginId = document.getElementById('student-login-id-input')?.value.trim();
            const citizenPass = document.getElementById('student-login-pass-input')?.value.trim();

            if (!loginId) {
                showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ เธซเธฃเธทเธญ เธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ', 'warning');
                return;
            }

            if (!citizenPass || citizenPass.length !== 13) {
                showCustomAlert({
                    title: 'เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                    message: 'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธณเธ•เธฑเธงเธเธฃเธฐเธเธฒเธเธเนเธซเนเธเธฃเธ 13 เธซเธฅเธฑเธ\n(เนเธเนเน€เธเนเธเธฃเธซเธฑเธชเธเนเธฒเธเน€เธเนเธฒเธชเธญเธ)',
                    icon: 'fas fa-id-card'
                });
                return;
            }

            let registeredStudents = getLocalStudents();

            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    const { data, error } = await state.supabaseClient.from('students').select('*');
                    if (!error && Array.isArray(data) && data.length > 0) {
                        registeredStudents = data;
                        localStorage.setItem('EXAM_LOCAL_STUDENTS', JSON.stringify(data));
                    }
                } catch (e) {}
            }

            let matchedStudent = null;

            if (registeredStudents && registeredStudents.length > 0) {
                matchedStudent = registeredStudents.find(s => 
                    (s.code === loginId || s.name.trim().toLowerCase() === loginId.toLowerCase() || s.citizen_id === loginId) && 
                    s.citizen_id === citizenPass
                );

                if (!matchedStudent) {
                    const studentById = registeredStudents.find(s => s.code === loginId || s.name.trim().toLowerCase() === loginId.toLowerCase());
                    if (studentById) {
                        showCustomAlert({
                            title: 'เธฃเธซเธฑเธชเธเนเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                            message: `เธเธเธฃเธฒเธขเธเธทเนเธญ "${studentById.name}" เนเธเธฃเธฐเธเธ\nเนเธ•เนเน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธณเธ•เธฑเธงเธเธฃเธฐเธเธฒเธเธ 13 เธซเธฅเธฑเธ (เธฃเธซเธฑเธชเธเนเธฒเธ) เนเธกเนเธ–เธนเธเธ•เนเธญเธ เธเธฃเธธเธ“เธฒเธฅเธญเธเนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธ`,
                            icon: 'fas fa-lock'
                        });
                        return;
                    }

                    showCustomAlert({
                        title: 'เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธฑเธเน€เธฃเธตเธขเธเนเธเธฃเธฐเธเธ',
                        message: `เนเธกเนเธเธเธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธเธซเธฃเธทเธญเธเธทเนเธญ "${loginId}" เธ—เธตเนเธญเธฒเธเธฒเธฃเธขเนเนเธ”เนเธฅเธเธ—เธฐเน€เธเธตเธขเธเนเธงเน\nเธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธชเธญเธเธซเธฃเธทเธญเธ•เธดเธ”เธ•เนเธญเธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธเน€เธเธทเนเธญเน€เธเธดเนเธกเธฃเธฒเธขเธเธทเนเธญเธเนเธญเธเน€เธเนเธฒเธชเธญเธ`,
                        icon: 'fas fa-user-xmark'
                    });
                    return;
                }
            } else {
                matchedStudent = {
                    id: generatePseudoUUID(),
                    code: loginId,
                    name: loginId,
                    citizen_id: citizenPass,
                    year: 'เธเธงเธ.2',
                    dept: 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ',
                    room: 'เธซเนเธญเธ 1'
                };
                saveLocalStudent(matchedStudent);
            }

            state.currentUser = {
                role: 'student',
                id: matchedStudent.id || generatePseudoUUID(),
                student_code: matchedStudent.code,
                name: matchedStudent.name,
                citizen_id: matchedStudent.citizen_id,
                year: matchedStudent.year || 'เธเธงเธ.2',
                dept: matchedStudent.dept || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ',
                room: matchedStudent.room || 'เธซเนเธญเธ 1'
            };
            try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}

            const badge = document.getElementById('student-class-badge');
            if (badge) badge.textContent = `${state.currentUser.year} | ${state.currentUser.dept} | ${state.currentUser.room}`;

            showToast(`เธขเธดเธเธ”เธตเธ•เนเธญเธเธฃเธฑเธเธเธธเธ“ ${state.currentUser.name} (${state.currentUser.year} ${state.currentUser.room})`, 'success');
            loadStudentLobby();
        });
    }

    // 3.2 เธเธญเธฃเนเธกเธญเธฒเธเธฒเธฃเธขเน (เธฃเธฐเธเธธเธเธทเนเธญเธญเธฒเธเธฒเธฃเธขเน/เธฃเธซเธฑเธชเธญเธฒเธเธฒเธฃเธขเน เนเธฅเธฐ เธฃเธซเธฑเธชเธเนเธฒเธเธเธฃเธฐเธเธณเธ•เธฑเธง)
    if (formTeacher) {
        formTeacher.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginInput = document.getElementById('teacher-name-input').value.trim();
            const password = document.getElementById('teacher-password-input').value.trim();

            if (!loginInput || !password) {
                showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ เธซเธฃเธทเธญ เธฃเธซเธฑเธชเธญเธฒเธเธฒเธฃเธขเน เนเธฅเธฐ เธฃเธซเธฑเธชเธเนเธฒเธ', 'warning');
                return;
            }

            let registeredTeachers = getLocalTeachers();

            // เธ”เธถเธเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเนเธฅเนเธฒเธชเธธเธ”เธเธฒเธ Supabase Cloud (เธชเธณเธซเธฃเธฑเธเธกเธทเธญเธ–เธทเธญเธซเธฃเธทเธญเน€เธเธฃเธทเนเธญเธเธญเธทเนเธเธ—เธตเนเน€เธเธดเนเธเน€เธเธดเธ”เน€เธงเนเธ)
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    const { data: dbTeachers, error: fetchErr } = await state.supabaseClient
                        .from('teachers')
                        .select('*');
                    if (!fetchErr && Array.isArray(dbTeachers) && dbTeachers.length > 0) {
                        registeredTeachers = dbTeachers;
                        localStorage.setItem('EXAM_LOCAL_TEACHERS', JSON.stringify(registeredTeachers));
                    }
                } catch (err) {
                    console.warn('[Teacher Login] Supabase check notice:', err);
                }
            }

            if (registeredTeachers && registeredTeachers.length > 0) {
                const cleanLogin = loginInput.toLowerCase();
                const matchedTeacher = registeredTeachers.find(t => 
                    (t.name.trim().toLowerCase() === cleanLogin || 
                     (t.teacher_code && t.teacher_code.trim().toLowerCase() === cleanLogin) ||
                     (t.code && String(t.code).trim().toLowerCase() === cleanLogin)) &&
                    String(t.password).trim() === password
                );

                if (matchedTeacher) {
                    state.currentUser = {
                        role: 'teacher',
                        id: matchedTeacher.id,
                        name: matchedTeacher.name,
                        code: matchedTeacher.teacher_code || matchedTeacher.code,
                        dept: matchedTeacher.department || matchedTeacher.dept || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ'
                    };
                    try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}

                    const portalNameEl = document.getElementById('teacher-portal-name');
                    if (portalNameEl) portalNameEl.textContent = `${matchedTeacher.name} (${matchedTeacher.department || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ'})`;

                    showToast(`เธขเธดเธเธ”เธตเธ•เนเธญเธเธฃเธฑเธ ${matchedTeacher.name}`, 'success');
                    loadTeacherDashboard();
                    return;
                }

                // เน€เธเนเธเธงเนเธฒเธเธทเนเธญเธญเธฒเธเธฒเธฃเธขเนเธกเธตเนเธเธฃเธฐเธเธเนเธ•เนเธฃเธซเธฑเธชเธเนเธฒเธเธเธดเธ”เธซเธฃเธทเธญเนเธกเน
                const teacherExists = registeredTeachers.find(t => 
                    t.name.trim().toLowerCase() === cleanLogin || 
                    (t.teacher_code && t.teacher_code.trim().toLowerCase() === cleanLogin) ||
                    (t.code && String(t.code).trim().toLowerCase() === cleanLogin)
                );

                if (teacherExists) {
                    showCustomAlert({
                        title: 'เธฃเธซเธฑเธชเธเนเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                        message: `เธเธเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเน "${teacherExists.name}" เนเธเธฃเธฐเธเธ\nเนเธ•เนเธฃเธซเธฑเธชเธเนเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ เธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธชเธญเธเนเธฅเธฐเธฅเธญเธเนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธ`,
                        icon: 'fas fa-lock'
                    });
                    return;
                }

                showCustomAlert({
                    title: 'เนเธกเนเธเธเธเธฑเธเธเธตเธญเธฒเธเธฒเธฃเธขเนเนเธเธฃเธฐเธเธ',
                    message: `เนเธกเนเธเธเธเธทเนเธญเธซเธฃเธทเธญเธฃเธซเธฑเธชเธญเธฒเธเธฒเธฃเธขเน "${loginInput}" เนเธเธฃเธฐเธเธ\nเธเธฃเธธเธ“เธฒเธ•เธดเธ”เธ•เนเธญเธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธ (Admin) เน€เธเธทเนเธญเน€เธเธดเนเธกเธฃเธฒเธขเธเธทเนเธญเธญเธฒเธเธฒเธฃเธขเนเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ`,
                    icon: 'fas fa-user-xmark'
                });
                return;
            } else {
                // เธเธฃเธ“เธตเธฃเธฐเธเธเธขเธฑเธเนเธกเนเธกเธตเธเธฒเธฃเธฅเธเธ—เธฐเน€เธเธตเธขเธเธญเธฒเธเธฒเธฃเธขเนเน€เธฅเธข เนเธซเนเนเธเนเธเนเธฒเน€เธฃเธดเนเธกเธ•เนเธ
                if (password === 'teacher1234' || password === 'teacher' || password === 'admin1234') {
                    const teacherId = generateTeacherUUID(loginInput);

                    state.currentUser = {
                        role: 'teacher',
                        id: teacherId,
                        name: loginInput,
                        code: 'T001',
                        dept: 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ'
                    };
                    try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}

                    const portalNameEl = document.getElementById('teacher-portal-name');
                    if (portalNameEl) portalNameEl.textContent = loginInput;

                    showToast(`เธขเธดเธเธ”เธตเธ•เนเธญเธเธฃเธฑเธ ${loginInput}`, 'success');
                    loadTeacherDashboard();
                } else {
                    showCustomAlert({
                        title: 'เธฃเธซเธฑเธชเธเนเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                        message: 'เธฃเธซเธฑเธชเธเนเธฒเธเธชเธณเธซเธฃเธฑเธเธญเธฒเธเธฒเธฃเธขเนเนเธกเนเธ–เธนเธเธ•เนเธญเธ เธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธชเธญเธเนเธฅเธฐเธฅเธญเธเนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธ',
                        icon: 'fas fa-lock'
                    });
                }
            }
        });
    }

    // 3.3 เธเธญเธฃเนเธกเนเธญเธ”เธกเธดเธ
    if (formAdmin) {
        formAdmin.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = document.getElementById('admin-password-input').value;

            if (password === 'admin9999' || password === 'admin1234' || password === 'admin') {
                state.currentUser = {
                    role: 'admin',
                    id: '00000000-0000-0000-0000-000000000001',
                    name: 'เธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธเธชเธนเธเธชเธธเธ” (Admin)'
                };
                try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}
                showToast('เน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธเนเธญเธ”เธกเธดเธเธชเธณเน€เธฃเนเธ', 'success');
                loadAdminDashboard();
            } else {
                showCustomAlert({
                    title: 'เธฃเธซเธฑเธชเธเนเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                    message: 'เธฃเธซเธฑเธชเธเนเธฒเธเธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ เธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธชเธญเธเนเธฅเธฐเธฅเธญเธเนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธ',
                    icon: 'fas fa-shield-cat'
                });
            }
        });
    }

    // เธเธธเนเธกเธญเธญเธเธเธฒเธเธฃเธฐเธเธ (Custom In-App Modal - No browser popup!)
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            showCustomConfirm({
                title: 'เธญเธญเธเธเธฒเธเธฃเธฐเธเธ',
                message: 'เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธญเธญเธเธเธฒเธเธฃเธฐเธเธเนเธฅเธฐเธเธฅเธฑเธเธชเธนเนเธซเธเนเธฒเธซเธฅเธฑเธเธซเธฃเธทเธญเนเธกเน?',
                icon: 'fas fa-arrow-right-from-bracket',
                confirmText: 'เธญเธญเธเธเธฒเธเธฃเธฐเธเธ',
                cancelText: 'เธขเธเน€เธฅเธดเธ',
                confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
                onConfirm: () => {
                    stopAntiCheatMonitor();
                    clearInterval(state.examTimer);
                    try { sessionStorage.removeItem('EXAM_SESSION_USER'); } catch (e) {}
                    state.currentUser = null;
                    state.currentExam = null;
                    state.questions = [];
                    state.answers = {};
                    showView('view-auth');
                    showToast('เธญเธญเธเธเธฒเธเธฃเธฐเธเธเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง', 'info');
                }
            });
        });
    }
}

// ==============================================================================
// 4. STUDENT LOBBY & EXAM ROOM (WITH TARGETING FILTER)
// ==============================================================================

window.refreshStudentLobby = async function(btn) {
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.classList.add('fa-spin');
        btn.disabled = true;
    }

    // Force sync with Supabase Cloud
    if (isSupabaseConfigured() && state.supabaseClient && state.currentUser) {
        try {
            const studentId = state.currentUser.id;
            const studentName = state.currentUser.name || '';
            let query = state.supabaseClient.from('exam_results').select('*');

            if (isValidUUID(studentId) && studentName) {
                query = query.or(`student_id.eq.${studentId},student_name.eq."${studentName}"`);
            } else if (isValidUUID(studentId)) {
                query = query.eq('student_id', studentId);
            } else if (studentName) {
                query = query.eq('student_name', studentName);
            }

            const { data: dbSubmissions, error } = await query;
            if (!error && Array.isArray(dbSubmissions)) {
                const allLocal = getLocalSubmissions();
                const otherStudents = allLocal.filter(s => s.student_id !== studentId && s.student_name !== studentName);
                const updatedForStudent = [...otherStudents, ...dbSubmissions];
                localStorage.setItem('EXAM_LOCAL_SUBMISSIONS', JSON.stringify(updatedForStudent));
            }
        } catch (e) {
            console.warn('[refreshStudentLobby] Supabase sync notice:', e);
        }
    }

    await loadStudentLobby();
    showToast('๐” เธญเธฑเธเน€เธ”เธ•เธเนเธญเธกเธนเธฅเนเธฅเธฐเธชเธดเธ—เธเธดเนเธเธฒเธฃเธชเธญเธเธฅเนเธฒเธชเธธเธ”เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง!', 'success');

    if (btn) {
        setTimeout(() => {
            const icon = btn.querySelector('i');
            if (icon) icon.classList.remove('fa-spin');
            btn.disabled = false;
        }, 500);
    }
};

async function loadStudentLobby() {
    showView('view-student-lobby');
    const listContainer = document.getElementById('exam-cards-container');
    if (!listContainer) return;

    let exams = getLocalExams();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('exams')
                .select('*')
                .eq('is_active', true)
                .order('created_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                exams = data;
            }
        } catch (e) {
            console.warn('[loadStudentLobby] Remote query failed, using local exams:', e);
        }
    }

    // เธ”เธถเธเธเธฃเธฐเธงเธฑเธ•เธดเธเธฒเธฃเธชเนเธเธเนเธญเธชเธญเธเธเธญเธเธเธฑเธเน€เธฃเธตเธขเธเธเธเธเธตเน เน€เธเธทเนเธญเธ•เธฃเธงเธเธชเธญเธเธงเนเธฒเน€เธเธขเธ—เธณเธเนเธญเธชเธญเธเนเธเนเธฅเนเธงเธซเธฃเธทเธญเนเธกเน
    let studentSubmissions = [];
    if (isSupabaseConfigured() && state.supabaseClient && state.currentUser) {
        try {
            const studentId = state.currentUser.id;
            const studentName = state.currentUser.name || '';
            
            let { data: dbSubmissions } = await state.supabaseClient
                .from('exam_results')
                .select('*')
                .eq('student_name', studentName);

            if (!dbSubmissions || dbSubmissions.length === 0) {
                if (isValidUUID(studentId)) {
                    const res = await state.supabaseClient
                        .from('exam_results')
                        .select('*')
                        .eq('student_id', studentId);
                    if (!res.error && res.data) dbSubmissions = res.data;
                }
            }

            if (Array.isArray(dbSubmissions)) {
                studentSubmissions = dbSubmissions;
                // เธ–เนเธฒ Supabase เธเธทเธเธเนเธฒเธกเธฒเนเธฅเนเธง (เธฃเธงเธกเธ–เธถเธเธเธฃเธ“เธตเน€เธเนเธ 0 เธเธ/เธเธฅเธ”เธฅเนเธญเธเนเธฅเนเธง)
                // เนเธซเนเธฅเธเนเธเธเธเนเธญเธชเธญเธเธ—เธตเนเนเธกเนเธกเธตเนเธ Cloud เธญเธญเธเธเธฒเธ LocalStorage เธเธญเธเน€เธเธฃเธทเนเธญเธเธเธตเนเธ—เธฑเธเธ—เธต!
                const activeDbExamIds = new Set(dbSubmissions.map(s => s.exam_id));
                const allLocal = getLocalSubmissions();
                const filteredLocal = allLocal.filter(s => {
                    const isMe = s.student_id === studentId || (s.student_name && s.student_name.trim().toLowerCase() === studentName.trim().toLowerCase());
                    if (!isMe) return true;
                    return activeDbExamIds.has(s.exam_id);
                });
                localStorage.setItem('EXAM_LOCAL_SUBMISSIONS', JSON.stringify(filteredLocal));
            }
        } catch (subErr) {
            console.warn('[loadStudentLobby] Submissions check notice:', subErr);
        }
    } else {
        // เธญเธญเธเนเธฅเธเน fallback
        const localSubs = getLocalSubmissions();
        const currentName = (state.currentUser?.name || '').trim().toLowerCase();
        const currentId = state.currentUser?.id;
        const currentCode = state.currentUser?.student_code || state.currentUser?.code;
        studentSubmissions = (localSubs || []).filter(s => 
            s.student_id === currentId || 
            s.student_id === currentCode ||
            (s.student_name && s.student_name.trim().toLowerCase() === currentName)
        );
    }

    // เธเธฑเธ”เธเธฃเธญเธเน€เธเธเธฒเธฐเธเนเธญเธชเธญเธเธ—เธตเนเธ•เธฃเธเธเธฑเธเธเธฅเธธเนเธกเธเธญเธเธเธฑเธเน€เธฃเธตเธขเธ (เธซเธฃเธทเธญเน€เธเนเธ 'เธ—เธฑเนเธเธซเธกเธ”')
    const eligibleExams = (exams || []).filter(exam => isExamEligibleForStudent(exam, state.currentUser));

    if (eligibleExams.length === 0) {
        listContainer.innerHTML = `
            <div class="col-span-full bg-white rounded-3xl p-10 text-center border border-slate-100 shadow-sm">
                <i class="fas fa-file-signature text-5xl text-slate-300 mb-4"></i>
                <h3 class="text-lg font-bold text-slate-800">เธขเธฑเธเนเธกเนเธกเธตเธเธธเธ”เธเนเธญเธชเธญเธเธชเธณเธซเธฃเธฑเธเธเธฅเธธเนเธกเธเธญเธเธเธธเธ“เนเธเธเธ“เธฐเธเธตเน</h3>
                <p class="text-slate-500 text-xs mt-1">
                    เธเธฅเธธเนเธกเธเธญเธเธเธธเธ“: <strong>${state.currentUser?.year || ''} | ${state.currentUser?.dept || ''} | ${state.currentUser?.room || ''}</strong>
                </p>
                <p class="text-slate-400 text-xs mt-2">เธเธฃเธธเธ“เธฒเธฃเธญเธญเธฒเธเธฒเธฃเธขเนเธเธฃเธฐเธเธณเธงเธดเธเธฒเน€เธเธดเธ”เธเธธเธ”เธเนเธญเธชเธญเธ</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = eligibleExams.map(exam => {
        const matchedCourse = getLocalCourses().find(c => c.id === exam.course_id);
        const courseCode = matchedCourse?.course_code || exam.course?.course_code || 'เธ—เธฑเนเธงเนเธ';
        const courseName = matchedCourse?.course_name || exam.course?.course_name || 'เธงเธดเธเธฒเธ—เธฑเนเธงเนเธ';
        const teacher = exam.teacher_name || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ';

        const targetTag = `${exam.target_year || 'เธ—เธธเธเธเธฑเนเธ'} | ${exam.target_department || 'เธ—เธธเธเนเธเธเธ'} | ${exam.target_room || 'เธ—เธธเธเธซเนเธญเธ'}`;

        // เน€เธเนเธเธงเนเธฒเธ—เธณเธเนเธญเธชเธญเธเธเธธเธ”เธเธตเนเนเธเนเธฅเนเธงเธซเธฃเธทเธญเนเธกเน
        const pastSubmission = studentSubmissions.find(s => s.exam_id === exam.id);
        const isCompleted = !!pastSubmission;

        return `
            <div class="bg-white rounded-3xl p-6 border ${isCompleted ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-100'} shadow-sm hover:shadow-md transition flex flex-col justify-between">
                <div>
                    <!-- Header Badges -->
                    <div class="flex items-center justify-between gap-2 mb-3">
                        <span class="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100">
                            [${escapeHtml(courseCode)}] ${escapeHtml(courseName)}
                        </span>
                        ${isCompleted ? `
                            <span class="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                                <i class="fas fa-check-circle"></i> เธ—เธณเนเธฅเนเธง
                            </span>
                        ` : `
                            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700">เน€เธเธดเธ”เธชเธญเธ</span>
                        `}
                    </div>

                    <h3 class="text-base font-bold text-slate-900 mb-1.5 leading-snug">${escapeHtml(exam.title)}</h3>
                    <p class="text-xs text-slate-500 mb-3 flex items-center gap-1.5">
                        <i class="fas fa-chalkboard-user text-slate-400"></i> เธชเธญเธเนเธ”เธข: <strong class="text-slate-700">${escapeHtml(teacher)}</strong>
                    </p>
                    <p class="text-slate-600 text-xs mb-4 line-clamp-2">${escapeHtml(exam.description || 'เนเธกเนเธกเธตเธเธณเธญเธเธดเธเธฒเธขเน€เธเธดเนเธกเน€เธ•เธดเธก')}</p>
                    
                    <!-- Target Audience Badge -->
                    <div class="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/60 text-[11px] text-amber-900 mb-4 flex items-center gap-1.5">
                        <i class="fas fa-bullseye text-amber-600"></i>
                        <span>เน€เธเนเธฒเธซเธกเธฒเธข: <strong>${escapeHtml(targetTag)}</strong></span>
                    </div>
                </div>

                ${isCompleted ? `
                    <div class="pt-4 border-t border-emerald-100">
                        <div class="p-3 bg-emerald-50 border border-emerald-200/80 rounded-2xl mb-3 text-center">
                            <div class="text-xs font-bold text-emerald-800 flex items-center justify-center gap-1.5 mb-1">
                                <i class="fas fa-circle-check text-emerald-600"></i> เธ—เธณเธเนเธญเธชเธญเธเน€เธชเธฃเนเธเธชเธดเนเธเนเธฅเนเธง
                            </div>
                            ${(exam.show_score_immediately !== false) ? `
                                <div class="text-xs text-emerald-700">
                                    เธเธฐเนเธเธ: <strong>${pastSubmission.total_score} / ${pastSubmission.max_score}</strong> (${pastSubmission.percentage}%)
                                </div>
                            ` : `
                                <div class="text-xs text-blue-700 font-medium flex items-center justify-center gap-1">
                                    <i class="fas fa-clock text-blue-500"></i> เธฃเธญเธเธฃเธฐเธเธฒเธจเธเธฐเนเธเธเธเธฒเธเธญเธฒเธเธฒเธฃเธขเน
                                </div>
                            `}
                        </div>

                        <button disabled class="w-full py-2.5 px-4 bg-slate-100 text-slate-400 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-not-allowed border border-slate-200">
                            <i class="fas fa-lock text-slate-400"></i> เธชเธญเธเนเธเนเธฅเนเธง (เนเธกเนเธญเธเธธเธเธฒเธ•เนเธซเนเธ—เธณเธเนเธณ)
                        </button>
                        <p class="text-[10px] text-slate-400 text-center mt-1.5">
                            * เธซเธฒเธเธ•เนเธญเธเธเธฒเธฃเธ—เธณเนเธซเธกเน เธเธฃเธธเธ“เธฒเธ•เธดเธ”เธ•เนเธญเธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธเน€เธเธทเนเธญเธเธฅเธ”เธฅเนเธญเธ
                        </p>
                    </div>
                ` : `
                    <div class="pt-4 border-t border-slate-100">
                        <div class="grid grid-cols-2 gap-2 text-xs text-slate-500 mb-4">
                            <div><i class="far fa-clock mr-1 text-indigo-500"></i> เน€เธงเธฅเธฒ: <strong>${exam.duration_minutes || 60} เธเธฒเธ—เธต</strong></div>
                            <div><i class="far fa-question-circle mr-1 text-indigo-500"></i> เธเธธเธ”เธเนเธญเธชเธญเธ: <strong>เธเธฃเนเธญเธกเธ—เธณ</strong></div>
                            <div class="col-span-2 text-amber-700 text-[11px]"><i class="fas fa-eye mr-1"></i> เธญเธเธธเธเธฒเธ•เธชเธฅเธฑเธเธเธญ: <strong>${exam.max_tab_switches_allowed || 3} เธเธฃเธฑเนเธ</strong></div>
                        </div>

                        <button onclick="startExam('${exam.id}')" class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-sm">
                            <i class="fas fa-play text-xs"></i> เน€เธเนเธฒเธ—เธณเธเนเธญเธชเธญเธ
                        </button>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

function isExamEligibleForStudent(exam, student) {
    if (!student || student.role !== 'student') return true;

    // เธ•เธฃเธงเธเธชเธญเธเธฃเธฐเธ”เธฑเธเธเธฑเนเธ
    const yearMatch = !exam.target_year || exam.target_year === 'เธ—เธฑเนเธเธซเธกเธ”' || exam.target_year === student.year;
    // เธ•เธฃเธงเธเธชเธญเธเนเธเธเธเธงเธดเธเธฒ
    const deptMatch = !exam.target_department || exam.target_department === 'เธ—เธฑเนเธเธซเธกเธ”' || exam.target_department === student.dept;
    // เธ•เธฃเธงเธเธชเธญเธเธซเนเธญเธเน€เธฃเธตเธขเธ
    const roomMatch = !exam.target_room || exam.target_room === 'เธ—เธฑเนเธเธซเธกเธ”' || exam.target_room === student.room;

    return yearMatch && deptMatch && roomMatch;
}

// เน€เธฃเธดเนเธกเธเธฒเธฃเธชเธญเธ
window.startExam = async function(examId) {
    // เธเนเธญเธเธเธฑเธเธเธ”เธเนเธณ
    if (window._startExamLock) return;
    window._startExamLock = true;
    setTimeout(() => { window._startExamLock = false; }, 3000);

    try {
        let exam = getLocalExams().find(e => e.id === examId);
        let questions = getLocalQuestions(examId);

        if (isSupabaseConfigured() && state.supabaseClient) {
            try {
                const { data: dbExam } = await state.supabaseClient
                    .from('exams')
                    .select('*')
                    .eq('id', examId)
                    .single();
                if (dbExam) exam = dbExam;

                const { data: dbQ } = await state.supabaseClient
                    .from('questions')
                    .select('id, exam_id, question_text, options, points, order_seq')
                    .eq('exam_id', examId)
                    .order('order_seq', { ascending: true });
                if (dbQ && dbQ.length > 0) questions = dbQ;
            } catch (dbErr) {
                console.warn('[startExam] Supabase fetch failed, using local exam & questions:', dbErr);
            }
        }

        if (!exam) {
            showToast('เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธธเธ”เธเนเธญเธชเธญเธ', 'error');
            return;
        }

        // เธ•เธฃเธงเธเธชเธญเธเธงเนเธฒเธเธฑเธเน€เธฃเธตเธขเธเน€เธเธขเธชเนเธเธเนเธญเธชเธญเธเธเธธเธ”เธเธตเนเนเธเนเธฅเนเธงเธซเธฃเธทเธญเนเธกเน
        let isAlreadySubmitted = false;
        if (isSupabaseConfigured() && state.supabaseClient && state.currentUser) {
            try {
                const studentId = state.currentUser.id;
                const studentName = state.currentUser.name || '';

                // เธเนเธเธซเธฒเธ”เนเธงเธขเธเธทเนเธญเธเนเธญเธ (เธชเธณเธเธฑเธเธ—เธตเนเธชเธธเธ”)
                let { data: byName } = await state.supabaseClient
                    .from('exam_results')
                    .select('id')
                    .eq('exam_id', examId)
                    .eq('student_name', studentName);

                // เธ–เนเธฒเนเธกเนเน€เธเธญเธ”เนเธงเธขเธเธทเนเธญ เธฅเธญเธเธ”เนเธงเธข UUID
                if ((!byName || byName.length === 0) && isValidUUID(studentId)) {
                    const res = await state.supabaseClient
                        .from('exam_results')
                        .select('id')
                        .eq('exam_id', examId)
                        .eq('student_id', studentId);
                    byName = res.data;
                }

                if (byName && byName.length > 0) {
                    isAlreadySubmitted = true;
                } else {
                    // Cloud เธขเธทเธเธขเธฑเธเธงเนเธฒเนเธกเนเธกเธตเธเธฅเธชเธญเธเนเธฅเนเธง โ’ เธฅเนเธฒเธเนเธเธเน€เธเนเธฒเธญเธญเธ
                    const localSubs = getLocalSubmissions();
                    const cleanName = (studentName || '').trim().toLowerCase();
                    const filtered = localSubs.filter(s => !(s.exam_id === examId && (s.student_id === studentId || (s.student_name && s.student_name.trim().toLowerCase() === cleanName))));
                    localStorage.setItem('EXAM_LOCAL_SUBMISSIONS', JSON.stringify(filtered));
                    isAlreadySubmitted = false;
                }
            } catch (e) {
                console.warn('[startExam] Submission check error:', e);
            }
        } else {
            const localSubs = getLocalSubmissions();
            const currentName = (state.currentUser?.name || '').trim().toLowerCase();
            const currentId = state.currentUser?.id;
            const currentCode = state.currentUser?.student_code || state.currentUser?.code;
            const match = (localSubs || []).find(s => 
                s.exam_id === examId &&
                (s.student_id === currentId || s.student_id === currentCode || (s.student_name && s.student_name.trim().toLowerCase() === currentName))
            );
            if (match) isAlreadySubmitted = true;
        }

        if (isAlreadySubmitted) {
            showCustomAlert({
                title: 'เธเธธเธ“เนเธ”เนเธ—เธณเธเนเธญเธชเธญเธเธเธธเธ”เธเธตเนเนเธเนเธฅเนเธง',
                message: `เธเธธเธ“เนเธ”เนเธชเนเธเธเธณเธ•เธญเธเธชเธณเธซเธฃเธฑเธเธเธธเธ”เธเนเธญเธชเธญเธ "${exam.title}" เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง เนเธฅเธฐเนเธกเนเธญเธเธธเธเธฒเธ•เนเธซเนเธ—เธณเธเนเธณ\n\nเธซเธฒเธเธกเธตเน€เธซเธ•เธธเธเธณเน€เธเนเธเธ•เนเธญเธเธชเธญเธเนเธซเธกเน เธเธฃเธธเธ“เธฒเธ•เธดเธ”เธ•เนเธญเธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธเน€เธเธทเนเธญเธเธ”เน€เธเธดเธ”/เธเธฅเธ”เธฅเนเธญเธเนเธซเนเธชเธญเธเนเธซเธกเนเธเธฃเธฑเธ`,
                icon: 'fas fa-lock'
            });
            return;
        }

        if (!questions || questions.length === 0) {
            showCustomAlert({
                title: 'เธขเธฑเธเนเธกเนเธกเธตเธเธณเธ–เธฒเธก',
                message: 'เธเธธเธ”เธเนเธญเธชเธญเธเธเธตเนเธขเธฑเธเนเธกเนเธกเธตเธเธณเธ–เธฒเธก เธเธฃเธธเธ“เธฒเธ•เธดเธ”เธ•เนเธญเธญเธฒเธเธฒเธฃเธขเนเธเธฃเธฐเธเธณเธงเธดเธเธฒเน€เธเธทเนเธญเน€เธเธดเนเธกเนเธเธ—เธขเนเธซเธฃเธทเธญเธเธณเน€เธเนเธฒ Excel',
                icon: 'fas fa-circle-info'
            });
            return;
        }

        // เธ•เธฃเธงเธเธเธฑเธ Split Screen
        if (isSplitScreenDetected()) {
            showCustomAlert({
                title: 'เธ•เธฃเธงเธเธเธเธเธฒเธฃเนเธเนเธเธซเธเนเธฒเธเธญ',
                message: 'เธ•เธฃเธงเธเธเธเธงเนเธฒเธกเธตเธเธฒเธฃเนเธเนเธเธฒเธเนเธเนเธเธซเธเนเธฒเธเธญ (Split Screen / Pop-up Window)\n\nเธฃเธฐเธเธเนเธกเนเธญเธเธธเธเธฒเธ•เนเธซเนเน€เธเนเธฒเธ—เธณเธเนเธญเธชเธญเธ เธเธฃเธธเธ“เธฒเธเธขเธฒเธขเน€เธ•เนเธกเธซเธเนเธฒเธเธญเธเนเธญเธเน€เธฃเธดเนเธกเธชเธญเธ',
                icon: 'fas fa-triangle-exclamation'
            });
            return;
        }

        showCustomConfirm({
            title: 'เน€เธฃเธดเนเธกเน€เธเนเธฒเธ—เธณเธเนเธญเธชเธญเธ?',
            message: `เธเธธเธ”เธเนเธญเธชเธญเธ: ${exam.title}\nเธงเธดเธเธฒ: ${exam.course?.course_name || 'เธ—เธฑเนเธงเนเธ'}\nเน€เธงเธฅเธฒเธ—เธณเธเนเธญเธชเธญเธ: ${exam.duration_minutes || 60} เธเธฒเธ—เธต (${questions.length} เธเนเธญ)\n\n๐ก๏ธ เธเธเธฃเธฐเน€เธเธตเธขเธเธฃเธฐเธซเธงเนเธฒเธเธเธฒเธฃเธชเธญเธ:\n1. เธเธฃเธธเธ“เธฒเธเธดเธ”เธซเธเนเธฒเธ•เนเธฒเธเนเธเธ—เธฅเธญเธข (Messenger / LINE Bubbles) เธ—เธฑเนเธเธซเธกเธ”เธเนเธญเธเน€เธฃเธดเนเธก\n2. เธซเนเธฒเธกเธชเธฅเธฑเธเธซเธเนเธฒเธเธญ เธซเนเธฒเธกเนเธเธเธเธญ เนเธฅเธฐเธซเนเธฒเธกเธญเธญเธเธเธฒเธเนเธซเธกเธ”เน€เธ•เนเธกเธเธญเน€เธ”เนเธ”เธเธฒเธ”\n3. เธเธฒเธฃเน€เธเธดเธ”เนเธเธ—เธฃเธฐเธซเธงเนเธฒเธเธชเธญเธเธเธฐเธ–เธนเธเธเธฑเธเธ—เธถเธเน€เธเนเธเธเธคเธ•เธดเธเธฃเธฃเธกเธ—เธธเธเธฃเธดเธ•เธ—เธฑเธเธ—เธต`,
            icon: 'fas fa-shield-halved',
            confirmText: 'เธฃเธฑเธเธ—เธฃเธฒเธเนเธฅเธฐเน€เธฃเธดเนเธกเธชเธญเธเธ—เธฑเธเธ—เธต',
            cancelText: 'เธขเธฑเธเนเธกเนเธเธฃเนเธญเธก',
            confirmClass: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100',
            onConfirm: async () => {
                try {
                    if (document.documentElement.requestFullscreen) {
                        await document.documentElement.requestFullscreen();
                    }
                } catch (e) {
                    console.warn('[Fullscreen Warning]:', e);
                }

                state.currentExam = exam;
                state.questions = questions;
                state.currentQuestionIndex = 0;
                state.answers = {};
                state.antiCheat.tabSwitches = 0;
                state.antiCheat.fullscreenExits = 0;
                state.antiCheat.cheatingReasons = [];
                state.remainingSeconds = (exam.duration_minutes || 60) * 60;

                showView('view-student-exam');
                renderExamQuestion();
                renderQuestionPalette();
                startCountdownTimer();
                startAntiCheatMonitor();
                showToast('เน€เธฃเธดเนเธกเธ—เธณเธเนเธญเธชเธญเธ เธเธญเนเธซเนเนเธเธเธ”เธตเนเธเธเธฒเธฃเธชเธญเธเธเธฃเธฑเธ!', 'success');
            }
        });

    } catch (err) {
        showCustomAlert({
            title: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”',
            message: 'เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เนเธซเธฅเธ”เธเธธเธ”เธเนเธญเธชเธญเธเนเธ”เน: ' + err.message,
            icon: 'fas fa-triangle-exclamation'
        });
    }
};

function renderExamQuestion() {
    if (!state.questions || state.questions.length === 0) return;
    const q = state.questions[state.currentQuestionIndex];
    if (!q) return;

    const card = document.getElementById('exam-question-card');
    if (!card) return;

    const parsed = parseQuestionTextAndImage(q.question_text, q.image_url || q.image);

    // parse options safely (Supabase returns JSONB as object, localStorage as string)
    let opts = q.options;
    if (typeof opts === 'string') {
        try { opts = JSON.parse(opts); } catch (e) { opts = []; }
    }
    if (!Array.isArray(opts)) opts = [];

    const selectedOpt = state.answers[q.id];

    let imageMarkup = '';
    if (parsed.image) {
        imageMarkup = `
            <div class="mb-4 p-2 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col items-center justify-center">
                <img src="${parsed.image}" alt="เธ เธฒเธเธเธฃเธฐเธเธญเธเธเนเธญเธชเธญเธ" class="max-h-80 max-w-full object-contain rounded-xl shadow-2xs cursor-pointer hover:opacity-95 transition" onclick="openImageZoomModal('${parsed.image}')">
                <div class="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1"><i class="fas fa-magnifying-glass-plus"></i> เธเธฅเธดเธเธ—เธตเนเธฃเธนเธเน€เธเธทเนเธญเธเธขเธฒเธขเธ”เธนเน€เธ•เนเธกเธเธญ</div>
            </div>`;
    }

    const textMarkup = parsed.text
        ? `<div class="text-slate-800 text-base font-bold leading-relaxed mb-5">${escapeHtml(parsed.text)}</div>`
        : (parsed.image ? '' : `<div class="text-slate-400 italic mb-5">(เนเธกเนเธกเธตเธเนเธญเธเธงเธฒเธกเธเธณเธ–เธฒเธก)</div>`);

    const optionsMarkup = opts.map(opt => {
        const isChecked = selectedOpt === opt.id;
        return `
            <label class="p-4 rounded-2xl border-2 cursor-pointer transition flex items-start gap-3.5 ${
                isChecked
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 shadow-sm font-semibold'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
            }">
                <input type="radio" name="option-choice" value="${opt.id}" ${isChecked ? 'checked' : ''} onchange="selectExamOption('${q.id}', '${opt.id}')" class="mt-1 text-indigo-600 focus:ring-indigo-500 w-4 h-4">
                <span class="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${isChecked ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}">
                    ${opt.id}
                </span>
                <span class="text-sm pt-0.5 leading-relaxed">${escapeHtml(opt.text || '')}</span>
            </label>`;
    }).join('');

    card.innerHTML = `
        <div class="flex items-center justify-between mb-4">
            <span id="exam-question-number" class="text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
                เธเนเธญเธ—เธตเน ${state.currentQuestionIndex + 1} เธเธฒเธ ${state.questions.length}
            </span>
            <span id="exam-question-points" class="text-xs font-semibold text-slate-500">(${q.points || 1} เธเธฐเนเธเธ)</span>
        </div>
        <div id="exam-question-text" class="mb-1">
            ${imageMarkup}
            ${textMarkup}
        </div>
        <div id="exam-options-container" class="space-y-3">
            ${optionsMarkup}
        </div>
        <div class="flex justify-between mt-6 pt-4 border-t border-slate-100 gap-3">
            <button type="button" id="btn-exam-prev" onclick="prevExamQuestion()" class="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition flex items-center gap-2 ${state.currentQuestionIndex === 0 ? 'opacity-40 pointer-events-none' : ''}">
                <i class="fas fa-chevron-left text-xs"></i> เธเนเธญเธเนเธญเธเธซเธเนเธฒ
            </button>
            ${state.currentQuestionIndex === state.questions.length - 1
                ? `<button type="button" onclick="confirmSubmitExam()" class="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition shadow-md shadow-green-100 flex items-center justify-center gap-2">
                       <i class="fas fa-paper-plane text-xs"></i> เธชเนเธเธเนเธญเธชเธญเธ
                   </button>`
                : `<button type="button" id="btn-exam-next" onclick="nextExamQuestion()" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition flex items-center gap-2">
                       เธเนเธญเธ–เธฑเธ”เนเธ <i class="fas fa-chevron-right text-xs"></i>
                   </button>`
            }
        </div>
    `;

    // เธญเธฑเธเน€เธ”เธ• palette เนเธฅเธฐเธเธธเนเธกเธเธณเธ—เธฒเธ
    renderQuestionPalette();
}

window.prevExamQuestion = function() {
    if (state.currentQuestionIndex > 0) {
        state.currentQuestionIndex--;
        renderExamQuestion();
    }
};

window.nextExamQuestion = function() {
    if (state.questions && state.currentQuestionIndex < state.questions.length - 1) {
        state.currentQuestionIndex++;
        renderExamQuestion();
    }
};

function selectExamOption(questionId, optionId) {
    state.answers[questionId] = optionId;
    saveStudentDraftAnswers();
    renderExamQuestion();
}

function saveStudentDraftAnswers() {
    if (!state.currentExam || !state.currentUser) return;
    try {
        const key = `DRAFT_ANSWERS_${state.currentUser.id}_${state.currentExam.id}`;
        localStorage.setItem(key, JSON.stringify(state.answers));
    } catch (e) {}
}

function clearStudentDraftAnswers() {
    if (!state.currentExam || !state.currentUser) return;
    try {
        const key = `DRAFT_ANSWERS_${state.currentUser.id}_${state.currentExam.id}`;
        localStorage.removeItem(key);
    } catch (e) {}
}

function renderQuestionPalette() {
    const palette = document.getElementById('exam-question-palette');
    if (!palette || !state.questions) return;

    palette.innerHTML = state.questions.map((q, idx) => {
        const isCurrent = idx === state.currentQuestionIndex;
        const isAnswered = !!state.answers[q.id];

        let cls = 'bg-slate-100 text-slate-600 hover:bg-slate-200';
        if (isAnswered) cls = 'bg-emerald-600 text-white shadow-xs';
        if (isCurrent) cls += ' ring-2 ring-indigo-500 ring-offset-2 font-black scale-105';

        return `
            <button type="button" onclick="jumpToQuestion(${idx})" class="w-8 h-8 rounded-xl text-xs font-bold transition flex items-center justify-center ${cls}">
                ${idx + 1}
            </button>
        `;
    }).join('');
}

window.jumpToQuestion = function(idx) {
    if (idx >= 0 && idx < state.questions.length) {
        state.currentQuestionIndex = idx;
        renderExamQuestion();
    }
};

function updateExamNavButtons() {
    const btnPrev = document.getElementById('btn-prev-question');
    const btnNext = document.getElementById('btn-next-question');
    const btnSubmit = document.getElementById('btn-submit-exam');

    const isFirst = state.currentQuestionIndex === 0;
    const isLast = state.currentQuestionIndex === state.questions.length - 1;

    if (btnPrev) btnPrev.disabled = isFirst;
    if (btnNext) {
        btnNext.classList.toggle('hidden', isLast);
    }
    if (btnSubmit) {
        btnSubmit.classList.toggle('hidden', !isLast);
    }
}

window.prevQuestion = function() {
    if (state.currentQuestionIndex > 0) renderQuestion(state.currentQuestionIndex - 1);
};
window.nextQuestion = function() {
    if (state.currentQuestionIndex < state.questions.length - 1) renderQuestion(state.currentQuestionIndex + 1);
};

// ==============================================================================
// 5. ANTI-CHEATING MONITOR ENGINE & LOCKDOWN
// ==============================================================================
// 5. ANTI-CHEATING MONITOR ENGINE & LOCKDOWN (WITH MOBILE BUBBLE DETECTOR)
// ==============================================================================

let focusWatchdogInterval = null;
let focusLostStartTime = 0;
let lastCheatWarningTime = 0;

function isSplitScreenDetected() {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);
    if (!isMobileDevice) return false;

    const screenHeight = window.screen.availHeight || window.screen.height;
    const currentHeight = window.innerHeight;

    if (screenHeight > 0) {
        const heightRatio = currentHeight / screenHeight;
        if (heightRatio < 0.68 && currentHeight < 550) {
            return true;
        }
    }
    return false;
}

function startAntiCheatMonitor() {
    state.antiCheat.isMonitoring = true;
    focusLostStartTime = 0;

    // Standard Window & Document Lifecycle Events
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('resize', handleWindowResize);
    document.addEventListener('focusout', handleDocumentFocusOut);
    document.addEventListener('focusin', handleDocumentFocusIn);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleVisualViewportResize);
    }
    
    // Exam Interaction Lockdown
    document.addEventListener('contextmenu', preventContextMenu);
    document.addEventListener('copy', preventCopy);
    document.addEventListener('cut', preventCopy);
    document.addEventListener('paste', preventCopy);
    document.addEventListener('keydown', preventExamShortcuts);
    document.addEventListener('selectstart', preventSelectStart);

    // ๐“ฑ Active Mobile & Overlay Watchdog (เธ•เธฃเธงเธเธเธฑเธ Messenger Bubble, Line Popup, Notification Shade)
    if (focusWatchdogInterval) clearInterval(focusWatchdogInterval);
    focusWatchdogInterval = setInterval(() => {
        if (!state.antiCheat.isMonitoring) return;

        const isHidden = document.hidden || document.visibilityState !== 'visible';
        const hasDocFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

        if (isHidden || !hasDocFocus) {
            if (!focusLostStartTime) {
                focusLostStartTime = Date.now();
            } else if (Date.now() - focusLostStartTime >= 300) {
                // เธซเธฅเธธเธ”เนเธเธเธฑเธชเน€เธเธดเธ 300ms (เธเธณเธฅเธฑเธเนเธ•เธฐเธซเธฃเธทเธญเนเธเธ—เนเธ Messenger Bubble เธซเธฃเธทเธญเนเธ–เธเนเธเนเธเน€เธ•เธทเธญเธ)
                registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเน€เธเธดเธ”เธซเธเนเธฒเธ•เนเธฒเธเนเธเธ—เธฅเธญเธข (Messenger Bubble) / เนเธ–เธเนเธเนเธเน€เธ•เธทเธญเธ / เธชเธฅเธฑเธเนเธเธเธฑเธชเธญเธญเธเธเธฒเธเธเนเธญเธชเธญเธ');
            }
        } else {
            focusLostStartTime = 0;
        }
    }, 200);
}

function stopAntiCheatMonitor() {
    state.antiCheat.isMonitoring = false;
    focusLostStartTime = 0;

    if (focusWatchdogInterval) {
        clearInterval(focusWatchdogInterval);
        focusWatchdogInterval = null;
    }

    if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
    }

    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    window.removeEventListener('focus', handleWindowFocus);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
    window.removeEventListener('resize', handleWindowResize);
    document.removeEventListener('focusout', handleDocumentFocusOut);
    document.removeEventListener('focusin', handleDocumentFocusIn);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.removeEventListener('contextmenu', preventContextMenu);
    document.removeEventListener('copy', preventCopy);
    document.removeEventListener('cut', preventCopy);
    document.removeEventListener('paste', preventCopy);
    document.removeEventListener('keydown', preventExamShortcuts);
    document.removeEventListener('selectstart', preventSelectStart);
}

function handleVisualViewportResize() {
    if (!state.antiCheat.isMonitoring) return;
    if (window.visualViewport) {
        const heightRatio = window.visualViewport.height / window.innerHeight;
        const isInputFocused = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
        if (heightRatio < 0.70 && !isInputFocused) {
            registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเน€เธเธดเธ”เนเธเนเธเธเธดเธกเธเนเธ เธฒเธขเธเธญเธเธซเธเนเธฒเธ•เนเธฒเธเธชเธญเธ (เนเธเธ—เธฅเธญเธข Messenger/LINE)');
        }
    }
}

function handleWindowResize() {
    if (!state.antiCheat.isMonitoring) return;
    if (isSplitScreenDetected()) {
        state.antiCheat.tabSwitches++;
        triggerCheatWarning('เธ•เธฃเธงเธเธเธเธเธฒเธฃเน€เธเธดเธ”เนเธเนเธเธฒเธเนเธซเธกเธ”เนเธเนเธเธซเธเนเธฒเธเธญ (Split Screen / Pop-up Window)');
    }
}

function handlePageHide() {
    if (!state.antiCheat.isMonitoring) return;
    registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธชเธฅเธฑเธเนเธญเธเธเธฅเธดเน€เธเธเธฑเธเธซเธฃเธทเธญเธญเธญเธเธเธฒเธเธซเธเนเธฒเธเธญเน€เธเธฃเธฒเธงเนเน€เธเธญเธฃเน');
}

function handlePageShow() {
    if (!state.antiCheat.isMonitoring) return;
    if (focusLostStartTime && Date.now() - focusLostStartTime >= 300) {
        registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธเธฅเธฑเธเน€เธเนเธฒเธชเธนเนเธซเนเธญเธเธชเธญเธเธซเธฅเธฑเธเธชเธฅเธฑเธเนเธเนเธญเธเธญเธทเนเธ');
    }
    focusLostStartTime = 0;
}

function handleDocumentFocusOut(e) {
    if (!state.antiCheat.isMonitoring) return;
    // เธซเธฒเธเนเธเธเธฑเธชเธซเธฅเธธเธ”เธญเธญเธเธเธฒเธ document เนเธ”เธขเนเธกเนเนเธ”เนเธขเนเธฒเธขเนเธเธขเธฑเธ element เธ เธฒเธขเนเธเน€เธงเนเธ
    if (!e.relatedTarget && typeof document.hasFocus === 'function' && !document.hasFocus()) {
        registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธเธฅเธดเธเธญเธญเธเธเธญเธเธซเธเนเธฒเธ•เนเธฒเธเธเนเธญเธชเธญเธ เธซเธฃเธทเธญเน€เธเธดเธ”เธซเธเนเธฒเธ•เนเธฒเธเนเธเธ—เธฅเธญเธข');
    }
}

function handleDocumentFocusIn() {
    if (!state.antiCheat.isMonitoring) return;
    if (focusLostStartTime && Date.now() - focusLostStartTime >= 350) {
        registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธเธฅเธฑเธเน€เธเนเธฒเธชเธนเนเธซเนเธญเธเธชเธญเธเธซเธฅเธฑเธเธชเธฅเธฑเธเนเธเธเธฑเธช');
    }
    focusLostStartTime = 0;
}

function handleWindowFocus() {
    if (!state.antiCheat.isMonitoring) return;
    if (focusLostStartTime && Date.now() - focusLostStartTime >= 350) {
        registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธชเธฅเธฑเธเธเธฅเธฑเธเธกเธฒเธเธฒเธเธซเธเนเธฒเธ•เนเธฒเธเธญเธทเนเธ / เนเธเธ—เธฅเธญเธข');
    }
    focusLostStartTime = 0;
}

function preventContextMenu(e) {
    if (state.antiCheat.isMonitoring) {
        e.preventDefault();
        showToast('โ ๏ธ เนเธกเนเธญเธเธธเธเธฒเธ•เนเธซเนเธเธฅเธดเธเธเธงเธฒเนเธเธซเนเธญเธเธชเธญเธ', 'warning');
    }
}

function preventCopy(e) {
    if (state.antiCheat.isMonitoring) {
        e.preventDefault();
        showToast('โ ๏ธ เนเธกเนเธญเธเธธเธเธฒเธ•เนเธซเนเธเธฑเธ”เธฅเธญเธ เธ•เธฑเธ” เธซเธฃเธทเธญเธงเธฒเธเธเนเธญเธเธงเธฒเธกเธฃเธฐเธซเธงเนเธฒเธเธ—เธณเธเนเธญเธชเธญเธ', 'warning');
    }
}

// ๐ซ เธเธดเธ”เธเธธเนเธกเธฅเธฑเธ” Developer Tools / เธเธฑเธ”เธฅเธญเธ / เธเธฃเธดเนเธเธ—เน / เธเธฑเธเธ—เธถเธเธซเธเนเธฒเธเธญ
function preventExamShortcuts(e) {
    if (!state.antiCheat.isMonitoring) return;

    // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (Developer Tools)
    if (e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) ||
        (e.ctrlKey && ['u', 'U', 'p', 'P', 's', 'S', 'a', 'A'].includes(e.key))) {
        e.preventDefault();
        e.stopPropagation();
        showToast('โ ๏ธ เนเธกเนเธญเธเธธเธเธฒเธ•เนเธซเนเนเธเนเธเธธเนเธกเธฅเธฑเธ”เธซเธฃเธทเธญเน€เธเธดเธ” Developer Tools เนเธเธซเนเธญเธเธชเธญเธ', 'warning');
        return false;
    }

    // Block Ctrl+C, Ctrl+V, Ctrl+X
    if (e.ctrlKey && ['c', 'C', 'v', 'V', 'x', 'X'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        showToast('โ ๏ธ เนเธกเนเธญเธเธธเธเธฒเธ•เนเธซเนเธเธฑเธ”เธฅเธญเธเธซเธฃเธทเธญเธงเธฒเธเธเนเธญเธเธงเธฒเธกเธฃเธฐเธซเธงเนเธฒเธเธ—เธณเธเนเธญเธชเธญเธ', 'warning');
        return false;
    }
}

function preventSelectStart(e) {
    if (state.antiCheat.isMonitoring) {
        const target = e.target;
        if (target && (target.closest('#exam-question-card') || target.closest('.exam-protection'))) {
            e.preventDefault();
        }
    }
}

function registerTabSwitch(reason) {
    if (!state.antiCheat.isMonitoring) return;
    const now = Date.now();
    // Debounce 600ms เน€เธเธทเนเธญเธเนเธญเธเธเธฑเธ event เธเนเธณเธเนเธญเธเธ•เธญเธเธชเธฅเธฑเธเธซเธเนเธฒเธ•เนเธฒเธเธเธฃเนเธญเธกเธเธฑเธ
    if (now - lastCheatWarningTime < 600) return;
    lastCheatWarningTime = now;

    state.antiCheat.tabSwitches++;
    triggerCheatWarning(reason);
}

function handleVisibilityChange() {
    if (!state.antiCheat.isMonitoring) return;
    if (document.hidden) {
        registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธชเธฅเธฑเธเธซเธเนเธฒเธเธญ / เธชเธฅเธฑเธเนเธ—เนเธเน€เธเธฃเธฒเธงเนเน€เธเธญเธฃเน');
    }
}

function handleWindowBlur() {
    if (!state.antiCheat.isMonitoring) return;
    registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธเธฅเธดเธเธญเธญเธเธเธฒเธเธซเธเนเธฒเธ•เนเธฒเธเธเนเธญเธชเธญเธ / เน€เธเธดเธ”เนเธเธ—เธฅเธญเธข');
}

function handleFullscreenChange() {
    if (!state.antiCheat.isMonitoring) return;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        state.antiCheat.fullscreenExits++;
        registerTabSwitch('เธ•เธฃเธงเธเธเธเธเธฒเธฃเธญเธญเธเธเธฒเธเนเธซเธกเธ”เน€เธ•เนเธกเธซเธเนเธฒเธเธญ');
    }
}

function triggerCheatWarning(reason) {
    const badgeEl = document.getElementById('exam-room-tab-badge');
    if (badgeEl && state.currentExam) {
        badgeEl.textContent = `เธชเธฅเธฑเธเธเธญ: ${state.antiCheat.tabSwitches}/${state.currentExam.max_tab_switches_allowed}`;
        if (state.antiCheat.tabSwitches > state.currentExam.max_tab_switches_allowed) {
            badgeEl.className = 'px-3 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700 border border-red-300 warning-pulse';
        }
    }

    const cheatPayload = {
        event_id: `cheat_${state.currentUser?.id}_${state.antiCheat.tabSwitches}_${Date.now()}`,
        student_id: state.currentUser?.id,
        student_name: state.currentUser?.name || 'เธเธฑเธเน€เธฃเธตเธขเธ',
        student_year: state.currentUser?.year || 'เธเธงเธ./เธเธงเธช.',
        student_department: state.currentUser?.dept || 'เนเธกเนเธฃเธฐเธเธธเนเธเธเธ',
        student_room: state.currentUser?.room || 'เธซเนเธญเธ 1',
        exam_id: state.currentExam?.id,
        exam_title: state.currentExam?.title || 'เธเธธเธ”เธเนเธญเธชเธญเธ',
        reason: reason,
        tabSwitches: state.antiCheat.tabSwitches,
        fullscreenExits: state.antiCheat.fullscreenExits,
        timestamp: new Date().toISOString()
    };

    // Broadcast instant event via Unified Real-Time Engine
    broadcastAppEvent('student_cheat_event', cheatPayload);

    // Persist in anti_cheat_logs table if connected
    if (state.supabaseClient && isSupabaseConfigured() && state.currentUser && state.currentExam) {
        state.supabaseClient
            .from('anti_cheat_logs')
            .insert({
                student_id: state.currentUser.id,
                exam_id: state.currentExam.id,
                event_type: 'suspicious_activity',
                event_payload: cheatPayload
            })
            .then(() => {})
            .catch(() => {});
    }

    const modal = document.getElementById('modal-cheat-warning');
    const reasonEl = document.getElementById('cheat-warning-reason');
    const countEl = document.getElementById('cheat-warning-count');

    if (modal) {
        if (reasonEl) reasonEl.textContent = reason;
        if (countEl) countEl.textContent = `เธเธณเธเธงเธเธเธฃเธฑเนเธเธ—เธตเนเธชเธฅเธฑเธเธซเธเนเธฒเธเธญ: ${state.antiCheat.tabSwitches} เธเธฃเธฑเนเธ (เธเธณเธซเธเธ”เนเธงเนเนเธกเนเน€เธเธดเธ ${state.currentExam.max_tab_switches_allowed} เธเธฃเธฑเนเธ)`;
        modal.classList.remove('hidden');
    }
}

window.closeCheatWarningModal = function() {
    const modal = document.getElementById('modal-cheat-warning');
    if (modal) modal.classList.add('hidden');

    if (!document.fullscreenElement) {
        try { document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
    }
};

// ==============================================================================
// 6. TIMER & FINAL SUBMISSION
// ==============================================================================

function startCountdownTimer() {
    clearInterval(state.examTimer);
    updateTimerDisplay();

    state.examTimer = setInterval(() => {
        state.remainingSeconds--;
        updateTimerDisplay();

        if (state.remainingSeconds <= 0) {
            clearInterval(state.examTimer);
            showToast('โฐ เธซเธกเธ”เน€เธงเธฅเธฒเธ—เธณเธเนเธญเธชเธญเธเนเธฅเนเธง! เธฃเธฐเธเธเธเธณเธฅเธฑเธเธชเนเธเธเนเธญเธชเธญเธเธญเธฑเธ•เนเธเธกเธฑเธ•เธด', 'warning');
            submitExamFinal();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const timerEl = document.getElementById('exam-room-timer');
    if (!timerEl) return;

    const mins = Math.floor(Math.max(0, state.remainingSeconds) / 60);
    const secs = Math.max(0, state.remainingSeconds) % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    timerEl.textContent = formatted;

    if (state.remainingSeconds <= 300) {
        timerEl.classList.add('text-red-600', 'font-bold');
    } else {
        timerEl.classList.remove('text-red-600');
    }
}

window.confirmSubmitExam = function() {
    const answeredCount = Object.keys(state.answers).length;
    const totalCount = state.questions.length;
    const unansweredCount = totalCount - answeredCount;

    let confirmMsg = `เธเธธเธ“เธ•เธญเธเนเธเนเธฅเนเธง ${answeredCount} เธเธฒเธ ${totalCount} เธเนเธญ\n`;
    if (unansweredCount > 0) {
        confirmMsg += `โ ๏ธ เธขเธฑเธเธกเธตเธเนเธญเธ—เธตเนเธขเธฑเธเนเธกเนเนเธ”เนเธ•เธญเธเธญเธตเธ ${unansweredCount} เธเนเธญ!\n`;
    }
    confirmMsg += `\nเธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธขเธทเธเธขเธฑเธเธเธฒเธฃเธชเนเธเธเนเธญเธชเธญเธเนเธฅเธฐเธ•เธฃเธงเธเธเธฐเนเธเธเนเธเนเธซเธฃเธทเธญเนเธกเน?`;

    showCustomConfirm({
        title: 'เธขเธทเธเธขเธฑเธเธเธฒเธฃเธชเนเธเธเนเธญเธชเธญเธ',
        message: confirmMsg,
        icon: 'fas fa-paper-plane',
        confirmText: 'เธชเนเธเธเนเธญเธชเธญเธเธ—เธฑเธเธ—เธต',
        cancelText: 'เธเธฅเธฑเธเนเธเธ•เธฃเธงเธเธ—เธฒเธ',
        confirmClass: 'bg-green-600 hover:bg-green-700 text-white shadow-md shadow-green-100',
        onConfirm: () => {
            submitExamFinal();
        }
    });
};

async function submitExamFinal() {
    stopAntiCheatMonitor();
    clearInterval(state.examTimer);

    if (document.fullscreenElement) {
        try { document.exitFullscreen(); } catch (e) {}
    }

    const loadingModal = document.getElementById('modal-loading');
    if (loadingModal) {
        document.getElementById('loading-modal-title').textContent = 'เธเธณเธฅเธฑเธเธ•เธฃเธงเธเธเนเธญเธชเธญเธ...';
        document.getElementById('loading-modal-desc').textContent = 'เธเธณเธฅเธฑเธเธเธณเธเธงเธ“เธเธฐเนเธเธเนเธฅเธฐเธ•เธฃเธงเธเธชเธญเธเธเธงเธฒเธกเธเธฅเธญเธ”เธ เธฑเธข';
        loadingModal.classList.remove('hidden');
    }

    try {
        // 1. เธฃเธฐเธเธเธ•เธฃเธงเธเธเธฐเนเธเธเธญเธฑเธ•เนเธเธกเธฑเธ•เธด (Local Auto-Grading Engine)
        const questions = state.questions || [];
        const localQuestions = getLocalQuestions(state.currentExam?.id);
        let totalScore = 0;
        let maxScore = 0;

        questions.forEach(q => {
            const points = Number(q.points) || 1.0;
            maxScore += points;
            const selectedAns = state.answers[q.id];
            
            // เธเนเธเธซเธฒเน€เธเธฅเธขเธเธฒเธ local questions เธซเธฃเธทเธญ q
            const foundQ = localQuestions.find(lq => lq.id === q.id) || q;
            const correctAns = foundQ.correct || foundQ.correct_option_id || 'A';

            if (selectedAns && selectedAns === correctAns) {
                totalScore += points;
            }
        });

        const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
        const isFlagged = state.antiCheat.tabSwitches > (state.currentExam?.max_tab_switches_allowed || 3) || state.antiCheat.fullscreenExits > 2;
        const cheatingReasons = [];
        if (state.antiCheat.tabSwitches > (state.currentExam?.max_tab_switches_allowed || 3)) {
            cheatingReasons.push(`เธชเธฅเธฑเธเธซเธเนเธฒเธเธญเน€เธเธดเธเธเธณเธซเธเธ” (${state.antiCheat.tabSwitches}/${state.currentExam?.max_tab_switches_allowed} เธเธฃเธฑเนเธ)`);
        }
        if (state.antiCheat.fullscreenExits > 2) {
            cheatingReasons.push(`เธญเธญเธเธเธฒเธเนเธซเธกเธ”เน€เธ•เนเธกเธซเธเนเธฒเธเธญ (${state.antiCheat.fullscreenExits} เธเธฃเธฑเนเธ)`);
        }

        const gradeResult = {
            student_id: state.currentUser.id,
            student_name: state.currentUser.name,
            student_year: state.currentUser.year || 'เนเธกเนเธฃเธฐเธเธธ',
            student_department: state.currentUser.dept || 'เนเธกเนเธฃเธฐเธเธธ',
            student_room: state.currentUser.room || 'เนเธกเนเธฃเธฐเธเธธ',
            exam_id: state.currentExam?.id,
            exam_title: state.currentExam?.title,
            course_name: state.currentExam?.course?.course_name || 'เธงเธดเธเธฒเธ—เธฑเนเธงเนเธ',
            total_score: totalScore,
            max_score: maxScore,
            percentage: percentage,
            is_flagged_cheating: isFlagged,
            cheating_reasons: cheatingReasons,
            total_tab_switches: state.antiCheat.tabSwitches,
            total_fullscreen_exits: state.antiCheat.fullscreenExits,
            graded_at: new Date().toISOString()
        };

        // เธเธฑเธเธ—เธถเธเธเธฅเธชเธญเธเธฅเธ Local Storage เน€เธเธทเนเธญเนเธซเนเธญเธฒเธเธฒเธฃเธขเนเธ”เธนเนเธฅเธฐ Export เนเธ”เนเธ—เธฑเธเธ—เธต
        saveLocalSubmission(gradeResult);

        // 2. เธ–เนเธฒเธ•เนเธญ Supabase เนเธ”เน เนเธซเน Sync เธเธถเนเธ DB
        if (isSupabaseConfigured() && state.supabaseClient) {
            // เธฅเธญเธ RPC grade_exam_secure เธเนเธญเธ
            let rpcOk = false;
            try {
                const rpcRes = await state.supabaseClient.rpc('grade_exam_secure', {
                    p_student_id: state.currentUser.id,
                    p_exam_id: state.currentExam.id,
                    p_student_name: state.currentUser.name,
                    p_student_year: state.currentUser.year || 'เนเธกเนเธฃเธฐเธเธธ',
                    p_student_department: state.currentUser.dept || 'เนเธกเนเธฃเธฐเธเธธ',
                    p_student_room: state.currentUser.room || 'เนเธกเนเธฃเธฐเธเธธ'
                });
                if (!rpcRes.error) rpcOk = true;
            } catch (rpcErr) {
                console.warn('[grade_exam_secure RPC warning]:', rpcErr);
            }

            // เธ–เนเธฒ RPC เนเธกเนเธชเธณเน€เธฃเนเธ โ’ เธเธฑเธเธ—เธถเธเธ•เธฃเธเธฅเธ exam_results เน€เธญเธ
            if (!rpcOk) {
                try {
                    await state.supabaseClient
                        .from('exam_results')
                        .upsert({
                            student_id: state.currentUser.id,
                            student_name: state.currentUser.name,
                            student_year: state.currentUser.year || 'เนเธกเนเธฃเธฐเธเธธ',
                            student_department: state.currentUser.dept || 'เนเธกเนเธฃเธฐเธเธธ',
                            student_room: state.currentUser.room || 'เนเธกเนเธฃเธฐเธเธธ',
                            exam_id: state.currentExam.id,
                            course_name: state.currentExam?.course?.course_name || 'เธงเธดเธเธฒเธ—เธฑเนเธงเนเธ',
                            total_score: gradeResult.total_score,
                            max_score: gradeResult.max_score,
                            percentage: gradeResult.percentage,
                            total_tab_switches: state.antiCheat.tabSwitches || 0,
                            total_fullscreen_exits: state.antiCheat.fullscreenExits || 0,
                            is_flagged_cheating: gradeResult.is_flagged_cheating,
                            cheating_reasons: gradeResult.cheating_reasons || [],
                            status: 'graded',
                            graded_at: new Date().toISOString()
                        }, { onConflict: 'student_name,exam_id' });
                } catch (upsertErr) {
                    console.warn('[exam_results upsert warning]:', upsertErr);
                }
            }
        }

        // เธฅเนเธฒเธเธเธณเธ•เธญเธเธฃเนเธฒเธเธ—เธตเนเธเธฑเธเธ—เธถเธเนเธงเนเน€เธกเธทเนเธญเธชเนเธเธเนเธญเธชเธญเธเน€เธชเธฃเนเธเธชเธกเธเธนเธฃเธ“เน
        clearStudentDraftAnswers();

        if (loadingModal) loadingModal.classList.add('hidden');
        renderResultView(gradeResult);

    } catch (err) {
        if (loadingModal) loadingModal.classList.add('hidden');
        showCustomAlert({
            title: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”',
            message: 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธ•เธฃเธงเธเธเนเธญเธชเธญเธ: ' + err.message,
            icon: 'fas fa-triangle-exclamation'
        });
    }
}

function renderResultView(res) {
    showView('view-student-result');

    const scoreTitleEl = document.getElementById('result-score-title-label');
    const scoreEl = document.getElementById('result-score-display');
    const percentEl = document.getElementById('result-percentage-display');
    const percentPrefix = document.getElementById('result-percentage-prefix');
    const statusEl = document.getElementById('result-status-badge');
    const cheatAuditEl = document.getElementById('result-cheat-audit-box');
    const examNameEl = document.getElementById('result-exam-title');

    if (examNameEl) examNameEl.textContent = state.currentExam?.title || '';

    // เธ•เธฃเธงเธเธชเธญเธเธงเนเธฒเธญเธฒเธเธฒเธฃเธขเนเธญเธเธธเธเธฒเธ•เนเธซเนเนเธชเธ”เธเธเธฐเนเธเธเธซเธฃเธทเธญเนเธกเน
    const showScore = state.currentExam?.show_score_immediately !== false; // default = true

    if (!showScore) {
        // เธเนเธญเธเธเธฐเนเธเธ โ’ เนเธชเธ”เธเนเธเน "เธชเนเธเน€เธฃเธตเธขเธเธฃเนเธญเธข เธฃเธญเธเธฃเธฐเธเธฒเธจเธเธฅ" (เน€เธญเธฒเธเธณเธงเนเธฒ เธเธดเธ”เน€เธเนเธเธฃเนเธญเธขเธฅเธฐ: เธญเธญเธ)
        if (scoreTitleEl) scoreTitleEl.textContent = 'เธชเธ–เธฒเธเธฐเธเธฒเธฃเธชเนเธเธเนเธญเธชเธญเธ';
        if (scoreEl) scoreEl.innerHTML = `<span class="text-3xl text-emerald-600">๐</span><br><span class="text-xl font-bold text-slate-800">เธชเนเธเธเนเธญเธชเธญเธเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง</span>`;
        if (percentPrefix) percentPrefix.textContent = '';
        if (percentEl) percentEl.innerHTML = '<span class="text-xs font-medium text-slate-500">เธฃเธฐเธเธเธเธฑเธเธ—เธถเธเธเธณเธ•เธญเธเธเธญเธเธเธธเธ“เนเธฅเนเธง เธเธฃเธธเธ“เธฒเธฃเธญเธญเธฒเธเธฒเธฃเธขเนเธ•เธฃเธงเธเนเธฅเธฐเธเธฃเธฐเธเธฒเธจเธเธฐเนเธเธ</span>';
        if (statusEl) {
            statusEl.textContent = '๐“ เธเธฑเธเธ—เธถเธเธเนเธญเธชเธญเธเน€เธฃเธตเธขเธเธฃเนเธญเธข (เธฃเธญเธเธฃเธฐเธเธฒเธจเธเธฅ)';
            statusEl.className = 'px-4 py-1.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-300';
        }
        if (cheatAuditEl) cheatAuditEl.innerHTML = '';
        return;
    }

    if (scoreTitleEl) scoreTitleEl.textContent = 'เธเธฐเนเธเธเธฃเธงเธกเธ—เธตเนเธ—เธณเนเธ”เน';
    if (scoreEl) scoreEl.textContent = `${res.total_score} / ${res.max_score}`;
    if (percentPrefix) percentPrefix.textContent = 'เธเธดเธ”เน€เธเนเธเธฃเนเธญเธขเธฅเธฐ: ';
    if (percentEl) percentEl.textContent = `${res.percentage}%`;

    if (res.is_flagged_cheating) {
        if (statusEl) {
            statusEl.textContent = 'โ ๏ธ เธ•เธดเธ”เธชเธ–เธฒเธเธฐเธ•เธฃเธงเธเธชเธญเธเธเธฒเธฃเธ—เธธเธเธฃเธดเธ• (Flagged)';
            statusEl.className = 'px-4 py-1.5 rounded-full text-sm font-bold bg-red-100 text-red-700 border border-red-300';
        }
        if (cheatAuditEl) {
            cheatAuditEl.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-xl p-4 text-left">
                    <h4 class="font-bold text-red-800 text-sm mb-2 flex items-center gap-2">
                        <i class="fas fa-exclamation-triangle"></i> เธเธเธเธคเธ•เธดเธเธฃเธฃเธกเธเธดเธ”เธเธเธ•เธดเธฃเธฐเธซเธงเนเธฒเธเธเธฒเธฃเธชเธญเธ:
                    </h4>
                    <ul class="list-disc list-inside text-xs text-red-700 space-y-1">
                        ${(res.cheating_reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                        <li>เธเธณเธเธงเธเธเธฒเธฃเธชเธฅเธฑเธเธซเธเนเธฒเธเธญเธ—เธฑเนเธเธซเธกเธ”: ${res.total_tab_switches || state.antiCheat.tabSwitches} เธเธฃเธฑเนเธ</li>
                    </ul>
                    <p class="text-xs text-gray-500 mt-2">เธเธฅเธเธฐเนเธเธเธเธตเนเธเธฐเธ–เธนเธเธชเนเธเนเธซเนเธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธเธ•เธฃเธงเธเธชเธญเธ</p>
                </div>
            `;
        }
    } else {
        if (statusEl) {
            statusEl.textContent = 'โ… เธเนเธฒเธเธเธฒเธฃเธ•เธฃเธงเธเธชเธญเธเธเธงเธฒเธกเธเธทเนเธญเธชเธฑเธ•เธขเน (Verified)';
            statusEl.className = 'px-4 py-1.5 rounded-full text-sm font-bold bg-green-100 text-green-700 border border-green-300';
        }
        if (cheatAuditEl) {
            cheatAuditEl.innerHTML = `
                <div class="bg-green-50 border border-green-200 rounded-xl p-4 text-center text-xs text-green-800">
                    <i class="fas fa-check-circle text-green-600 text-lg mb-1"></i>
                    <p class="font-medium">เนเธกเนเธเธเธเธคเธ•เธดเธเธฃเธฃเธกเธ•เนเธญเธเธชเธเธชเธฑเธข เธเธฒเธฃเธชเธญเธเธชเธกเธเธนเธฃเธ“เน</p>
                    <p class="text-gray-500 mt-0.5">เธชเธฅเธฑเธเธเธญเธ—เธฑเนเธเธซเธกเธ”: ${res.total_tab_switches || state.antiCheat.tabSwitches} เธเธฃเธฑเนเธ (เธญเธขเธนเนเนเธเน€เธเธ“เธ‘เน)</p>
                </div>
            `;
        }
    }
}

// ==============================================================================
// 7. TEACHER PORTAL, REAL-TIME MONITOR & COURSE MANAGEMENT
// ==============================================================================

function initTeacherRealtimeAlerts() {
    updateLiveAlertToggleUI();
}

window.toggleLiveAlerts = function() {
    state.realtimeAlertsEnabled = !state.realtimeAlertsEnabled;
    localStorage.setItem('EXAM_REALTIME_NOTIFICATIONS', state.realtimeAlertsEnabled ? 'true' : 'false');
    updateLiveAlertToggleUI();

    if (state.realtimeAlertsEnabled) {
        showToast('๐”” เน€เธเธดเธ”เธเธฒเธฃเนเธเนเธเน€เธ•เธทเธญเธเธชเธฅเธฑเธเธซเธเนเธฒเธเธญเนเธเธเน€เธฃเธตเธขเธฅเนเธ—เธกเนเนเธฅเนเธง', 'success');
    } else {
        showToast('๐”• เธเธดเธ”เธเธฒเธฃเนเธเนเธเน€เธ•เธทเธญเธเธชเธฅเธฑเธเธซเธเนเธฒเธเธญเนเธเธเน€เธฃเธตเธขเธฅเนเธ—เธกเนเนเธฅเนเธง', 'info');
    }
};

window.toggleAlertSound = function() {
    state.realtimeAlertsSoundEnabled = !state.realtimeAlertsSoundEnabled;
    localStorage.setItem('EXAM_REALTIME_SOUND', state.realtimeAlertsSoundEnabled ? 'true' : 'false');
    updateLiveAlertToggleUI();

    if (state.realtimeAlertsSoundEnabled) {
        playAlertChime();
        showToast('๐” เน€เธเธดเธ”เน€เธชเธตเธขเธเน€เธ•เธทเธญเธเธชเธฅเธฑเธเธซเธเนเธฒเธเธญเนเธฅเนเธง', 'success');
    } else {
        showToast('๐” เธเธดเธ”เน€เธชเธตเธขเธเน€เธ•เธทเธญเธเธชเธฅเธฑเธเธซเธเนเธฒเธเธญเนเธฅเนเธง', 'info');
    }
};

function updateLiveAlertToggleUI() {
    const btnToggle = document.getElementById('btn-toggle-live-alerts');
    const textEl = document.getElementById('live-alert-status-text');
    const dotEl = document.getElementById('live-alert-pulse-dot');
    const soundIcon = document.getElementById('live-alert-sound-icon');

    if (btnToggle && textEl && dotEl) {
        if (state.realtimeAlertsEnabled) {
            btnToggle.className = 'px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm';
            textEl.textContent = 'เนเธเนเธเน€เธ•เธทเธญเธเธชเธฅเธฑเธเธเธญ: เน€เธเธดเธ”';
            dotEl.className = 'w-2 h-2 rounded-full bg-white animate-ping';
        } else {
            btnToggle.className = 'px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-600 shadow-sm';
            textEl.textContent = 'เนเธเนเธเน€เธ•เธทเธญเธเธชเธฅเธฑเธเธเธญ: เธเธดเธ”';
            dotEl.className = 'w-2 h-2 rounded-full bg-slate-400';
        }
    }

    if (soundIcon) {
        if (state.realtimeAlertsSoundEnabled) {
            soundIcon.className = 'fas fa-volume-high text-emerald-700';
        } else {
            soundIcon.className = 'fas fa-volume-xmark text-slate-400';
        }
    }
}

function playAlertChime() {
    if (!state.realtimeAlertsSoundEnabled) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        // Tone 1: High crisp alert chime
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(784, ctx.currentTime); // G5 note
        gain1.gain.setValueAtTime(0.2, ctx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 0.18);

        // Tone 2: Harmonious second beep
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.12); // C6 note
        gain2.gain.setValueAtTime(0.25, ctx.currentTime + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(ctx.currentTime + 0.12);
        osc2.stop(ctx.currentTime + 0.38);
    } catch (e) {
        console.warn('[Audio Chime Warning]', e);
    }
}

function handleIncomingCheatingAlert(data) {
    if (!data) return;
    if (!state.realtimeAlertsEnabled) return;

    // เธ•เธฃเธงเธเธชเธญเธเธงเนเธฒเน€เธเธดเธ”เธซเธเนเธฒเธซเนเธญเธเธญเธฒเธเธฒเธฃเธขเนเธญเธขเธนเนเธซเธฃเธทเธญเนเธกเน
    const isTeacher = state.currentUser?.role === 'teacher' || 
                      state.currentUser?.role === 'admin' || 
                      state.currentView === 'view-teacher' || 
                      (document.getElementById('view-teacher') && !document.getElementById('view-teacher').classList.contains('hidden'));

    if (!isTeacher) {
        console.log('[Cheating Alert received - Not viewing teacher portal]');
        return;
    }

    const studentName = data.student_name || 'เธเธฑเธเน€เธฃเธตเธขเธ';
    const studentYear = data.student_year || 'เธเธงเธ./เธเธงเธช.';
    const studentDept = data.student_department || 'เนเธกเนเธฃเธฐเธเธธเนเธเธเธ';
    const studentRoom = data.student_room || 'เธซเนเธญเธ 1';
    const examTitle = data.exam_title || 'เธเธธเธ”เธเนเธญเธชเธญเธ';
    const reason = data.reason || 'เธ•เธฃเธงเธเธเธเธเธฒเธฃเธชเธฅเธฑเธเธซเธเนเธฒเธเธญ';
    const tabSwitches = data.tabSwitches || 1;
    const timeStr = new Date(data.timestamp || Date.now()).toLocaleTimeString('th-TH');

    // 1. Play sound chime
    playAlertChime();

    // 2. Spawn Floating Real-Time Card
    renderLiveCheatToast({
        studentName,
        studentYear,
        studentDept,
        studentRoom,
        examTitle,
        reason,
        tabSwitches,
        timeStr
    });

    // 3. Add to Submissions tab live feed
    addLiveFeedEntry({
        studentName,
        studentYear,
        studentDept,
        studentRoom,
        examTitle,
        reason,
        tabSwitches,
        timeStr
    });

    // 4. Update flagged stats counter if visible
    const statFlagged = document.getElementById('teacher-stat-flagged-cheats');
    if (statFlagged) {
        const current = parseInt(statFlagged.textContent) || 0;
        statFlagged.textContent = current + 1;
    }
}

function renderLiveCheatToast({ studentName, studentYear, studentDept, studentRoom, examTitle, reason, tabSwitches, timeStr }) {
    const container = document.getElementById('live-cheat-alerts-container');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'bg-white/95 backdrop-blur-md rounded-2xl p-4 border-2 border-red-500 shadow-2xl shadow-red-500/20 pointer-events-auto animate-slide-down flex flex-col gap-2.5 transition-all duration-300';
    
    card.innerHTML = `
        <div class="flex items-start justify-between">
            <div class="flex items-center gap-2.5">
                <span class="w-8 h-8 rounded-xl bg-red-100 text-red-600 flex items-center justify-center text-sm font-bold animate-pulse">
                    <i class="fas fa-triangle-exclamation"></i>
                </span>
                <div>
                    <h4 class="font-black text-red-700 text-xs uppercase tracking-wider flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-red-600 animate-ping"></span>
                        เน€เธ•เธทเธญเธเธชเธฅเธฑเธเธซเธเนเธฒเธเธญเธชเธ”!
                    </h4>
                    <p class="text-[10px] text-slate-400">${escapeHtml(timeStr)}</p>
                </div>
            </div>
            <button class="text-slate-400 hover:text-slate-700 text-xs p-1">
                <i class="fas fa-xmark"></i>
            </button>
        </div>
        <div class="bg-red-50/70 p-3 rounded-xl border border-red-100 text-xs">
            <div class="font-extrabold text-slate-900 text-sm mb-0.5">${escapeHtml(studentName)}</div>
            <div class="text-[11px] text-indigo-700 font-bold mb-1.5">${escapeHtml(studentYear)} | ${escapeHtml(studentDept)} | ${escapeHtml(studentRoom)}</div>
            <div class="text-[11px] text-slate-600 mb-1">
                <i class="fas fa-book-open text-slate-400 mr-1"></i> เธงเธดเธเธฒ/เธเนเธญเธชเธญเธ: <strong>${escapeHtml(examTitle)}</strong>
            </div>
            <div class="flex items-center justify-between pt-1 mt-1 border-t border-red-200/50">
                <span class="text-[11px] text-red-600 font-medium">${escapeHtml(reason)}</span>
                <span class="text-red-700 font-bold bg-red-200/70 px-2 py-0.5 rounded-full text-[10px]">เธชเธฅเธฑเธเธเธฃเธฑเนเธเธ—เธตเน ${tabSwitches}</span>
            </div>
        </div>
    `;

    const closeBtn = card.querySelector('button');
    if (closeBtn) {
        closeBtn.onclick = () => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(-10px)';
            setTimeout(() => card.remove(), 250);
        };
    }

    container.prepend(card);

    // Auto remove after 9 seconds
    setTimeout(() => {
        if (card.parentElement) {
            card.style.opacity = '0';
            card.style.transform = 'translateY(-10px)';
            setTimeout(() => card.remove(), 250);
        }
    }, 9000);
}

function addLiveFeedEntry(entry) {
    const listEl = document.getElementById('live-cheat-feed-list');
    const countEl = document.getElementById('live-cheat-feed-count');
    if (!listEl) return;

    state.liveFeedLogs.unshift(entry);
    if (countEl) countEl.textContent = `${state.liveFeedLogs.length} เธเธดเธเธเธฃเธฃเธก`;

    listEl.innerHTML = state.liveFeedLogs.slice(0, 15).map(item => `
        <div class="p-2.5 bg-white rounded-xl border border-red-100 flex items-center justify-between gap-3 shadow-xs">
            <div class="flex items-center gap-2.5">
                <span class="w-6 h-6 rounded-lg bg-red-100 text-red-600 flex items-center justify-center text-xs">
                    <i class="fas fa-arrow-right-arrow-left"></i>
                </span>
                <div>
                    <span class="font-bold text-slate-800 text-xs">${escapeHtml(item.studentName)}</span>
                    <span class="text-[11px] text-slate-400 ml-1.5">(${escapeHtml(item.studentYear)} ${escapeHtml(item.studentRoom)})</span>
                    <div class="text-[10px] text-slate-500">${escapeHtml(item.examTitle)} &bull; <span class="text-red-600 font-medium">${escapeHtml(item.reason)}</span></div>
                </div>
            </div>
            <div class="text-right whitespace-nowrap">
                <span class="px-2 py-0.5 rounded-md bg-red-50 text-red-700 font-bold text-[10px]">เธเธฃเธฑเนเธเธ—เธตเน ${item.tabSwitches}</span>
                <div class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(item.timeStr)}</div>
            </div>
        </div>
    `).join('');
}

window.clearLiveFeedLogs = function() {
    state.liveFeedLogs = [];
    const listEl = document.getElementById('live-cheat-feed-list');
    const countEl = document.getElementById('live-cheat-feed-count');
    if (countEl) countEl.textContent = '0 เธเธดเธเธเธฃเธฃเธก';
    if (listEl) {
        listEl.innerHTML = `<p class="text-slate-400 text-xs italic py-2 text-center">เธฃเธฐเธเธเธเธณเธฅเธฑเธเธกเธญเธเธดเน€เธ•เธญเธฃเนเธชเธ”... (เธซเธฒเธเธกเธตเธเธฑเธเน€เธฃเธตเธขเธเธชเธฅเธฑเธเธซเธเนเธฒเธเธญ เธเธฐเธเธฃเธฒเธเธเธเธถเนเธเธ—เธตเนเธเธตเนเธ—เธฑเธเธ—เธต)</p>`;
    }
};

async function loadTeacherDashboard() {
    showView('view-teacher');
    initTeacherRealtimeAlerts();
    setupTeacherTabs();
    await loadTeacherCourses();
    await loadTeacherExamsList();
    loadTeacherSubmissions();
    loadTeacherStudentsList();
    populateCourseSelects();
    await populateTeacherExamSelects();
    setupExcelDragDrop();
}

function setupTeacherTabs() {
    const btnCourses = document.getElementById('teacher-tab-btn-courses');
    const btnExams = document.getElementById('teacher-tab-btn-exams');
    const btnSubmissions = document.getElementById('teacher-tab-btn-submissions');
    const btnStudents = document.getElementById('teacher-tab-btn-students');
    const btnAddQ = document.getElementById('teacher-tab-btn-add-question');
    const btnExcel = document.getElementById('teacher-tab-btn-excel-import');

    const contentCourses = document.getElementById('teacher-content-courses');
    const contentExams = document.getElementById('teacher-content-exams');
    const contentSubmissions = document.getElementById('teacher-content-submissions');
    const contentStudents = document.getElementById('teacher-content-students');
    const contentAddQ = document.getElementById('teacher-content-add-question');
    const contentExcel = document.getElementById('teacher-content-excel-import');

    const setTab = (tab) => {
        state.teacherCurrentTab = tab;

        [btnCourses, btnExams, btnSubmissions, btnStudents, btnAddQ, btnExcel].forEach(btn => {
            if (btn) {
                btn.classList.remove('border-emerald-600', 'text-emerald-600');
                btn.classList.add('border-transparent', 'text-slate-500');
            }
        });

        if (contentCourses) contentCourses.classList.add('hidden');
        if (contentExams) contentExams.classList.add('hidden');
        if (contentSubmissions) contentSubmissions.classList.add('hidden');
        if (contentStudents) contentStudents.classList.add('hidden');
        if (contentAddQ) contentAddQ.classList.add('hidden');
        if (contentExcel) contentExcel.classList.add('hidden');

        if (tab === 'courses') {
            if (btnCourses) {
                btnCourses.classList.add('border-emerald-600', 'text-emerald-600');
                btnCourses.classList.remove('border-transparent', 'text-slate-500');
            }
            if (contentCourses) contentCourses.classList.remove('hidden');
            loadTeacherCourses();
        } else if (tab === 'exams') {
            if (btnExams) {
                btnExams.classList.add('border-emerald-600', 'text-emerald-600');
                btnExams.classList.remove('border-transparent', 'text-slate-500');
            }
            if (contentExams) contentExams.classList.remove('hidden');
            loadTeacherExamsList();
        } else if (tab === 'submissions') {
            if (btnSubmissions) {
                btnSubmissions.classList.add('border-emerald-600', 'text-emerald-600');
                btnSubmissions.classList.remove('border-transparent', 'text-slate-500');
            }
            if (contentSubmissions) contentSubmissions.classList.remove('hidden');
            loadTeacherSubmissions();
        } else if (tab === 'students') {
            if (btnStudents) {
                btnStudents.classList.add('border-emerald-600', 'text-emerald-600');
                btnStudents.classList.remove('border-transparent', 'text-slate-500');
            }
            if (contentStudents) contentStudents.classList.remove('hidden');
            loadTeacherStudentsList();
        } else if (tab === 'add-question') {
            if (btnAddQ) {
                btnAddQ.classList.add('border-emerald-600', 'text-emerald-600');
                btnAddQ.classList.remove('border-transparent', 'text-slate-500');
            }
            if (contentAddQ) contentAddQ.classList.remove('hidden');
            populateTeacherExamSelects();
        } else if (tab === 'excel-import') {
            if (btnExcel) {
                btnExcel.classList.add('border-emerald-600', 'text-emerald-600');
                btnExcel.classList.remove('border-transparent', 'text-slate-500');
            }
            if (contentExcel) contentExcel.classList.remove('hidden');
            populateTeacherExamSelects();
        }
    };

    if (btnCourses) btnCourses.onclick = () => setTab('courses');
    if (btnExams) btnExams.onclick = () => setTab('exams');
    if (btnSubmissions) btnSubmissions.onclick = () => setTab('submissions');
    if (btnStudents) btnStudents.onclick = () => setTab('students');
    if (btnAddQ) btnAddQ.onclick = () => setTab('add-question');
    if (btnExcel) btnExcel.onclick = () => setTab('excel-import');
}

// 7.1 เธเธฑเธ”เธเธฒเธฃเธฃเธฒเธขเธงเธดเธเธฒเธเธญเธเธญเธฒเธเธฒเธฃเธขเน (Courses)
async function loadTeacherCourses() {
    const container = document.getElementById('teacher-courses-list-container');
    const badgeCount = document.getElementById('teacher-courses-count-badge');
    if (!container) return;

    let courses = getLocalCourses();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('courses')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                courses = data;
                localStorage.setItem('EXAM_LOCAL_COURSES', JSON.stringify(courses));
            }
        } catch (err) {
            console.warn('[loadTeacherCourses] Remote fetch skipped, using local cache:', err);
        }
    }

    // ๐”’ Teacher Isolation: เนเธชเธ”เธเน€เธเธเธฒเธฐเธฃเธฒเธขเธงเธดเธเธฒเธเธญเธเธญเธฒเธเธฒเธฃเธขเนเธ—เนเธฒเธเธเธตเนเน€เธ—เนเธฒเธเธฑเนเธ (เน€เธงเนเธเนเธ•เน Admin)
    if (state.currentUser?.role === 'teacher') {
        const currentTeacherId = state.currentUser.id;
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        courses = courses.filter(c => 
            (c.teacher_id && c.teacher_id === currentTeacherId) || 
            (c.teacher_name && c.teacher_name.trim().toLowerCase() === currentTeacherName)
        );
    }

    state.courses = courses;
    if (badgeCount) badgeCount.textContent = `${courses.length} เธฃเธฒเธขเธงเธดเธเธฒ`;

    if (courses.length === 0) {
        container.innerHTML = `
            <div class="col-span-full bg-white p-8 rounded-3xl border border-slate-100 text-center">
                <i class="fas fa-book-open text-4xl text-slate-300 mb-3"></i>
                <h4 class="font-bold text-slate-700">เธเธธเธ“เธขเธฑเธเนเธกเนเธกเธตเธฃเธฒเธขเธงเธดเธเธฒเนเธเธฃเธฐเธเธ</h4>
                <p class="text-xs text-slate-400 mt-1 mb-4">เธเธ”เธเธธเนเธกเธชเธฃเนเธฒเธเธฃเธฒเธขเธงเธดเธเธฒเนเธซเธกเนเน€เธเธทเนเธญเน€เธฃเธดเนเธกเธ•เนเธเน€เธเธดเธ”เธชเธญเธเนเธฅเธฐเธชเธฃเนเธฒเธเธเธธเธ”เธเนเธญเธชเธญเธเธเธญเธเธเธธเธ“</p>
                <button onclick="document.getElementById('modal-create-course').classList.remove('hidden')" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-sm">
                    <i class="fas fa-plus mr-1"></i> เธชเธฃเนเธฒเธเธฃเธฒเธขเธงเธดเธเธฒเนเธฃเธเธเธญเธเธเธธเธ“
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = courses.map(c => `
        <div class="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition flex flex-col justify-between">
            <div>
                <div class="flex items-center justify-between gap-2 mb-2">
                    <span class="px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-indigo-50 text-indigo-700">
                        ${escapeHtml(c.course_code)}
                    </span>
                </div>
                <h4 class="font-bold text-slate-900 text-base mb-1">${escapeHtml(c.course_name)}</h4>
                
                <!-- Badge เธฃเธฐเธ”เธฑเธเธเธฑเนเธเนเธฅเธฐเนเธเธเธเธเธฃเธฐเธเธณเธงเธดเธเธฒ -->
                <div class="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200/60 rounded-lg text-[11px] font-bold text-amber-900">
                    <i class="fas fa-bullseye text-amber-600"></i> ${escapeHtml(c.target_year || 'เธ—เธธเธเธเธฑเนเธ')} | ${escapeHtml(c.target_department || 'เธ—เธธเธเนเธเธเธ')}
                </div>

                <p class="text-xs text-slate-500 line-clamp-2 mb-3">${escapeHtml(c.description || 'เนเธกเนเธกเธตเธเธณเธญเธเธดเธเธฒเธขเธฃเธฒเธขเธงเธดเธเธฒ')}</p>
                <div class="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <i class="fas fa-user-tie text-emerald-500"></i> ${escapeHtml(c.teacher_name || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ')}
                </div>
            </div>

            <div class="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                <button onclick="openCreateExamForCourse('${c.id}')" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl transition flex items-center gap-1">
                    <i class="fas fa-plus"></i> เน€เธเธดเนเธกเธเนเธญเธชเธญเธเนเธเธงเธดเธเธฒเธเธตเน
                </button>
                <button onclick="deleteCourse('${c.id}', '${escapeHtml(c.course_name)}')" class="text-slate-300 hover:text-red-500 text-xs p-1.5 rounded-lg transition" title="เธฅเธเธฃเธฒเธขเธงเธดเธเธฒ">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        </div>
    `).join('');
}

window.deleteCourse = async function(courseId, courseName) {
    showCustomConfirm({
        title: 'เธขเธทเธเธขเธฑเธเธเธฒเธฃเธฅเธเธฃเธฒเธขเธงเธดเธเธฒ',
        message: `เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธฅเธเธฃเธฒเธขเธงเธดเธเธฒ "${courseName}" เนเธเนเธซเธฃเธทเธญเนเธกเน?\n(เธเธธเธ”เธเนเธญเธชเธญเธเธ—เธตเนเธเธนเธเธเธฑเธเธงเธดเธเธฒเธเธตเนเธเธฐเธขเธฑเธเธเธเธญเธขเธนเนเนเธเธฃเธฐเธเธ)`,
        icon: 'fas fa-trash-can',
        confirmText: 'เธฅเธเธฃเธฒเธขเธงเธดเธเธฒ',
        cancelText: 'เธขเธเน€เธฅเธดเธ',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalCourse(courseId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.from('courses').delete().eq('id', courseId);
                } catch (e) {}
            }
            showToast(`เธฅเธเธฃเธฒเธขเธงเธดเธเธฒ "${courseName}" เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง`, 'info');
            loadTeacherCourses();
            populateCourseSelects();
        }
    });
};

// 7.2 เธเธฑเธเธเนเธเธฑเธเน€เธ•เธดเธกเธฃเธฒเธขเธเธฒเธฃเธเธธเธ”เธเนเธญเธชเธญเธเนเธเธ•เธฑเธงเธเธฃเธญเธเธเธฅเธชเธญเธ
function populateTeacherSubmissionExamFilter() {
    const select = document.getElementById('teacher-sub-filter-exam');
    if (!select) return;

    let exams = state.localExams || getLocalExams();
    if (state.currentUser?.role === 'teacher') {
        const myCourseIds = (state.courses || []).map(c => c.id);
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        exams = exams.filter(e => 
            (e.teacher_name && e.teacher_name.trim().toLowerCase() === currentTeacherName) ||
            (e.course_id && myCourseIds.includes(e.course_id))
        );
    }

    const currentVal = select.value;
    select.innerHTML = `<option value="เธ—เธฑเนเธเธซเธกเธ”">เธเธธเธ”เธเนเธญเธชเธญเธ: เธ—เธฑเนเธเธซเธกเธ”</option>` + exams.map(e => `
        <option value="${e.id}">[${escapeHtml(e.title)}] (${escapeHtml(e.target_year || 'เธ—เธธเธเธเธฑเนเธ')} ${escapeHtml(e.target_room || 'เธ—เธธเธเธซเนเธญเธ')})</option>
    `).join('');

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
    }
}

// 7.2.1 เนเธซเธฅเธ”เธ•เธฒเธฃเธฒเธเธเธฅเธชเธญเธเธญเธฒเธเธฒเธฃเธขเน (เธเธฃเนเธญเธกเธ•เธฑเธงเธเธฃเธญเธเนเธขเธเธเธธเธ”เธเนเธญเธชเธญเธ/เธฃเธฐเธ”เธฑเธเธเธฑเนเธ/เนเธเธเธ/เธซเนเธญเธเน€เธฃเธตเธขเธ)
async function loadTeacherSubmissions() {
    const tableBody = document.getElementById('teacher-submissions-table-body');
    const statTotal = document.getElementById('teacher-stat-total-submissions');
    const statFlagged = document.getElementById('teacher-stat-flagged-cheats');
    const statAvg = document.getElementById('teacher-stat-avg-score');

    if (!tableBody) return;

    populateTeacherSubmissionExamFilter();

    let subs = getLocalSubmissions();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('exam_results')
                .select(`
                    *,
                    exam:exams(title, max_tab_switches_allowed, target_year, target_department, target_room, course:courses(course_name))
                `)
                .order('graded_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                subs = data;
            }
        } catch (err) {
            console.warn('[loadTeacherSubmissions] Supabase fetch skipped, using local cache:', err);
        }
    }

    // ๐”’ Teacher Isolation: เนเธชเธ”เธเน€เธเธเธฒเธฐเธเธฅเธเธฐเนเธเธเนเธเธงเธดเธเธฒเนเธฅเธฐเธเธธเธ”เธเนเธญเธชเธญเธเธเธญเธเธญเธฒเธเธฒเธฃเธขเนเธ—เนเธฒเธเธเธตเนเน€เธ—เนเธฒเธเธฑเนเธ (เน€เธงเนเธเนเธ•เน Admin)
    if (state.currentUser?.role === 'teacher') {
        const myExamIds = (state.localExams || getLocalExams()).map(e => e.id);
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        subs = (subs || []).filter(sub => 
            myExamIds.includes(sub.exam_id) || 
            (sub.exam?.teacher_name && sub.exam.teacher_name.trim().toLowerCase() === currentTeacherName)
        );
    }

    // ๐” Apply Filters: Search, Exam, Year, Department, Room
    const searchVal = (document.getElementById('teacher-sub-filter-search')?.value || '').trim().toLowerCase();
    const examFilter = document.getElementById('teacher-sub-filter-exam')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const yearFilter = document.getElementById('teacher-sub-filter-year')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const deptFilter = document.getElementById('teacher-sub-filter-dept')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const roomFilter = document.getElementById('teacher-sub-filter-room')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';

    // Roster lookup map for resolving student code / citizen id
    const localStudents = getLocalStudents();
    const studentRosterMap = new Map();
    localStudents.forEach(st => {
        if (st.id) studentRosterMap.set(st.id, st);
        if (st.code) studentRosterMap.set(String(st.code).toLowerCase(), st);
        if (st.citizen_id) studentRosterMap.set(String(st.citizen_id), st);
        if (st.name) studentRosterMap.set(st.name.trim().toLowerCase(), st);
    });

    let filtered = subs || [];

    if (searchVal) {
        filtered = filtered.filter(s => {
            const name = (s.student_name || '').toLowerCase();
            const id = String(s.student_id || '').toLowerCase();
            const code = String(s.student_code || s.code || '').toLowerCase();
            const citizen = String(s.student_citizen_id || s.citizen_id || '').toLowerCase();

            // Check linked student from roster
            const linked = studentRosterMap.get(s.student_id) || 
                           studentRosterMap.get(name) || 
                           studentRosterMap.get(code) || 
                           studentRosterMap.get(citizen);

            const linkedCode = String(linked?.code || '').toLowerCase();
            const linkedCitizen = String(linked?.citizen_id || '').toLowerCase();
            const linkedName = String(linked?.name || '').toLowerCase();

            return name.includes(searchVal) || 
                   id.includes(searchVal) || 
                   code.includes(searchVal) || 
                   citizen.includes(searchVal) ||
                   linkedCode.includes(searchVal) ||
                   linkedCitizen.includes(searchVal) ||
                   linkedName.includes(searchVal);
        });
    }

    if (examFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        filtered = filtered.filter(s => s.exam_id === examFilter);
    }

    if (yearFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        const cleanTargetYear = yearFilter.replace(/\s+/g, '').toLowerCase();
        filtered = filtered.filter(s => {
            const sYear = (s.student_year || s.year || '').replace(/\s+/g, '').toLowerCase();
            const eYear = (s.exam?.target_year || '').replace(/\s+/g, '').toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lYear = (linked?.year || '').replace(/\s+/g, '').toLowerCase();

            return sYear.includes(cleanTargetYear) || eYear.includes(cleanTargetYear) || lYear.includes(cleanTargetYear);
        });
    }

    if (deptFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        const targetDept = deptFilter.trim().toLowerCase();
        filtered = filtered.filter(s => {
            const sDept = (s.student_department || s.dept || '').trim().toLowerCase();
            const eDept = (s.exam?.target_department || '').trim().toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lDept = (linked?.dept || '').trim().toLowerCase();

            return sDept.includes(targetDept) || eDept.includes(targetDept) || lDept.includes(targetDept);
        });
    }

    if (roomFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        const cleanTargetRoom = roomFilter.replace(/\s+/g, '').toLowerCase();
        filtered = filtered.filter(s => {
            const sRoom = (s.student_room || s.room || '').replace(/\s+/g, '').toLowerCase();
            const eRoom = (s.exam?.target_room || '').replace(/\s+/g, '').toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lRoom = (linked?.room || '').replace(/\s+/g, '').toLowerCase();

            return sRoom.includes(cleanTargetRoom) || eRoom.includes(cleanTargetRoom) || lRoom.includes(cleanTargetRoom);
        });
    }

    if (!filtered || filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-10 text-slate-400">
                    <i class="fas fa-filter-circle-xmark text-3xl text-slate-300 mb-2 block"></i>
                    เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธฅเธเธฒเธฃเธชเธญเธเธ•เธฒเธกเน€เธเธทเนเธญเธเนเธเธ•เธฑเธงเธเธฃเธญเธเธ—เธตเนเธเนเธเธซเธฒ
                    <div class="text-xs text-slate-400 mt-1">
                        (เธเนเธเธซเธฒ: ${escapeHtml(searchVal || '-')} | เธฃเธฐเธ”เธฑเธเธเธฑเนเธ: ${escapeHtml(yearFilter)} | เธซเนเธญเธ: ${escapeHtml(roomFilter)})
                    </div>
                    <button type="button" onclick="resetTeacherSubmissionFilters()" class="mt-3 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition inline-flex items-center gap-1.5">
                        <i class="fas fa-rotate-left"></i> เธฅเนเธฒเธเธ•เธฑเธงเธเธฃเธญเธเธ—เธฑเนเธเธซเธกเธ”
                    </button>
                </td>
            </tr>
        `;
        if (statTotal) statTotal.textContent = '0';
        if (statFlagged) statFlagged.textContent = '0';
        if (statAvg) statAvg.textContent = '0%';
        return;
    }

    const total = filtered.length;
    const flagged = filtered.filter(d => d.is_flagged_cheating).length;
    const avg = (filtered.reduce((sum, d) => sum + Number(d.percentage || 0), 0) / total).toFixed(1);

    if (statTotal) statTotal.textContent = total;
    if (statFlagged) statFlagged.textContent = flagged;
    if (statAvg) statAvg.textContent = `${avg}%`;

    tableBody.innerHTML = filtered.map(sub => {
        const isFlagged = sub.is_flagged_cheating;
        const examTitle = sub.exam_title || sub.exam?.title || 'เธเธธเธ”เธเนเธญเธชเธญเธ';
        const courseName = sub.course_name || sub.exam?.course?.course_name || '-';
        const formattedDate = new Date(sub.graded_at).toLocaleString('th-TH');

        const classInfo = `${sub.student_year || '-'} | ${sub.student_department || '-'} | ${sub.student_room || '-'}`;

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50/70 transition">
                <td class="py-4 px-4 font-medium text-gray-800">
                    <div class="font-bold text-slate-900">${escapeHtml(sub.student_name || 'เธเธฑเธเน€เธฃเธตเธขเธ')}</div>
                    <div class="text-xs text-gray-400 font-mono">${(sub.student_id || '').slice(0, 8)}...</div>
                </td>
                <td class="py-4 px-4 text-xs font-semibold text-indigo-700">
                    <span class="px-2.5 py-1 bg-indigo-50 border border-indigo-100/60 rounded-lg">
                        ${escapeHtml(classInfo)}
                    </span>
                </td>
                <td class="py-4 px-4 text-gray-600 text-xs">
                    <div class="font-bold text-slate-800">${escapeHtml(examTitle)}</div>
                    <div class="text-[11px] text-slate-400">เธงเธดเธเธฒ: ${escapeHtml(courseName)}</div>
                </td>
                <td class="py-4 px-4 font-bold text-gray-800">
                    ${sub.total_score} / ${sub.max_score}
                    <span class="text-xs font-normal text-gray-500">(${sub.percentage}%)</span>
                </td>
                <td class="py-4 px-4 text-center">
                    <span class="px-2 py-1 rounded-lg text-xs font-semibold ${
                        sub.total_tab_switches > (sub.exam?.max_tab_switches_allowed || 3)
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                    }">
                        ${sub.total_tab_switches} เธเธฃเธฑเนเธ
                    </span>
                </td>
                <td class="py-4 px-4 text-center">
                    ${isFlagged ? `
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 inline-flex items-center gap-1">
                            <i class="fas fa-exclamation-triangle"></i> เธกเธตเธเธคเธ•เธดเธเธฃเธฃเธกเธชเธเธชเธฑเธข
                        </span>
                    ` : `
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 inline-flex items-center gap-1">
                            <i class="fas fa-check-circle"></i> เธเธเธ•เธด
                        </span>
                    `}
                </td>
                <td class="py-4 px-4 text-xs text-gray-400">${formattedDate}</td>
                <td class="py-4 px-4 text-right">
                    <button onclick="inspectStudentSubmission('${sub.student_id}', '${sub.exam_id}', '${escapeHtml(sub.student_name)}')" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium rounded-lg transition shadow-xs">
                        <i class="fas fa-search mr-1"></i> เธ•เธฃเธงเธเธเธณเธ•เธญเธ
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

window.resetTeacherSubmissionFilters = function() {
    const searchInput = document.getElementById('teacher-sub-filter-search');
    const examSelect = document.getElementById('teacher-sub-filter-exam');
    const yearSelect = document.getElementById('teacher-sub-filter-year');
    const deptSelect = document.getElementById('teacher-sub-filter-dept');
    const roomSelect = document.getElementById('teacher-sub-filter-room');

    if (searchInput) searchInput.value = '';
    if (examSelect) examSelect.value = 'เธ—เธฑเนเธเธซเธกเธ”';
    if (yearSelect) yearSelect.value = 'เธ—เธฑเนเธเธซเธกเธ”';
    if (deptSelect) deptSelect.value = 'เธ—เธฑเนเธเธซเธกเธ”';
    if (roomSelect) roomSelect.value = 'เธ—เธฑเนเธเธซเธกเธ”';

    showToast('เธฅเนเธฒเธเธ•เธฑเธงเธเธฃเธญเธเธเธฅเธชเธญเธเธ—เธฑเนเธเธซเธกเธ”เนเธฅเนเธง', 'info');
    loadTeacherSubmissions();
};

// 7.3 เธชเนเธเธญเธญเธเธเธฐเนเธเธเธเธฑเธเน€เธฃเธตเธขเธเน€เธเนเธเนเธเธฅเน Excel (.xlsx) เธ•เธฒเธกเธ•เธฑเธงเธเธฃเธญเธเธฃเธฐเธ”เธฑเธเธเธฑเนเธ/เนเธเธเธ/เธซเนเธญเธเน€เธฃเธตเธขเธ
window.exportTeacherScoresToExcel = async function() {
    if (!window.XLSX) {
        showToast('เนเธฅเธเธฃเธฒเธฃเธต SheetJS เธขเธฑเธเนเธกเนเธเธฃเนเธญเธกเนเธเนเธเธฒเธ', 'warning');
        return;
    }

    let subs = getLocalSubmissions();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('exam_results')
                .select(`
                    *,
                    exam:exams(title, duration_minutes, target_year, target_department, target_room, course:courses(course_code, course_name))
                `)
                .order('graded_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                subs = data;
            }
        } catch (err) {
            console.warn('[exportTeacherScoresToExcel] Supabase fetch skipped, using local cache:', err);
        }
    }

    if (state.currentUser?.role === 'teacher') {
        const myExamIds = (state.localExams || getLocalExams()).map(e => e.id);
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        subs = (subs || []).filter(sub => 
            myExamIds.includes(sub.exam_id) || 
            (sub.exam?.teacher_name && sub.exam.teacher_name.trim().toLowerCase() === currentTeacherName)
        );
    }

    // Apply active filters to export
    const searchVal = (document.getElementById('teacher-sub-filter-search')?.value || '').trim().toLowerCase();
    const examFilter = document.getElementById('teacher-sub-filter-exam')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const yearFilter = document.getElementById('teacher-sub-filter-year')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const deptFilter = document.getElementById('teacher-sub-filter-dept')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const roomFilter = document.getElementById('teacher-sub-filter-room')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';

    const localStudents = getLocalStudents();
    const studentRosterMap = new Map();
    localStudents.forEach(st => {
        if (st.id) studentRosterMap.set(st.id, st);
        if (st.code) studentRosterMap.set(String(st.code).toLowerCase(), st);
        if (st.citizen_id) studentRosterMap.set(String(st.citizen_id), st);
        if (st.name) studentRosterMap.set(st.name.trim().toLowerCase(), st);
    });

    let filtered = subs || [];
    if (searchVal) {
        filtered = filtered.filter(s => {
            const name = (s.student_name || '').toLowerCase();
            const id = String(s.student_id || '').toLowerCase();
            const code = String(s.student_code || s.code || '').toLowerCase();
            const citizen = String(s.student_citizen_id || s.citizen_id || '').toLowerCase();

            const linked = studentRosterMap.get(s.student_id) || 
                           studentRosterMap.get(name) || 
                           studentRosterMap.get(code) || 
                           studentRosterMap.get(citizen);

            const linkedCode = String(linked?.code || '').toLowerCase();
            const linkedCitizen = String(linked?.citizen_id || '').toLowerCase();
            const linkedName = String(linked?.name || '').toLowerCase();

            return name.includes(searchVal) || 
                   id.includes(searchVal) || 
                   code.includes(searchVal) || 
                   citizen.includes(searchVal) ||
                   linkedCode.includes(searchVal) ||
                   linkedCitizen.includes(searchVal) ||
                   linkedName.includes(searchVal);
        });
    }

    if (examFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        filtered = filtered.filter(s => s.exam_id === examFilter);
    }
    if (yearFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        const cleanTargetYear = yearFilter.replace(/\s+/g, '').toLowerCase();
        filtered = filtered.filter(s => {
            const sYear = (s.student_year || s.year || '').replace(/\s+/g, '').toLowerCase();
            const eYear = (s.exam?.target_year || '').replace(/\s+/g, '').toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lYear = (linked?.year || '').replace(/\s+/g, '').toLowerCase();

            return sYear.includes(cleanTargetYear) || eYear.includes(cleanTargetYear) || lYear.includes(cleanTargetYear);
        });
    }
    if (deptFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        const targetDept = deptFilter.trim().toLowerCase();
        filtered = filtered.filter(s => {
            const sDept = (s.student_department || s.dept || '').trim().toLowerCase();
            const eDept = (s.exam?.target_department || '').trim().toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lDept = (linked?.dept || '').trim().toLowerCase();

            return sDept.includes(targetDept) || eDept.includes(targetDept) || lDept.includes(targetDept);
        });
    }
    if (roomFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        const cleanTargetRoom = roomFilter.replace(/\s+/g, '').toLowerCase();
        filtered = filtered.filter(s => {
            const sRoom = (s.student_room || s.room || '').replace(/\s+/g, '').toLowerCase();
            const eRoom = (s.exam?.target_room || '').replace(/\s+/g, '').toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lRoom = (linked?.room || '').replace(/\s+/g, '').toLowerCase();

            return sRoom.includes(cleanTargetRoom) || eRoom.includes(cleanTargetRoom) || lRoom.includes(cleanTargetRoom);
        });
    }

    if (!filtered || filtered.length === 0) {
        showToast('เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธฅเธเธฒเธฃเธชเธญเธเธ•เธฒเธกเน€เธเธทเนเธญเธเนเธเธ—เธตเนเน€เธฅเธทเธญเธเน€เธเธทเนเธญเธชเนเธเธญเธญเธ Excel', 'warning');
        return;
    }

    const excelRows = filtered.map((d, index) => ({
        'เธฅเธณเธ”เธฑเธ': index + 1,
        'เธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ': d.student_name || 'เธเธฑเธเน€เธฃเธตเธขเธ',
        'เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ': d.student_id,
        'เธฃเธฐเธ”เธฑเธเธเธฑเนเธ/เธเธต': d.student_year || '-',
        'เนเธเธเธเธงเธดเธเธฒ/เธชเธฒเธเธฒ': d.student_department || '-',
        'เธซเนเธญเธเน€เธฃเธตเธขเธ': d.student_room || '-',
        'เธฃเธฒเธขเธงเธดเธเธฒ': d.course_name || d.exam?.course?.course_name || '-',
        'เธเธธเธ”เธเนเธญเธชเธญเธ': d.exam_title || d.exam?.title || '-',
        'เธเธฐเนเธเธเธ—เธตเนเนเธ”เน': Number(d.total_score || 0),
        'เธเธฐเนเธเธเน€เธ•เนเธก': Number(d.max_score || 0),
        'เธฃเนเธญเธขเธฅเธฐ (%)': Number(d.percentage || 0),
        'เธเธณเธเธงเธเธชเธฅเธฑเธเธซเธเนเธฒเธเธญ (เธเธฃเธฑเนเธ)': Number(d.total_tab_switches || 0),
        'เธเธณเธเธงเธเธญเธญเธเธเธฒเธเน€เธ•เนเธกเธเธญ (เธเธฃเธฑเนเธ)': Number(d.total_fullscreen_exits || 0),
        'เธชเธ–เธฒเธเธฐเธเธฒเธฃเธ•เธฃเธงเธ': d.is_flagged_cheating ? 'โ ๏ธ เธเธเธเธคเธ•เธดเธเธฃเธฃเธกเธเนเธฒเธชเธเธชเธฑเธข' : 'โ… เธเนเธฒเธเธเธฒเธฃเธ•เธฃเธงเธเธชเธญเธ',
        'เธชเธฒเน€เธซเธ•เธธเธ—เธตเนเธ•เธดเธ”เธชเธ–เธฒเธเธฐ': (d.cheating_reasons || []).join('; ') || '-',
        'เธงเธฑเธเธ—เธตเนเนเธฅเธฐเน€เธงเธฅเธฒเธ—เธตเนเธชเนเธ': new Date(d.graded_at).toLocaleString('th-TH')
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'เธฃเธฒเธขเธเธฒเธเธเธฅเธเธฐเนเธเธ');

    const dateStr = new Date().toISOString().slice(0, 10);
    let nameParts = ['เธฃเธฒเธขเธเธฒเธเธเธฅเธเธฐเนเธเธเธชเธญเธ'];
    if (yearFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') nameParts.push(yearFilter);
    if (roomFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') nameParts.push(roomFilter);
    if (deptFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') nameParts.push(deptFilter);
    nameParts.push(dateStr);

    const fileName = `${nameParts.join('_')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    showToast(`เธ”เธฒเธงเธเนเนเธซเธฅเธ”เนเธเธฅเน Excel (${filtered.length} เธฃเธฒเธขเธเธฒเธฃ) เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง!`, 'success');
};

// ==============================================================================
// 7.3.5 TEACHER STUDENT ROSTER MANAGEMENT (เธเธฑเธ”เธเธฒเธฃเธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธ & เธฃเธซเธฑเธชเธเนเธฒเธเน€เธฅเธเธเธฑเธ•เธฃ เธเธเธ.)
// ==============================================================================

let _studentExcelParsedList = [];

window.loadTeacherStudentsList = function() {
    const tbody = document.getElementById('teacher-students-table-body');
    const badgeCount = document.getElementById('teacher-students-count-badge');
    if (!tbody) return;

    let students = getLocalStudents();

    // Filters
    const searchVal = document.getElementById('teacher-student-search-input')?.value.trim().toLowerCase() || '';
    const filterYear = document.getElementById('teacher-student-filter-year')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const filterDept = document.getElementById('teacher-student-filter-dept')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
    const filterRoom = document.getElementById('teacher-student-filter-room')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';

    if (filterYear !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        students = students.filter(s => s.year === filterYear);
    }
    if (filterDept !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        students = students.filter(s => s.dept === filterDept);
    }
    if (filterRoom !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        students = students.filter(s => s.room === filterRoom);
    }
    if (searchVal) {
        students = students.filter(s => 
            (s.name && s.name.toLowerCase().includes(searchVal)) ||
            (s.code && s.code.toLowerCase().includes(searchVal)) ||
            (s.citizen_id && s.citizen_id.includes(searchVal))
        );
    }

    if (badgeCount) badgeCount.textContent = `${students.length} เธเธ`;

    if (students.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-400">
                    <i class="fas fa-user-slash text-3xl mb-2 text-slate-300"></i>
                    <p class="font-bold text-slate-600">เธขเธฑเธเนเธกเนเธกเธตเธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธเนเธเธฃเธฐเธเธ</p>
                    <p class="text-xs text-slate-400 mt-1">เธเธฅเธดเธเธเธธเนเธก "+ เน€เธเธดเนเธกเธเธฑเธเน€เธฃเธตเธขเธเธฃเธฒเธขเธเธ" เธซเธฃเธทเธญ "เธเธณเน€เธเนเธฒเธเธฒเธ Excel" เน€เธเธทเนเธญเน€เธเธดเนเธกเธฃเธฒเธขเธเธทเนเธญ</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = students.map((s, idx) => `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-slate-700">
            <td class="py-3 px-4 text-center font-bold text-slate-400">${idx + 1}</td>
            <td class="py-3 px-4 font-mono font-bold text-indigo-700">${escapeHtml(s.code || '-')}</td>
            <td class="py-3 px-4 font-bold text-slate-900">${escapeHtml(s.name || '-')}</td>
            <td class="py-3 px-4 font-mono text-slate-800 bg-slate-50/50">
                <span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 border border-indigo-100 font-semibold text-xs tracking-wider">
                    ${escapeHtml(s.citizen_id || '-')}
                </span>
            </td>
            <td class="py-3 px-4">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                    ${escapeHtml(s.year || '-')} &bull; ${escapeHtml(s.dept || '-')} &bull; ${escapeHtml(s.room || '-')}
                </span>
            </td>
            <td class="py-3 px-4 text-center text-[11px] text-slate-400">
                ${s.created_at ? new Date(s.created_at).toLocaleDateString('th-TH') : '-'}
            </td>
            <td class="py-3 px-4 text-right whitespace-nowrap">
                <button onclick="openAddStudentModal('${s.id}')" class="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition mr-1" title="เนเธเนเนเธเธเนเธญเธกเธนเธฅ">
                    <i class="fas fa-edit"></i> เนเธเนเนเธ
                </button>
                <button onclick="deleteStudent('${s.id}', '${escapeHtml(s.name)}')" class="px-2.5 py-1 text-xs font-semibold text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition" title="เธฅเธเธฃเธฒเธขเธเธทเนเธญ">
                    <i class="fas fa-trash"></i> เธฅเธ
                </button>
            </td>
        </tr>
    `).join('');
};

window.openAddStudentModal = function(studentId = null) {
    const modal = document.getElementById('modal-student-form');
    const title = document.getElementById('modal-student-form-title');
    const modeInput = document.getElementById('student-form-mode');
    const idInput = document.getElementById('student-form-id');
    const codeInput = document.getElementById('student-form-code');
    const nameInput = document.getElementById('student-form-name');
    const citizenInput = document.getElementById('student-form-citizen-id');
    const yearSelect = document.getElementById('student-form-year');
    const deptSelect = document.getElementById('student-form-dept');
    const roomSelect = document.getElementById('student-form-room');

    if (!modal) return;

    if (studentId) {
        const students = getLocalStudents();
        const student = students.find(s => s.id === studentId);
        if (student) {
            if (title) title.innerHTML = '<i class="fas fa-user-pen text-indigo-600"></i> เนเธเนเนเธเธเนเธญเธกเธนเธฅเธเธฑเธเน€เธฃเธตเธขเธ';
            if (modeInput) modeInput.value = 'edit';
            if (idInput) idInput.value = student.id;
            if (codeInput) codeInput.value = student.code || '';
            if (nameInput) nameInput.value = student.name || '';
            if (citizenInput) citizenInput.value = student.citizen_id || '';
            if (yearSelect) yearSelect.value = student.year || 'เธเธงเธ.2';
            if (deptSelect) deptSelect.value = student.dept || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ';
            if (roomSelect) roomSelect.value = student.room || 'เธซเนเธญเธ 1';
        }
    } else {
        if (title) title.innerHTML = '<i class="fas fa-user-plus text-indigo-600"></i> เน€เธเธดเนเธกเธเนเธญเธกเธนเธฅเธเธฑเธเน€เธฃเธตเธขเธเนเธซเธกเน';
        if (modeInput) modeInput.value = 'create';
        if (idInput) idInput.value = '';
        if (codeInput) codeInput.value = '';
        if (nameInput) nameInput.value = '';
        if (citizenInput) citizenInput.value = '';
        if (yearSelect) yearSelect.value = 'เธเธงเธ.2';
        if (deptSelect) deptSelect.value = 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ';
        if (roomSelect) roomSelect.value = 'เธซเนเธญเธ 1';
    }

    modal.classList.remove('hidden');
};

window.closeStudentModal = function() {
    const modal = document.getElementById('modal-student-form');
    if (modal) modal.classList.add('hidden');
};

window.saveStudentFromForm = function(event) {
    event.preventDefault();
    const mode = document.getElementById('student-form-mode')?.value || 'create';
    const id = document.getElementById('student-form-id')?.value || generatePseudoUUID();
    const code = document.getElementById('student-form-code')?.value.trim();
    const name = document.getElementById('student-form-name')?.value.trim();
    const citizenId = document.getElementById('student-form-citizen-id')?.value.trim();
    const year = document.getElementById('student-form-year')?.value || 'เธเธงเธ.2';
    const dept = document.getElementById('student-form-dept')?.value || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ';
    const room = document.getElementById('student-form-room')?.value || 'เธซเนเธญเธ 1';

    if (!code || !name) {
        showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธเนเธฅเธฐเธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ', 'warning');
        return;
    }

    if (!citizenId || citizenId.length !== 13 || isNaN(citizenId)) {
        showCustomAlert({
            title: 'เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
            message: 'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธณเธ•เธฑเธงเธเธฃเธฐเธเธฒเธเธเนเธซเนเธเธฃเธ 13 เธซเธฅเธฑเธเธ•เธฑเธงเน€เธฅเธ\n(เนเธเนเน€เธเนเธเธฃเธซเธฑเธชเธเนเธฒเธเน€เธเนเธฒเธชเธญเธเธเธญเธเธเธฑเธเน€เธฃเธตเธขเธ)',
            icon: 'fas fa-id-card'
        });
        return;
    }

    // Check duplicate code or citizen_id in create mode
    const allStudents = getLocalStudents();
    if (mode === 'create') {
        const existCode = allStudents.find(s => s.code === code);
        if (existCode) {
            showCustomAlert({
                title: 'เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธเธเนเธณ',
                message: `เธกเธตเธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ "${code}" (${existCode.name}) เธญเธขเธนเนเนเธเธฃเธฐเธเธเนเธฅเนเธง`,
                icon: 'fas fa-triangle-exclamation'
            });
            return;
        }
        const existCitizen = allStudents.find(s => s.citizen_id === citizenId);
        if (existCitizen) {
            showCustomAlert({
                title: 'เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธเธเนเธณ',
                message: `เธกเธตเน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ "${citizenId}" (${existCitizen.name}) เธญเธขเธนเนเนเธเธฃเธฐเธเธเนเธฅเนเธง`,
                icon: 'fas fa-triangle-exclamation'
            });
            return;
        }
    }

    const studentObj = {
        id: id,
        code: code,
        name: name,
        citizen_id: citizenId,
        year: year,
        dept: dept,
        room: room
    };

    saveLocalStudent(studentObj);
    showToast(`เธเธฑเธเธ—เธถเธเธเนเธญเธกเธนเธฅเธเธฑเธเน€เธฃเธตเธขเธ "${name}" เธชเธณเน€เธฃเนเธ`, 'success');
    closeStudentModal();
    loadTeacherStudentsList();
};

window.deleteStudent = function(studentId, studentName) {
    showCustomConfirm({
        title: 'เธขเธทเธเธขเธฑเธเธเธฒเธฃเธฅเธเธเธฑเธเน€เธฃเธตเธขเธ',
        message: `เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธฅเธเธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธ "${studentName}" เธซเธฃเธทเธญเนเธกเน?\n(เธเนเธญเธกเธนเธฅเธเธฐเนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธเธนเนเธเธทเธเนเธ”เน)`,
        icon: 'fas fa-user-xmark',
        confirmText: 'เธฅเธเธฃเธฒเธขเธเธทเนเธญ',
        cancelText: 'เธขเธเน€เธฅเธดเธ',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: () => {
            deleteLocalStudent(studentId);
            showToast(`เธฅเธเธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธ "${studentName}" เนเธฅเนเธง`, 'info');
            loadTeacherStudentsList();
        }
    });
};

// Excel Template & Import for Students
window.downloadStudentExcelTemplate = function() {
    if (!window.XLSX) {
        showToast('เนเธฅเธเธฃเธฒเธฃเธต SheetJS เธขเธฑเธเนเธกเนเธเธฃเนเธญเธกเนเธเนเธเธฒเธ', 'warning');
        return;
    }

    const templateData = [
        {
            'เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ': '66209010001',
            'เธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ': 'เธเธฒเธขเธชเธกเธเธฒเธข เธฃเธฑเธเน€เธฃเธตเธขเธ',
            'เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ13เธซเธฅเธฑเธ': '1103701234567',
            'เธฃเธฐเธ”เธฑเธเธเธฑเนเธ': 'เธเธงเธ.2',
            'เนเธเธเธเธงเธดเธเธฒ': 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ',
            'เธซเนเธญเธเน€เธฃเธตเธขเธ': 'เธซเนเธญเธ 1'
        },
        {
            'เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ': '66209010002',
            'เธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ': 'เธเธฒเธเธชเธฒเธงเธชเธกเธซเธเธดเธ เนเธเธ”เธต',
            'เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ13เธซเธฅเธฑเธ': '1103701234568',
            'เธฃเธฐเธ”เธฑเธเธเธฑเนเธ': 'เธเธงเธ.2',
            'เนเธเธเธเธงเธดเธเธฒ': 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ',
            'เธซเนเธญเธเน€เธฃเธตเธขเธ': 'เธซเนเธญเธ 1'
        },
        {
            'เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ': '66209010003',
            'เธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ': 'เธเธฒเธขเธเธเธเธคเธ• เธกเธธเนเธเธกเธฑเนเธ',
            'เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ13เธซเธฅเธฑเธ': '1103701234569',
            'เธฃเธฐเธ”เธฑเธเธเธฑเนเธ': 'เธเธงเธ.2',
            'เนเธเธเธเธงเธดเธเธฒ': 'เธเธฒเธฃเธเธฑเธเธเธต',
            'เธซเนเธญเธเน€เธฃเธตเธขเธ': 'เธซเนเธญเธ 2'
        }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'เธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธ');

    XLSX.writeFile(workbook, 'เนเธเธเธเธญเธฃเนเธกเธเธณเน€เธเนเธฒเธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธ_เธงเธฑเธเนเธเธฅเธเธฑเธเธงเธฅ.xlsx');
    showToast('เธ”เธฒเธงเธเนเนเธซเธฅเธ”เน€เธ—เธกเน€เธเธฅเธ• Excel เธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธเนเธฅเนเธง', 'success');
};

window.openStudentExcelImportModal = function() {
    clearStudentExcelPreview();
    const modal = document.getElementById('modal-student-excel-import');
    if (modal) modal.classList.remove('hidden');
};

window.handleStudentExcelUpload = function(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            if (!rows || rows.length === 0) {
                showCustomAlert({
                    title: 'เนเธกเนเธเธเธเนเธญเธกเธนเธฅเนเธเนเธเธฅเน',
                    message: 'เนเธกเนเธเธเธเนเธญเธกเธนเธฅเนเธเนเธเธฅเน Excel เธซเธฃเธทเธญเธฃเธนเธเนเธเธเธ•เธฒเธฃเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                    icon: 'fas fa-triangle-exclamation'
                });
                return;
            }

            _studentExcelParsedList = rows.map((r, idx) => {
                const code = String(r['เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ'] || r['student_id'] || r['code'] || r['ID'] || '').trim();
                const name = String(r['เธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ'] || r['เธเธทเนเธญ'] || r['name'] || r['student_name'] || '').trim();
                const citizenId = String(r['เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ13เธซเธฅเธฑเธ'] || r['เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ'] || r['citizen_id'] || r['id_card'] || '').replace(/[^0-9]/g, '').trim();
                const year = String(r['เธฃเธฐเธ”เธฑเธเธเธฑเนเธ'] || r['year'] || r['class'] || 'เธเธงเธ.2').trim();
                const dept = String(r['เนเธเธเธเธงเธดเธเธฒ'] || r['เนเธเธเธ'] || r['dept'] || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ').trim();
                const room = String(r['เธซเนเธญเธเน€เธฃเธตเธขเธ'] || r['เธซเนเธญเธ'] || r['room'] || 'เธซเนเธญเธ 1').trim();

                return {
                    id: generatePseudoUUID(),
                    code,
                    name,
                    citizen_id: citizenId,
                    year,
                    dept,
                    room,
                    created_at: new Date().toISOString()
                };
            }).filter(s => s.code && s.name && s.citizen_id.length === 13);

            if (_studentExcelParsedList.length === 0) {
                showCustomAlert({
                    title: 'เธเนเธญเธกเธนเธฅเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                    message: 'เนเธกเนเธเธเธฃเธฒเธขเธเธทเนเธญเธ—เธตเนเธชเธกเธเธนเธฃเธ“เน เธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธชเธญเธเธงเนเธฒเธกเธตเธเธญเธฅเธฑเธกเธเน "เธฃเธซเธฑเธชเธเธฑเธเน€เธฃเธตเธขเธ", "เธเธทเนเธญ-เธเธฒเธกเธชเธเธธเธฅ", เนเธฅเธฐ "เน€เธฅเธเธเธฑเธ•เธฃเธเธฃเธฐเธเธฒเธเธ13เธซเธฅเธฑเธ" (13 เธซเธฅเธฑเธ) เธเธฃเธเธ–เนเธงเธเธ•เธฒเธกเธ•เธฑเธงเธญเธขเนเธฒเธเน€เธ—เธกเน€เธเธฅเธ•',
                    icon: 'fas fa-triangle-exclamation'
                });
                return;
            }

            const previewContainer = document.getElementById('student-excel-preview-container');
            const previewTbody = document.getElementById('student-excel-preview-tbody');
            const previewCount = document.getElementById('student-excel-preview-count');

            if (previewCount) previewCount.textContent = _studentExcelParsedList.length;
            if (previewTbody) {
                previewTbody.innerHTML = _studentExcelParsedList.map((s, idx) => `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2 font-bold">${idx + 1}</td>
                        <td class="p-2 font-mono font-bold text-indigo-700">${escapeHtml(s.code)}</td>
                        <td class="p-2 font-bold text-slate-800">${escapeHtml(s.name)}</td>
                        <td class="p-2 font-mono text-slate-600">${escapeHtml(s.citizen_id)}</td>
                        <td class="p-2 text-[11px] text-slate-500">${escapeHtml(s.year)} | ${escapeHtml(s.dept)} | ${escapeHtml(s.room)}</td>
                    </tr>
                `).join('');
            }

            if (previewContainer) previewContainer.classList.remove('hidden');
            showToast(`เธญเนเธฒเธเนเธเธฅเนเธชเธณเน€เธฃเนเธ เธเธเธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธ ${_studentExcelParsedList.length} เธเธ`, 'info');

        } catch (err) {
            showToast('เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธญเนเธฒเธเนเธเธฅเน: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
};

window.clearStudentExcelPreview = function() {
    _studentExcelParsedList = [];
    const fileInput = document.getElementById('student-excel-file-input');
    if (fileInput) fileInput.value = '';
    const previewContainer = document.getElementById('student-excel-preview-container');
    if (previewContainer) previewContainer.classList.add('hidden');
};

window.executeStudentExcelImport = function() {
    if (!_studentExcelParsedList || _studentExcelParsedList.length === 0) {
        showToast('เนเธกเนเธกเธตเธเนเธญเธกเธนเธฅเธเธฑเธเน€เธฃเธตเธขเธเธ—เธตเนเธเธฐเธเธณเน€เธเนเธฒ', 'warning');
        return;
    }

    _studentExcelParsedList.forEach(s => {
        saveLocalStudent(s);
    });

    showToast(`เธเธณเน€เธเนเธฒเธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธเธชเธณเน€เธฃเนเธ ${_studentExcelParsedList.length} เธเธ!`, 'success');
    const modal = document.getElementById('modal-student-excel-import');
    if (modal) modal.classList.add('hidden');
    clearStudentExcelPreview();
    loadTeacherStudentsList();
};

// 7.4 เธ”เธฒเธงเธเนเนเธซเธฅเธ”เนเธเธฅเนเน€เธ—เธกเน€เธเธฅเธ• Excel เธชเธณเธซเธฃเธฑเธเน€เธเธดเนเธกเนเธเธ—เธขเน
window.downloadExcelQuestionTemplate = function() {
    if (!window.XLSX) {
        showToast('เนเธฅเธเธฃเธฒเธฃเธต SheetJS เธขเธฑเธเนเธกเนเธเธฃเนเธญเธกเนเธเนเธเธฒเธ', 'warning');
        return;
    }

    const templateData = [
        {
            'เนเธเธ—เธขเนเธเธณเธ–เธฒเธก': 'เธเนเธญเนเธ”เธเธทเธญเนเธเธฃเนเธ•เธเธญเธฅเธเธงเธฒเธกเธเธฅเธญเธ”เธ เธฑเธขเธชเธณเธซเธฃเธฑเธเธเธฒเธฃเธชเนเธเธเนเธญเธกเธนเธฅเธเนเธฒเธเน€เธงเนเธ?',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ A': 'HTTP',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ B': 'FTP',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ C': 'HTTPS',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ D': 'SMTP',
            'เน€เธเธฅเธขเธ—เธตเนเธ–เธนเธเธ•เนเธญเธ (A/B/C/D)': 'C',
            'เธเธฐเนเธเธ': 2.0,
            'เธเธณเธญเธเธดเธเธฒเธขเน€เธเธฅเธข': 'HTTPS เธกเธตเธเธฒเธฃเน€เธเนเธฒเธฃเธซเธฑเธชเธเนเธญเธกเธนเธฅเธเนเธฒเธ TLS/SSL เธเธฅเธญเธ”เธ เธฑเธขเธ—เธตเนเธชเธธเธ”'
        },
        {
            'เนเธเธ—เธขเนเธเธณเธ–เธฒเธก': 'เธเธฑเธเธเนเธเธฑเธเธซเธฅเธฑเธเธเธญเธ CPU เนเธเน€เธเธฃเธทเนเธญเธเธเธญเธกเธเธดเธงเน€เธ•เธญเธฃเนเธเธทเธญเธญเธฐเนเธฃ?',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ A': 'เธเธฃเธฐเธกเธงเธฅเธเธฅเธเธณเธชเธฑเนเธเนเธฅเธฐเธเนเธญเธกเธนเธฅ',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ B': 'เธเนเธฒเธขเธเธฃเธฐเนเธชเนเธเธเนเธฒ',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ C': 'เธฃเธฐเธเธฒเธขเธเธงเธฒเธกเธฃเนเธญเธ',
            'เธ•เธฑเธงเน€เธฅเธทเธญเธ D': 'เนเธชเธ”เธเธเธฅเธ—เธฒเธเธเธญเธ เธฒเธ',
            'เน€เธเธฅเธขเธ—เธตเนเธ–เธนเธเธ•เนเธญเธ (A/B/C/D)': 'A',
            'เธเธฐเนเธเธ': 1.0,
            'เธเธณเธญเธเธดเธเธฒเธขเน€เธเธฅเธข': 'CPU (Central Processing Unit) เธ—เธณเธซเธเนเธฒเธ—เธตเนเน€เธเนเธเธชเธกเธญเธเนเธเธเธฒเธฃเธเธฃเธฐเธกเธงเธฅเธเธฅเธเธณเธชเธฑเนเธ'
        }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'เน€เธ—เธกเน€เธเธฅเธ•เธเนเธญเธชเธญเธ');

    XLSX.writeFile(workbook, 'เนเธเธเธเธญเธฃเนเธกเธเธณเน€เธเนเธฒเธเนเธญเธชเธญเธ_เธงเธฑเธเนเธเธฅเธเธฑเธเธงเธฅ.xlsx');
    showToast('เธ”เธฒเธงเธเนเนเธซเธฅเธ”เนเธเธฅเนเน€เธ—เธกเน€เธเธฅเธ• Excel เนเธฅเนเธง เธเธฃเธธเธ“เธฒเธเธฃเธญเธเนเธเธ—เธขเนเธ•เธฒเธกเธ•เธฑเธงเธญเธขเนเธฒเธ', 'success');
};

// 7.5 เธเธฑเธ”เธเธฒเธฃเนเธเธฅเน Excel เธ—เธตเนเธญเธฑเธเนเธซเธฅเธ” (Import)
window.handleExcelFileUpload = function(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            if (!rows || rows.length === 0) {
                showCustomAlert({
                    title: 'เนเธกเนเธเธเธเนเธญเธกเธนเธฅเนเธเนเธเธฅเน',
                    message: 'เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเนเธญเธชเธญเธเนเธเนเธเธฅเน Excel เธซเธฃเธทเธญเธฃเธนเธเนเธเธเธ•เธฒเธฃเธฒเธเนเธกเนเธ–เธนเธเธ•เนเธญเธ',
                    icon: 'fas fa-triangle-exclamation'
                });
                return;
            }

            state.excelParsedQuestions = rows.map((r, idx) => {
                const qText = r['เนเธเธ—เธขเนเธเธณเธ–เธฒเธก'] || r['question'] || r['Question'] || '';
                const optA = r['เธ•เธฑเธงเน€เธฅเธทเธญเธ A'] || r['option_a'] || r['A'] || '';
                const optB = r['เธ•เธฑเธงเน€เธฅเธทเธญเธ B'] || r['option_b'] || r['B'] || '';
                const optC = r['เธ•เธฑเธงเน€เธฅเธทเธญเธ C'] || r['option_c'] || r['C'] || '';
                const optD = r['เธ•เธฑเธงเน€เธฅเธทเธญเธ D'] || r['option_d'] || r['D'] || '';
                const correct = (r['เน€เธเธฅเธขเธ—เธตเนเธ–เธนเธเธ•เนเธญเธ (A/B/C/D)'] || r['correct'] || r['Answer'] || 'A').toString().trim().toUpperCase();
                const points = Number(r['เธเธฐเนเธเธ'] || r['points'] || 1.0);
                const explanation = r['เธเธณเธญเธเธดเธเธฒเธขเน€เธเธฅเธข'] || r['explanation'] || '';

                return {
                    order: idx + 1,
                    questionText: qText,
                    optA,
                    optB,
                    optC,
                    optD,
                    correct,
                    points,
                    explanation
                };
            }).filter(q => q.questionText && q.optA && q.optB);

            if (state.excelParsedQuestions.length === 0) {
                showCustomAlert({
                    title: 'เธเนเธญเธกเธนเธฅเนเธกเนเธเธฃเธเธ–เนเธงเธ',
                    message: 'เธเธฃเธธเธ“เธฒเธ•เธฃเธงเธเธชเธญเธเธงเนเธฒเธกเธตเธเธญเธฅเธฑเธกเธเน "เนเธเธ—เธขเนเธเธณเธ–เธฒเธก", "เธ•เธฑเธงเน€เธฅเธทเธญเธ A", เนเธฅเธฐ "เธ•เธฑเธงเน€เธฅเธทเธญเธ B" เธเธฃเธเธ–เนเธงเธเธ•เธฒเธกเธ•เธฑเธงเธญเธขเนเธฒเธเน€เธ—เธกเน€เธเธฅเธ•',
                    icon: 'fas fa-triangle-exclamation'
                });
                return;
            }

            const previewContainer = document.getElementById('excel-preview-container');
            const previewTbody = document.getElementById('excel-preview-tbody');
            const previewCount = document.getElementById('excel-preview-count');

            if (previewCount) previewCount.textContent = state.excelParsedQuestions.length;
            if (previewTbody) {
                previewTbody.innerHTML = state.excelParsedQuestions.map(q => `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2.5 font-bold">${q.order}</td>
                        <td class="p-2.5 max-w-xs truncate">${escapeHtml(q.questionText)}</td>
                        <td class="p-2.5 text-[11px] text-slate-500">
                            A: ${escapeHtml(q.optA)} | B: ${escapeHtml(q.optB)}
                            ${q.optC ? ` | C: ${escapeHtml(q.optC)}` : ''}
                            ${q.optD ? ` | D: ${escapeHtml(q.optD)}` : ''}
                        </td>
                        <td class="p-2.5 text-center font-bold text-emerald-700">${q.correct}</td>
                        <td class="p-2.5 text-center">${q.points}</td>
                    </tr>
                `).join('');
            }

            if (previewContainer) previewContainer.classList.remove('hidden');
            showToast(`เธญเนเธฒเธเนเธเธฅเนเธชเธณเน€เธฃเนเธ เธเธเธเนเธญเธชเธญเธ ${state.excelParsedQuestions.length} เธเนเธญ`, 'info');

        } catch (err) {
            showToast('เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธญเนเธฒเธเนเธเธฅเน Excel: ' + err.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
};

window.clearExcelPreview = function() {
    state.excelParsedQuestions = [];
    document.getElementById('excel-file-input').value = '';
    const previewContainer = document.getElementById('excel-preview-container');
    if (previewContainer) previewContainer.classList.add('hidden');
};

// 7.6 เธเธณเน€เธเนเธฒเนเธเธ—เธขเนเน€เธเนเธฒเธชเธนเนเธเธฒเธเธเนเธญเธกเธนเธฅ Supabase
window.executeExcelImport = async function() {
    let examId = document.getElementById('excel-target-exam-select').value;
    
    // Auto-fallback: if examId is empty, try to grab the first non-empty option
    if (!examId) {
        const select = document.getElementById('excel-target-exam-select');
        if (select && select.options.length > 0) {
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value) {
                    select.selectedIndex = i;
                    examId = select.options[i].value;
                    break;
                }
            }
        }
    }

    if (!examId) {
        showToast('กรุณาเลือกชุดข้อสอบที่จะนำเข้า', 'warning');
        return;
    }
    if (!state.excelParsedQuestions || state.excelParsedQuestions.length === 0) {
        showToast('ไม่มีข้อมูลข้อสอบที่จะนำเข้า', 'warning');
        return;
    }

    const totalQ = state.excelParsedQuestions.length;
    const loadingModal = document.getElementById('modal-loading');
    if (loadingModal) {
        document.getElementById('loading-modal-title').textContent = 'กำลังนำเข้าข้อสอบ...';
        document.getElementById('loading-modal-desc').textContent = `กำลังบันทึก ${totalQ} ข้อลงฐานข้อมูลอย่างปลอดภัย`;
        loadingModal.classList.remove('hidden');
    }

    let successCount = 0;
    let failedRows = [];

    try {
        for (let idx = 0; idx < state.excelParsedQuestions.length; idx++) {
            const q = state.excelParsedQuestions[idx];
            const options = [{ id: 'A', text: q.optA }, { id: 'B', text: q.optB }];
            if (q.optC) options.push({ id: 'C', text: q.optC });
            if (q.optD) options.push({ id: 'D', text: q.optD });

            // อัปเดต progress
            if (loadingModal) {
                document.getElementById('loading-modal-desc').textContent =
                    `กำลังบันทึกข้อ ${idx + 1}/${totalQ}...`;
            }

            // Local storage (ไม่มีเฉลยเก็บ — local ใช้แค่ preview)
            const localQ = {
                id: generatePseudoUUID(),
                exam_id: examId,
                question_text: q.questionText,
                options: options,
                correct: q.correct,
                points: Number(q.points) || 1.0,
                explanation: q.explanation || '',
                order_seq: idx + 1
            };
            saveLocalQuestion(localQ);

            // Supabase: ใช้ RPC ที่ insert ทั้ง questions + exam_answers พร้อมกัน
            if (isSupabaseConfigured() && state.supabaseClient) {
                const { data, error } = await state.supabaseClient.rpc('create_question_with_answer', {
                    p_exam_id: examId,
                    p_question_text: q.questionText,
                    p_options: options,
                    p_points: Number(q.points) || 1.0,
                    p_correct_option_id: q.correct,
                    p_explanation: q.explanation || '',
                    p_order_seq: idx + 1
                });
                if (error) {
                    failedRows.push({ order: idx + 1, error: error.message });
                    console.warn(`[Excel Import] ข้อ ${idx + 1} fail:`, error.message);
                } else {
                    successCount++;
                }
            } else {
                successCount++;
            }
        }

        if (loadingModal) loadingModal.classList.add('hidden');

        const failMsg = failedRows.length > 0
            ? `\n\n⚠️ บันทึกไม่สำเร็จ ${failedRows.length} ข้อ:\nข้อ ${failedRows.map(f => f.order).join(', ')}\n\nError: ${failedRows[0].error}`
            : '';

        showCustomAlert({
            title: failedRows.length === 0 ? 'นำเข้าสำเร็จ!' : 'นำเข้าบางส่วน',
            message: `${failedRows.length === 0 ? '🎉' : '⚠️'} บันทึกข้อสอบสำเร็จ ${successCount}/${totalQ} ข้อ${failMsg}`,
            icon: failedRows.length === 0 ? 'fas fa-check-circle' : 'fas fa-triangle-exclamation'
        });

        clearExcelPreview();
        document.getElementById('teacher-tab-btn-exams').click();

    } catch (err) {
        if (loadingModal) loadingModal.classList.add('hidden');
        showToast('เกิดข้อผิดพลาดในการนำเข้า: ' + err.message, 'error');
    }
};

function setupExcelDragDrop() {
    const dropZone = document.getElementById('excel-drop-zone');
    if (!dropZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });
    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files[0]) {
            handleExcelFileUpload({ target: { files: files } });
        }
    }, false);
}

// 7.7 เธ•เธฃเธงเธเธเธณเธ•เธญเธเธเธฑเธเน€เธฃเธตเธขเธเธ—เธตเธฅเธฐเธเนเธญ (Inspection Modal)
// 7.2.2 เธญเธฒเธเธฒเธฃเธขเนเธเธฅเธ”เธฅเนเธญเธเนเธซเนเธเธฑเธเน€เธฃเธตเธขเธเธ—เธณเธเนเธญเธชเธญเธเนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธ (เธฅเนเธฒเธเธเธฅเธชเธญเธเน€เธ”เธดเธกเนเธฅเธฐเน€เธเธดเธ”เธชเธดเธ—เธเธดเน)
window.allowStudentRetake = function(subId, studentId, examId, studentName, examTitle) {
    // เธฃเธญเธเธฃเธฑเธเธเธฒเธฃเน€เธฃเธตเธขเธเนเธเธ 4 เธเธฒเธฃเธฒเธกเธดเน€เธ•เธญเธฃเนเน€เธ”เธดเธก (studentId, examId, studentName, examTitle)
    if (!examTitle && studentName && examId) {
        examTitle = studentName;
        studentName = examId;
        examId = studentId;
        studentId = subId;
        subId = null;
    }

    showCustomConfirm({
        title: 'เธเธฅเธ”เธฅเนเธญเธเนเธซเนเน€เธเนเธฒเธ—เธณเธเนเธญเธชเธญเธเนเธซเธกเน',
        message: `เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธฅเนเธฒเธเธเธฅเธชเธญเธเน€เธ”เธดเธกเนเธฅเธฐเธญเธเธธเธเธฒเธ•เนเธซเนเธเธฑเธเน€เธฃเธตเธขเธ "${studentName}" เน€เธเนเธฒเธ—เธณเธเนเธญเธชเธญเธเธเธธเธ” "${examTitle}" เนเธซเธกเนเธญเธตเธเธเธฃเธฑเนเธเนเธเนเธซเธฃเธทเธญเนเธกเน?`,
        icon: 'fas fa-rotate-left text-amber-500',
        confirmText: 'เธเธฅเธ”เธฅเนเธญเธเนเธซเนเธชเธญเธเนเธซเธกเน',
        cancelText: 'เธขเธเน€เธฅเธดเธ',
        confirmClass: 'bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-100',
        onConfirm: async () => {
            // 1. เธฅเธเธเธฒเธ Local Storage เธเธญเธเธเธฃเธน
            const subs = getLocalSubmissions();
            const cleanName = (studentName || '').trim().toLowerCase();
            const updatedSubs = subs.filter(s => !(s.exam_id === examId && (s.student_id === studentId || (s.student_name && s.student_name.trim().toLowerCase() === cleanName))));
            localStorage.setItem('EXAM_LOCAL_SUBMISSIONS', JSON.stringify(updatedSubs));

            // 2. เธฅเธเธเธฒเธ Supabase Cloud เนเธเธเนเธขเธเธเธณเธชเธฑเนเธ เธเนเธญเธเธเธฑเธ syntax error เธเธฒเธเธเนเธญเธเธงเนเธฒเธเนเธเธเธทเนเธญเธซเธฃเธทเธญ UUID error
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    // เธฅเธเธเธฒเธ exam_results เธ”เนเธงเธข Primary Key ID เนเธ”เธขเธ•เธฃเธ (100% เนเธเนเธเธญเธ)
                    if (subId && isValidUUID(subId)) {
                        await state.supabaseClient
                            .from('exam_results')
                            .delete()
                            .eq('id', subId);
                    }

                    // เธฅเธเธเธฒเธ exam_results เธ”เนเธงเธข student_id (เธ–เนเธฒเน€เธเนเธ UUID)
                    if (isValidUUID(studentId)) {
                        await state.supabaseClient
                            .from('exam_results')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_id', studentId);
                    }

                    // เธฅเธเธเธฒเธ exam_results เธ”เนเธงเธข student_name
                    if (studentName) {
                        await state.supabaseClient
                            .from('exam_results')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_name', studentName);
                    }

                    // เธฅเธเธเธฒเธ student_submissions เธ”เนเธงเธข student_id (เธ–เนเธฒเน€เธเนเธ UUID)
                    if (isValidUUID(studentId)) {
                        await state.supabaseClient
                            .from('student_submissions')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_id', studentId);
                    }

                    // เธฅเธเธเธฒเธ student_submissions เธ”เนเธงเธข student_name
                    if (studentName) {
                        await state.supabaseClient
                            .from('student_submissions')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_name', studentName);
                    }

                    // เธฅเธเธเธฒเธ anti_cheat_logs
                    if (isValidUUID(studentId)) {
                        await state.supabaseClient
                            .from('anti_cheat_logs')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_id', studentId);
                    }
                } catch (err) {
                    console.warn('[allowStudentRetake] Remote delete warning:', err);
                }
            }

            // 3. เธชเนเธเธชเธฑเธเธเธฒเธ“ Realtime เน€เธเธทเนเธญเธเธฅเธ”เธฅเนเธญเธเนเธเน€เธเธฃเธทเนเธญเธเธเธฑเธเน€เธฃเธตเธขเธเธ—เธฑเธเธ—เธต
            broadcastAppEvent('student_retake_unlocked', {
                studentId: studentId,
                examId: examId,
                studentName: studentName
            });

            showToast(`เธเธฅเธ”เธฅเนเธญเธเนเธซเนเธเธฑเธเน€เธฃเธตเธขเธ "${studentName}" เน€เธเนเธฒเธ—เธณเธเนเธญเธชเธญเธเนเธซเธกเนเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง!`, 'success');
            await loadTeacherSubmissions();

            const unlockModal = document.getElementById('modal-exam-submissions-unlock');
            if (unlockModal && !unlockModal.classList.contains('hidden')) {
                await openExamSubmissionsUnlockModal(examId);
            }

            // เธเธดเธ” modal เธ•เธฃเธงเธเธเธณเธ•เธญเธเธ–เนเธฒเน€เธเธดเธ”เธญเธขเธนเน
            closeInspectModal();
        }
    });
};

window.inspectStudentSubmission = async function(studentId, examId, studentName) {
    const modal = document.getElementById('modal-inspect');
    const container = document.getElementById('inspect-content');
    const nameEl = document.getElementById('inspect-student-name');

    if (nameEl) nameEl.textContent = `เธฃเธฒเธขเธเธฒเธเธเธฒเธฃเธ•เธฃเธงเธ: ${studentName}`;
    if (modal) modal.classList.remove('hidden');

    if (container) {
        container.innerHTML = `
            <div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-emerald-500 mb-2"></i><p class="text-gray-500 text-sm">เธเธณเธฅเธฑเธเธ”เธถเธเธเนเธญเธกเธนเธฅเธเธณเธ•เธญเธเนเธฅเธฐเน€เธเธฅเธขเธฅเธฑเธ...</p></div>
        `;
    }

    try {
        let summary = {};
        let questions = [];

        if (isSupabaseConfigured() && state.supabaseClient) {
            try {
                const { data, error } = await state.supabaseClient.rpc('get_admin_student_detail', {
                    p_student_id: studentId,
                    p_exam_id: examId
                });

                if (!error && data) {
                    summary = data.summary || {};
                    questions = data.questions_breakdown || [];
                }
            } catch (e) {}
        }

        if (questions.length === 0) {
            // Local fallback
            const localSub = getLocalSubmissions().find(s => s.student_id === studentId && s.exam_id === examId);
            summary = localSub || {
                total_score: 0,
                max_score: 0,
                percentage: 0,
                total_tab_switches: 0,
                is_flagged_cheating: false
            };
            const localQuestions = getLocalQuestions(examId);
            questions = localQuestions.map(q => ({
                question_text: q.question_text,
                points: q.points || 1,
                is_correct: true,
                student_selected: q.correct || 'A',
                correct_answer: q.correct || 'A',
                explanation: q.explanation || ''
            }));
        }

        container.innerHTML = `
            <div class="bg-gray-50 rounded-xl p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span class="text-gray-400 block text-xs">เธเธฐเนเธเธเธฃเธงเธก:</span><span class="text-lg font-bold text-gray-800">${summary.total_score || 0} / ${summary.max_score || 0}</span></div>
                <div><span class="text-gray-400 block text-xs">เธเธดเธ”เน€เธเนเธ:</span><span class="text-lg font-bold text-emerald-600">${summary.percentage || 0}%</span></div>
                <div><span class="text-gray-400 block text-xs">เธชเธฅเธฑเธเธซเธเนเธฒเธเธญเธฃเธงเธก:</span><span class="text-lg font-bold text-amber-600">${summary.total_tab_switches || 0} เธเธฃเธฑเนเธ</span></div>
                <div><span class="text-gray-400 block text-xs">เธชเธ–เธฒเธเธฐ Anti-Cheat:</span><span class="text-xs font-bold px-2 py-1 rounded-full ${summary.is_flagged_cheating ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${summary.is_flagged_cheating ? 'โ ๏ธ เธชเธเธชเธฑเธขเธ—เธธเธเธฃเธดเธ•' : 'โ… เธเธเธ•เธด'}</span></div>
            </div>

            <h4 class="font-bold text-gray-800 mb-4 text-sm flex items-center gap-2">
                <i class="fas fa-list-check text-emerald-500"></i> เธฃเธฒเธขเธฅเธฐเน€เธญเธตเธขเธ”เธเธณเธ•เธญเธ (${questions.length} เธเนเธญ):
            </h4>

            <div class="space-y-4">
                ${questions.map((q, idx) => {
    const isCorrect = q.is_correct;
    const parsed = parseQuestionTextAndImage(q.question_text, q.image_url || q.image);
    return `
        <div class="p-4 rounded-xl border ${isCorrect ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}">
            <div class="flex items-center justify-between mb-2">
                <span class="font-bold text-sm text-gray-800">เธเนเธญเธ—เธตเน ${idx + 1}: ${escapeHtml(parsed.text || (parsed.image ? '(เธเนเธญเธชเธญเธเนเธเธเธฃเธนเธเธ เธฒเธ)' : ''))}</span>
                <span class="text-xs font-bold px-2 py-0.5 rounded ${isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    ${isCorrect ? `+${q.points} เธเธฐเนเธเธ (เธ–เธนเธ)` : '0 เธเธฐเนเธเธ (เธเธดเธ”)'}
                </span>
            </div>
            ${parsed.image ? `
                <div class="mb-3 p-2 bg-white rounded-xl border border-gray-200 inline-block">
                    <img src="${parsed.image}" alt="เธฃเธนเธเธ เธฒเธเนเธเธ—เธขเน" class="max-h-48 max-w-full object-contain rounded-lg cursor-pointer hover:opacity-90 transition" onclick="openImageZoomModal('${parsed.image}')">
                    <div class="text-[10px] text-gray-400 mt-1"><i class="fas fa-magnifying-glass-plus"></i> เธเธฅเธดเธเน€เธเธทเนเธญเธ”เธนเธฃเธนเธเธเธเธฒเธ”เนเธซเธเน</div>
                </div>
            ` : ''}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mb-2">
                <div class="p-2 rounded bg-white border border-gray-100"><span class="text-gray-400">เธเธณเธ•เธญเธเธ—เธตเนเธเธฑเธเน€เธฃเธตเธขเธเน€เธฅเธทเธญเธ:</span> <strong class="${isCorrect ? 'text-green-600' : 'text-red-600'}">${q.student_selected || 'เนเธกเนเนเธ”เนเธ•เธญเธ'}</strong></div>
                <div class="p-2 rounded bg-white border border-gray-100"><span class="text-gray-400">เน€เธเธฅเธขเธ—เธตเนเธ–เธนเธเธ•เนเธญเธ:</span> <strong class="text-green-600">${q.correct_answer}</strong></div>
            </div>
            ${q.explanation ? `<p class="text-xs text-gray-500 bg-white/80 p-2 rounded border border-gray-100 mt-1">๐’ก <strong>เธเธณเธญเธเธดเธเธฒเธข:</strong> ${escapeHtml(q.explanation)}</p>` : ''}
        </div>
    `;
}).join('')}

            </div>
        `;

    } catch (err) {
        container.innerHTML = `<div class="text-red-500 p-4">เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”: ${escapeHtml(err.message)}</div>`;
    }
};

window.closeInspectModal = function() {
    const modal = document.getElementById('modal-inspect');
    if (modal) modal.classList.add('hidden');
};

// 7.8 เธเธฑเธ”เธเธฒเธฃเธเธธเธ”เธเนเธญเธชเธญเธเนเธเธซเนเธญเธเธญเธฒเธเธฒเธฃเธขเน (เธเธฃเนเธญเธกเธชเธงเธดเธ•เธเนเน€เธเธดเธ”/เธเธดเธ”เธชเธญเธเธ—เธฑเธเธ—เธต & เนเธขเธเธชเธดเธ—เธเธดเนเธเธฃเธนเนเธ•เนเธฅเธฐเธ—เนเธฒเธ)
// 8.1 เธ•เธฑเธงเธเธฃเธญเธเธฃเธฐเธ”เธฑเธเธเธฑเนเธเธเธตเนเธเธซเธเนเธฒเธฃเธงเธกเธเธธเธ”เธเนเธญเธชเธญเธ
window.selectedTeacherExamYearFilter = 'เธ—เธฑเนเธเธซเธกเธ”';

window.setTeacherExamYearFilter = function(year) {
    window.selectedTeacherExamYearFilter = year || 'เธ—เธฑเนเธเธซเธกเธ”';
    
    // Update pills styling
    const pillBtns = document.querySelectorAll('.year-pill-btn');
    pillBtns.forEach(btn => {
        const btnYear = btn.getAttribute('data-year');
        if (btnYear === window.selectedTeacherExamYearFilter) {
            btn.className = 'year-pill-btn px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-2xs transition';
        } else {
            btn.className = 'year-pill-btn px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition';
        }
    });

    loadTeacherExamsList();
};

window.saveExamDuration = async function(event) {
    event.preventDefault();
    const examId = document.getElementById('edit-duration-exam-id')?.value;
    const minutes = parseInt(document.getElementById('edit-duration-minutes-input')?.value, 10);
    const maxSwitches = parseInt(document.getElementById('edit-max-switches-input')?.value, 10);

    if (!examId || isNaN(minutes) || minutes <= 0) {
        showToast('เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเน€เธงเธฅเธฒเธ—เธณเธเนเธญเธชเธญเธเนเธซเนเธ–เธนเธเธ•เนเธญเธ (เธญเธขเนเธฒเธเธเนเธญเธข 1 เธเธฒเธ—เธต)', 'warning');
        return;
    }
    if (isNaN(maxSwitches) || maxSwitches < 0) {
        showToast('เธเธฃเธธเธ“เธฒเธฃเธฐเธเธธเธเธณเธเธงเธเธเธฃเธฑเนเธเธ—เธตเนเธญเธเธธเธเธฒเธ•เนเธซเนเธชเธฅเธฑเธเธเธญ (0 = เธซเนเธฒเธกเธชเธฅเธฑเธ)', 'warning');
        return;
    }

    const exams = getLocalExams();
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
        showToast('เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธธเธ”เธเนเธญเธชเธญเธ', 'error');
        return;
    }

    exam.duration_minutes = minutes;
    exam.max_tab_switches_allowed = maxSwitches;
    saveLocalExam(exam);

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            await state.supabaseClient
                .from('exams')
                .update({ duration_minutes: minutes, max_tab_switches_allowed: maxSwitches })
                .eq('id', examId);
        } catch (e) {
            console.warn('[saveExamDuration] Remote update warning:', e);
        }
    }

    // Update in-memory state
    if (state.localExams) {
        const idx = state.localExams.findIndex(e => e.id === examId);
        if (idx >= 0) {
            state.localExams[idx].duration_minutes = minutes;
            state.localExams[idx].max_tab_switches_allowed = maxSwitches;
        }
    }

    // Update view modal display if open
    const displayEl = document.getElementById('teacher-view-duration-display');
    if (displayEl) displayEl.textContent = `${minutes} เธเธฒเธ—เธต`;

    closeEditExamDurationModal();
    showToast(`เธญเธฑเธเน€เธ”เธ• \"${exam.title}\" โ’ ${minutes} เธเธฒเธ—เธต, เธชเธฅเธฑเธเธเธญเธชเธนเธเธชเธธเธ” ${maxSwitches} เธเธฃเธฑเนเธ`, 'success');
    broadcastAppEvent('exam_updated', exam);
    await loadTeacherExamsList();
};

// 8.1 เนเธซเธฅเธ”เธเธธเธ”เธเนเธญเธชเธญเธเธ—เธฑเนเธเธซเธกเธ” เนเธ”เธขเธเธฑเธ”เธเธฅเธธเนเธกเนเธขเธเธ•เธฒเธกเธซเธกเธงเธ”เธซเธกเธนเนเธงเธดเธเธฒเนเธฅเธฐเธฃเธฐเธ”เธฑเธเธเธฑเนเธเธเธตเธญเธขเนเธฒเธเธเธฑเธ”เน€เธเธ
async function loadTeacherExamsList() {
    const container = document.getElementById('teacher-exams-list-container');
    if (!container) return;

    let exams = getLocalExams();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('exams')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                exams = data;
                localStorage.setItem('EXAM_LOCAL_EXAMS', JSON.stringify(exams));
            }
        } catch (err) {
            console.warn('[loadTeacherExamsList] Remote fetch skipped, using local cache:', err);
        }
    }

    // ๐”’ Teacher Isolation: เนเธชเธ”เธเน€เธเธเธฒเธฐเธเธธเธ”เธเนเธญเธชเธญเธเธเธญเธเธญเธฒเธเธฒเธฃเธขเนเธ—เนเธฒเธเธเธตเนเน€เธ—เนเธฒเธเธฑเนเธ (เน€เธงเนเธเนเธ•เน Admin)
    if (state.currentUser?.role === 'teacher') {
        const myCourseIds = (state.courses || []).map(c => c.id);
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        exams = exams.filter(e => 
            (e.teacher_name && e.teacher_name.trim().toLowerCase() === currentTeacherName) ||
            (e.course_id && myCourseIds.includes(e.course_id))
        );
    }

    state.localExams = exams;

    // Filters from UI
    const searchVal = (document.getElementById('teacher-exam-list-filter-search')?.value || '').trim().toLowerCase();
    const yearFilter = window.selectedTeacherExamYearFilter || 'เธ—เธฑเนเธเธซเธกเธ”';

    let filteredExams = exams;

    if (searchVal) {
        filteredExams = filteredExams.filter(e => 
            (e.title && e.title.toLowerCase().includes(searchVal)) ||
            (e.description && e.description.toLowerCase().includes(searchVal))
        );
    }
    if (yearFilter !== 'เธ—เธฑเนเธเธซเธกเธ”') {
        filteredExams = filteredExams.filter(e => (e.target_year || '').includes(yearFilter));
    }

    if (filteredExams.length === 0) {
        container.innerHTML = `
            <div class="bg-white p-10 rounded-3xl border border-slate-200 text-center space-y-3">
                <div class="w-16 h-16 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto text-2xl">
                    <i class="fas fa-folder-open"></i>
                </div>
                <h4 class="font-bold text-slate-800 text-base">เนเธกเนเธเธเธเธธเธ”เธเนเธญเธชเธญเธเธ•เธฒเธกเน€เธเธทเนเธญเธเนเธ</h4>
                <p class="text-xs text-slate-400 max-w-sm mx-auto">เธเธธเธ“เธชเธฒเธกเธฒเธฃเธ–เธชเธฃเนเธฒเธเธเธธเธ”เธเนเธญเธชเธญเธเนเธซเธกเน เธซเธฃเธทเธญเธเธฅเธดเธเธเธธเนเธกเน€เธฅเธทเธญเธ "เธ—เธฑเนเธเธซเธกเธ”" เธ”เนเธฒเธเธเธเน€เธเธทเนเธญเธ”เธนเธเธธเธ”เธเนเธญเธชเธญเธเธ—เธฑเนเธเธซเธกเธ”</p>
                <div class="flex items-center justify-center gap-2 pt-2">
                    <button onclick="setTeacherExamYearFilter('เธ—เธฑเนเธเธซเธกเธ”')" class="px-3.5 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition">
                        <i class="fas fa-rotate-left mr-1"></i> เนเธชเธ”เธเธ—เธฑเนเธเธซเธกเธ”
                    </button>
                    <button onclick="openCreateExamModal()" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-sm hover:bg-emerald-700 transition">
                        <i class="fas fa-plus mr-1"></i> เธชเธฃเนเธฒเธเธเธธเธ”เธเนเธญเธชเธญเธเนเธซเธกเน
                    </button>
                </div>
            </div>
        `;
        populateTeacherExamSelects();
        return;
    }

    // เธเธฑเธ”เธเธฅเธธเนเธกเธเธธเธ”เธเนเธญเธชเธญเธเธ•เธฒเธก เธฃเธฒเธขเธงเธดเธเธฒ + เธฃเธฐเธ”เธฑเธเธเธฑเนเธเธเธต (Group by Course and Target Year)
    const groupsMap = new Map();

    filteredExams.forEach(exam => {
        const matchedCourse = state.courses?.find(c => c.id === exam.course_id);
        const courseCode = matchedCourse?.course_code || 'เธ—เธฑเนเธงเนเธ';
        const courseName = matchedCourse?.course_name || 'เธงเธดเธเธฒเธ—เธฑเนเธงเนเธ';
        const targetYear = exam.target_year || 'เธ—เธธเธเธฃเธฐเธ”เธฑเธเธเธฑเนเธ';

        const groupKey = `${courseCode}___${courseName}___${targetYear}`;
        if (!groupsMap.has(groupKey)) {
            groupsMap.set(groupKey, {
                courseCode,
                courseName,
                targetYear,
                exams: []
            });
        }
        groupsMap.get(groupKey).exams.push(exam);
    });

    // Render grouped UI
    container.innerHTML = Array.from(groupsMap.values()).map(group => {
        const cardsHtml = group.exams.map(exam => {
            const isActive = exam.is_active !== false;
            const isShowScore = exam.show_score_immediately !== false;
            const targetTag = `${exam.target_year || 'เธ—เธธเธเธเธฑเนเธ'} | ${exam.target_department || 'เธ—เธธเธเนเธเธเธ'} | ${exam.target_room || 'เธ—เธธเธเธซเนเธญเธ'}`;

            return `
                <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition flex flex-wrap items-center justify-between gap-4">
                    <div class="flex-1 min-w-[280px]">
                        <div class="flex flex-wrap items-center gap-2 mb-1.5">
                            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                                ${isActive ? '๐ข เน€เธเธดเธ”เธชเธญเธเธญเธขเธนเน' : 'โช เธเธดเธ”เธชเธญเธเธญเธขเธนเน'}
                            </span>
                            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full ${isShowScore ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                                ${isShowScore ? '๐‘๏ธ เนเธชเธ”เธเธเธฐเนเธเธเธ—เธฑเธเธ—เธต' : '๐”’ เธเนเธญเธเธเธฐเนเธเธ'}
                            </span>
                            <h4 class="font-bold text-slate-800 text-base">${escapeHtml(exam.title)}</h4>
                        </div>
                        
                        <div class="text-xs text-amber-800 font-semibold mb-2 flex items-center gap-1.5">
                            <i class="fas fa-bullseye text-amber-600"></i> เน€เธเนเธฒเธซเธกเธฒเธข: <strong>${escapeHtml(targetTag)}</strong>
                        </div>
                        
                        <p class="text-xs text-slate-500 line-clamp-1">${escapeHtml(exam.description || 'เนเธกเนเธกเธตเธเธณเธญเธเธดเธเธฒเธขเน€เธเธดเนเธกเน€เธ•เธดเธก')}</p>
                        
                        <div class="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-2.5">
                            <button type="button" onclick="openEditExamDurationModal('${exam.id}', ${exam.duration_minutes || 60}, '${escapeHtml(exam.title)}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/70 hover:bg-indigo-100 hover:text-indigo-800 font-bold text-indigo-700 transition border border-indigo-100" title="เธเธฅเธดเธเน€เธเธทเนเธญเน€เธเธฅเธตเนเธขเธเน€เธงเธฅเธฒเธ—เธณเธเนเธญเธชเธญเธ">
                                <i class="far fa-clock text-indigo-500"></i>
                                <span>${exam.duration_minutes || 60} เธเธฒเธ—เธต</span>
                                <i class="fas fa-pen-to-square text-[10px] text-indigo-400 ml-0.5"></i>
                            </button>
                            <span><i class="far fa-user-tie text-emerald-600"></i> ${escapeHtml(exam.teacher_name || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ')}</span>
                            <span><i class="fas fa-shield-halved text-purple-500"></i> เธชเธฅเธฑเธเธเธญ: ${exam.max_tab_switches_allowed || 3} เธเธฃเธฑเนเธ</span>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <!-- 1. เนเธเนเนเธเธเนเธญเธชเธญเธ (เธ•เธฃเธงเธเธ”เธนเนเธเธ—เธขเน, เน€เธเธฅเธข เนเธฅเธฐเน€เธเธดเธ”/เธเธดเธ”เนเธชเธ”เธเธเธฐเนเธเธ) -->
                        <button onclick="viewTeacherExam('${exam.id}')" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-xs" title="เธเธฅเธดเธเน€เธเธทเนเธญเนเธเนเนเธเธเนเธญเธชเธญเธ เธ•เธฃเธงเธเธ”เธนเนเธเธ—เธขเน เน€เธเธฅเธข เนเธฅเธฐเธ•เธฑเนเธเธเนเธฒเน€เธเธดเธ”/เธเธดเธ”เนเธชเธ”เธเธเธฐเนเธเธ">
                            <i class="fas fa-pen-to-square text-white"></i>
                            <span>เนเธเนเนเธเธเนเธญเธชเธญเธ</span>
                        </button>

                        <!-- 2. เธเธฅเธชเธญเธ & เนเธซเนเธชเธญเธเนเธซเธกเน (Allow Retake) -->
                        <button onclick="openExamSubmissionsUnlockModal('${exam.id}')" class="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-xs border border-amber-300" title="เธ”เธนเธเธฅเธชเธญเธเธเธญเธเธเธธเธ”เธเธตเน เนเธฅเธฐเธเธ”เธเธฅเธ”เธฅเนเธญเธเนเธซเนเธเธฑเธเน€เธฃเธตเธขเธเธ—เธณเนเธซเธกเน">
                            <i class="fas fa-rotate-left text-amber-600"></i>
                            <span>๐” เนเธซเนเธชเธญเธเนเธซเธกเน</span>
                        </button>

                        <!-- 3. เธชเธฅเธฑเธ เน€เธเธดเธ”/เธเธดเธ”เธชเธญเธ เธ—เธฑเธเธ—เธต -->
                        <button onclick="toggleExamActive('${exam.id}')" class="px-3.5 py-2 ${isActive ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'} rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs" title="เธเธฅเธดเธเธชเธฅเธฑเธเน€เธเธดเธ”เธซเธฃเธทเธญเธเธดเธ”เธชเธญเธ">
                            <i class="fas ${isActive ? 'fa-toggle-on text-emerald-600 text-sm' : 'fa-toggle-off text-slate-400 text-sm'}"></i>
                            <span>${isActive ? 'เธเธญเธเธดเธ”เธชเธญเธ' : 'เน€เธเธดเธ”เธชเธญเธ'}</span>
                        </button>

                        <button onclick="openAddQuestionForExam('${exam.id}')" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-xs">
                            <i class="fas fa-plus"></i> เน€เธเธดเนเธกเนเธเธ—เธขเน
                        </button>
                        <button onclick="openExcelImportForExam('${exam.id}')" class="px-3 py-2 btn-excel rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-xs">
                            <i class="fas fa-file-excel"></i> เธเธณเน€เธเนเธฒ Excel
                        </button>
                        <button onclick="deleteExam('${exam.id}', '${escapeHtml(exam.title)}')" class="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-medium transition flex items-center gap-1.5" title="เธฅเธเธเธธเธ”เธเนเธญเธชเธญเธ">
                            <i class="fas fa-trash-can"></i> เธฅเธ
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="bg-slate-100/70 rounded-3xl p-4 sm:p-5 border border-slate-200 space-y-3 shadow-2xs">
                <!-- Group Category Header (เธซเธฑเธงเธเนเธญเธซเธกเธงเธ”เธซเธกเธนเนเธงเธดเธเธฒเนเธฅเธฐเธฃเธฐเธ”เธฑเธเธเธฑเนเธเธเธต) -->
                <div class="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div class="flex flex-wrap items-center gap-2.5">
                        <div class="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-sm shadow-xs font-bold">
                            <i class="fas fa-book-open"></i>
                        </div>
                        <div>
                            <span class="font-extrabold text-slate-900 text-base">
                                [${escapeHtml(group.courseCode)}] ${escapeHtml(group.courseName)}
                            </span>
                            <span class="ml-2.5 px-2.5 py-0.5 text-xs font-bold rounded-lg bg-indigo-100 text-indigo-800 border border-indigo-200">
                                ๐“ เธฃเธฐเธ”เธฑเธเธเธฑเนเธ: ${escapeHtml(group.targetYear)}
                            </span>
                        </div>
                    </div>
                    <span class="text-xs text-slate-600 font-bold px-3 py-1 bg-white rounded-xl border border-slate-200 shadow-2xs">
                        ${group.exams.length} เธเธธเธ”เธเนเธญเธชเธญเธ
                    </span>
                </div>

                <!-- Group Exam Cards -->
                <div class="space-y-3">
                    ${cardsHtml}
                </div>
            </div>
        `;
    }).join('');

    populateTeacherExamSelects();
}

// 8.1.2 เน€เธเธดเธ”เธซเธเนเธฒเธ•เนเธฒเธเธ”เธนเธเธฅเธชเธญเธเนเธฅเธฐเธเธฅเธ”เธฅเนเธญเธเธชเธญเธเนเธซเธกเนเธฃเธฒเธขเธเธธเธ”เธเนเธญเธชเธญเธ
window.openExamSubmissionsUnlockModal = async function(examId) {
    const modal = document.getElementById('modal-exam-submissions-unlock');
    const tableBody = document.getElementById('exam-unlock-table-body');
    const titleEl = document.getElementById('exam-unlock-title');
    const badgeEl = document.getElementById('exam-unlock-course-badge');
    const metaEl = document.getElementById('exam-unlock-meta');

    if (!modal) return;

    const exams = state.localExams || getLocalExams();
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
        showToast('เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธธเธ”เธเนเธญเธชเธญเธ', 'error');
        return;
    }

    const matchedCourse = state.courses?.find(c => c.id === exam.course_id);
    const courseCode = matchedCourse?.course_code || 'เธ—เธฑเนเธงเนเธ';
    const courseName = matchedCourse?.course_name || 'เธงเธดเธเธฒเธ—เธฑเนเธงเนเธ';

    if (titleEl) titleEl.textContent = exam.title;
    if (badgeEl) badgeEl.textContent = `[${courseCode}] ${courseName}`;

    modal.classList.remove('hidden');

    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-8 text-slate-400">
                    <i class="fas fa-spinner fa-spin text-2xl text-indigo-500 mb-2 block"></i>
                    เธเธณเธฅเธฑเธเนเธซเธฅเธ”เธฃเธฒเธขเธเธทเนเธญเธเธฑเธเน€เธฃเธตเธขเธเธ—เธตเนเธชเนเธเธเนเธญเธชเธญเธเธเธธเธ”เธเธตเน...
                </td>
            </tr>
        `;
    }

    let subs = getLocalSubmissions();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('exam_results')
                .select(`
                    *,
                    exam:exams(title, max_tab_switches_allowed, target_year, target_department, target_room)
                `)
                .eq('exam_id', examId)
                .order('graded_at', { ascending: false });

            if (!error && Array.isArray(data)) {
                subs = data;
            }
        } catch (err) {
            console.warn('[openExamSubmissionsUnlockModal] Fetch notice:', err);
        }
    }

    const examSubs = (subs || []).filter(s => s.exam_id === examId);

    if (metaEl) {
        metaEl.innerHTML = `
            <span><i class="fas fa-users text-indigo-500"></i> เธชเนเธเธเนเธญเธชเธญเธเนเธฅเนเธง: <strong>${examSubs.length} เธเธ</strong></span>
            <span><i class="fas fa-bullseye text-amber-500"></i> เน€เธเนเธฒเธซเธกเธฒเธข: <strong>${escapeHtml(exam.target_year || 'เธ—เธธเธเธเธฑเนเธ')} ${escapeHtml(exam.target_room || 'เธ—เธธเธเธซเนเธญเธ')}</strong></span>
        `;
    }

    if (examSubs.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-10 text-slate-400">
                    <i class="fas fa-user-clock text-3xl text-slate-300 mb-2 block"></i>
                    เธขเธฑเธเนเธกเนเธกเธตเธเธฑเธเน€เธฃเธตเธขเธเธชเนเธเธเนเธญเธชเธญเธเนเธเธเธธเธ”เธเธตเน
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = examSubs.map(sub => {
        const isFlagged = sub.is_flagged_cheating;
        const formattedDate = new Date(sub.graded_at).toLocaleString('th-TH');
        const classInfo = `${sub.student_year || '-'} | ${sub.student_department || '-'} | ${sub.student_room || '-'}`;

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-3.5 px-4 font-medium text-slate-800">
                    <div class="font-bold text-slate-900">${escapeHtml(sub.student_name || 'เธเธฑเธเน€เธฃเธตเธขเธ')}</div>
                    <div class="text-[11px] text-slate-400 font-mono">${sub.student_code || sub.student_id}</div>
                </td>
                <td class="py-3.5 px-4 text-xs font-semibold text-indigo-700">
                    <span class="px-2 py-0.5 bg-indigo-50 rounded-md border border-indigo-100">
                        ${escapeHtml(classInfo)}
                    </span>
                </td>
                <td class="py-3.5 px-4 font-bold text-slate-800">
                    ${sub.total_score} / ${sub.max_score}
                    <span class="text-xs font-normal text-slate-500">(${sub.percentage}%)</span>
                </td>
                <td class="py-3.5 px-4 text-center">
                    <span class="px-2 py-0.5 rounded-md text-xs font-semibold ${
                        sub.total_tab_switches > (exam.max_tab_switches_allowed || 3) ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                    }">
                        ${sub.total_tab_switches} เธเธฃเธฑเนเธ
                    </span>
                </td>
                <td class="py-3.5 px-4 text-center">
                    ${isFlagged ? `
                        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">โ ๏ธ เธชเธเธชเธฑเธขเธ—เธธเธเธฃเธดเธ•</span>
                    ` : `
                        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">โ… เธเธเธ•เธด</span>
                    `}
                </td>
                <td class="py-3.5 px-4 text-slate-400 text-[11px]">${formattedDate}</td>
                <td class="py-3.5 px-4 text-right">
                    <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <button onclick="inspectStudentSubmission('${sub.student_id}', '${sub.exam_id}', '${escapeHtml(sub.student_name)}')" class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition shadow-2xs inline-flex items-center gap-1">
                            <i class="fas fa-search"></i> เธ•เธฃเธงเธเธเธณเธ•เธญเธ
                        </button>
                        <button onclick="allowStudentRetake('${sub.id || ''}', '${sub.student_id}', '${sub.exam_id}', '${escapeHtml(sub.student_name)}', '${escapeHtml(exam.title)}')" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-lg transition shadow-2xs inline-flex items-center gap-1 border border-amber-300" title="เธฅเนเธฒเธเธเธฅเธชเธญเธเน€เธ”เธดเธกเนเธฅเธฐเน€เธเธดเธ”เธชเธดเธ—เธเธดเนเนเธซเนเธเธฑเธเน€เธฃเธตเธขเธเธ—เธณเนเธซเธกเนเธ—เธฑเธเธ—เธต">
                            <i class="fas fa-rotate-left"></i> เนเธซเนเธชเธญเธเนเธซเธกเน
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
};

window.closeExamSubmissionsUnlockModal = function() {
    const modal = document.getElementById('modal-exam-submissions-unlock');
    if (modal) modal.classList.add('hidden');
};

window.toggleExamActive = async function(examId) {
    const exams = getLocalExams();
    const exam = exams.find(e => e.id === examId);
    if (!exam) return;

    const newStatus = !(exam.is_active !== false);
    exam.is_active = newStatus;
    saveLocalExam(exam);

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            await state.supabaseClient
                .from('exams')
                .update({ is_active: newStatus })
                .eq('id', examId);
        } catch (e) {
            console.warn('[toggleExamActive] Supabase update error:', e);
        }
    }

    broadcastAppEvent('exam_updated', exam);
    showToast(`เธเธธเธ”เธเนเธญเธชเธญเธ "${exam.title}" เน€เธเธฅเธตเนเธขเธเธชเธ–เธฒเธเธฐเน€เธเนเธ ${newStatus ? '๐ข เน€เธเธดเธ”เธชเธญเธเธญเธขเธนเน' : 'โช เธเธดเธ”เธชเธญเธเธญเธขเธนเน'}`, 'success');
    await loadTeacherExamsList();
};

window.toggleExamShowScore = async function(examId) {
    const exams = getLocalExams();
    const exam = exams.find(e => e.id === examId);
    if (!exam) return;

    const currentSetting = exam.show_score_immediately !== false;
    const newSetting = !currentSetting;
    exam.show_score_immediately = newSetting;
    saveLocalExam(exam);

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            await state.supabaseClient
                .from('exams')
                .update({ show_score_immediately: newSetting })
                .eq('id', examId);
        } catch (e) {
            console.warn('[toggleExamShowScore] Supabase update error:', e);
        }
    }

    broadcastAppEvent('exam_updated', exam);
    showToast(`เธเธธเธ”เธเนเธญเธชเธญเธ "${exam.title}" ${newSetting ? '๐‘๏ธ เน€เธเธดเธ”เนเธซเนเธเธฑเธเน€เธฃเธตเธขเธเน€เธซเนเธเธเธฐเนเธเธเนเธฅเนเธง' : '๐”’ เธเนเธญเธเธเธฐเนเธเธเธเธฒเธเธเธฑเธเน€เธฃเธตเธขเธเนเธฅเนเธง'}`, 'success');
    await loadTeacherExamsList();
};

// 8.1.1 เธเธฑเธ”เธเธฒเธฃเนเธเนเนเธเน€เธงเธฅเธฒเธ—เธณเธเนเธญเธชเธญเธ (Duration Modal)
window.openEditExamDurationModal = function(examId, currentMinutes, examTitle = '') {
    const modal = document.getElementById('modal-edit-exam-duration');
    const idInput = document.getElementById('edit-duration-exam-id');
    const minInput = document.getElementById('edit-duration-minutes-input');
    const titleEl = document.getElementById('edit-duration-exam-title');
    const switchesInput = document.getElementById('edit-max-switches-input');

    if (!modal) return;

    if (idInput) idInput.value = examId;
    if (minInput) minInput.value = currentMinutes || 60;
    if (titleEl) titleEl.textContent = examTitle || 'เธเธธเธ”เธเนเธญเธชเธญเธ';

    // เนเธซเธฅเธ”เธเนเธฒ max_tab_switches_allowed เธเธฑเธเธเธธเธเธฑเธ
    if (switchesInput) {
        const exam = (state.localExams || getLocalExams()).find(e => e.id === examId);
        switchesInput.value = (exam && exam.max_tab_switches_allowed != null) ? exam.max_tab_switches_allowed : 3;
    }

    modal.classList.remove('hidden');
    if (minInput) {
        minInput.focus();
        minInput.select();
    }
};

window.closeEditExamDurationModal = function() {
    const modal = document.getElementById('modal-edit-exam-duration');
    if (modal) modal.classList.add('hidden');
};

window.setDurationPreset = function(minutes) {
    const minInput = document.getElementById('edit-duration-minutes-input');
    if (minInput) minInput.value = minutes;
};


window.viewTeacherExam = async function(examId) {
    const exam = (state.localExams || getLocalExams()).find(e => e.id === examId) || 
                 getLocalExams().find(e => e.id === examId);
    if (!exam) {
        showToast('เนเธกเนเธเธเธเนเธญเธกเธนเธฅเธเธธเธ”เธเนเธญเธชเธญเธ', 'error');
        return;
    }

    let questions = getLocalQuestions(examId);

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data: dbQ, error } = await state.supabaseClient
                .from('questions')
                .select('*')
                .eq('exam_id', examId)
                .order('order_seq', { ascending: true });

            if (!error && Array.isArray(dbQ) && dbQ.length > 0) {
                const localMap = new Map(questions.map(q => [q.id, q]));
                questions = dbQ.map(q => {
                    const localQ = localMap.get(q.id);
                    return {
                        ...q,
                        correct: localQ?.correct || localQ?.correct_option_id || q.correct_option_id || 'A'
                    };
                });
            }
        } catch (err) {
            console.warn('[viewTeacherExam] Supabase fetch notice:', err);
        }
    }

    renderTeacherExamViewModal(exam, questions);
};

window.closeTeacherExamViewModal = function() {
    const modal = document.getElementById('modal-teacher-exam-view');
    if (modal) modal.classList.add('hidden');
};

function renderTeacherExamViewModal(exam, questions) {
    const modal = document.getElementById('modal-teacher-exam-view');
    if (!modal) return;

    modal.classList.remove('hidden');

    const matchedCourse = state.courses?.find(c => c.id === exam.course_id);
    const courseCode = matchedCourse?.course_code || 'เธ—เธฑเนเธงเนเธ';
    const courseName = matchedCourse?.course_name || 'เธงเธดเธเธฒเธ—เธฑเนเธงเนเธ';
    const isActive = exam.is_active !== false;

    // Header Badges & Info
    const courseBadge = document.getElementById('teacher-exam-view-course-badge');
    const statusBadge = document.getElementById('teacher-exam-view-status-badge');
    const titleEl = document.getElementById('teacher-exam-view-title');
    const metaEl = document.getElementById('teacher-exam-view-meta');
    const contentEl = document.getElementById('teacher-exam-view-content');

    const totalPoints = (questions || []).reduce((sum, q) => sum + (Number(q.points) || 1), 0);

    const isShowScore = exam.show_score_immediately !== false;

    if (courseBadge) courseBadge.textContent = `[${courseCode}] ${courseName}`;
    if (statusBadge) {
        statusBadge.innerHTML = `
            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                ${isActive ? '๐ข เน€เธเธดเธ”เธชเธญเธเธญเธขเธนเน' : 'โช เธเธดเธ”เธชเธญเธเธญเธขเธนเน'}
            </span>
            <span class="ml-1 px-2.5 py-0.5 text-xs font-bold rounded-full ${isShowScore ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                ${isShowScore ? '๐‘๏ธ เนเธชเธ”เธเธเธฐเนเธเธ' : '๐”’ เธเนเธญเธเธเธฐเนเธเธ'}
            </span>
        `;
    }
    if (titleEl) titleEl.textContent = exam.title;
    if (metaEl) {
        metaEl.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 pt-1">
                <span class="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100/80 px-2.5 py-1 rounded-xl text-indigo-900 shadow-2xs">
                    <i class="far fa-clock text-indigo-600"></i> เน€เธงเธฅเธฒเธชเธญเธ: <strong id="teacher-view-duration-display" class="font-bold text-indigo-700">${exam.duration_minutes || 60} เธเธฒเธ—เธต</strong>
                    <button type="button" onclick="openEditExamDurationModal('${exam.id}', ${exam.duration_minutes || 60}, '${escapeHtml(exam.title)}')" class="ml-1 px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition inline-flex items-center gap-1 shadow-xs" title="เธเธฅเธดเธเน€เธเธทเนเธญเน€เธเธฅเธตเนเธขเธเน€เธงเธฅเธฒเธ—เธณเธเนเธญเธชเธญเธ">
                        <i class="fas fa-pen-to-square"></i> เนเธเนเนเธเน€เธงเธฅเธฒ
                    </button>
                </span>
                <button type="button" onclick="toggleExamShowScore('${exam.id}'); setTimeout(() => viewTeacherExam('${exam.id}'), 200);" class="px-3 py-1.5 ${isShowScore ? 'bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'} rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 shadow-xs" title="เธเธฅเธดเธเน€เธเธทเนเธญเน€เธเธดเธ”เธซเธฃเธทเธญเธเธดเธ”เธเธฒเธฃเนเธชเธ”เธเธเธฐเนเธเธเนเธซเนเธเธฑเธเน€เธฃเธตเธขเธเน€เธซเนเธเธ—เธฑเธเธ—เธตเธซเธฅเธฑเธเธชเนเธ">
                    <i class="fas ${isShowScore ? 'fa-eye text-amber-600' : 'fa-eye-slash text-slate-500'}"></i>
                    <span>${isShowScore ? '๐‘๏ธ เนเธชเธ”เธเธเธฐเนเธเธเนเธซเนเธเธฑเธเน€เธฃเธตเธขเธ: เน€เธเธดเธ”' : '๐”’ เธเนเธญเธเธเธฐเนเธเธ: เธเธดเธ”เธญเธขเธนเน'}</span>
                </button>
                <span><i class="fas fa-list-check text-emerald-500"></i> เธเนเธญเธชเธญเธ: <strong>${questions.length} เธเนเธญ</strong> (${totalPoints} เธเธฐเนเธเธ)</span>
                <span><i class="fas fa-bullseye text-amber-500"></i> <strong>${escapeHtml(exam.target_year || 'เธ—เธธเธเธเธฑเนเธ')} ${escapeHtml(exam.target_department || 'เธ—เธธเธเนเธเธเธ')} ${escapeHtml(exam.target_room || 'เธ—เธธเธเธซเนเธญเธ')}</strong></span>
                <span><i class="fas fa-shield-halved text-purple-500"></i> เธชเธฅเธฑเธเธเธญ: <strong>${exam.max_tab_switches_allowed || 3} เธเธฃเธฑเนเธ</strong></span>
                <button type="button" onclick="closeTeacherExamViewModal(); openExamSubmissionsUnlockModal('${exam.id}')" class="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-1 shadow-xs">
                    <i class="fas fa-rotate-left"></i> เธเธฅเธชเธญเธ & เนเธซเนเธชเธญเธเนเธซเธกเน
                </button>
            </div>
        `;
    }

    // Bind footer action buttons
    const btnAddQ = document.getElementById('teacher-exam-view-btn-add-q');
    const btnImport = document.getElementById('teacher-exam-view-btn-import-excel');
    if (btnAddQ) {
        btnAddQ.onclick = () => {
            closeTeacherExamViewModal();
            openAddQuestionForExam(exam.id);
        };
    }
    if (btnImport) {
        btnImport.onclick = () => {
            closeTeacherExamViewModal();
            openExcelImportForExam(exam.id);
        };
    }

    // Render questions list
    if (!questions || questions.length === 0) {
        contentEl.innerHTML = `
            <div class="bg-white p-12 rounded-3xl border border-slate-200 text-center space-y-3">
                <div class="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto text-2xl">
                    <i class="fas fa-clipboard-question"></i>
                </div>
                <h4 class="font-bold text-slate-800 text-base">เธขเธฑเธเนเธกเนเธกเธตเธเธณเธ–เธฒเธกเนเธเธเธธเธ”เธเนเธญเธชเธญเธเธเธตเน</h4>
                <p class="text-xs text-slate-500 max-w-sm mx-auto">เธเธธเธ“เธชเธฒเธกเธฒเธฃเธ–เน€เธเธดเนเธกเธเธณเธ–เธฒเธกเนเธเธเธเนเธญเธ•เนเธญเธเนเธญ เธซเธฃเธทเธญเธเธณเน€เธเนเธฒเธเนเธญเธชเธญเธเธเธฃเนเธญเธกเธเธฑเธเธเธฒเธเนเธเธฅเน Excel (.xlsx) เนเธ”เนเธ—เธฑเธเธ—เธต</p>
                <div class="flex items-center justify-center gap-2 pt-2">
                    <button onclick="closeTeacherExamViewModal(); openAddQuestionForExam('${exam.id}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-plus"></i> เน€เธเธดเนเธกเนเธเธ—เธขเนเนเธฃเธ
                    </button>
                    <button onclick="closeTeacherExamViewModal(); openExcelImportForExam('${exam.id}')" class="px-4 py-2 btn-excel text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-file-excel"></i> เธเธณเน€เธเนเธฒ Excel
                    </button>
                </div>
            </div>
        `;
    } else {
                contentEl.innerHTML = questions.map((q, idx) => {
            const qNum = idx + 1;
            const points = q.points || 1;
            const correctOpt = (q.correct || q.correct_option_id || 'A').toUpperCase();
            const parsed = parseQuestionTextAndImage(q.question_text, q.image_url || q.image);

            // Render 4 choices
            const optionsHtml = (q.options || []).map(opt => {
                const isCorrect = String(opt.id).toUpperCase() === correctOpt;
                return `
                    <div class="p-3 rounded-2xl border ${isCorrect ? 'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-400 font-semibold text-emerald-950' : 'bg-white border-slate-200 text-slate-700'} flex items-start gap-2.5 text-xs transition">
                        <span class="w-6 h-6 rounded-lg ${isCorrect ? 'bg-emerald-600 text-white font-bold' : 'bg-slate-100 text-slate-600 font-bold'} flex items-center justify-center text-xs shrink-0">
                            ${escapeHtml(opt.id)}
                        </span>
                        <div class="flex-1 pt-0.5 leading-relaxed">
                            ${escapeHtml(opt.text || '')}
                        </div>
                        ${isCorrect ? `
                            <span class="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold rounded-md flex items-center gap-1 shrink-0">
                                <i class="fas fa-check"></i> เน€เธเธฅเธข
                            </span>
                        ` : ''}
                    </div>
                `;
            }).join('');

            return `
                <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold">
                                เธเนเธญเธ—เธตเน ${qNum}
                            </span>
                            <span class="text-xs text-slate-400">(${points} เธเธฐเนเธเธ)</span>
                        </div>
                        <button onclick="deleteTeacherQuestion('${q.id}', '${exam.id}', ${qNum})" class="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition font-medium flex items-center gap-1">
                            <i class="fas fa-trash-can"></i> เธฅเธเธเนเธญเธเธตเน
                        </button>
                    </div>

                    ${parsed.image ? `
                        <div class="p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3">
                            <img src="${parsed.image}" alt="เธ เธฒเธเนเธเธ—เธขเน" class="w-24 h-24 object-contain bg-white rounded-lg border border-slate-200 shadow-2xs cursor-pointer" onclick="openImageZoomModal('${parsed.image}')">
                            <div class="text-xs text-slate-500">
                                <div class="font-bold text-slate-700 mb-1"><i class="far fa-image text-indigo-600 mr-1"></i> เธกเธตเธฃเธนเธเธ เธฒเธเธเธฃเธฐเธเธญเธเนเธเธ—เธขเน</div>
                                <button type="button" onclick="openImageZoomModal('${parsed.image}')" class="text-[11px] text-indigo-600 hover:underline font-semibold">
                                    <i class="fas fa-magnifying-glass-plus"></i> เธเธฅเธดเธเน€เธเธทเนเธญเธ”เธนเธฃเธนเธเธเธเธฒเธ”เนเธซเธเน
                                </button>
                            </div>
                        </div>
                    ` : ''}

                    <div class="text-sm font-bold text-slate-900 leading-snug">
                        ${escapeHtml(parsed.text || (parsed.image ? '(เธ”เธนเนเธเธ—เธขเนเธเธฒเธเธ เธฒเธเธ”เนเธฒเธเธเธ)' : ''))}
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        ${optionsHtml}
                    </div>

                    ${q.explanation ? `
                        <div class="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-900 mt-2">
                            <strong class="text-amber-800"><i class="fas fa-lightbulb text-amber-600 mr-1"></i> เธเธณเธญเธเธดเธเธฒเธข:</strong> ${escapeHtml(q.explanation)}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

    }
}


window.deleteTeacherQuestion = async function(questionId, examId, qIndex) {
    showCustomConfirm({
        title: 'เธขเธทเธเธขเธฑเธเธเธฒเธฃเธฅเธเธเธณเธ–เธฒเธก',
        message: `เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธฅเธเธเธณเธ–เธฒเธกเธเนเธญเธ—เธตเน ${qIndex} เนเธเนเธซเธฃเธทเธญเนเธกเน?\n(เธเนเธญเธกเธนเธฅเธเธฐเนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธเธนเนเธเธทเธเนเธ”เน)`,
        icon: 'fas fa-trash-can',
        confirmText: 'เธฅเธเธเธณเธ–เธฒเธก',
        cancelText: 'เธขเธเน€เธฅเธดเธ',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            const allQ = getLocalQuestions().filter(q => q.id !== questionId);
            localStorage.setItem('EXAM_LOCAL_QUESTIONS', JSON.stringify(allQ));

            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.from('questions').delete().eq('id', questionId);
                    await state.supabaseClient.from('exam_answers').delete().eq('question_id', questionId);
                } catch (e) {}
            }

            showToast(`เธฅเธเธเธณเธ–เธฒเธกเธเนเธญเธ—เธตเน ${qIndex} เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง`, 'info');
            await viewTeacherExam(examId);
            await loadTeacherExamsList();
        }
    });
};

window.deleteExam = function(examId, examTitle) {
    showCustomConfirm({
        title: 'เธขเธทเธเธขเธฑเธเธเธฒเธฃเธฅเธเธเธธเธ”เธเนเธญเธชเธญเธ',
        message: `เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธฅเธเธเธธเธ”เธเนเธญเธชเธญเธ "${examTitle}" เนเธเนเธซเธฃเธทเธญเนเธกเน?\n(เธเธณเธ–เธฒเธกเนเธฅเธฐเธเนเธญเธกเธนเธฅเธ—เธฑเนเธเธซเธกเธ”เธเธญเธเธเธธเธ”เธเธตเนเธเธฐเธ–เธนเธเธฅเธเธญเธญเธเธเธฒเธเธฃเธฐเธเธ)`,
        icon: 'fas fa-trash-can',
        confirmText: 'เธฅเธเธเธธเธ”เธเนเธญเธชเธญเธ',
        cancelText: 'เธขเธเน€เธฅเธดเธ',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalExam(examId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.from('exams').delete().eq('id', examId);
                } catch (e) {}
            }
            showToast(`เธฅเธเธเธธเธ”เธเนเธญเธชเธญเธ "${examTitle}" เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง`, 'info');
            loadTeacherExamsList();
            populateTeacherExamSelects();
        }
    });
};

function populateCourseSelects() {
    const courseSelect = document.getElementById('create-exam-course-select');
    if (!courseSelect) return;

    if (state.courses.length === 0) {
        courseSelect.innerHTML = `<option value="">(เนเธกเนเธกเธตเธฃเธฒเธขเธงเธดเธเธฒ - เธเธฃเธธเธ“เธฒเธชเธฃเนเธฒเธเธฃเธฒเธขเธงเธดเธเธฒเธเนเธญเธ)</option>`;
        return;
    }

    courseSelect.innerHTML = state.courses.map(c => `
        <option value="${c.id}" data-year="${escapeHtml(c.target_year || 'เธ—เธฑเนเธเธซเธกเธ”')}" data-dept="${escapeHtml(c.target_department || 'เธ—เธฑเนเธเธซเธกเธ”')}">[${escapeHtml(c.course_code)}] ${escapeHtml(c.course_name)} (${escapeHtml(c.target_year || 'เธ—เธธเธเธเธฑเนเธ')})</option>
    `).join('');

    courseSelect.onchange = function() {
        syncCourseTargeting();
    };

    syncCourseTargeting();
}

function syncCourseTargeting() {
    const courseSelect = document.getElementById('create-exam-course-select');
    const yearSelect = document.getElementById('create-exam-target-year');
    const deptSelect = document.getElementById('create-exam-target-dept');
    if (!courseSelect || !yearSelect || !deptSelect) return;

    const selectedOption = courseSelect.options[courseSelect.selectedIndex];
    if (selectedOption) {
        const year = selectedOption.getAttribute('data-year');
        const dept = selectedOption.getAttribute('data-dept');
        if (year) yearSelect.value = year;
        if (dept) deptSelect.value = dept;
    }
}

window.populateTeacherExamSelects = async function(showToastFeedback = false) {
    const selects = [
        document.getElementById('teacher-add-question-exam-select'),
        document.getElementById('excel-target-exam-select')
    ];

    let exams = [];

    try {
        if (state.supabaseClient) {
            // เธ”เธถเธเธเธธเธ”เธเนเธญเธชเธญเธเธ—เธฑเนเธเธซเธกเธ”
            const { data, error } = await state.supabaseClient
                .from('exams')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                exams = data.map(exam => {
                    const matchedCourse = state.courses?.find(c => c.id === exam.course_id);
                    return {
                        ...exam,
                        course: matchedCourse || { course_code: '', course_name: exam.teacher_name || '' }
                    };
                });
                state.localExams = exams;
            }
        }
    } catch (e) {
        console.warn('[populateTeacherExamSelects] Fetching from DB failed, using memory/fallback:', e);
    }

    // เนเธเน localExams เธ—เธตเนเธชเธฃเนเธฒเธเนเธงเนเธเธฃเธดเธ
    if (exams.length === 0 && Array.isArray(state.localExams) && state.localExams.length > 0) {
        exams = state.localExams;
    }

    // ๐”’ Teacher Isolation: เนเธชเธ”เธเน€เธเธเธฒเธฐเธเธธเธ”เธเนเธญเธชเธญเธเธเธญเธเธ•เธเน€เธญเธ
    if (state.currentUser?.role === 'teacher') {
        const myCourseIds = (state.courses || []).map(c => c.id);
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        exams = exams.filter(e => 
            (e.teacher_name && e.teacher_name.trim().toLowerCase() === currentTeacherName) ||
            (e.course_id && myCourseIds.includes(e.course_id))
        );
    }

    selects.forEach(select => {
        if (!select) return;
        const currentVal = select.value;

        if (exams.length === 0) {
            select.innerHTML = `<option value="">-- เธขเธฑเธเนเธกเนเธกเธตเธเธธเธ”เธเนเธญเธชเธญเธ (เธเธฃเธธเธ“เธฒเธชเธฃเนเธฒเธเธเธธเธ”เธเนเธญเธชเธญเธเธเนเธญเธ) --</option>`;
            return;
        }

        let html = exams.map(exam => {
            const coursePrefix = exam.course?.course_code ? `[${exam.course.course_code}] ` : (exam.course?.course_name ? `[${exam.course.course_name}] ` : '');
            const targetTag = ` (${exam.target_year || 'เธ—เธธเธเธเธฑเนเธ'} ${exam.target_room || 'เธ—เธธเธเธซเนเธญเธ'})`;
            return `<option value="${exam.id}">${escapeHtml(coursePrefix + exam.title + targetTag)}</option>`;
        }).join('');

        select.innerHTML = html;

        // Auto-select: เธ–เนเธฒเธกเธตเธเนเธฒเน€เธ”เธดเธกเธ—เธตเนเธ•เธฃเธเนเธซเนเธเธเนเธงเน เธกเธดเธเธฐเธเธฑเนเธเน€เธฅเธทเธญเธเธเธธเธ”เนเธฃเธเนเธซเนเธญเธฑเธ•เนเธเธกเธฑเธ•เธดเธ—เธฑเธเธ—เธต
        if (currentVal && exams.some(e => e.id === currentVal)) {
            select.value = currentVal;
        } else if (exams.length > 0) {
            select.value = exams[0].id;
        }
    });

    if (showToastFeedback) {
        showToast(`เนเธซเธฅเธ”เธฃเธฒเธขเธเธฒเธฃเธเธธเธ”เธเนเธญเธชเธญเธเนเธฅเนเธง (${exams.length} เธเธธเธ”)`, 'info');
    }
};

window.openCreateExamModal = function() {
    populateCourseSelects();
    const modal = document.getElementById('modal-create-exam');
    if (modal) modal.classList.remove('hidden');
};

window.openCreateExamForCourse = function(courseId) {
    populateCourseSelects();
    const select = document.getElementById('create-exam-course-select');
    if (select) {
        select.value = courseId;
        syncCourseTargeting();
    }
    const modal = document.getElementById('modal-create-exam');
    if (modal) modal.classList.remove('hidden');
};

window.openAddQuestionForExam = async function(examId) {
    document.getElementById('teacher-tab-btn-add-question').click();
    await populateTeacherExamSelects();
    const select = document.getElementById('teacher-add-question-exam-select');
    if (select) select.value = examId;
};

window.openExcelImportForExam = async function(examId) {
    document.getElementById('teacher-tab-btn-excel-import').click();
    await populateTeacherExamSelects();
    const select = document.getElementById('excel-target-exam-select');
    if (select) select.value = examId;
};

// ==============================================================================
// 8. ADMIN PORTAL (SUPABASE CONFIGURATION & TEACHER MANAGEMENT)
// ==============================================================================

function loadAdminDashboard() {
    showView('view-admin');

    const creds = getSupabaseCredentials();
    const urlInput = document.getElementById('admin-config-url');
    const keyInput = document.getElementById('admin-config-key');

    if (urlInput) urlInput.value = creds.url;
    if (keyInput) keyInput.value = creds.key;

    setupAdminConfigForm();
    loadAdminTeachersList();
}

// 8.1 เธเธฑเธ”เธเธฒเธฃเธฃเธฒเธขเธเธทเนเธญเธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธเนเธเธซเธเนเธฒเนเธญเธ”เธกเธดเธ (Admin Teacher Management)
async function loadAdminTeachersList() {
    const tableBody = document.getElementById('admin-teachers-table-body');
    const badgeCount = document.getElementById('admin-teachers-count-badge');
    if (!tableBody) return;

    let teachers = getLocalTeachers();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('teachers')
                .select('*')
                .order('created_at', { ascending: false });

            if (!error && Array.isArray(data) && data.length > 0) {
                teachers = data;
                localStorage.setItem('EXAM_LOCAL_TEACHERS', JSON.stringify(teachers));
            }
        } catch (err) {
            console.warn('[loadAdminTeachersList] Remote fetch skipped, using local cache:', err);
        }
    }

    if (badgeCount) badgeCount.textContent = `${teachers.length} เธญเธฒเธเธฒเธฃเธขเน`;

    if (teachers.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-8 text-slate-400">
                    <i class="fas fa-user-xmark text-2xl text-slate-300 mb-2 block"></i>
                    เธขเธฑเธเนเธกเนเธกเธตเธฃเธฒเธขเธเธทเนเธญเธญเธฒเธเธฒเธฃเธขเนเนเธเธฃเธฐเธเธ เธเธฅเธดเธเธเธธเนเธก "+ เน€เธเธดเนเธกเธญเธฒเธเธฒเธฃเธขเนเนเธซเธกเน" เธ”เนเธฒเธเธเธเน€เธเธทเนเธญเน€เธฃเธดเนเธกเธ•เนเธ
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = teachers.map((t, idx) => `
        <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition">
            <td class="py-3 px-3 text-slate-400 font-mono">${idx + 1}</td>
            <td class="py-3 px-3 font-bold text-slate-800 flex items-center gap-2">
                <div class="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold">
                    ${escapeHtml((t.name || 'เธญ').charAt(0))}
                </div>
                <span>${escapeHtml(t.name)}</span>
            </td>
            <td class="py-3 px-3 text-slate-600 font-mono">
                <span class="px-2 py-0.5 bg-slate-100 rounded text-[11px] font-semibold text-slate-700">
                    ${escapeHtml(t.teacher_code || t.code || '-')}
                </span>
            </td>
            <td class="py-3 px-3 text-slate-600">
                ${escapeHtml(t.department || t.dept || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ')}
            </td>
            <td class="py-3 px-3 font-mono text-slate-600">
                <div class="flex items-center gap-1.5">
                    <span id="teacher-pass-display-${t.id}">โ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ข</span>
                    <button type="button" onclick="toggleTeacherPasswordRow('${t.id}', '${escapeHtml(t.password || 'teacher1234')}')" class="text-slate-400 hover:text-indigo-600 text-xs p-1" title="เนเธชเธ”เธ/เธเนเธญเธเธฃเธซเธฑเธชเธเนเธฒเธ">
                        <i id="teacher-pass-icon-${t.id}" class="fas fa-eye text-[11px]"></i>
                    </button>
                </div>
            </td>
            <td class="py-3 px-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                    <button onclick="openTeacherModal('${t.id}')" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="เนเธเนเนเธเธเนเธญเธกเธนเธฅ">
                        <i class="fas fa-pen-to-square"></i>
                    </button>
                    <button onclick="deleteTeacher('${t.id}', '${escapeHtml(t.name)}')" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="เธฅเธเธญเธฒเธเธฒเธฃเธขเน">
                        <i class="fas fa-trash-can"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.toggleTeacherPasswordRow = function(teacherId, realPassword) {
    const textEl = document.getElementById(`teacher-pass-display-${teacherId}`);
    const iconEl = document.getElementById(`teacher-pass-icon-${teacherId}`);
    if (!textEl) return;

    if (textEl.textContent === 'โ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ข') {
        textEl.textContent = realPassword;
        if (iconEl) iconEl.className = 'fas fa-eye-slash text-[11px] text-indigo-600';
    } else {
        textEl.textContent = 'โ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ขโ€ข';
        if (iconEl) iconEl.className = 'fas fa-eye text-[11px] text-slate-400';
    }
};

window.openTeacherModal = function(teacherId) {
    const modal = document.getElementById('modal-teacher-form');
    if (!modal) return;

    const title = document.getElementById('teacher-modal-title');
    const modeInput = document.getElementById('teacher-form-mode');
    const idInput = document.getElementById('teacher-form-id');
    const nameInput = document.getElementById('teacher-form-name');
    const codeInput = document.getElementById('teacher-form-code');
    const deptSelect = document.getElementById('teacher-form-dept');
    const passInput = document.getElementById('teacher-form-password');

    if (teacherId) {
        const teachers = getLocalTeachers();
        const teacher = teachers.find(t => t.id === teacherId);
        if (teacher) {
            if (title) title.innerHTML = '<i class="fas fa-user-pen text-indigo-600"></i> เนเธเนเนเธเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเน';
            if (modeInput) modeInput.value = 'edit';
            if (idInput) idInput.value = teacher.id;
            if (nameInput) nameInput.value = teacher.name || '';
            if (codeInput) codeInput.value = teacher.teacher_code || teacher.code || '';
            if (deptSelect) deptSelect.value = teacher.department || teacher.dept || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ';
            if (passInput) passInput.value = teacher.password || '';
        }
    } else {
        if (title) title.innerHTML = '<i class="fas fa-user-plus text-indigo-600"></i> เน€เธเธดเนเธกเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ';
        if (modeInput) modeInput.value = 'create';
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (codeInput) codeInput.value = '';
        if (deptSelect) deptSelect.value = 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ';
        if (passInput) passInput.value = 'teacher1234';
    }

    modal.classList.remove('hidden');
};

window.closeTeacherModal = function() {
    const modal = document.getElementById('modal-teacher-form');
    if (modal) modal.classList.add('hidden');
};

window.toggleTeacherFormPassword = function() {
    const passInput = document.getElementById('teacher-form-password');
    const icon = document.getElementById('teacher-form-pass-icon');
    if (!passInput) return;

    if (passInput.type === 'password') {
        passInput.type = 'text';
        if (icon) icon.className = 'fas fa-eye-slash text-indigo-600';
    } else {
        passInput.type = 'password';
        if (icon) icon.className = 'fas fa-eye';
    }
};

window.saveTeacherFromForm = async function(event) {
    event.preventDefault();
    const mode = document.getElementById('teacher-form-mode')?.value || 'create';
    const id = document.getElementById('teacher-form-id')?.value || generatePseudoUUID();
    const name = document.getElementById('teacher-form-name')?.value.trim();
    const code = document.getElementById('teacher-form-code')?.value.trim();
    const dept = document.getElementById('teacher-form-dept')?.value || 'เน€เธ—เธเนเธเนเธฅเธขเธตเธเธธเธฃเธเธดเธเธ”เธดเธเธดเธ—เธฑเธฅ';
    const password = document.getElementById('teacher-form-password')?.value.trim();

    if (!name || !code || !password) {
        showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเนเนเธซเนเธเธฃเธเธ–เนเธงเธ', 'warning');
        return;
    }

    const allTeachers = getLocalTeachers();
    if (mode === 'create') {
        const existCode = allTeachers.find(t => (t.teacher_code || t.code) === code);
        if (existCode) {
            showCustomAlert({
                title: 'เธฃเธซเธฑเธชเธญเธฒเธเธฒเธฃเธขเนเธเนเธณ',
                message: `เธกเธตเธฃเธซเธฑเธชเธญเธฒเธเธฒเธฃเธขเน / Username "${code}" (${existCode.name}) เธญเธขเธนเนเนเธเธฃเธฐเธเธเนเธฅเนเธง`,
                icon: 'fas fa-triangle-exclamation'
            });
            return;
        }
    }

    const teacherObj = {
        id: id,
        teacher_code: code,
        name: name,
        department: dept,
        password: password,
        updated_at: new Date().toISOString()
    };

    saveLocalTeacher(teacherObj);

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            await state.supabaseClient.from('teachers').upsert({
                id: teacherObj.id,
                teacher_code: teacherObj.teacher_code,
                name: teacherObj.name,
                department: teacherObj.department,
                password: teacherObj.password
            }, { onConflict: 'id' });
        } catch (dbErr) {
            console.warn('[saveTeacher] Supabase sync notice:', dbErr);
        }
    }

    showToast(`เธเธฑเธเธ—เธถเธเธเนเธญเธกเธนเธฅ "${name}" เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง`, 'success');
    closeTeacherModal();
    loadAdminTeachersList();
};

window.deleteTeacher = function(teacherId, teacherName) {
    showCustomConfirm({
        title: 'เธขเธทเธเธขเธฑเธเธเธฒเธฃเธฅเธเธญเธฒเธเธฒเธฃเธขเน',
        message: `เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธฅเธเธฃเธฒเธขเธเธทเนเธญเธญเธฒเธเธฒเธฃเธขเน "${teacherName}" เนเธเนเธซเธฃเธทเธญเนเธกเน?\n(เธญเธฒเธเธฒเธฃเธขเนเธ—เนเธฒเธเธเธตเนเธเธฐเนเธกเนเธชเธฒเธกเธฒเธฃเธ–เน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธเนเธ”เนเธญเธตเธ)`,
        icon: 'fas fa-user-xmark',
        confirmText: 'เธฅเธเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเน',
        cancelText: 'เธขเธเน€เธฅเธดเธ',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalTeacher(teacherId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.from('teachers').delete().eq('id', teacherId);
                } catch (e) {}
            }
            showToast(`เธฅเธเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเน "${teacherName}" เน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง`, 'info');
            loadAdminTeachersList();
        }
    });
};

function setupAdminConfigForm() {
    const form = document.getElementById('form-admin-supabase-config');
    if (!form) return;

    form.onsubmit = (e) => {
        e.preventDefault();
        const rawUrl = document.getElementById('admin-config-url').value.trim();
        const key = document.getElementById('admin-config-key').value.trim();

        if (!rawUrl || !key) {
            showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธ—เธฑเนเธ Supabase URL เนเธฅเธฐ Key', 'warning');
            return;
        }

        const cleanUrl = cleanSupabaseUrl(rawUrl);
        document.getElementById('admin-config-url').value = cleanUrl;

        localStorage.setItem('EXAM_SUPABASE_URL', cleanUrl);
        localStorage.setItem('EXAM_SUPABASE_ANON_KEY', key);

        initSupabase();
        showToast('เธเธฑเธเธ—เธถเธเธเธฒเธฃเธ•เธฑเนเธเธเนเธฒ Supabase เธชเธณเน€เธฃเนเธเนเธฅเนเธง!', 'success');
    };
}

window.testSupabaseConnection = async function() {
    const rawUrl = document.getElementById('admin-config-url').value.trim();
    const key = document.getElementById('admin-config-key').value.trim();

    if (!rawUrl || !key) {
        showCustomAlert({
            title: 'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเนเธญเธกเธนเธฅ',
            message: 'เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธ—เธฑเนเธ Supabase Project URL เนเธฅเธฐ Anon Key เธเนเธญเธเธเธ”เธ—เธ”เธชเธญเธ',
            icon: 'fas fa-triangle-exclamation'
        });
        return;
    }

    const cleanUrl = cleanSupabaseUrl(rawUrl);
    document.getElementById('admin-config-url').value = cleanUrl;

    try {
        const tempClient = window.supabase.createClient(cleanUrl, key);
        const { data, error } = await tempClient.from('exams').select('id').limit(1);

        if (error) {
            if (error.message && (error.message.includes('relation') || error.message.includes('does not exist'))) {
                showCustomAlert({
                    title: 'เน€เธเธทเนเธญเธกเธ•เนเธญ Supabase เธชเธณเน€เธฃเนเธ!',
                    message: 'โ… เน€เธเธทเนเธญเธกเธ•เนเธญเธเธฒเธเธเนเธญเธกเธนเธฅเธชเธณเน€เธฃเนเธเนเธฅเนเธง\nโ ๏ธ เนเธ•เนเธขเธฑเธเนเธกเนเธเธเธ•เธฒเธฃเธฒเธเธเนเธญเธกเธนเธฅ เธเธฃเธธเธ“เธฒเธเธณเนเธเนเธ”เนเธเนเธเธฅเน supabase/schema.sql เนเธเธเธ” Run เนเธ SQL Editor เธเธเน€เธงเนเธ Supabase เน€เธเธทเนเธญเธชเธฃเนเธฒเธเธ•เธฒเธฃเธฒเธ',
                    icon: 'fas fa-circle-info'
                });
                return;
            }
            throw error;
        }

        showCustomAlert({
            title: 'เน€เธเธทเนเธญเธกเธ•เนเธญเธชเธณเน€เธฃเนเธ!',
            message: '๐ เธเธฒเธฃเน€เธเธทเนเธญเธกเธ•เนเธญเธเธฑเธเธเธฒเธเธเนเธญเธกเธนเธฅ Supabase เธชเธณเน€เธฃเนเธเธชเธกเธเธนเธฃเธ“เน 100%\nเธเนเธญเธกเธนเธฅเธญเธฒเธเธฒเธฃเธขเน เธเนเธญเธชเธญเธ เนเธฅเธฐเธเธฅเธเธฐเนเธเธเธเธฐเธ–เธนเธเธเธดเธเธเนเนเธเธเน€เธฃเธตเธขเธฅเนเธ—เธกเน',
            icon: 'fas fa-plug-circle-check'
        });
    } catch (err) {
        showCustomAlert({
            title: 'เน€เธเธทเนเธญเธกเธ•เนเธญเนเธกเนเธชเธณเน€เธฃเนเธ',
            message: 'โ เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เน€เธเธทเนเธญเธกเธ•เนเธญ Supabase เนเธ”เน: ' + err.message + '\n\n๐’ก เนเธเธฐเธเธณ: เธ•เธฃเธงเธเธชเธญเธเธงเนเธฒ Project URL เธญเธขเธนเนเนเธเธฃเธนเธเนเธเธ https://xxxx.supabase.co',
            icon: 'fas fa-triangle-exclamation'
        });
    }
};

window.switchAdminToTeacher = function() {
    state.currentUser = {
        role: 'teacher',
        id: '11111111-0000-0000-0000-000000000001',
        name: 'เธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธ (เธชเธดเธ—เธเธดเนเธญเธฒเธเธฒเธฃเธขเน)'
    };
    loadTeacherDashboard();
};

// ==============================================================================
// 9. FORM EVENT LISTENERS (CREATE COURSE, CREATE EXAM, ADD QUESTION)
// ==============================================================================

function setupGlobalFormEvents() {
    // 9.1 เธเธญเธฃเนเธกเธชเธฃเนเธฒเธเธฃเธฒเธขเธงเธดเธเธฒเนเธซเธกเน
    const formNewCourse = document.getElementById('form-create-course');
    if (formNewCourse) {
        formNewCourse.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('create-course-code').value.trim();
            const name = document.getElementById('create-course-name').value.trim();
            const year = document.getElementById('create-course-year')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
            const dept = document.getElementById('create-course-dept')?.value || 'เธ—เธฑเนเธเธซเธกเธ”';
            const desc = document.getElementById('create-course-desc').value.trim();

            if (!code || !name) {
                showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธฃเธซเธฑเธชเธงเธดเธเธฒเนเธฅเธฐเธเธทเนเธญเธฃเธฒเธขเธงเธดเธเธฒ', 'warning');
                return;
            }

            const newCourse = {
                id: generatePseudoUUID(),
                course_code: code,
                course_name: name,
                target_year: year,
                target_department: dept,
                description: desc,
                teacher_id: state.currentUser?.id || '11111111-0000-0000-0000-000000000001',
                teacher_name: state.currentUser?.name || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ',
                created_at: new Date().toISOString()
            };

            // 1. เธเธฑเธเธ—เธถเธเธฅเธ Local Cache / LocalStorage เธ—เธฑเธเธ—เธต
            saveLocalCourse(newCourse);

            // 2. เธ–เนเธฒเธ•เนเธญ Supabase เธญเธขเธนเน เนเธซเน Sync เธเธถเนเธ DB
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient
                        .from('courses')
                        .insert(newCourse);
                } catch (dbErr) {
                    console.warn('[Supabase Sync Warning]', dbErr);
                }
            }

            showToast(`เธชเธฃเนเธฒเธเธฃเธฒเธขเธงเธดเธเธฒ "${name}" เธชเธณเน€เธฃเนเธ!`, 'success');
            formNewCourse.reset();
            document.getElementById('modal-create-course').classList.add('hidden');
            loadTeacherCourses();
            populateCourseSelects();
        });
    }

    // 9.2 เธเธญเธฃเนเธกเธชเธฃเนเธฒเธเธเนเธญเธชเธญเธเนเธซเธกเน (เธฃเธฐเธเธธเธงเธดเธเธฒเนเธฅเธฐเธเธฅเธธเนเธกเน€เธเนเธฒเธซเธกเธฒเธข)
    const formNewExam = document.getElementById('form-create-exam');
    if (formNewExam) {
        formNewExam.addEventListener('submit', async (e) => {
            e.preventDefault();
            const courseId = document.getElementById('create-exam-course-select').value;
            const title = document.getElementById('create-exam-title').value.trim();
            const targetYear = document.getElementById('create-exam-target-year').value;
            const targetDept = document.getElementById('create-exam-target-dept').value;
            const targetRoom = document.getElementById('create-exam-target-room').value;
            const desc = document.getElementById('create-exam-desc').value.trim();
            const duration = document.getElementById('create-exam-duration').value;
            const maxSwitches = document.getElementById('create-exam-max-switches').value;
            const showScore = document.getElementById('create-exam-show-score')?.checked !== false;

            if (!title) {
                showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธเธทเนเธญเธเธธเธ”เธเนเธญเธชเธญเธ', 'warning');
                return;
            }

            const newExam = {
                id: generatePseudoUUID(),
                course_id: courseId || null,
                teacher_name: state.currentUser?.name || 'เธญเธฒเธเธฒเธฃเธขเนเธเธนเนเธชเธญเธ',
                title,
                description: desc,
                target_year: targetYear,
                target_department: targetDept,
                target_room: targetRoom,
                duration_minutes: Number(duration) || 60,
                max_tab_switches_allowed: Number(maxSwitches) || 3,
                show_score_immediately: showScore,
                is_active: true,
                created_at: new Date().toISOString()
            };

            // 1. เธเธฑเธเธ—เธถเธเธฅเธ Local Cache / LocalStorage เธ—เธฑเธเธ—เธต
            saveLocalExam(newExam);

            // 2. เธ–เนเธฒเธ•เนเธญ Supabase เธญเธขเธนเน เนเธซเน Sync เธเธถเนเธ DB
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient
                        .from('exams')
                        .insert(newExam);
                } catch (dbErr) {
                    console.warn('[Supabase Sync Warning]', dbErr);
                }
            }

            showToast(`เธชเธฃเนเธฒเธเธเธธเธ”เธเนเธญเธชเธญเธ "${title}" เธชเธณเน€เธฃเนเธ!`, 'success');
            formNewExam.reset();
            loadTeacherExamsList();
            await populateTeacherExamSelects();

            const modal = document.getElementById('modal-create-exam');
            if (modal) modal.classList.add('hidden');
        });
    }

    // 9.3 เธเธญเธฃเนเธกเน€เธเธดเนเธกเนเธเธ—เธขเนเน€เธ”เธตเนเธขเธงเธเธญเธเธญเธฒเธเธฒเธฃเธขเน
        const formAddQ = document.getElementById('form-teacher-add-question');
    if (formAddQ) {
        formAddQ.addEventListener('submit', async (e) => {
            e.preventDefault();
            const examId = document.getElementById('teacher-add-question-exam-select').value;
            let qText = document.getElementById('teacher-add-question-text').value.trim();
            const optA = document.getElementById('teacher-add-opt-a').value.trim();
            const optB = document.getElementById('teacher-add-opt-b').value.trim();
            const optC = document.getElementById('teacher-add-opt-c').value.trim();
            const optD = document.getElementById('teacher-add-opt-d').value.trim();
            const correctOpt = document.getElementById('teacher-add-correct-option').value;
            const points = document.getElementById('teacher-add-points').value;
            const explanation = document.getElementById('teacher-add-explanation').value.trim();
            const attachedImg = state.currentAddQuestionImage;

            if (!examId) {
                showToast('เธเธฃเธธเธ“เธฒเน€เธฅเธทเธญเธเธเธธเธ”เธเนเธญเธชเธญเธ', 'warning');
                return;
            }

            if (!qText && !attachedImg) {
                showToast('เธเธฃเธธเธ“เธฒเธเธดเธกเธเนเธเนเธญเธเธงเธฒเธกเธเธณเธ–เธฒเธก เธซเธฃเธทเธญเธญเธฑเธเนเธซเธฅเธ”เธฃเธนเธเธ เธฒเธเนเธเธ—เธขเน', 'warning');
                return;
            }

            if (!optA || !optB) {
                showToast('เธเธฃเธธเธ“เธฒเธเธฃเธญเธเธ•เธฑเธงเน€เธฅเธทเธญเธเธญเธขเนเธฒเธเธเนเธญเธข A เนเธฅเธฐ B', 'warning');
                return;
            }

            // If image is attached, embed tag [img:...] in question_text for seamless sync
            let fullQuestionText = qText;
            if (attachedImg) {
                fullQuestionText = `[img:${attachedImg}]` + (qText ? `\n${qText}` : '');
            }

            const options = [
                { id: 'A', text: optA },
                { id: 'B', text: optB }
            ];
            if (optC) options.push({ id: 'C', text: optC });
            if (optD) options.push({ id: 'D', text: optD });

            const newQ = {
                id: generatePseudoUUID(),
                exam_id: examId,
                question_text: fullQuestionText,
                image_url: attachedImg || null,
                options: options,
                points: Number(points) || 1.0,
                correct: correctOpt,
                explanation: explanation
            };

            // 1. เธเธฑเธเธ—เธถเธเธฅเธ Local Storage เธ—เธฑเธเธ—เธต
            saveLocalQuestion(newQ);

            // 2. เธ–เนเธฒเธ•เนเธญ Supabase เนเธ”เน เนเธซเน Sync
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.rpc('create_question_with_answer', {
                        p_exam_id: examId,
                        p_question_text: fullQuestionText,
                        p_options: options,
                        p_points: Number(points) || 1.0,
                        p_correct_option_id: correctOpt,
                        p_explanation: explanation,
                        p_order_seq: 0
                    });
                } catch (dbErr) {
                    console.warn('[Supabase Sync Warning]', dbErr);
                }
            }

            showToast('เน€เธเธดเนเธกเนเธเธ—เธขเนเนเธฅเธฐเน€เธเธฅเธขเธฅเธฑเธเธชเธณเน€เธฃเนเธ!', 'success');
            document.getElementById('teacher-add-question-text').value = '';
            document.getElementById('teacher-add-opt-a').value = '';
            document.getElementById('teacher-add-opt-b').value = '';
            document.getElementById('teacher-add-opt-c').value = '';
            document.getElementById('teacher-add-opt-d').value = '';
            document.getElementById('teacher-add-explanation').value = '';
            removeTeacherQuestionImage();
        });
    }

    }

// ==============================================================================
// 10. CUSTOM IN-APP MODAL DIALOGS (REPLACE NATIVE POPUPS)
// ==============================================================================

/**
 * Modern In-App Confirmation Modal (Replaces window.confirm)
 */
function showCustomConfirm(options) {
    const {
        title = 'เธขเธทเธเธขเธฑเธเธเธฒเธฃเธ—เธณเธฃเธฒเธขเธเธฒเธฃ',
        message = 'เธเธธเธ“เธ•เนเธญเธเธเธฒเธฃเธ”เธณเน€เธเธดเธเธเธฒเธฃเธ•เนเธญเนเธเนเธซเธฃเธทเธญเนเธกเน?',
        icon = 'fas fa-question',
        confirmText = 'เธ•เธเธฅเธ',
        cancelText = 'เธขเธเน€เธฅเธดเธ',
        confirmClass = 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md',
        onConfirm = null,
        onCancel = null
    } = options;

    const modal = document.getElementById('modal-custom-confirm');
    const titleEl = document.getElementById('custom-confirm-title');
    const msgEl = document.getElementById('custom-confirm-message');
    const iconEl = document.getElementById('custom-confirm-icon');
    const btnOk = document.getElementById('custom-confirm-btn-ok');
    const btnCancel = document.getElementById('custom-confirm-btn-cancel');

    if (!modal) return;

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.className = icon;
    if (btnOk) {
        btnOk.textContent = confirmText;
        btnOk.className = `flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition ${confirmClass}`;
    }
    if (btnCancel) btnCancel.textContent = cancelText;

    const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.onclick = null;
        btnCancel.onclick = null;
    };

    btnOk.onclick = () => {
        cleanup();
        if (typeof onConfirm === 'function') onConfirm();
    };

    btnCancel.onclick = () => {
        cleanup();
        if (typeof onCancel === 'function') onCancel();
    };

    modal.classList.remove('hidden');
}

/**
 * Modern In-App Alert Modal (Replaces window.alert)
 */
function showCustomAlert(options) {
    const {
        title = 'เนเธเนเธเน€เธ•เธทเธญเธ',
        message = '',
        icon = 'fas fa-circle-exclamation',
        buttonText = 'เธ•เธเธฅเธ',
        onOk = null
    } = options;

    const modal = document.getElementById('modal-custom-alert');
    const titleEl = document.getElementById('custom-alert-title');
    const msgEl = document.getElementById('custom-alert-message');
    const iconEl = document.getElementById('custom-alert-icon');
    const btnOk = document.getElementById('custom-alert-btn-ok');

    if (!modal) return;

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.className = icon;
    if (btnOk) btnOk.textContent = buttonText;

    btnOk.onclick = () => {
        modal.classList.add('hidden');
        btnOk.onclick = null;
        if (typeof onOk === 'function') onOk();
    };

    modal.classList.remove('hidden');
}

// Override native window.alert to never show browser's ugly popups
window.alert = function(message) {
    showToast(message, 'info');
};

// ==============================================================================
// 11. HELPERS & ENTRY POINT
// ==============================================================================

function generatePseudoUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function generateTeacherUUID(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i);
        hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `11111111-${hex.slice(0, 4)}-4000-8000-${hex.repeat(3).slice(0, 12)}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-600 text-white',
        warning: 'bg-amber-500 text-white',
        error: 'bg-red-600 text-white',
        info: 'bg-indigo-600 text-white'
    };

    toast.className = `fixed bottom-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl font-medium text-sm flex items-center gap-2 animate-slide-down ${colors[type] || colors.info}`;
    toast.innerHTML = `<i class="fas fa-info-circle"></i> <span>${escapeHtml(msg)}</span>`;

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3500);
}

document.addEventListener('DOMContentLoaded', () => {
    // เธฅเนเธฒเธเธเนเธญเธกเธนเธฅเธเธธเธ”เธ—เธ”เธชเธญเธเธ•เธฑเธงเธญเธขเนเธฒเธ (Dummy) เน€เธเนเธฒเธญเธญเธเธเธฒเธ LocalStorage
    try {
        const rawExams = localStorage.getItem('EXAM_LOCAL_EXAMS');
        if (rawExams) {
            const parsed = JSON.parse(rawExams).filter(e => e.id !== '11111111-1111-1111-1111-111111111111');
            localStorage.setItem('EXAM_LOCAL_EXAMS', JSON.stringify(parsed));
        }
        const rawCourses = localStorage.getItem('EXAM_LOCAL_COURSES');
        if (rawCourses) {
            const parsed = JSON.parse(rawCourses).filter(c => c.id !== '33333333-3333-3333-3333-333333333331');
            localStorage.setItem('EXAM_LOCAL_COURSES', JSON.stringify(parsed));
        }
        const rawQuestions = localStorage.getItem('EXAM_LOCAL_QUESTIONS');
        if (rawQuestions) {
            const parsed = JSON.parse(rawQuestions).filter(q => !q.id?.startsWith('22222222-'));
            localStorage.setItem('EXAM_LOCAL_QUESTIONS', JSON.stringify(parsed));
        }
    } catch (e) {}

    initSupabase();
    initGlobalRealtimeSync();
    setupAuthEvents();
    setupGlobalFormEvents();

    // เธเธนเนเธเธทเธ Session เธเธญเธเนเธ—เนเธเธเธฑเธเธเธธเธเธฑเธ (เน€เธเธทเนเธญเนเธซเนเธญเธฒเธเธฒเธฃเธขเน/เธเธฑเธเน€เธฃเธตเธขเธเนเธกเนเธ•เนเธญเธเธฅเนเธญเธเธญเธดเธเธเนเธณเน€เธกเธทเนเธญเธเธ” Refresh)
    try {
        const savedSession = sessionStorage.getItem('EXAM_SESSION_USER');
        if (savedSession) {
            const user = JSON.parse(savedSession);
            if (user && user.role) {
                state.currentUser = user;
                if (user.role === 'teacher') {
                    const portalNameEl = document.getElementById('teacher-portal-name');
                    if (portalNameEl) portalNameEl.textContent = user.name;
                    loadTeacherDashboard();
                    return;
                } else if (user.role === 'admin') {
                    loadAdminDashboard();
                    return;
                } else if (user.role === 'student') {
                    const badge = document.getElementById('student-class-badge');
                    if (badge) badge.textContent = `${user.year} | ${user.dept} | ${user.room}`;
                    loadStudentLobby();
                    return;
                }
            }
        }
    } catch (e) {}

    showView('view-auth');
});