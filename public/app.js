/**
 * ==============================================================================
 * EXAMSECURE PRO - MAIN FRONTEND APPLICATION (SPA)
 * ==============================================================================
 * 1. 3-Role Access: Student (นักเรียน), Teacher (อาจารย์), Admin (ผู้ดูแลระบบ)
 * 2. Teacher Course Management: จัดการรายวิชาของครูแต่ละคน
 * 3. Classroom Targeting: กำหนดระดับชั้น (Year), แผนกวิชา (Dept), ห้องเรียน (Room)
 * 4. Student Auto-Filtering: นักเรียนเห็นเฉพาะข้อสอบของกลุ่มตนเอง
 * 5. Excel Import & Export (SheetJS Engine): นำเข้าข้อสอบ & ส่งออกคะแนนจำแนกห้อง
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
        showToast('กรุณาเลือกไฟล์รูปภาพเท่านั้น (JPG, PNG, WebP)', 'warning');
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

            showToast('อัปโหลดและบีบอัดรูปภาพเรียบร้อยแล้ว!', 'success');
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
        if (optA) optA.value = 'ก';
        if (optB) optB.value = 'ข';
        if (optC) optC.value = 'ค';
        if (optD) optD.value = 'ง';
    } else if (type === 'TF') {
        if (optA) optA.value = 'ถูก (True)';
        if (optB) optB.value = 'ผิด (False)';
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
    // ถ้าผู้ใช้วาง URL หน้า Dashboard เช่น https://supabase.com/dashboard/project/ividsfcwvhngsojtzwjt...
    const dashboardMatch = url.match(/dashboard\/project\/([a-zA-Z0-9_-]+)/);
    if (dashboardMatch && dashboardMatch[1]) {
        return `https://${dashboardMatch[1]}.supabase.co`;
    }
    // ถ้าผู้ใช้มี path ต่อท้าย เช่น https://ividsfcwvhngsojtzwjt.supabase.co/settings/api-keys
    const coMatch = url.match(/(https?:\/\/[a-zA-Z0-9_-]+\.supabase\.co)/);
    if (coMatch && coMatch[1]) {
        return coMatch[1];
    }
    // ตัด trailing slash
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
        // 1. ดึงข้อมูลรายชื่ออาจารย์จากคลาวด์ลงมือถือ/ทุกอุปกรณ์
        const { data: dbTeachers, error: tErr } = await state.supabaseClient
            .from('teachers')
            .select('*');
        if (!tErr && Array.isArray(dbTeachers) && dbTeachers.length > 0) {
            localStorage.setItem('EXAM_LOCAL_TEACHERS', JSON.stringify(dbTeachers));
        }

        // 2. ดึงรายวิชา
        const { data: dbCourses, error: cErr } = await state.supabaseClient
            .from('courses')
            .select('*');
        if (!cErr && Array.isArray(dbCourses) && dbCourses.length > 0) {
            localStorage.setItem('EXAM_LOCAL_COURSES', JSON.stringify(dbCourses));
            state.courses = dbCourses;
        }

        // 3. ดึงชุดข้อสอบ
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
                    department: t.department || t.dept || 'เทคโนโลยีธุรกิจดิจิทัล',
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
                    target_year: c.target_year || 'ทั้งหมด',
                    target_department: c.target_department || 'ทั้งหมด',
                    teacher_id: c.teacher_id || '11111111-0000-0000-0000-000000000001',
                    teacher_name: c.teacher_name || 'อาจารย์ผู้สอน'
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
                    teacher_name: e.teacher_name || 'อาจารย์ผู้สอน',
                    title: e.title,
                    description: e.description || '',
                    duration_minutes: Number(e.duration_minutes) || 60,
                    is_active: e.is_active !== false,
                    max_tab_switches_allowed: Number(e.max_tab_switches_allowed) || 3,
                    target_year: e.target_year || 'ทั้งหมด',
                    target_department: e.target_department || 'ทั้งหมด',
                    target_room: e.target_room || 'ทั้งหมด'
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

    // ลบชุดข้อสอบทั้งหมดที่ผูกกับรายวิชานี้
    const allExams = getLocalExams();
    const removedExamIds = allExams.filter(e => e.course_id === courseId).map(e => e.id);
    const remainingExams = allExams.filter(e => e.course_id !== courseId);
    localStorage.setItem('EXAM_LOCAL_EXAMS', JSON.stringify(remainingExams));
    state.localExams = remainingExams;

    // ลบคำถามทั้งหมดของชุดข้อสอบที่ถูกลบ
    if (removedExamIds.length > 0) {
        const remainingQuestions = getLocalQuestions().filter(q => !removedExamIds.includes(q.exam_id));
        localStorage.setItem('EXAM_LOCAL_QUESTIONS', JSON.stringify(remainingQuestions));
    }

    broadcastAppEvent('course_deleted', { courseId, removedExamIds });
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

function deleteLocalTeacher(teacherId, teacherName = '') {
    const teachers = getLocalTeachers();
    const targetTeacher = teachers.find(t => t.id === teacherId || (teacherName && t.name === teacherName));
    const cleanTeacherName = (targetTeacher?.name || teacherName || '').trim().toLowerCase();

    // 1. ลบรายชื่ออาจารย์
    const remainingTeachers = teachers.filter(t => t.id !== teacherId && (!cleanTeacherName || t.name.trim().toLowerCase() !== cleanTeacherName));
    localStorage.setItem('EXAM_LOCAL_TEACHERS', JSON.stringify(remainingTeachers));

    // 2. ค้นหาและลบรายวิชาทั้งหมดของอาจารย์ท่านนี้
    const allCourses = getLocalCourses();
    const removedCourses = allCourses.filter(c => 
        (c.teacher_id && c.teacher_id === teacherId) ||
        (cleanTeacherName && c.teacher_name && c.teacher_name.trim().toLowerCase() === cleanTeacherName)
    );
    const removedCourseIds = removedCourses.map(c => c.id);
    const remainingCourses = allCourses.filter(c => !removedCourseIds.includes(c.id));
    localStorage.setItem('EXAM_LOCAL_COURSES', JSON.stringify(remainingCourses));
    state.courses = remainingCourses;

    // 3. ค้นหาและลบชุดข้อสอบทั้งหมดที่อาจารย์ท่านนี้สร้าง หรือผูกกับวิชาของอาจารย์
    const allExams = getLocalExams();
    const removedExams = allExams.filter(e => 
        (cleanTeacherName && e.teacher_name && e.teacher_name.trim().toLowerCase() === cleanTeacherName) ||
        (e.course_id && removedCourseIds.includes(e.course_id))
    );
    const removedExamIds = removedExams.map(e => e.id);
    const remainingExams = allExams.filter(e => !removedExamIds.includes(e.id));
    localStorage.setItem('EXAM_LOCAL_EXAMS', JSON.stringify(remainingExams));
    state.localExams = remainingExams;

    // 4. ลบคำถามทั้งหมดของชุดข้อสอบที่ถูกลบ
    if (removedExamIds.length > 0) {
        const remainingQuestions = getLocalQuestions().filter(q => !removedExamIds.includes(q.exam_id));
        localStorage.setItem('EXAM_LOCAL_QUESTIONS', JSON.stringify(remainingQuestions));
    }

    broadcastAppEvent('teacher_roster_updated', { teacherId });
    broadcastAppEvent('course_updated', {});
    broadcastAppEvent('exam_updated', {});
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
                showToast(`🔔 มีชุดข้อสอบใหม่เปิดให้เข้าสอบ: "${payload.title || 'ชุดข้อสอบ'}"`, 'info');
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
        // 1.1 Student Retake Unlocked Event (อาจารย์ปลดล็อกให้สอบใหม่)
    if (type === 'student_retake_unlocked') {
        const isStudentLobby = state.currentView === 'view-student-lobby' || (document.getElementById('view-student-lobby') && !document.getElementById('view-student-lobby').classList.contains('hidden'));
        if (isStudentLobby && state.currentUser?.role === 'student') {
            const currentStudentId = state.currentUser.id;
            const currentStudentCode = state.currentUser.student_code || state.currentUser.code;
            if (!payload || payload.studentId === currentStudentId || payload.studentId === currentStudentCode) {
                loadStudentLobby();
                showToast('อาจารย์ได้ปลดล็อกให้คุณเข้าทำข้อสอบใหม่อีกครั้งแล้ว!', 'success');
            }
        }
    }

    if (type === 'student_submission') {
        const isTeacherView = state.currentView === 'view-teacher' || (document.getElementById('view-teacher') && !document.getElementById('view-teacher').classList.contains('hidden'));
        if (isTeacherView) {
            console.log('[Realtime] Student submitted exam, auto-updating submissions table...');
            loadTeacherSubmissions();
            const studentName = payload.student_name || 'นักเรียน';
            const examTitle = payload.exam_title || 'ชุดข้อสอบ';
            const scoreText = `${payload.total_score}/${payload.max_score} (${payload.percentage}%)`;
            showToast(`📝 ${studentName} ส่งข้อสอบ "${examTitle}" แล้ว [${scoreText}]`, 'success');
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
                roleBadge.textContent = '⚙️ แอดมิน';
                roleBadge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-700 border border-purple-300';
            } else if (state.currentUser.role === 'teacher') {
                roleBadge.textContent = `👨‍🏫 ${state.currentUser.name}`;
                roleBadge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300';
            } else {
                roleBadge.textContent = `👨‍🎓 ${state.currentUser.year} ${state.currentUser.room}`;
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

    // 3.1 ฟอร์มนักเรียน (ล็อกอินด้วย รหัสนักเรียน/ชื่อ และ เลขบัตรประชาชน 13 หลัก)
    if (formStudent) {
        formStudent.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginId = document.getElementById('student-login-id-input')?.value.trim();
            const citizenPass = document.getElementById('student-login-pass-input')?.value.trim();

            if (!loginId) {
                showToast('กรุณากรอกรหัสนักเรียน หรือ ชื่อ-นามสกุล', 'warning');
                return;
            }

            if (!citizenPass || citizenPass.length !== 13) {
                showCustomAlert({
                    title: 'เลขบัตรประชาชนไม่ถูกต้อง',
                    message: 'กรุณากรอกเลขบัตรประจำตัวประชาชนให้ครบ 13 หลัก\n(ใช้เป็นรหัสผ่านเข้าสอบ)',
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
                            title: 'รหัสผ่านไม่ถูกต้อง',
                            message: `พบรายชื่อ "${studentById.name}" ในระบบ\nแต่เลขบัตรประจำตัวประชาชน 13 หลัก (รหัสผ่าน) ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง`,
                            icon: 'fas fa-lock'
                        });
                        return;
                    }

                    showCustomAlert({
                        title: 'ไม่พบข้อมูลนักเรียนในระบบ',
                        message: `ไม่พบรหัสนักเรียนหรือชื่อ "${loginId}" ที่อาจารย์ได้ลงทะเบียนไว้\nกรุณาตรวจสอบหรือติดต่ออาจารย์ผู้สอนเพื่อเพิ่มรายชื่อก่อนเข้าสอบ`,
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
                    year: 'ปวช.2',
                    dept: 'เทคโนโลยีธุรกิจดิจิทัล',
                    room: 'ห้อง 1'
                };
                saveLocalStudent(matchedStudent);
            }

            state.currentUser = {
                role: 'student',
                id: matchedStudent.id || generatePseudoUUID(),
                student_code: matchedStudent.code,
                name: matchedStudent.name,
                citizen_id: matchedStudent.citizen_id,
                year: matchedStudent.year || 'ปวช.2',
                dept: matchedStudent.dept || 'เทคโนโลยีธุรกิจดิจิทัล',
                room: matchedStudent.room || 'ห้อง 1'
            };
            try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}

            const badge = document.getElementById('student-class-badge');
            if (badge) badge.textContent = `${state.currentUser.year} | ${state.currentUser.dept} | ${state.currentUser.room}`;

            showToast(`ยินดีต้อนรับคุณ ${state.currentUser.name} (${state.currentUser.year} ${state.currentUser.room})`, 'success');
            loadStudentLobby();
        });
    }

    // 3.2 ฟอร์มอาจารย์ (ระบุชื่ออาจารย์/รหัสอาจารย์ และ รหัสผ่านประจำตัว)
    if (formTeacher) {
        formTeacher.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginInput = document.getElementById('teacher-name-input').value.trim();
            const password = document.getElementById('teacher-password-input').value.trim();

            if (!loginInput || !password) {
                showToast('กรุณากรอกชื่อ-นามสกุล หรือ รหัสอาจารย์ และ รหัสผ่าน', 'warning');
                return;
            }

            let registeredTeachers = getLocalTeachers();

            // ดึงข้อมูลอาจารย์ล่าสุดจาก Supabase Cloud (สำหรับมือถือหรือเครื่องอื่นที่เพิ่งเปิดเว็บ)
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
                        dept: matchedTeacher.department || matchedTeacher.dept || 'เทคโนโลยีธุรกิจดิจิทัล'
                    };
                    try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}

                    const portalNameEl = document.getElementById('teacher-portal-name');
                    if (portalNameEl) portalNameEl.textContent = `${matchedTeacher.name} (${matchedTeacher.department || 'อาจารย์ผู้สอน'})`;

                    showToast(`ยินดีต้อนรับ ${matchedTeacher.name}`, 'success');
                    loadTeacherDashboard();
                    return;
                }

                // เช็คว่าชื่ออาจารย์มีในระบบแต่รหัสผ่านผิดหรือไม่
                const teacherExists = registeredTeachers.find(t => 
                    t.name.trim().toLowerCase() === cleanLogin || 
                    (t.teacher_code && t.teacher_code.trim().toLowerCase() === cleanLogin) ||
                    (t.code && String(t.code).trim().toLowerCase() === cleanLogin)
                );

                if (teacherExists) {
                    showCustomAlert({
                        title: 'รหัสผ่านไม่ถูกต้อง',
                        message: `พบข้อมูลอาจารย์ "${teacherExists.name}" ในระบบ\nแต่รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบและลองใหม่อีกครั้ง`,
                        icon: 'fas fa-lock'
                    });
                    return;
                }

                showCustomAlert({
                    title: 'ไม่พบบัญชีอาจารย์ในระบบ',
                    message: `ไม่พบชื่อหรือรหัสอาจารย์ "${loginInput}" ในระบบ\nกรุณาติดต่อผู้ดูแลระบบ (Admin) เพื่อเพิ่มรายชื่ออาจารย์เข้าสู่ระบบ`,
                    icon: 'fas fa-user-xmark'
                });
                return;
            } else {
                // กรณีระบบยังไม่มีการลงทะเบียนอาจารย์เลย ให้ใช้ค่าเริ่มต้น
                if (password === 'teacher1234' || password === 'teacher' || password === 'admin1234') {
                    const teacherId = generateTeacherUUID(loginInput);

                    state.currentUser = {
                        role: 'teacher',
                        id: teacherId,
                        name: loginInput,
                        code: 'T001',
                        dept: 'เทคโนโลยีธุรกิจดิจิทัล'
                    };
                    try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}

                    const portalNameEl = document.getElementById('teacher-portal-name');
                    if (portalNameEl) portalNameEl.textContent = loginInput;

                    showToast(`ยินดีต้อนรับ ${loginInput}`, 'success');
                    loadTeacherDashboard();
                } else {
                    showCustomAlert({
                        title: 'รหัสผ่านไม่ถูกต้อง',
                        message: 'รหัสผ่านสำหรับอาจารย์ไม่ถูกต้อง กรุณาตรวจสอบและลองใหม่อีกครั้ง',
                        icon: 'fas fa-lock'
                    });
                }
            }
        });
    }

    // 3.3 ฟอร์มแอดมิน
    if (formAdmin) {
        formAdmin.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = document.getElementById('admin-password-input').value;

            if (password === 'admin9999' || password === 'admin1234' || password === 'admin') {
                state.currentUser = {
                    role: 'admin',
                    id: '00000000-0000-0000-0000-000000000001',
                    name: 'ผู้ดูแลระบบสูงสุด (Admin)'
                };
                try { sessionStorage.setItem('EXAM_SESSION_USER', JSON.stringify(state.currentUser)); } catch (e) {}
                showToast('เข้าสู่ระบบแอดมินสำเร็จ', 'success');
                loadAdminDashboard();
            } else {
                showCustomAlert({
                    title: 'รหัสผ่านไม่ถูกต้อง',
                    message: 'รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง กรุณาตรวจสอบและลองใหม่อีกครั้ง',
                    icon: 'fas fa-shield-cat'
                });
            }
        });
    }

    // ปุ่มออกจากระบบ (Custom In-App Modal - No browser popup!)
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            showCustomConfirm({
                title: 'ออกจากระบบ',
                message: 'คุณต้องการออกจากระบบและกลับสู่หน้าหลักหรือไม่?',
                icon: 'fas fa-arrow-right-from-bracket',
                confirmText: 'ออกจากระบบ',
                cancelText: 'ยกเลิก',
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
                    showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
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
    showToast('🔄 อัปเดตข้อมูลและสิทธิ์การสอบล่าสุดเรียบร้อยแล้ว!', 'success');

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

    // ดึงประวัติการส่งข้อสอบของนักเรียนคนนี้ เพื่อตรวจสอบว่าเคยทำข้อสอบไปแล้วหรือไม่
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
                // ถ้า Supabase คืนค่ามาแล้ว (รวมถึงกรณีเป็น 0 คน/ปลดล็อกแล้ว)
                // ให้ลบแคชข้อสอบที่ไม่มีใน Cloud ออกจาก LocalStorage ของเครื่องนี้ทันที!
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
        // ออฟไลน์ fallback
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

    // คัดกรองเฉพาะข้อสอบที่ตรงกับกลุ่มของนักเรียน (หรือเป็น 'ทั้งหมด')
    const eligibleExams = (exams || []).filter(exam => isExamEligibleForStudent(exam, state.currentUser));

    if (eligibleExams.length === 0) {
        listContainer.innerHTML = `
            <div class="col-span-full bg-white rounded-3xl p-10 text-center border border-slate-100 shadow-sm">
                <i class="fas fa-file-signature text-5xl text-slate-300 mb-4"></i>
                <h3 class="text-lg font-bold text-slate-800">ยังไม่มีชุดข้อสอบสำหรับกลุ่มของคุณในขณะนี้</h3>
                <p class="text-slate-500 text-xs mt-1">
                    กลุ่มของคุณ: <strong>${state.currentUser?.year || ''} | ${state.currentUser?.dept || ''} | ${state.currentUser?.room || ''}</strong>
                </p>
                <p class="text-slate-400 text-xs mt-2">กรุณารออาจารย์ประจำวิชาเปิดชุดข้อสอบ</p>
            </div>
        `;
        return;
    }

    listContainer.innerHTML = eligibleExams.map(exam => {
        const matchedCourse = getLocalCourses().find(c => c.id === exam.course_id);
        const courseCode = matchedCourse?.course_code || exam.course?.course_code || 'ทั่วไป';
        const courseName = matchedCourse?.course_name || exam.course?.course_name || 'วิชาทั่วไป';
        const teacher = exam.teacher_name || 'อาจารย์ผู้สอน';

        const targetTag = `${exam.target_year || 'ทุกชั้น'} | ${exam.target_department || 'ทุกแผนก'} | ${exam.target_room || 'ทุกห้อง'}`;

        // เช็คว่าทำข้อสอบชุดนี้ไปแล้วหรือไม่
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
                                <i class="fas fa-check-circle"></i> ทำแล้ว
                            </span>
                        ` : `
                            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700">เปิดสอบ</span>
                        `}
                    </div>

                    <h3 class="text-base font-bold text-slate-900 mb-1.5 leading-snug">${escapeHtml(exam.title)}</h3>
                    <p class="text-xs text-slate-500 mb-3 flex items-center gap-1.5">
                        <i class="fas fa-chalkboard-user text-slate-400"></i> สอนโดย: <strong class="text-slate-700">${escapeHtml(teacher)}</strong>
                    </p>
                    <p class="text-slate-600 text-xs mb-4 line-clamp-2">${escapeHtml(exam.description || 'ไม่มีคำอธิบายเพิ่มเติม')}</p>
                    
                    <!-- Target Audience Badge -->
                    <div class="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/60 text-[11px] text-amber-900 mb-4 flex items-center gap-1.5">
                        <i class="fas fa-bullseye text-amber-600"></i>
                        <span>เป้าหมาย: <strong>${escapeHtml(targetTag)}</strong></span>
                    </div>
                </div>

                ${isCompleted ? `
                    <div class="pt-4 border-t border-emerald-100">
                        <div class="p-3 bg-emerald-50 border border-emerald-200/80 rounded-2xl mb-3 text-center">
                            <div class="text-xs font-bold text-emerald-800 flex items-center justify-center gap-1.5 mb-1">
                                <i class="fas fa-circle-check text-emerald-600"></i> ทำข้อสอบเสร็จสิ้นแล้ว
                            </div>
                            ${(exam.show_score_immediately !== false) ? `
                                <div class="text-xs text-emerald-700">
                                    คะแนน: <strong>${pastSubmission.total_score} / ${pastSubmission.max_score}</strong> (${pastSubmission.percentage}%)
                                </div>
                            ` : `
                                <div class="text-xs text-blue-700 font-medium flex items-center justify-center gap-1">
                                    <i class="fas fa-clock text-blue-500"></i> รอประกาศคะแนนจากอาจารย์
                                </div>
                            `}
                        </div>

                        <button disabled class="w-full py-2.5 px-4 bg-slate-100 text-slate-400 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-not-allowed border border-slate-200">
                            <i class="fas fa-lock text-slate-400"></i> สอบไปแล้ว (ไม่อนุญาตให้ทำซ้ำ)
                        </button>
                        <p class="text-[10px] text-slate-400 text-center mt-1.5">
                            * หากต้องการทำใหม่ กรุณาติดต่ออาจารย์ผู้สอนเพื่อปลดล็อก
                        </p>
                    </div>
                ` : `
                    <div class="pt-4 border-t border-slate-100">
                        <div class="grid grid-cols-2 gap-2 text-xs text-slate-500 mb-4">
                            <div><i class="far fa-clock mr-1 text-indigo-500"></i> เวลา: <strong>${exam.duration_minutes || 60} นาที</strong></div>
                            <div><i class="far fa-question-circle mr-1 text-indigo-500"></i> ชุดข้อสอบ: <strong>พร้อมทำ</strong></div>
                            <div class="col-span-2 text-amber-700 text-[11px]"><i class="fas fa-eye mr-1"></i> อนุญาตสลับจอ: <strong>${exam.max_tab_switches_allowed || 3} ครั้ง</strong></div>
                        </div>

                        <button onclick="startExam('${exam.id}')" class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-sm">
                            <i class="fas fa-play text-xs"></i> เข้าทำข้อสอบ
                        </button>
                    </div>
                `}
            </div>
        `;
    }).join('');
}

function isExamEligibleForStudent(exam, student) {
    if (!student || student.role !== 'student') return true;

    // ตรวจสอบระดับชั้น
    const yearMatch = !exam.target_year || exam.target_year === 'ทั้งหมด' || exam.target_year === student.year;
    // ตรวจสอบแผนกวิชา
    const deptMatch = !exam.target_department || exam.target_department === 'ทั้งหมด' || exam.target_department === student.dept;
    // ตรวจสอบห้องเรียน
    const roomMatch = !exam.target_room || exam.target_room === 'ทั้งหมด' || exam.target_room === student.room;

    return yearMatch && deptMatch && roomMatch;
}

// เริ่มการสอบ
window.startExam = async function(examId) {
    // ป้องกันกดซ้ำ
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
            showToast('ไม่พบข้อมูลชุดข้อสอบ', 'error');
            return;
        }

        // ตรวจสอบว่านักเรียนเคยส่งข้อสอบชุดนี้ไปแล้วหรือไม่
        let isAlreadySubmitted = false;
        if (isSupabaseConfigured() && state.supabaseClient && state.currentUser) {
            try {
                const studentId = state.currentUser.id;
                const studentName = state.currentUser.name || '';

                // ค้นหาด้วยชื่อก่อน (สำคัญที่สุด)
                let { data: byName } = await state.supabaseClient
                    .from('exam_results')
                    .select('id')
                    .eq('exam_id', examId)
                    .eq('student_name', studentName);

                // ถ้าไม่เจอด้วยชื่อ ลองด้วย UUID
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
                    // Cloud ยืนยันว่าไม่มีผลสอบแล้ว → ล้างแคชเก่าออก
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
                title: 'คุณได้ทำข้อสอบชุดนี้ไปแล้ว',
                message: `คุณได้ส่งคำตอบสำหรับชุดข้อสอบ "${exam.title}" เรียบร้อยแล้ว และไม่อนุญาตให้ทำซ้ำ\n\nหากมีเหตุจำเป็นต้องสอบใหม่ กรุณาติดต่ออาจารย์ผู้สอนเพื่อกดเปิด/ปลดล็อกให้สอบใหม่ครับ`,
                icon: 'fas fa-lock'
            });
            return;
        }

        if (!questions || questions.length === 0) {
            showCustomAlert({
                title: 'ยังไม่มีคำถาม',
                message: 'ชุดข้อสอบนี้ยังไม่มีคำถาม กรุณาติดต่ออาจารย์ประจำวิชาเพื่อเพิ่มโจทย์หรือนำเข้า Excel',
                icon: 'fas fa-circle-info'
            });
            return;
        }

        // ตรวจจับ Split Screen
        if (isSplitScreenDetected()) {
            showCustomAlert({
                title: 'ตรวจพบการแบ่งหน้าจอ',
                message: 'ตรวจพบว่ามีการใช้งานแบ่งหน้าจอ (Split Screen / Pop-up Window)\n\nระบบไม่อนุญาตให้เข้าทำข้อสอบ กรุณาขยายเต็มหน้าจอก่อนเริ่มสอบ',
                icon: 'fas fa-triangle-exclamation'
            });
            return;
        }

        showCustomConfirm({
            title: 'เริ่มเข้าทำข้อสอบ?',
            message: `ชุดข้อสอบ: ${exam.title}\nวิชา: ${exam.course?.course_name || 'ทั่วไป'}\nเวลาทำข้อสอบ: ${exam.duration_minutes || 60} นาที (${questions.length} ข้อ)\n\n🛡️ กฎระเบียบระหว่างการสอบ:\n1. กรุณาปิดหน้าต่างแชทลอย (Messenger / LINE Bubbles) ทั้งหมดก่อนเริ่ม\n2. ห้ามสลับหน้าจอ ห้ามแคปจอ และห้ามออกจากโหมดเต็มจอเด็ดขาด\n3. การเปิดแชทระหว่างสอบจะถูกบันทึกเป็นพฤติกรรมทุจริตทันที`,
            icon: 'fas fa-shield-halved',
            confirmText: 'รับทราบและเริ่มสอบทันที',
            cancelText: 'ยังไม่พร้อม',
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

                // อัปเดตข้อมูลหัวห้องสอบให้ตรงกับชุดข้อสอบจริง
                const titleEl = document.getElementById('exam-room-title');
                const courseBadgeEl = document.getElementById('exam-room-course-badge');
                const studentEl = document.getElementById('exam-room-student');
                const tabBadgeEl = document.getElementById('exam-room-tab-badge');

                if (titleEl) titleEl.textContent = exam.title || 'ชุดข้อสอบ';
                if (courseBadgeEl) {
                    const cName = exam.course?.course_name || exam.course_name || 'วิชาทั่วไป';
                    courseBadgeEl.textContent = cName;
                }
                if (studentEl) {
                    const sInfo = [state.currentUser?.year, state.currentUser?.dept, state.currentUser?.room].filter(Boolean).join(' ');
                    studentEl.textContent = `${state.currentUser?.name || 'นักเรียน'}${sInfo ? ` (${sInfo})` : ''}`;
                }
                const maxSwitches = exam.max_tab_switches_allowed != null ? Number(exam.max_tab_switches_allowed) : 3;
                if (tabBadgeEl) {
                    tabBadgeEl.innerHTML = `<i class="fas fa-eye text-amber-500"></i> สลับจอ: 0/${maxSwitches}`;
                    tabBadgeEl.className = 'px-3 py-1.5 text-xs font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1.5 shadow-2xs';
                }

                showView('view-student-exam');
                renderExamQuestion();
                renderQuestionPalette();
                startCountdownTimer();
                startAntiCheatMonitor();
                showToast('เริ่มทำข้อสอบ ขอให้โชคดีในการสอบครับ!', 'success');
            }
        });

    } catch (err) {
        showCustomAlert({
            title: 'เกิดข้อผิดพลาด',
            message: 'ไม่สามารถโหลดชุดข้อสอบได้: ' + err.message,
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
                <img src="${parsed.image}" alt="ภาพประกอบข้อสอบ" class="max-h-80 max-w-full object-contain rounded-xl shadow-2xs cursor-pointer hover:opacity-95 transition" onclick="openImageZoomModal('${parsed.image}')">
                <div class="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1"><i class="fas fa-magnifying-glass-plus"></i> คลิกที่รูปเพื่อขยายดูเต็มจอ</div>
            </div>`;
    }

    const textMarkup = parsed.text
        ? `<div class="text-slate-800 text-base font-bold leading-relaxed mb-5">${escapeHtml(parsed.text)}</div>`
        : (parsed.image ? '' : `<div class="text-slate-400 italic mb-5">(ไม่มีข้อความคำถาม)</div>`);

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
                ข้อที่ ${state.currentQuestionIndex + 1} จาก ${state.questions.length}
            </span>
            <span id="exam-question-points" class="text-xs font-semibold text-slate-500">(${q.points || 1} คะแนน)</span>
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
                <i class="fas fa-chevron-left text-xs"></i> ข้อก่อนหน้า
            </button>
            ${state.currentQuestionIndex === state.questions.length - 1
                ? `<button type="button" onclick="confirmSubmitExam()" class="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition shadow-md shadow-green-100 flex items-center justify-center gap-2">
                       <i class="fas fa-paper-plane text-xs"></i> ส่งข้อสอบ
                   </button>`
                : `<button type="button" id="btn-exam-next" onclick="nextExamQuestion()" class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition flex items-center gap-2">
                       ข้อถัดไป <i class="fas fa-chevron-right text-xs"></i>
                   </button>`
            }
        </div>
    `;

    // อัปเดต palette และปุ่มนำทาง
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

    // 📱 Active Mobile & Overlay Watchdog (ตรวจจับ Messenger Bubble, Line Popup, Notification Shade)
    if (focusWatchdogInterval) clearInterval(focusWatchdogInterval);
    focusWatchdogInterval = setInterval(() => {
        if (!state.antiCheat.isMonitoring) return;

        const isHidden = document.hidden || document.visibilityState !== 'visible';
        const hasDocFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

        if (isHidden || !hasDocFocus) {
            if (!focusLostStartTime) {
                focusLostStartTime = Date.now();
            } else if (Date.now() - focusLostStartTime >= 300) {
                // หลุดโฟกัสเกิน 300ms (กำลังแตะหรือแชทใน Messenger Bubble หรือแถบแจ้งเตือน)
                registerTabSwitch('ตรวจพบการเปิดหน้าต่างแชทลอย (Messenger Bubble) / แถบแจ้งเตือน / สลับโฟกัสออกจากข้อสอบ');
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
            registerTabSwitch('ตรวจพบการเปิดแป้นพิมพ์ภายนอกหน้าต่างสอบ (แชทลอย Messenger/LINE)');
        }
    }
}

function handleWindowResize() {
    if (!state.antiCheat.isMonitoring) return;
    if (isSplitScreenDetected()) {
        state.antiCheat.tabSwitches++;
        triggerCheatWarning('ตรวจพบการเปิดใช้งานโหมดแบ่งหน้าจอ (Split Screen / Pop-up Window)');
    }
}

function handlePageHide() {
    if (!state.antiCheat.isMonitoring) return;
    registerTabSwitch('ตรวจพบการสลับแอปพลิเคชันหรือออกจากหน้าจอเบราว์เซอร์');
}

function handlePageShow() {
    if (!state.antiCheat.isMonitoring) return;
    if (focusLostStartTime && Date.now() - focusLostStartTime >= 300) {
        registerTabSwitch('ตรวจพบการกลับเข้าสู่ห้องสอบหลังสลับไปแอปอื่น');
    }
    focusLostStartTime = 0;
}

function handleDocumentFocusOut(e) {
    if (!state.antiCheat.isMonitoring) return;
    // หากโฟกัสหลุดออกจาก document โดยไม่ได้ย้ายไปยัง element ภายในเว็บ
    if (!e.relatedTarget && typeof document.hasFocus === 'function' && !document.hasFocus()) {
        registerTabSwitch('ตรวจพบการคลิกออกนอกหน้าต่างข้อสอบ หรือเปิดหน้าต่างแชทลอย');
    }
}

function handleDocumentFocusIn() {
    if (!state.antiCheat.isMonitoring) return;
    if (focusLostStartTime && Date.now() - focusLostStartTime >= 350) {
        registerTabSwitch('ตรวจพบการกลับเข้าสู่ห้องสอบหลังสลับโฟกัส');
    }
    focusLostStartTime = 0;
}

function handleWindowFocus() {
    if (!state.antiCheat.isMonitoring) return;
    if (focusLostStartTime && Date.now() - focusLostStartTime >= 350) {
        registerTabSwitch('ตรวจพบการสลับกลับมาจากหน้าต่างอื่น / แชทลอย');
    }
    focusLostStartTime = 0;
}

function preventContextMenu(e) {
    if (state.antiCheat.isMonitoring) {
        e.preventDefault();
        showToast('⚠️ ไม่อนุญาตให้คลิกขวาในห้องสอบ', 'warning');
    }
}

function preventCopy(e) {
    if (state.antiCheat.isMonitoring) {
        e.preventDefault();
        showToast('⚠️ ไม่อนุญาตให้คัดลอก ตัด หรือวางข้อความระหว่างทำข้อสอบ', 'warning');
    }
}

// 🚫 ปิดปุ่มลัด Developer Tools / คัดลอก / ปริ้นท์ / บันทึกหน้าจอ
function preventExamShortcuts(e) {
    if (!state.antiCheat.isMonitoring) return;

    // Block F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (Developer Tools)
    if (e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) ||
        (e.ctrlKey && ['u', 'U', 'p', 'P', 's', 'S', 'a', 'A'].includes(e.key))) {
        e.preventDefault();
        e.stopPropagation();
        showToast('⚠️ ไม่อนุญาตให้ใช้ปุ่มลัดหรือเปิด Developer Tools ในห้องสอบ', 'warning');
        return false;
    }

    // Block Ctrl+C, Ctrl+V, Ctrl+X
    if (e.ctrlKey && ['c', 'C', 'v', 'V', 'x', 'X'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        showToast('⚠️ ไม่อนุญาตให้คัดลอกหรือวางข้อความระหว่างทำข้อสอบ', 'warning');
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
    // Debounce 600ms เพื่อป้องกัน event ซ้ำซ้อนตอนสลับหน้าต่างพร้อมกัน
    if (now - lastCheatWarningTime < 600) return;
    lastCheatWarningTime = now;

    state.antiCheat.tabSwitches++;
    triggerCheatWarning(reason);
}

function handleVisibilityChange() {
    if (!state.antiCheat.isMonitoring) return;
    if (document.hidden) {
        registerTabSwitch('ตรวจพบการสลับหน้าจอ / สลับแท็บเบราว์เซอร์');
    }
}

function handleWindowBlur() {
    if (!state.antiCheat.isMonitoring) return;
    registerTabSwitch('ตรวจพบการคลิกออกจากหน้าต่างข้อสอบ / เปิดแชทลอย');
}

function handleFullscreenChange() {
    if (!state.antiCheat.isMonitoring) return;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        state.antiCheat.fullscreenExits++;
        registerTabSwitch('ตรวจพบการออกจากโหมดเต็มหน้าจอ');
    }
}

function triggerCheatWarning(reason) {
    const maxSwitches = state.currentExam?.max_tab_switches_allowed != null ? Number(state.currentExam.max_tab_switches_allowed) : 3;
    const isExceeded = state.antiCheat.tabSwitches > maxSwitches;

    const badgeEl = document.getElementById('exam-room-tab-badge');
    if (badgeEl && state.currentExam) {
        badgeEl.innerHTML = `<i class="fas fa-eye ${isExceeded ? 'text-red-500' : 'text-amber-500'}"></i> สลับจอ: ${state.antiCheat.tabSwitches}/${maxSwitches}`;
        if (isExceeded) {
            badgeEl.className = 'px-3 py-1.5 text-xs font-bold rounded-full bg-red-100 text-red-700 border border-red-300 warning-pulse flex items-center gap-1.5 shadow-2xs';
        } else {
            badgeEl.className = 'px-3 py-1.5 text-xs font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1.5 shadow-2xs';
        }
    }

    const cheatPayload = {
        event_id: `cheat_${state.currentUser?.id}_${state.antiCheat.tabSwitches}_${Date.now()}`,
        student_id: state.currentUser?.id,
        student_name: state.currentUser?.name || 'นักเรียน',
        student_year: state.currentUser?.year || 'ปวช./ปวส.',
        student_department: state.currentUser?.dept || 'ไม่ระบุแผนก',
        student_room: state.currentUser?.room || 'ห้อง 1',
        exam_id: state.currentExam?.id,
        exam_title: state.currentExam?.title || 'ชุดข้อสอบ',
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

    // 🚨 หากสลับจอเกินจำนวนครั้งที่อนุญาต -> ยุติการสอบ ตัดสิทธิ์ และเด้งออกจากห้องสอบทันที
    if (isExceeded) {
        stopAntiCheatMonitor();
        clearInterval(state.examTimer);

        const warningModal = document.getElementById('modal-cheat-warning');
        if (warningModal) warningModal.classList.add('hidden');

        showCustomAlert({
            title: '🚨 ถูกตัดสิทธิ์การสอบทันที',
            message: `ตรวจพบการสลับหน้าจอ ${state.antiCheat.tabSwitches} ครั้ง (อนุญาตไม่เกิน ${maxSwitches} ครั้ง)\n\nคุณทำผิดกฎความปลอดภัยในการสอบ ระบบได้ทำการบันทึกประวัติการทุจริตและยุติการทำข้อสอบทันที`,
            icon: 'fas fa-ban',
            buttonText: 'รับทราบและออกจากห้องสอบ',
            onOk: () => {
                submitExamFinal();
            }
        });
        return;
    }

    const modal = document.getElementById('modal-cheat-warning');
    const reasonEl = document.getElementById('cheat-warning-reason');
    const countEl = document.getElementById('cheat-warning-count');

    if (modal) {
        if (reasonEl) reasonEl.textContent = reason;
        if (countEl) countEl.textContent = `จำนวนครั้งที่สลับหน้าจอ: ${state.antiCheat.tabSwitches}/${maxSwitches} ครั้ง (หากเกินกำหนดจะถูกตัดสิทธิ์และเด้งออกทันที)`;
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
            showToast('⏰ หมดเวลาทำข้อสอบแล้ว! ระบบกำลังส่งข้อสอบอัตโนมัติ', 'warning');
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
    const questions = state.questions || [];
    const totalCount = questions.length;
    const answeredCount = Object.keys(state.answers).filter(qId => state.answers[qId] !== undefined && state.answers[qId] !== '').length;
    const unansweredCount = totalCount - answeredCount;

    // 🔒 บังคับทำข้อสอบให้ครบทุกข้อ: ถ้ายังตอบไม่ครบ ห้ามส่ง และเด้งกลับไปข้อแรกที่ยังไม่ได้ตอบ
    if (unansweredCount > 0) {
        const firstUnansweredIdx = questions.findIndex(q => !state.answers[q.id]);
        const targetQNum = firstUnansweredIdx >= 0 ? firstUnansweredIdx + 1 : 1;

        showCustomAlert({
            title: 'ยังทำข้อสอบไม่ครบ',
            message: `⚠️ คุณยังตอบข้อสอบไม่ครบทุกข้อ (ทำแล้ว ${answeredCount}/${totalCount} ข้อ, ยังเหลืออีก ${unansweredCount} ข้อ)\n\nกรุณาตอบคำถามให้ครบทุกข้อก่อนกดส่งข้อสอบ`,
            icon: 'fas fa-circle-exclamation',
            buttonText: `ไปยังข้อที่ ${targetQNum} ที่ยังไม่ได้ตอบ`,
            onOk: () => {
                if (firstUnansweredIdx >= 0) {
                    state.currentQuestionIndex = firstUnansweredIdx;
                    renderExamQuestion();
                    const qCard = document.getElementById('exam-question-card');
                    if (qCard) qCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
        return;
    }

    // ถ้าตอบครบทุกข้อแล้ว -> ให้ยืนยันการส่งข้อสอบ
    showCustomConfirm({
        title: 'ยืนยันการส่งข้อสอบ',
        message: `คุณตอบคำถามครบทั้งหมด ${totalCount} ข้อแล้ว!\n\nคุณต้องการยืนยันการส่งข้อสอบและตรวจคะแนนใช่หรือไม่?`,
        icon: 'fas fa-paper-plane',
        confirmText: 'ส่งข้อสอบทันที',
        cancelText: 'กลับไปตรวจทาน',
        confirmClass: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-100',
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
        document.getElementById('loading-modal-title').textContent = 'กำลังตรวจข้อสอบ...';
        document.getElementById('loading-modal-desc').textContent = 'กำลังคำนวณคะแนนและตรวจสอบความปลอดภัย';
        loadingModal.classList.remove('hidden');
    }

    try {
        // 1. ระบบตรวจคะแนนเบื้องต้นในเครื่อง (Smart Local Auto-Grading Engine)
        const questions = state.questions || [];
        const localQuestions = getLocalQuestions(state.currentExam?.id);
        let totalScore = 0;
        let maxScore = 0;

        questions.forEach(q => {
            const points = Number(q.points) || 1.0;
            maxScore += points;
            const selectedAns = (state.answers[q.id] || '').trim().toUpperCase();
            
            // ค้นหาเฉลยจาก local questions โดยเทียบทั้ง id และข้อความโจทย์
            const foundQ = localQuestions.find(lq => 
                lq.id === q.id || 
                (lq.question_text && q.question_text && lq.question_text.trim() === q.question_text.trim())
            ) || q;
            
            const correctAns = (foundQ.correct || foundQ.correct_option_id || q.correct || q.correct_option_id || 'A').trim().toUpperCase();

            if (selectedAns && selectedAns === correctAns) {
                totalScore += points;
            }
        });

        let percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
        const isFlagged = state.antiCheat.tabSwitches > (state.currentExam?.max_tab_switches_allowed || 3) || state.antiCheat.fullscreenExits > 2;
        const cheatingReasons = [];
        if (state.antiCheat.tabSwitches > (state.currentExam?.max_tab_switches_allowed || 3)) {
            cheatingReasons.push(`สลับหน้าจอเกินกำหนด (${state.antiCheat.tabSwitches}/${state.currentExam?.max_tab_switches_allowed} ครั้ง)`);
        }
        if (state.antiCheat.fullscreenExits > 2) {
            cheatingReasons.push(`ออกจากโหมดเต็มหน้าจอ (${state.antiCheat.fullscreenExits} ครั้ง)`);
        }

        const gradeResult = {
            student_id: state.currentUser.id,
            student_name: state.currentUser.name,
            student_year: state.currentUser.year || 'ไม่ระบุ',
            student_department: state.currentUser.dept || 'ไม่ระบุ',
            student_room: state.currentUser.room || 'ไม่ระบุ',
            exam_id: state.currentExam?.id,
            exam_title: state.currentExam?.title,
            course_name: state.currentExam?.course?.course_name || 'วิชาทั่วไป',
            total_score: totalScore,
            max_score: maxScore,
            percentage: percentage,
            is_flagged_cheating: isFlagged,
            cheating_reasons: cheatingReasons,
            total_tab_switches: state.antiCheat.tabSwitches,
            total_fullscreen_exits: state.antiCheat.fullscreenExits,
            graded_at: new Date().toISOString()
        };

        // 2. ถ้าต่อ Supabase ได้ ให้ใช้ RPC submit_and_grade_exam เพื่อตรวจกับ exam_answers บนฐานข้อมูลโดยตรง (แม่นยำ 100%)
        if (isSupabaseConfigured() && state.supabaseClient) {
            let rpcOk = false;
            try {
                const { data: rpcRes, error: rpcErr } = await state.supabaseClient.rpc('submit_and_grade_exam', {
                    p_student_id: state.currentUser.id,
                    p_exam_id: state.currentExam.id,
                    p_student_name: state.currentUser.name || 'นักเรียน',
                    p_student_year: state.currentUser.year || 'ไม่ระบุ',
                    p_student_department: state.currentUser.dept || 'ไม่ระบุ',
                    p_student_room: state.currentUser.room || 'ไม่ระบุ',
                    p_answers: state.answers,
                    p_tab_switches: state.antiCheat.tabSwitches || 0,
                    p_fullscreen_exits: state.antiCheat.fullscreenExits || 0,
                    p_is_flagged: isFlagged,
                    p_cheating_reasons: cheatingReasons
                });

                if (!rpcErr && rpcRes && rpcRes.success) {
                    rpcOk = true;
                    gradeResult.total_score = Number(rpcRes.total_score) != null ? Number(rpcRes.total_score) : gradeResult.total_score;
                    gradeResult.max_score = Number(rpcRes.max_score) || gradeResult.max_score;
                    gradeResult.percentage = Number(rpcRes.percentage) != null ? Number(rpcRes.percentage) : gradeResult.percentage;
                    gradeResult.is_flagged_cheating = !!rpcRes.is_flagged_cheating;
                    if (rpcRes.course_name) gradeResult.course_name = rpcRes.course_name;
                }
            } catch (rpcErr) {
                console.warn('[submit_and_grade_exam RPC notice]:', rpcErr);
            }

            // ถ้า RPC ไม่สำเร็จ → บันทึกตรงลง exam_results เอง
            if (!rpcOk) {
                try {
                    await state.supabaseClient
                        .from('exam_results')
                        .upsert({
                            student_id: state.currentUser.id,
                            student_name: state.currentUser.name,
                            student_year: state.currentUser.year || 'ไม่ระบุ',
                            student_department: state.currentUser.dept || 'ไม่ระบุ',
                            student_room: state.currentUser.room || 'ไม่ระบุ',
                            exam_id: state.currentExam.id,
                            course_name: state.currentExam?.course?.course_name || 'วิชาทั่วไป',
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

        // บันทึกผลสอบลง Local Storage เพื่อให้อาจารย์ดูและ Export ได้ทันที
        saveLocalSubmission(gradeResult);

        // ล้างคำตอบร่างที่บันทึกไว้เมื่อส่งข้อสอบเสร็จสมบูรณ์
        clearStudentDraftAnswers();

        if (loadingModal) loadingModal.classList.add('hidden');
        renderResultView(gradeResult);

    } catch (err) {
        if (loadingModal) loadingModal.classList.add('hidden');
        showCustomAlert({
            title: 'เกิดข้อผิดพลาด',
            message: 'เกิดข้อผิดพลาดในการตรวจข้อสอบ: ' + err.message,
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

    // ตรวจสอบว่าอาจารย์อนุญาตให้แสดงคะแนนหรือไม่
    const showScore = state.currentExam?.show_score_immediately !== false; // default = true

    if (!showScore) {
        // ซ่อนคะแนน → แสดงแค่ "ส่งเรียบร้อย รอประกาศผล" (เอาคำว่า คิดเป็นร้อยละ: ออก)
        if (scoreTitleEl) scoreTitleEl.textContent = 'สถานะการส่งข้อสอบ';
        if (scoreEl) scoreEl.innerHTML = `<span class="text-3xl text-emerald-600">🎉</span><br><span class="text-xl font-bold text-slate-800">ส่งข้อสอบเรียบร้อยแล้ว</span>`;
        if (percentPrefix) percentPrefix.textContent = '';
        if (percentEl) percentEl.innerHTML = '<span class="text-xs font-medium text-slate-500">ระบบบันทึกคำตอบของคุณแล้ว กรุณารออาจารย์ตรวจและประกาศคะแนน</span>';
        if (statusEl) {
            statusEl.textContent = '📋 บันทึกข้อสอบเรียบร้อย (รอประกาศผล)';
            statusEl.className = 'px-4 py-1.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 border border-blue-300';
        }
        if (cheatAuditEl) cheatAuditEl.innerHTML = '';
        return;
    }

    if (scoreTitleEl) scoreTitleEl.textContent = 'คะแนนรวมที่ทำได้';
    if (scoreEl) scoreEl.textContent = `${res.total_score} / ${res.max_score}`;
    if (percentPrefix) percentPrefix.textContent = 'คิดเป็นร้อยละ: ';
    if (percentEl) percentEl.textContent = `${res.percentage}%`;

    if (res.is_flagged_cheating) {
        if (statusEl) {
            statusEl.textContent = '⚠️ ติดสถานะตรวจสอบการทุจริต (Flagged)';
            statusEl.className = 'px-4 py-1.5 rounded-full text-sm font-bold bg-red-100 text-red-700 border border-red-300';
        }
        if (cheatAuditEl) {
            cheatAuditEl.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-xl p-4 text-left">
                    <h4 class="font-bold text-red-800 text-sm mb-2 flex items-center gap-2">
                        <i class="fas fa-exclamation-triangle"></i> พบพฤติกรรมผิดปกติระหว่างการสอบ:
                    </h4>
                    <ul class="list-disc list-inside text-xs text-red-700 space-y-1">
                        ${(res.cheating_reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                        <li>จำนวนการสลับหน้าจอทั้งหมด: ${res.total_tab_switches || state.antiCheat.tabSwitches} ครั้ง</li>
                    </ul>
                    <p class="text-xs text-gray-500 mt-2">ผลคะแนนนี้จะถูกส่งให้อาจารย์ผู้สอนตรวจสอบ</p>
                </div>
            `;
        }
    } else {
        if (statusEl) {
            statusEl.textContent = '✅ ผ่านการตรวจสอบความซื่อสัตย์ (Verified)';
            statusEl.className = 'px-4 py-1.5 rounded-full text-sm font-bold bg-green-100 text-green-700 border border-green-300';
        }
        if (cheatAuditEl) {
            cheatAuditEl.innerHTML = `
                <div class="bg-green-50 border border-green-200 rounded-xl p-4 text-center text-xs text-green-800">
                    <i class="fas fa-check-circle text-green-600 text-lg mb-1"></i>
                    <p class="font-medium">ไม่พบพฤติกรรมต้องสงสัย การสอบสมบูรณ์</p>
                    <p class="text-gray-500 mt-0.5">สลับจอทั้งหมด: ${res.total_tab_switches || state.antiCheat.tabSwitches} ครั้ง (อยู่ในเกณฑ์)</p>
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
        showToast('🔔 เปิดการแจ้งเตือนสลับหน้าจอแบบเรียลไทม์แล้ว', 'success');
    } else {
        showToast('🔕 ปิดการแจ้งเตือนสลับหน้าจอแบบเรียลไทม์แล้ว', 'info');
    }
};

window.toggleAlertSound = function() {
    state.realtimeAlertsSoundEnabled = !state.realtimeAlertsSoundEnabled;
    localStorage.setItem('EXAM_REALTIME_SOUND', state.realtimeAlertsSoundEnabled ? 'true' : 'false');
    updateLiveAlertToggleUI();

    if (state.realtimeAlertsSoundEnabled) {
        playAlertChime();
        showToast('🔊 เปิดเสียงเตือนสลับหน้าจอแล้ว', 'success');
    } else {
        showToast('🔇 ปิดเสียงเตือนสลับหน้าจอแล้ว', 'info');
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
            textEl.textContent = 'แจ้งเตือนสลับจอ: เปิด';
            dotEl.className = 'w-2 h-2 rounded-full bg-white animate-ping';
        } else {
            btnToggle.className = 'px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 bg-slate-200 hover:bg-slate-300 text-slate-600 shadow-sm';
            textEl.textContent = 'แจ้งเตือนสลับจอ: ปิด';
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

    // ตรวจสอบว่าเปิดหน้าห้องอาจารย์อยู่หรือไม่
    const isTeacher = state.currentUser?.role === 'teacher' || 
                      state.currentUser?.role === 'admin' || 
                      state.currentView === 'view-teacher' || 
                      (document.getElementById('view-teacher') && !document.getElementById('view-teacher').classList.contains('hidden'));

    if (!isTeacher) {
        console.log('[Cheating Alert received - Not viewing teacher portal]');
        return;
    }

    const studentName = data.student_name || 'นักเรียน';
    const studentYear = data.student_year || 'ปวช./ปวส.';
    const studentDept = data.student_department || 'ไม่ระบุแผนก';
    const studentRoom = data.student_room || 'ห้อง 1';
    const examTitle = data.exam_title || 'ชุดข้อสอบ';
    const reason = data.reason || 'ตรวจพบการสลับหน้าจอ';
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
                        เตือนสลับหน้าจอสด!
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
                <i class="fas fa-book-open text-slate-400 mr-1"></i> วิชา/ข้อสอบ: <strong>${escapeHtml(examTitle)}</strong>
            </div>
            <div class="flex items-center justify-between pt-1 mt-1 border-t border-red-200/50">
                <span class="text-[11px] text-red-600 font-medium">${escapeHtml(reason)}</span>
                <span class="text-red-700 font-bold bg-red-200/70 px-2 py-0.5 rounded-full text-[10px]">สลับครั้งที่ ${tabSwitches}</span>
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
    if (countEl) countEl.textContent = `${state.liveFeedLogs.length} กิจกรรม`;

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
                <span class="px-2 py-0.5 rounded-md bg-red-50 text-red-700 font-bold text-[10px]">ครั้งที่ ${item.tabSwitches}</span>
                <div class="text-[10px] text-slate-400 mt-0.5">${escapeHtml(item.timeStr)}</div>
            </div>
        </div>
    `).join('');
}

window.clearLiveFeedLogs = function() {
    state.liveFeedLogs = [];
    const listEl = document.getElementById('live-cheat-feed-list');
    const countEl = document.getElementById('live-cheat-feed-count');
    if (countEl) countEl.textContent = '0 กิจกรรม';
    if (listEl) {
        listEl.innerHTML = `<p class="text-slate-400 text-xs italic py-2 text-center">ระบบกำลังมอนิเตอร์สด... (หากมีนักเรียนสลับหน้าจอ จะปรากฏขึ้นที่นี่ทันที)</p>`;
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

// 7.1 จัดการรายวิชาของอาจารย์ (Courses)
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

    // 🔒 Teacher Isolation: แสดงเฉพาะรายวิชาของอาจารย์ท่านนี้เท่านั้น (เว้นแต่ Admin)
    if (state.currentUser?.role === 'teacher') {
        const currentTeacherId = state.currentUser.id;
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        courses = courses.filter(c => 
            (c.teacher_id && c.teacher_id === currentTeacherId) || 
            (c.teacher_name && c.teacher_name.trim().toLowerCase() === currentTeacherName)
        );
    }

    state.courses = courses;
    if (badgeCount) badgeCount.textContent = `${courses.length} รายวิชา`;

    if (courses.length === 0) {
        container.innerHTML = `
            <div class="col-span-full bg-white p-8 rounded-3xl border border-slate-100 text-center">
                <i class="fas fa-book-open text-4xl text-slate-300 mb-3"></i>
                <h4 class="font-bold text-slate-700">คุณยังไม่มีรายวิชาในระบบ</h4>
                <p class="text-xs text-slate-400 mt-1 mb-4">กดปุ่มสร้างรายวิชาใหม่เพื่อเริ่มต้นเปิดสอนและสร้างชุดข้อสอบของคุณ</p>
                <button onclick="document.getElementById('modal-create-course').classList.remove('hidden')" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-sm">
                    <i class="fas fa-plus mr-1"></i> สร้างรายวิชาแรกของคุณ
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
                
                <!-- Badge ระดับชั้นและแผนกประจำวิชา -->
                <div class="mb-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200/60 rounded-lg text-[11px] font-bold text-amber-900">
                    <i class="fas fa-bullseye text-amber-600"></i> ${escapeHtml(c.target_year || 'ทุกชั้น')} | ${escapeHtml(c.target_department || 'ทุกแผนก')}
                </div>

                <p class="text-xs text-slate-500 line-clamp-2 mb-3">${escapeHtml(c.description || 'ไม่มีคำอธิบายรายวิชา')}</p>
                <div class="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <i class="fas fa-user-tie text-emerald-500"></i> ${escapeHtml(c.teacher_name || 'อาจารย์ผู้สอน')}
                </div>
            </div>

            <div class="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                <button onclick="openCreateExamForCourse('${c.id}')" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl transition flex items-center gap-1">
                    <i class="fas fa-plus"></i> เพิ่มข้อสอบในวิชานี้
                </button>
                <button onclick="deleteCourse('${c.id}', '${escapeHtml(c.course_name)}')" class="text-slate-300 hover:text-red-500 text-xs p-1.5 rounded-lg transition" title="ลบรายวิชา">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        </div>
    `).join('');
}

window.deleteCourse = async function(courseId, courseName) {
    showCustomConfirm({
        title: 'ยืนยันการลบรายวิชา',
        message: `คุณต้องการลบรายวิชา "${courseName}" ใช่หรือไม่?\n(ชุดข้อสอบทั้งหมดที่ผูกกับวิชานี้จะถูกลบออกจากระบบด้วย)`,
        icon: 'fas fa-trash-can',
        confirmText: 'ลบรายวิชาและข้อสอบ',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalCourse(courseId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    // ลบชุดข้อสอบที่ผูกกับรายวิชานี้ใน Supabase
                    await state.supabaseClient.from('exams').delete().eq('course_id', courseId);
                    // ลบรายวิชา
                    const { error } = await state.supabaseClient.from('courses').delete().eq('id', courseId);
                    if (error) {
                        console.error('[deleteCourse] Supabase error:', error);
                        showToast('ลบจากเซิร์ฟเวอร์ไม่สำเร็จ (ติดสิทธิ์ RLS): ' + error.message, 'warning');
                    }
                } catch (e) {
                    console.error('[deleteCourse] Error:', e);
                }
            }
            showToast(`ลบรายวิชา "${courseName}" และชุดข้อสอบในวิชาเรียบร้อยแล้ว`, 'info');
            await loadTeacherCourses();
            await loadTeacherExamsList();
            populateCourseSelects();
            populateTeacherExamSelects();
        }
    });
};

// 7.2 ฟังก์ชันเติมรายการชุดข้อสอบในตัวกรองผลสอบ
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
    select.innerHTML = `<option value="ทั้งหมด">ชุดข้อสอบ: ทั้งหมด</option>` + exams.map(e => `
        <option value="${e.id}">[${escapeHtml(e.title)}] (${escapeHtml(e.target_year || 'ทุกชั้น')} ${escapeHtml(e.target_room || 'ทุกห้อง')})</option>
    `).join('');

    if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
        select.value = currentVal;
    }
}

// 7.2.1 โหลดตารางผลสอบอาจารย์ (พร้อมตัวกรองแยกชุดข้อสอบ/ระดับชั้น/แผนก/ห้องเรียน)
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

    // 🔒 Teacher Isolation: แสดงเฉพาะผลคะแนนในวิชาและชุดข้อสอบของอาจารย์ท่านนี้เท่านั้น (เว้นแต่ Admin)
    if (state.currentUser?.role === 'teacher') {
        const myExamIds = (state.localExams || getLocalExams()).map(e => e.id);
        const currentTeacherName = (state.currentUser.name || '').trim().toLowerCase();
        subs = (subs || []).filter(sub => 
            myExamIds.includes(sub.exam_id) || 
            (sub.exam?.teacher_name && sub.exam.teacher_name.trim().toLowerCase() === currentTeacherName)
        );
    }

    // 🔍 Apply Filters: Search, Exam, Year, Department, Room
    const searchVal = (document.getElementById('teacher-sub-filter-search')?.value || '').trim().toLowerCase();
    const examFilter = document.getElementById('teacher-sub-filter-exam')?.value || 'ทั้งหมด';
    const yearFilter = document.getElementById('teacher-sub-filter-year')?.value || 'ทั้งหมด';
    const deptFilter = document.getElementById('teacher-sub-filter-dept')?.value || 'ทั้งหมด';
    const roomFilter = document.getElementById('teacher-sub-filter-room')?.value || 'ทั้งหมด';

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

    if (examFilter !== 'ทั้งหมด') {
        filtered = filtered.filter(s => s.exam_id === examFilter);
    }

    if (yearFilter !== 'ทั้งหมด') {
        const cleanTargetYear = yearFilter.replace(/\s+/g, '').toLowerCase();
        filtered = filtered.filter(s => {
            const sYear = (s.student_year || s.year || '').replace(/\s+/g, '').toLowerCase();
            const eYear = (s.exam?.target_year || '').replace(/\s+/g, '').toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lYear = (linked?.year || '').replace(/\s+/g, '').toLowerCase();

            return sYear.includes(cleanTargetYear) || eYear.includes(cleanTargetYear) || lYear.includes(cleanTargetYear);
        });
    }

    if (deptFilter !== 'ทั้งหมด') {
        const targetDept = deptFilter.trim().toLowerCase();
        filtered = filtered.filter(s => {
            const sDept = (s.student_department || s.dept || '').trim().toLowerCase();
            const eDept = (s.exam?.target_department || '').trim().toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lDept = (linked?.dept || '').trim().toLowerCase();

            return sDept.includes(targetDept) || eDept.includes(targetDept) || lDept.includes(targetDept);
        });
    }

    if (roomFilter !== 'ทั้งหมด') {
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
                    ไม่พบข้อมูลผลการสอบตามเงื่อนไขตัวกรองที่ค้นหา
                    <div class="text-xs text-slate-400 mt-1">
                        (ค้นหา: ${escapeHtml(searchVal || '-')} | ระดับชั้น: ${escapeHtml(yearFilter)} | ห้อง: ${escapeHtml(roomFilter)})
                    </div>
                    <button type="button" onclick="resetTeacherSubmissionFilters()" class="mt-3 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition inline-flex items-center gap-1.5">
                        <i class="fas fa-rotate-left"></i> ล้างตัวกรองทั้งหมด
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
        const examTitle = sub.exam_title || sub.exam?.title || 'ชุดข้อสอบ';
        const courseName = sub.course_name || sub.exam?.course?.course_name || '-';
        const formattedDate = new Date(sub.graded_at).toLocaleString('th-TH');

        const classInfo = `${sub.student_year || '-'} | ${sub.student_department || '-'} | ${sub.student_room || '-'}`;

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50/70 transition">
                <td class="py-4 px-4 font-medium text-gray-800">
                    <div class="font-bold text-slate-900">${escapeHtml(sub.student_name || 'นักเรียน')}</div>
                    <div class="text-xs text-gray-400 font-mono">${(sub.student_id || '').slice(0, 8)}...</div>
                </td>
                <td class="py-4 px-4 text-xs font-semibold text-indigo-700">
                    <span class="px-2.5 py-1 bg-indigo-50 border border-indigo-100/60 rounded-lg">
                        ${escapeHtml(classInfo)}
                    </span>
                </td>
                <td class="py-4 px-4 text-gray-600 text-xs">
                    <div class="font-bold text-slate-800">${escapeHtml(examTitle)}</div>
                    <div class="text-[11px] text-slate-400">วิชา: ${escapeHtml(courseName)}</div>
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
                        ${sub.total_tab_switches} ครั้ง
                    </span>
                </td>
                <td class="py-4 px-4 text-center">
                    ${isFlagged ? `
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 inline-flex items-center gap-1">
                            <i class="fas fa-exclamation-triangle"></i> มีพฤติกรรมสงสัย
                        </span>
                    ` : `
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 inline-flex items-center gap-1">
                            <i class="fas fa-check-circle"></i> ปกติ
                        </span>
                    `}
                </td>
                <td class="py-4 px-4 text-xs text-gray-400">${formattedDate}</td>
                <td class="py-4 px-4 text-right">
                    <button onclick="inspectStudentSubmission('${sub.student_id}', '${sub.exam_id}', '${escapeHtml(sub.student_name)}')" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium rounded-lg transition shadow-xs">
                        <i class="fas fa-search mr-1"></i> ตรวจคำตอบ
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
    if (examSelect) examSelect.value = 'ทั้งหมด';
    if (yearSelect) yearSelect.value = 'ทั้งหมด';
    if (deptSelect) deptSelect.value = 'ทั้งหมด';
    if (roomSelect) roomSelect.value = 'ทั้งหมด';

    showToast('ล้างตัวกรองผลสอบทั้งหมดแล้ว', 'info');
    loadTeacherSubmissions();
};

// 7.3 ส่งออกคะแนนนักเรียนเป็นไฟล์ Excel (.xlsx) ตามตัวกรองระดับชั้น/แผนก/ห้องเรียน
window.exportTeacherScoresToExcel = async function() {
    if (!window.XLSX) {
        showToast('ไลบรารี SheetJS ยังไม่พร้อมใช้งาน', 'warning');
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
    const examFilter = document.getElementById('teacher-sub-filter-exam')?.value || 'ทั้งหมด';
    const yearFilter = document.getElementById('teacher-sub-filter-year')?.value || 'ทั้งหมด';
    const deptFilter = document.getElementById('teacher-sub-filter-dept')?.value || 'ทั้งหมด';
    const roomFilter = document.getElementById('teacher-sub-filter-room')?.value || 'ทั้งหมด';

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

    if (examFilter !== 'ทั้งหมด') {
        filtered = filtered.filter(s => s.exam_id === examFilter);
    }
    if (yearFilter !== 'ทั้งหมด') {
        const cleanTargetYear = yearFilter.replace(/\s+/g, '').toLowerCase();
        filtered = filtered.filter(s => {
            const sYear = (s.student_year || s.year || '').replace(/\s+/g, '').toLowerCase();
            const eYear = (s.exam?.target_year || '').replace(/\s+/g, '').toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lYear = (linked?.year || '').replace(/\s+/g, '').toLowerCase();

            return sYear.includes(cleanTargetYear) || eYear.includes(cleanTargetYear) || lYear.includes(cleanTargetYear);
        });
    }
    if (deptFilter !== 'ทั้งหมด') {
        const targetDept = deptFilter.trim().toLowerCase();
        filtered = filtered.filter(s => {
            const sDept = (s.student_department || s.dept || '').trim().toLowerCase();
            const eDept = (s.exam?.target_department || '').trim().toLowerCase();
            const linked = studentRosterMap.get(s.student_id) || studentRosterMap.get((s.student_name || '').trim().toLowerCase());
            const lDept = (linked?.dept || '').trim().toLowerCase();

            return sDept.includes(targetDept) || eDept.includes(targetDept) || lDept.includes(targetDept);
        });
    }
    if (roomFilter !== 'ทั้งหมด') {
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
        showToast('ไม่พบข้อมูลผลการสอบตามเงื่อนไขที่เลือกเพื่อส่งออก Excel', 'warning');
        return;
    }

    const excelRows = filtered.map((d, index) => ({
        'ลำดับ': index + 1,
        'ชื่อ-นามสกุล': d.student_name || 'นักเรียน',
        'รหัสนักเรียน': d.student_id,
        'ระดับชั้น/ปี': d.student_year || '-',
        'แผนกวิชา/สาขา': d.student_department || '-',
        'ห้องเรียน': d.student_room || '-',
        'รายวิชา': d.course_name || d.exam?.course?.course_name || '-',
        'ชุดข้อสอบ': d.exam_title || d.exam?.title || '-',
        'คะแนนที่ได้': Number(d.total_score || 0),
        'คะแนนเต็ม': Number(d.max_score || 0),
        'ร้อยละ (%)': Number(d.percentage || 0),
        'จำนวนสลับหน้าจอ (ครั้ง)': Number(d.total_tab_switches || 0),
        'จำนวนออกจากเต็มจอ (ครั้ง)': Number(d.total_fullscreen_exits || 0),
        'สถานะการตรวจ': d.is_flagged_cheating ? '⚠️ พบพฤติกรรมน่าสงสัย' : '✅ ผ่านการตรวจสอบ',
        'สาเหตุที่ติดสถานะ': (d.cheating_reasons || []).join('; ') || '-',
        'วันที่และเวลาที่ส่ง': new Date(d.graded_at).toLocaleString('th-TH')
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'รายงานผลคะแนน');

    const dateStr = new Date().toISOString().slice(0, 10);
    let nameParts = ['รายงานผลคะแนนสอบ'];
    if (yearFilter !== 'ทั้งหมด') nameParts.push(yearFilter);
    if (roomFilter !== 'ทั้งหมด') nameParts.push(roomFilter);
    if (deptFilter !== 'ทั้งหมด') nameParts.push(deptFilter);
    nameParts.push(dateStr);

    const fileName = `${nameParts.join('_')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    showToast(`ดาวน์โหลดไฟล์ Excel (${filtered.length} รายการ) เรียบร้อยแล้ว!`, 'success');
};

// ==============================================================================
// 7.3.5 TEACHER STUDENT ROSTER MANAGEMENT (จัดการรายชื่อนักเรียน & รหัสผ่านเลขบัตร ปชช.)
// ==============================================================================

let _studentExcelParsedList = [];

window.loadTeacherStudentsList = function() {
    const tbody = document.getElementById('teacher-students-table-body');
    const badgeCount = document.getElementById('teacher-students-count-badge');
    if (!tbody) return;

    let students = getLocalStudents();

    // Filters
    const searchVal = document.getElementById('teacher-student-search-input')?.value.trim().toLowerCase() || '';
    const filterYear = document.getElementById('teacher-student-filter-year')?.value || 'ทั้งหมด';
    const filterDept = document.getElementById('teacher-student-filter-dept')?.value || 'ทั้งหมด';
    const filterRoom = document.getElementById('teacher-student-filter-room')?.value || 'ทั้งหมด';

    if (filterYear !== 'ทั้งหมด') {
        students = students.filter(s => s.year === filterYear);
    }
    if (filterDept !== 'ทั้งหมด') {
        students = students.filter(s => s.dept === filterDept);
    }
    if (filterRoom !== 'ทั้งหมด') {
        students = students.filter(s => s.room === filterRoom);
    }
    if (searchVal) {
        students = students.filter(s => 
            (s.name && s.name.toLowerCase().includes(searchVal)) ||
            (s.code && s.code.toLowerCase().includes(searchVal)) ||
            (s.citizen_id && s.citizen_id.includes(searchVal))
        );
    }

    if (badgeCount) badgeCount.textContent = `${students.length} คน`;

    if (students.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-slate-400">
                    <i class="fas fa-user-slash text-3xl mb-2 text-slate-300"></i>
                    <p class="font-bold text-slate-600">ยังไม่มีรายชื่อนักเรียนในระบบ</p>
                    <p class="text-xs text-slate-400 mt-1">คลิกปุ่ม "+ เพิ่มนักเรียนรายคน" หรือ "นำเข้าจาก Excel" เพื่อเพิ่มรายชื่อ</p>
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
                <button onclick="openAddStudentModal('${s.id}')" class="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-lg transition mr-1" title="แก้ไขข้อมูล">
                    <i class="fas fa-edit"></i> แก้ไข
                </button>
                <button onclick="deleteStudent('${s.id}', '${escapeHtml(s.name)}')" class="px-2.5 py-1 text-xs font-semibold text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition" title="ลบรายชื่อ">
                    <i class="fas fa-trash"></i> ลบ
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
            if (title) title.innerHTML = '<i class="fas fa-user-pen text-indigo-600"></i> แก้ไขข้อมูลนักเรียน';
            if (modeInput) modeInput.value = 'edit';
            if (idInput) idInput.value = student.id;
            if (codeInput) codeInput.value = student.code || '';
            if (nameInput) nameInput.value = student.name || '';
            if (citizenInput) citizenInput.value = student.citizen_id || '';
            if (yearSelect) yearSelect.value = student.year || 'ปวช.2';
            if (deptSelect) deptSelect.value = student.dept || 'เทคโนโลยีธุรกิจดิจิทัล';
            if (roomSelect) roomSelect.value = student.room || 'ห้อง 1';
        }
    } else {
        if (title) title.innerHTML = '<i class="fas fa-user-plus text-indigo-600"></i> เพิ่มข้อมูลนักเรียนใหม่';
        if (modeInput) modeInput.value = 'create';
        if (idInput) idInput.value = '';
        if (codeInput) codeInput.value = '';
        if (nameInput) nameInput.value = '';
        if (citizenInput) citizenInput.value = '';
        if (yearSelect) yearSelect.value = 'ปวช.2';
        if (deptSelect) deptSelect.value = 'เทคโนโลยีธุรกิจดิจิทัล';
        if (roomSelect) roomSelect.value = 'ห้อง 1';
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
    const year = document.getElementById('student-form-year')?.value || 'ปวช.2';
    const dept = document.getElementById('student-form-dept')?.value || 'เทคโนโลยีธุรกิจดิจิทัล';
    const room = document.getElementById('student-form-room')?.value || 'ห้อง 1';

    if (!code || !name) {
        showToast('กรุณากรอกรหัสนักเรียนและชื่อ-นามสกุล', 'warning');
        return;
    }

    if (!citizenId || citizenId.length !== 13 || isNaN(citizenId)) {
        showCustomAlert({
            title: 'เลขบัตรประชาชนไม่ถูกต้อง',
            message: 'กรุณากรอกเลขบัตรประจำตัวประชาชนให้ครบ 13 หลักตัวเลข\n(ใช้เป็นรหัสผ่านเข้าสอบของนักเรียน)',
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
                title: 'รหัสนักเรียนซ้ำ',
                message: `มีรหัสนักเรียน "${code}" (${existCode.name}) อยู่ในระบบแล้ว`,
                icon: 'fas fa-triangle-exclamation'
            });
            return;
        }
        const existCitizen = allStudents.find(s => s.citizen_id === citizenId);
        if (existCitizen) {
            showCustomAlert({
                title: 'เลขบัตรประชาชนซ้ำ',
                message: `มีเลขบัตรประชาชน "${citizenId}" (${existCitizen.name}) อยู่ในระบบแล้ว`,
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
    showToast(`บันทึกข้อมูลนักเรียน "${name}" สำเร็จ`, 'success');
    closeStudentModal();
    loadTeacherStudentsList();
};

window.deleteStudent = function(studentId, studentName) {
    showCustomConfirm({
        title: 'ยืนยันการลบนักเรียน',
        message: `คุณต้องการลบรายชื่อนักเรียน "${studentName}" หรือไม่?\n(ข้อมูลจะไม่สามารถกู้คืนได้)`,
        icon: 'fas fa-user-xmark',
        confirmText: 'ลบรายชื่อ',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: () => {
            deleteLocalStudent(studentId);
            showToast(`ลบรายชื่อนักเรียน "${studentName}" แล้ว`, 'info');
            loadTeacherStudentsList();
        }
    });
};

// Excel Template & Import for Students
window.downloadStudentExcelTemplate = function() {
    if (!window.XLSX) {
        showToast('ไลบรารี SheetJS ยังไม่พร้อมใช้งาน', 'warning');
        return;
    }

    const templateData = [
        {
            'รหัสนักเรียน': '66209010001',
            'ชื่อ-นามสกุล': 'นายสมชาย รักเรียน',
            'เลขบัตรประชาชน13หลัก': '1103701234567',
            'ระดับชั้น': 'ปวช.2',
            'แผนกวิชา': 'เทคโนโลยีธุรกิจดิจิทัล',
            'ห้องเรียน': 'ห้อง 1'
        },
        {
            'รหัสนักเรียน': '66209010002',
            'ชื่อ-นามสกุล': 'นางสาวสมหญิง ใจดี',
            'เลขบัตรประชาชน13หลัก': '1103701234568',
            'ระดับชั้น': 'ปวช.2',
            'แผนกวิชา': 'เทคโนโลยีธุรกิจดิจิทัล',
            'ห้องเรียน': 'ห้อง 1'
        },
        {
            'รหัสนักเรียน': '66209010003',
            'ชื่อ-นามสกุล': 'นายธนกฤต มุ่งมั่น',
            'เลขบัตรประชาชน13หลัก': '1103701234569',
            'ระดับชั้น': 'ปวช.2',
            'แผนกวิชา': 'การบัญชี',
            'ห้องเรียน': 'ห้อง 2'
        }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'รายชื่อนักเรียน');

    XLSX.writeFile(workbook, 'แบบฟอร์มนำเข้ารายชื่อนักเรียน_วังไกลกังวล.xlsx');
    showToast('ดาวน์โหลดเทมเพลต Excel รายชื่อนักเรียนแล้ว', 'success');
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
                    title: 'ไม่พบข้อมูลในไฟล์',
                    message: 'ไม่พบข้อมูลในไฟล์ Excel หรือรูปแบบตารางไม่ถูกต้อง',
                    icon: 'fas fa-triangle-exclamation'
                });
                return;
            }

            _studentExcelParsedList = rows.map((r, idx) => {
                const code = String(r['รหัสนักเรียน'] || r['student_id'] || r['code'] || r['ID'] || '').trim();
                const name = String(r['ชื่อ-นามสกุล'] || r['ชื่อ'] || r['name'] || r['student_name'] || '').trim();
                const citizenId = String(r['เลขบัตรประชาชน13หลัก'] || r['เลขบัตรประชาชน'] || r['citizen_id'] || r['id_card'] || '').replace(/[^0-9]/g, '').trim();
                const year = String(r['ระดับชั้น'] || r['year'] || r['class'] || 'ปวช.2').trim();
                const dept = String(r['แผนกวิชา'] || r['แผนก'] || r['dept'] || 'เทคโนโลยีธุรกิจดิจิทัล').trim();
                const room = String(r['ห้องเรียน'] || r['ห้อง'] || r['room'] || 'ห้อง 1').trim();

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
                    title: 'ข้อมูลไม่ถูกต้อง',
                    message: 'ไม่พบรายชื่อที่สมบูรณ์ กรุณาตรวจสอบว่ามีคอลัมน์ "รหัสนักเรียน", "ชื่อ-นามสกุล", และ "เลขบัตรประชาชน13หลัก" (13 หลัก) ครบถ้วนตามตัวอย่างเทมเพลต',
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
            showToast(`อ่านไฟล์สำเร็จ พบรายชื่อนักเรียน ${_studentExcelParsedList.length} คน`, 'info');

        } catch (err) {
            showToast('เกิดข้อผิดพลาดในการอ่านไฟล์: ' + err.message, 'error');
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
        showToast('ไม่มีข้อมูลนักเรียนที่จะนำเข้า', 'warning');
        return;
    }

    _studentExcelParsedList.forEach(s => {
        saveLocalStudent(s);
    });

    showToast(`นำเข้ารายชื่อนักเรียนสำเร็จ ${_studentExcelParsedList.length} คน!`, 'success');
    const modal = document.getElementById('modal-student-excel-import');
    if (modal) modal.classList.add('hidden');
    clearStudentExcelPreview();
    loadTeacherStudentsList();
};

// 7.4 ดาวน์โหลดไฟล์เทมเพลต Excel สำหรับเพิ่มโจทย์
window.downloadExcelQuestionTemplate = function() {
    if (!window.XLSX) {
        showToast('ไลบรารี SheetJS ยังไม่พร้อมใช้งาน', 'warning');
        return;
    }

    const templateData = [
        {
            'โจทย์คำถาม': 'ข้อใดคือโปรโตคอลความปลอดภัยสำหรับการส่งข้อมูลผ่านเว็บ?',
            'ตัวเลือก A': 'HTTP',
            'ตัวเลือก B': 'FTP',
            'ตัวเลือก C': 'HTTPS',
            'ตัวเลือก D': 'SMTP',
            'เฉลยที่ถูกต้อง (A/B/C/D)': 'C',
            'คะแนน': 2.0,
            'คำอธิบายเฉลย': 'HTTPS มีการเข้ารหัสข้อมูลผ่าน TLS/SSL ปลอดภัยที่สุด'
        },
        {
            'โจทย์คำถาม': 'ฟังก์ชันหลักของ CPU ในเครื่องคอมพิวเตอร์คืออะไร?',
            'ตัวเลือก A': 'ประมวลผลคำสั่งและข้อมูล',
            'ตัวเลือก B': 'จ่ายกระแสไฟฟ้า',
            'ตัวเลือก C': 'ระบายความร้อน',
            'ตัวเลือก D': 'แสดงผลทางจอภาพ',
            'เฉลยที่ถูกต้อง (A/B/C/D)': 'A',
            'คะแนน': 1.0,
            'คำอธิบายเฉลย': 'CPU (Central Processing Unit) ทำหน้าที่เป็นสมองในการประมวลผลคำสั่ง'
        }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'เทมเพลตข้อสอบ');

    XLSX.writeFile(workbook, 'แบบฟอร์มนำเข้าข้อสอบ_วังไกลกังวล.xlsx');
    showToast('ดาวน์โหลดไฟล์เทมเพลต Excel แล้ว กรุณากรอกโจทย์ตามตัวอย่าง', 'success');
};

// 7.5 จัดการไฟล์ Excel ที่อัปโหลด (Import)
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
                    title: 'ไม่พบข้อมูลในไฟล์',
                    message: 'ไม่พบข้อมูลข้อสอบในไฟล์ Excel หรือรูปแบบตารางไม่ถูกต้อง',
                    icon: 'fas fa-triangle-exclamation'
                });
                return;
            }

            // Helper function to extract cell value from row with flexible key matching
            const getVal = (r, keys) => {
                for (const k of keys) {
                    if (r[k] !== undefined && r[k] !== null) {
                        const s = String(r[k]).trim();
                        if (s.length > 0) return s;
                    }
                }
                const rowKeys = Object.keys(r);
                for (const targetKey of keys) {
                    const normTarget = targetKey.toLowerCase().replace(/[\s_\-()]/g, '');
                    for (const rk of rowKeys) {
                        const normRk = rk.toLowerCase().replace(/[\s_\-()]/g, '');
                        if (normRk === normTarget || (normRk.length > 2 && normTarget.length > 2 && (normRk.includes(normTarget) || normTarget.includes(normRk)))) {
                            const val = r[rk];
                            if (val !== undefined && val !== null) {
                                const s = String(val).trim();
                                if (s.length > 0) return s;
                            }
                        }
                    }
                }
                return '';
            };

            const parseCorrectOption = (rawVal, optA, optB, optC, optD) => {
                if (rawVal === undefined || rawVal === null) return 'A';
                const s = String(rawVal).trim();
                if (!s) return 'A';
                const upper = s.toUpperCase();

                // 1. Direct letter match (A, B, C, D)
                if (upper === 'A' || upper.startsWith('A.') || upper.startsWith('A ') || upper.startsWith('A:') || upper.includes('ข้อ A') || upper.includes('ตัวเลือก A')) return 'A';
                if (upper === 'B' || upper.startsWith('B.') || upper.startsWith('B ') || upper.startsWith('B:') || upper.includes('ข้อ B') || upper.includes('ตัวเลือก B')) return 'B';
                if (upper === 'C' || upper.startsWith('C.') || upper.startsWith('C ') || upper.startsWith('C:') || upper.includes('ข้อ C') || upper.includes('ตัวเลือก C')) return 'C';
                if (upper === 'D' || upper.startsWith('D.') || upper.startsWith('D ') || upper.startsWith('D:') || upper.includes('ข้อ D') || upper.includes('ตัวเลือก D')) return 'D';

                // 2. Thai letter match (ก, ข, ค, ง) and numbers (1, 2, 3, 4)
                if (s === 'ก' || s.startsWith('ก.') || s.startsWith('ก ') || s.startsWith('ก:') || s.includes('ข้อ ก') || s.includes('ตัวเลือก ก') || s === '1' || s.startsWith('1.') || s.includes('ข้อ 1') || s.includes('ตัวเลือก 1')) return 'A';
                if (s === 'ข' || s.startsWith('ข.') || s.startsWith('ข ') || s.startsWith('ข:') || s.includes('ข้อ ข') || s.includes('ตัวเลือก ข') || s === '2' || s.startsWith('2.') || s.includes('ข้อ 2') || s.includes('ตัวเลือก 2')) return 'B';
                if (s === 'ค' || s.startsWith('ค.') || s.startsWith('ค ') || s.startsWith('ค:') || s.includes('ข้อ ค') || s.includes('ตัวเลือก ค') || s === '3' || s.startsWith('3.') || s.includes('ข้อ 3') || s.includes('ตัวเลือก 3')) return 'C';
                if (s === 'ง' || s.startsWith('ง.') || s.startsWith('ง ') || s.startsWith('ง:') || s.includes('ข้อ ง') || s.includes('ตัวเลือก ง') || s === '4' || s.startsWith('4.') || s.includes('ข้อ 4') || s.includes('ตัวเลือก 4')) return 'D';

                // 3. Match answer text with option text
                const cleanS = s.toLowerCase();
                if (optA && optA.trim().toLowerCase() === cleanS) return 'A';
                if (optB && optB.trim().toLowerCase() === cleanS) return 'B';
                if (optC && optC.trim().toLowerCase() === cleanS) return 'C';
                if (optD && optD.trim().toLowerCase() === cleanS) return 'D';

                // 4. Any occurrence of A, B, C, D
                for (const char of upper) {
                    if (['A', 'B', 'C', 'D'].includes(char)) return char;
                }

                return 'A';
            };

            const parsed = rows.map((r, idx) => {
                const qText = getVal(r, ['โจทย์คำถาม', 'โจทย์', 'คำถาม', 'question', 'Question', 'text']);
                const optA = getVal(r, ['ตัวเลือก A', 'ตัวเลือกA', 'ข้อ A', 'A', 'option_a', 'ตัวเลือก 1', 'ข้อ 1', 'ก']);
                const optB = getVal(r, ['ตัวเลือก B', 'ตัวเลือกB', 'ข้อ B', 'B', 'option_b', 'ตัวเลือก 2', 'ข้อ 2', 'ข']);
                const optC = getVal(r, ['ตัวเลือก C', 'ตัวเลือกC', 'ข้อ C', 'C', 'option_c', 'ตัวเลือก 3', 'ข้อ 3', 'ค']);
                const optD = getVal(r, ['ตัวเลือก D', 'ตัวเลือกD', 'ข้อ D', 'D', 'option_d', 'ตัวเลือก 4', 'ข้อ 4', 'ง']);
                const rawCorrect = getVal(r, ['เฉลยที่ถูกต้อง (A/B/C/D)', 'เฉลยที่ถูกต้อง', 'เฉลยคำตอบ', 'เฉลยข้อ', 'เฉลย', 'คำตอบที่ถูกต้อง', 'คำตอบ', 'ข้อที่ถูก', 'ข้อถูก', 'ตัวเลือกที่ถูกต้อง', 'correct', 'Answer', 'answer', 'Key', 'key', 'Ans']);
                const correct = parseCorrectOption(rawCorrect, optA, optB, optC, optD);
                const points = Number(getVal(r, ['คะแนน', 'points', 'point', 'score'])) || 1.0;
                const explanation = getVal(r, ['คำอธิบายเฉลย', 'คำอธิบาย', 'explanation']);

                return {
                    order: idx + 1,
                    questionText: qText,
                    optA: optA || 'ตัวเลือก A',
                    optB: optB || 'ตัวเลือก B',
                    optC,
                    optD,
                    correct,
                    points,
                    explanation
                };
            });

            state.excelParsedQuestions = parsed.filter(q => q.questionText.length > 0);

            if (state.excelParsedQuestions.length === 0) {
                showCustomAlert({
                    title: 'ข้อมูลไม่ครบถ้วน',
                    message: 'กรุณาตรวจสอบว่ามีคอลัมน์ "โจทย์คำถาม", "ตัวเลือก A", และ "ตัวเลือก B" ครบถ้วนตามตัวอย่างเทมเพลต',
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
            showToast(`อ่านไฟล์สำเร็จ พบข้อสอบ ${state.excelParsedQuestions.length} ข้อ`, 'info');

        } catch (err) {
            showToast('เกิดข้อผิดพลาดในการอ่านไฟล์ Excel: ' + err.message, 'error');
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

// 7.6 นำเข้าโจทย์เข้าสู่ฐานข้อมูล Supabase
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
        document.getElementById('loading-modal-desc').textContent = `กำลังบันทึก ${totalQ} ข้อลงฐานข้อมูล...`;
        loadingModal.classList.remove('hidden');
    }

    let successCount = 0;
    let failedRows = [];
    const newLocalQuestions = [];

    const existingQ = getLocalQuestions(examId);
    const maxExistingOrder = existingQ.reduce((max, q) => Math.max(max, Number(q.order_seq) || 0), 0);

    try {
        for (let idx = 0; idx < state.excelParsedQuestions.length; idx++) {
            const q = state.excelParsedQuestions[idx];
            const currentOrder = maxExistingOrder + idx + 1;

            const options = [
                { id: 'A', text: q.optA || 'ตัวเลือก A' },
                { id: 'B', text: q.optB || 'ตัวเลือก B' }
            ];
            if (q.optC) options.push({ id: 'C', text: q.optC });
            if (q.optD) options.push({ id: 'D', text: q.optD });

            const newQ = {
                id: generatePseudoUUID(),
                exam_id: examId,
                question_text: q.questionText,
                options: options,
                points: Number(q.points) || 1.0,
                correct: q.correct || 'A',
                correct_option_id: q.correct || 'A',
                explanation: q.explanation || '',
                order_seq: currentOrder
            };

            if (loadingModal && (idx % 5 === 0 || idx === totalQ - 1)) {
                document.getElementById('loading-modal-desc').textContent = `กำลังบันทึกข้อที่ ${idx + 1}/${totalQ}...`;
            }

            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    const { data, error } = await state.supabaseClient.rpc('create_question_with_answer', {
                        p_exam_id: examId,
                        p_question_text: q.questionText,
                        p_options: options,
                        p_points: Number(q.points) || 1.0,
                        p_correct_option_id: q.correct || 'A',
                        p_explanation: q.explanation || '',
                        p_order_seq: currentOrder
                    });
                    if (error) {
                        console.error(`[Excel Import] ข้อ ${idx + 1} Supabase error:`, error);
                        failedRows.push({ order: idx + 1, error: error.message });
                    } else {
                        if (data && data.question_id) {
                            newQ.id = data.question_id;
                        }
                        successCount++;
                    }
                } catch (rpcErr) {
                    console.error(`[Excel Import] ข้อ ${idx + 1} RPC exception:`, rpcErr);
                    failedRows.push({ order: idx + 1, error: rpcErr.message || 'Network error' });
                }
            } else {
                successCount++;
            }

            newLocalQuestions.push(newQ);
        }

        const allLocal = getLocalQuestions();
        newLocalQuestions.forEach(q => allLocal.unshift(q));
        localStorage.setItem('EXAM_LOCAL_QUESTIONS', JSON.stringify(allLocal));
        broadcastAppEvent('exam_updated', { examId });

        if (loadingModal) loadingModal.classList.add('hidden');

        if (failedRows.length === 0) {
            showCustomAlert({
                title: 'นำเข้าสำเร็จ!',
                message: `🎉 บันทึกข้อสอบเข้าสู่ชุดข้อสอบเรียบร้อยแล้ว ครบถ้วน ${totalQ} ข้อ!`,
                icon: 'fas fa-check-circle'
            });
        } else {
            showCustomAlert({
                title: 'นำเข้าสำเร็จบางส่วน',
                message: `บันทึกสำเร็จ ${successCount}/${totalQ} ข้อ\n(ไม่สำเร็จ ${failedRows.length} ข้อ: ${failedRows.map(f => `ข้อ ${f.order}`).join(', ')})\n\nคำแนะนำ: กรุณารัน SQL อัปเดตตาราง questions/exams ใน Supabase`,
                icon: 'fas fa-triangle-exclamation'
            });
        }

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

// 7.7 ตรวจคำตอบนักเรียนทีละข้อ (Inspection Modal)
// 7.2.2 อาจารย์ปลดล็อกให้นักเรียนทำข้อสอบใหม่อีกครั้ง (ล้างผลสอบเดิมและเปิดสิทธิ์)
window.allowStudentRetake = function(subId, studentId, examId, studentName, examTitle) {
    // รองรับการเรียกแบบ 4 พารามิเตอร์เดิม (studentId, examId, studentName, examTitle)
    if (!examTitle && studentName && examId) {
        examTitle = studentName;
        studentName = examId;
        examId = studentId;
        studentId = subId;
        subId = null;
    }

    showCustomConfirm({
        title: 'ปลดล็อกให้เข้าทำข้อสอบใหม่',
        message: `คุณต้องการล้างผลสอบเดิมและอนุญาตให้นักเรียน "${studentName}" เข้าทำข้อสอบชุด "${examTitle}" ใหม่อีกครั้งใช่หรือไม่?`,
        icon: 'fas fa-rotate-left text-amber-500',
        confirmText: 'ปลดล็อกให้สอบใหม่',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-amber-600 hover:bg-amber-700 text-white shadow-md shadow-amber-100',
        onConfirm: async () => {
            // 1. ลบจาก Local Storage ของครู
            const subs = getLocalSubmissions();
            const cleanName = (studentName || '').trim().toLowerCase();
            const updatedSubs = subs.filter(s => !(s.exam_id === examId && (s.student_id === studentId || (s.student_name && s.student_name.trim().toLowerCase() === cleanName))));
            localStorage.setItem('EXAM_LOCAL_SUBMISSIONS', JSON.stringify(updatedSubs));

            // 2. ลบจาก Supabase Cloud แบบแยกคำสั่ง ป้องกัน syntax error จากช่องว่างในชื่อหรือ UUID error
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    // ลบจาก exam_results ด้วย Primary Key ID โดยตรง (100% แน่นอน)
                    if (subId && isValidUUID(subId)) {
                        await state.supabaseClient
                            .from('exam_results')
                            .delete()
                            .eq('id', subId);
                    }

                    // ลบจาก exam_results ด้วย student_id (ถ้าเป็น UUID)
                    if (isValidUUID(studentId)) {
                        await state.supabaseClient
                            .from('exam_results')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_id', studentId);
                    }

                    // ลบจาก exam_results ด้วย student_name
                    if (studentName) {
                        await state.supabaseClient
                            .from('exam_results')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_name', studentName);
                    }

                    // ลบจาก student_submissions ด้วย student_id (ถ้าเป็น UUID)
                    if (isValidUUID(studentId)) {
                        await state.supabaseClient
                            .from('student_submissions')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_id', studentId);
                    }

                    // ลบจาก student_submissions ด้วย student_name
                    if (studentName) {
                        await state.supabaseClient
                            .from('student_submissions')
                            .delete()
                            .eq('exam_id', examId)
                            .eq('student_name', studentName);
                    }

                    // ลบจาก anti_cheat_logs
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

            // 3. ส่งสัญญาณ Realtime เพื่อปลดล็อกในเครื่องนักเรียนทันที
            broadcastAppEvent('student_retake_unlocked', {
                studentId: studentId,
                examId: examId,
                studentName: studentName
            });

            showToast(`ปลดล็อกให้นักเรียน "${studentName}" เข้าทำข้อสอบใหม่เรียบร้อยแล้ว!`, 'success');
            await loadTeacherSubmissions();

            const unlockModal = document.getElementById('modal-exam-submissions-unlock');
            if (unlockModal && !unlockModal.classList.contains('hidden')) {
                await openExamSubmissionsUnlockModal(examId);
            }

            // ปิด modal ตรวจคำตอบถ้าเปิดอยู่
            closeInspectModal();
        }
    });
};

window.inspectStudentSubmission = async function(studentId, examId, studentName) {
    const modal = document.getElementById('modal-inspect');
    const container = document.getElementById('inspect-content');
    const nameEl = document.getElementById('inspect-student-name');

    if (nameEl) nameEl.textContent = `รายงานการตรวจ: ${studentName}`;
    if (modal) modal.classList.remove('hidden');

    if (container) {
        container.innerHTML = `
            <div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-emerald-500 mb-2"></i><p class="text-gray-500 text-sm">กำลังดึงข้อมูลคำตอบและเฉลยลับ...</p></div>
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
                <div><span class="text-gray-400 block text-xs">คะแนนรวม:</span><span class="text-lg font-bold text-gray-800">${summary.total_score || 0} / ${summary.max_score || 0}</span></div>
                <div><span class="text-gray-400 block text-xs">คิดเป็น:</span><span class="text-lg font-bold text-emerald-600">${summary.percentage || 0}%</span></div>
                <div><span class="text-gray-400 block text-xs">สลับหน้าจอรวม:</span><span class="text-lg font-bold text-amber-600">${summary.total_tab_switches || 0} ครั้ง</span></div>
                <div><span class="text-gray-400 block text-xs">สถานะ Anti-Cheat:</span><span class="text-xs font-bold px-2 py-1 rounded-full ${summary.is_flagged_cheating ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${summary.is_flagged_cheating ? '⚠️ สงสัยทุจริต' : '✅ ปกติ'}</span></div>
            </div>

            <h4 class="font-bold text-gray-800 mb-4 text-sm flex items-center gap-2">
                <i class="fas fa-list-check text-emerald-500"></i> รายละเอียดคำตอบ (${questions.length} ข้อ):
            </h4>

            <div class="space-y-4">
                ${questions.map((q, idx) => {
    const isCorrect = q.is_correct;
    const parsed = parseQuestionTextAndImage(q.question_text, q.image_url || q.image);
    return `
        <div class="p-4 rounded-xl border ${isCorrect ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}">
            <div class="flex items-center justify-between mb-2">
                <span class="font-bold text-sm text-gray-800">ข้อที่ ${idx + 1}: ${escapeHtml(parsed.text || (parsed.image ? '(ข้อสอบแบบรูปภาพ)' : ''))}</span>
                <span class="text-xs font-bold px-2 py-0.5 rounded ${isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    ${isCorrect ? `+${q.points} คะแนน (ถูก)` : '0 คะแนน (ผิด)'}
                </span>
            </div>
            ${parsed.image ? `
                <div class="mb-3 p-2 bg-white rounded-xl border border-gray-200 inline-block">
                    <img src="${parsed.image}" alt="รูปภาพโจทย์" class="max-h-48 max-w-full object-contain rounded-lg cursor-pointer hover:opacity-90 transition" onclick="openImageZoomModal('${parsed.image}')">
                    <div class="text-[10px] text-gray-400 mt-1"><i class="fas fa-magnifying-glass-plus"></i> คลิกเพื่อดูรูปขนาดใหญ่</div>
                </div>
            ` : ''}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mb-2">
                <div class="p-2 rounded bg-white border border-gray-100"><span class="text-gray-400">คำตอบที่นักเรียนเลือก:</span> <strong class="${isCorrect ? 'text-green-600' : 'text-red-600'}">${q.student_selected || 'ไม่ได้ตอบ'}</strong></div>
                <div class="p-2 rounded bg-white border border-gray-100"><span class="text-gray-400">เฉลยที่ถูกต้อง:</span> <strong class="text-green-600">${q.correct_answer}</strong></div>
            </div>
            ${q.explanation ? `<p class="text-xs text-gray-500 bg-white/80 p-2 rounded border border-gray-100 mt-1">💡 <strong>คำอธิบาย:</strong> ${escapeHtml(q.explanation)}</p>` : ''}
        </div>
    `;
}).join('')}

            </div>
        `;

    } catch (err) {
        container.innerHTML = `<div class="text-red-500 p-4">เกิดข้อผิดพลาด: ${escapeHtml(err.message)}</div>`;
    }
};

window.closeInspectModal = function() {
    const modal = document.getElementById('modal-inspect');
    if (modal) modal.classList.add('hidden');
};

// 7.8 จัดการชุดข้อสอบในห้องอาจารย์ (พร้อมสวิตช์เปิด/ปิดสอบทันที & แยกสิทธิ์ครูแต่ละท่าน)
// 8.1 ตัวกรองระดับชั้นปีในหน้ารวมชุดข้อสอบ
window.selectedTeacherExamYearFilter = 'ทั้งหมด';

window.setTeacherExamYearFilter = function(year) {
    window.selectedTeacherExamYearFilter = year || 'ทั้งหมด';
    
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

// 8.1 โหลดชุดข้อสอบทั้งหมด โดยจัดกลุ่มแยกตามหมวดหมู่วิชาและระดับชั้นปีอย่างชัดเจน
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

    // 🔒 Teacher Isolation: แสดงเฉพาะชุดข้อสอบของอาจารย์ท่านนี้เท่านั้น (เว้นแต่ Admin)
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
    const yearFilter = window.selectedTeacherExamYearFilter || 'ทั้งหมด';

    let filteredExams = exams;

    if (searchVal) {
        filteredExams = filteredExams.filter(e => 
            (e.title && e.title.toLowerCase().includes(searchVal)) ||
            (e.description && e.description.toLowerCase().includes(searchVal))
        );
    }
    if (yearFilter !== 'ทั้งหมด') {
        filteredExams = filteredExams.filter(e => (e.target_year || '').includes(yearFilter));
    }

    if (filteredExams.length === 0) {
        container.innerHTML = `
            <div class="bg-white p-10 rounded-3xl border border-slate-200 text-center space-y-3">
                <div class="w-16 h-16 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto text-2xl">
                    <i class="fas fa-folder-open"></i>
                </div>
                <h4 class="font-bold text-slate-800 text-base">ไม่พบชุดข้อสอบตามเงื่อนไข</h4>
                <p class="text-xs text-slate-400 max-w-sm mx-auto">คุณสามารถสร้างชุดข้อสอบใหม่ หรือคลิกปุ่มเลือก "ทั้งหมด" ด้านบนเพื่อดูชุดข้อสอบทั้งหมด</p>
                <div class="flex items-center justify-center gap-2 pt-2">
                    <button onclick="setTeacherExamYearFilter('ทั้งหมด')" class="px-3.5 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition">
                        <i class="fas fa-rotate-left mr-1"></i> แสดงทั้งหมด
                    </button>
                    <button onclick="openCreateExamModal()" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-sm hover:bg-emerald-700 transition">
                        <i class="fas fa-plus mr-1"></i> สร้างชุดข้อสอบใหม่
                    </button>
                </div>
            </div>
        `;
        populateTeacherExamSelects();
        return;
    }

    // จัดกลุ่มชุดข้อสอบตาม รายวิชา + ระดับชั้นปี (Group by Course and Target Year)
    const groupsMap = new Map();

    filteredExams.forEach(exam => {
        const matchedCourse = state.courses?.find(c => c.id === exam.course_id);
        const courseCode = matchedCourse?.course_code || 'ทั่วไป';
        const courseName = matchedCourse?.course_name || 'วิชาทั่วไป';
        const targetYear = exam.target_year || 'ทุกระดับชั้น';

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
            const targetTag = `${exam.target_year || 'ทุกชั้น'} | ${exam.target_department || 'ทุกแผนก'} | ${exam.target_room || 'ทุกห้อง'}`;

            return `
                <div class="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-sm transition flex flex-wrap items-center justify-between gap-4">
                    <div class="flex-1 min-w-[280px]">
                        <div class="flex flex-wrap items-center gap-2 mb-1.5">
                            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                                ${isActive ? '🟢 เปิดสอบอยู่' : '⚪ ปิดสอบอยู่'}
                            </span>
                            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full ${isShowScore ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                                ${isShowScore ? '👁️ แสดงคะแนนทันที' : '🔒 ซ่อนคะแนน'}
                            </span>
                            <h4 class="font-bold text-slate-800 text-base">${escapeHtml(exam.title)}</h4>
                        </div>
                        
                        <div class="text-xs text-amber-800 font-semibold mb-2 flex items-center gap-1.5">
                            <i class="fas fa-bullseye text-amber-600"></i> เป้าหมาย: <strong>${escapeHtml(targetTag)}</strong>
                        </div>
                        
                        <p class="text-xs text-slate-500 line-clamp-1">${escapeHtml(exam.description || 'ไม่มีคำอธิบายเพิ่มเติม')}</p>
                        
                        <div class="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-2.5">
                            <button type="button" onclick="openEditExamDurationModal('${exam.id}', ${exam.duration_minutes || 60}, '${escapeHtml(exam.title)}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/70 hover:bg-indigo-100 hover:text-indigo-800 font-bold text-indigo-700 transition border border-indigo-100" title="คลิกเพื่อเปลี่ยนเวลาทำข้อสอบ">
                                <i class="far fa-clock text-indigo-500"></i>
                                <span>${exam.duration_minutes || 60} นาที</span>
                                <i class="fas fa-pen-to-square text-[10px] text-indigo-400 ml-0.5"></i>
                            </button>
                            <span><i class="far fa-user-tie text-emerald-600"></i> ${escapeHtml(exam.teacher_name || 'อาจารย์ผู้สอน')}</span>
                            <span><i class="fas fa-shield-halved text-purple-500"></i> สลับจอ: ${exam.max_tab_switches_allowed || 3} ครั้ง</span>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <!-- 1. แก้ไขข้อสอบ (ตรวจดูโจทย์, เฉลย และเปิด/ปิดแสดงคะแนน) -->
                        <button onclick="viewTeacherExam('${exam.id}')" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-xs" title="คลิกเพื่อแก้ไขข้อสอบ ตรวจดูโจทย์ เฉลย และตั้งค่าเปิด/ปิดแสดงคะแนน">
                            <i class="fas fa-pen-to-square text-white"></i>
                            <span>แก้ไขข้อสอบ</span>
                        </button>

                        <!-- 2. ผลสอบ & ให้สอบใหม่ (Allow Retake) -->
                        <button onclick="openExamSubmissionsUnlockModal('${exam.id}')" class="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-xs border border-amber-300" title="ดูผลสอบของชุดนี้ และกดปลดล็อกให้นักเรียนทำใหม่">
                            <i class="fas fa-rotate-left text-amber-600"></i>
                            <span>🔄 ให้สอบใหม่</span>
                        </button>

                        <!-- 3. สลับ เปิด/ปิดสอบ ทันที -->
                        <button onclick="toggleExamActive('${exam.id}')" class="px-3.5 py-2 ${isActive ? 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'} rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs" title="คลิกสลับเปิดหรือปิดสอบ">
                            <i class="fas ${isActive ? 'fa-toggle-on text-emerald-600 text-sm' : 'fa-toggle-off text-slate-400 text-sm'}"></i>
                            <span>${isActive ? 'ขอปิดสอบ' : 'เปิดสอบ'}</span>
                        </button>

                        <button onclick="openAddQuestionForExam('${exam.id}')" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-xs">
                            <i class="fas fa-plus"></i> เพิ่มโจทย์
                        </button>
                        <button onclick="openExcelImportForExam('${exam.id}')" class="px-3 py-2 btn-excel rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-xs">
                            <i class="fas fa-file-excel"></i> นำเข้า Excel
                        </button>
                        <button onclick="deleteExam('${exam.id}', '${escapeHtml(exam.title)}')" class="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-medium transition flex items-center gap-1.5" title="ลบชุดข้อสอบ">
                            <i class="fas fa-trash-can"></i> ลบ
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="bg-slate-100/70 rounded-3xl p-4 sm:p-5 border border-slate-200 space-y-3 shadow-2xs">
                <!-- Group Category Header (หัวข้อหมวดหมู่วิชาและระดับชั้นปี) -->
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
                                🎓 ระดับชั้น: ${escapeHtml(group.targetYear)}
                            </span>
                        </div>
                    </div>
                    <span class="text-xs text-slate-600 font-bold px-3 py-1 bg-white rounded-xl border border-slate-200 shadow-2xs">
                        ${group.exams.length} ชุดข้อสอบ
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

// 8.1.2 เปิดหน้าต่างดูผลสอบและปลดล็อกสอบใหม่รายชุดข้อสอบ
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
        showToast('ไม่พบข้อมูลชุดข้อสอบ', 'error');
        return;
    }

    const matchedCourse = state.courses?.find(c => c.id === exam.course_id);
    const courseCode = matchedCourse?.course_code || 'ทั่วไป';
    const courseName = matchedCourse?.course_name || 'วิชาทั่วไป';

    if (titleEl) titleEl.textContent = exam.title;
    if (badgeEl) badgeEl.textContent = `[${courseCode}] ${courseName}`;

    modal.classList.remove('hidden');

    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-8 text-slate-400">
                    <i class="fas fa-spinner fa-spin text-2xl text-indigo-500 mb-2 block"></i>
                    กำลังโหลดรายชื่อนักเรียนที่ส่งข้อสอบชุดนี้...
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
            <span><i class="fas fa-users text-indigo-500"></i> ส่งข้อสอบแล้ว: <strong>${examSubs.length} คน</strong></span>
            <span><i class="fas fa-bullseye text-amber-500"></i> เป้าหมาย: <strong>${escapeHtml(exam.target_year || 'ทุกชั้น')} ${escapeHtml(exam.target_room || 'ทุกห้อง')}</strong></span>
        `;
    }

    if (examSubs.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-10 text-slate-400">
                    <i class="fas fa-user-clock text-3xl text-slate-300 mb-2 block"></i>
                    ยังไม่มีนักเรียนส่งข้อสอบในชุดนี้
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
                    <div class="font-bold text-slate-900">${escapeHtml(sub.student_name || 'นักเรียน')}</div>
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
                        ${sub.total_tab_switches} ครั้ง
                    </span>
                </td>
                <td class="py-3.5 px-4 text-center">
                    ${isFlagged ? `
                        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">⚠️ สงสัยทุจริต</span>
                    ` : `
                        <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">✅ ปกติ</span>
                    `}
                </td>
                <td class="py-3.5 px-4 text-slate-400 text-[11px]">${formattedDate}</td>
                <td class="py-3.5 px-4 text-right">
                    <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <button onclick="inspectStudentSubmission('${sub.student_id}', '${sub.exam_id}', '${escapeHtml(sub.student_name)}')" class="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg transition shadow-2xs inline-flex items-center gap-1">
                            <i class="fas fa-search"></i> ตรวจคำตอบ
                        </button>
                        <button onclick="allowStudentRetake('${sub.id || ''}', '${sub.student_id}', '${sub.exam_id}', '${escapeHtml(sub.student_name)}', '${escapeHtml(exam.title)}')" class="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold rounded-lg transition shadow-2xs inline-flex items-center gap-1 border border-amber-300" title="ล้างผลสอบเดิมและเปิดสิทธิ์ให้นักเรียนทำใหม่ทันที">
                            <i class="fas fa-rotate-left"></i> ให้สอบใหม่
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
    showToast(`ชุดข้อสอบ "${exam.title}" เปลี่ยนสถานะเป็น ${newStatus ? '🟢 เปิดสอบอยู่' : '⚪ ปิดสอบอยู่'}`, 'success');
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
    showToast(`ชุดข้อสอบ "${exam.title}" ${newSetting ? '👁️ เปิดให้นักเรียนเห็นคะแนนแล้ว' : '🔒 ซ่อนคะแนนจากนักเรียนแล้ว'}`, 'success');
    await loadTeacherExamsList();
};

window.openEditExamDurationModal = function(examId, currentMinutes, examTitle = '') {
    const modal = document.getElementById('modal-edit-exam-duration');
    const idInput = document.getElementById('edit-duration-exam-id');
    const minInput = document.getElementById('edit-duration-minutes-input');
    const titleEl = document.getElementById('edit-duration-exam-title');
    const switchesInput = document.getElementById('edit-max-switches-input');

    if (!modal) return;

    if (idInput) idInput.value = examId;
    if (minInput) minInput.value = currentMinutes || 60;
    if (titleEl) titleEl.textContent = examTitle || 'ชุดข้อสอบ';

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

window.saveExamDuration = async function(event) {
    event.preventDefault();
    const examId = document.getElementById('edit-duration-exam-id')?.value;
    const minutes = parseInt(document.getElementById('edit-duration-minutes-input')?.value, 10);
    const maxSwitches = parseInt(document.getElementById('edit-max-switches-input')?.value, 10);

    if (!examId || isNaN(minutes) || minutes <= 0) {
        showToast('กรุณาระบุเวลาทำข้อสอบให้ถูกต้อง (อย่างน้อย 1 นาที)', 'warning');
        return;
    }
    const safeSwitches = isNaN(maxSwitches) || maxSwitches < 0 ? 3 : maxSwitches;

    const exams = getLocalExams();
    const exam = exams.find(e => e.id === examId);
    if (!exam) {
        showToast('ไม่พบข้อมูลชุดข้อสอบ', 'error');
        return;
    }

    exam.duration_minutes = minutes;
    exam.max_tab_switches_allowed = safeSwitches;
    saveLocalExam(exam);

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            await state.supabaseClient
                .from('exams')
                .update({ 
                    duration_minutes: minutes,
                    max_tab_switches_allowed: safeSwitches
                })
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
            state.localExams[idx].max_tab_switches_allowed = safeSwitches;
        }
    }

    // Update view modal display if open
    const displayEl = document.getElementById('teacher-view-duration-display');
    if (displayEl) displayEl.textContent = `${minutes} นาที`;

    closeEditExamDurationModal();
    showToast(`อัปเดต "${exam.title}" เป็น ${minutes} นาที, อนุญาตสลับจอ ${safeSwitches} ครั้ง เรียบร้อยแล้ว!`, 'success');
    broadcastAppEvent('exam_updated', exam);
    await loadTeacherExamsList();
};

window.viewTeacherExam = async function(examId) {
    const exam = (state.localExams || getLocalExams()).find(e => e.id === examId) || 
                 getLocalExams().find(e => e.id === examId);
    if (!exam) {
        showToast('ไม่พบข้อมูลชุดข้อสอบ', 'error');
        return;
    }

    let questions = getLocalQuestions(examId);

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            // 1. ดึงคำถามพร้อมเฉลยตรงจาก exam_answers ผ่าน RPC
            const { data: rpcQ, error: rpcErr } = await state.supabaseClient
                .rpc('get_teacher_exam_questions', { p_exam_id: examId });

            if (!rpcErr && Array.isArray(rpcQ) && rpcQ.length > 0) {
                questions = rpcQ;
            } else {
                // 2. Fallback: ดึงจาก questions table และจับคู่กับข้อมูลเครื่องทั้งด้วย id และข้อความโจทย์
                const { data: dbQ, error: dbErr } = await state.supabaseClient
                    .from('questions')
                    .select('*')
                    .eq('exam_id', examId)
                    .order('order_seq', { ascending: true });

                if (!dbErr && Array.isArray(dbQ) && dbQ.length > 0) {
                    const localById = new Map(questions.map(q => [q.id, q]));
                    const localByText = new Map(questions.map(q => [q.question_text?.trim(), q]));
                    questions = dbQ.map(q => {
                        const localQ = localById.get(q.id) || localByText.get(q.question_text?.trim());
                        return {
                            ...q,
                            correct: localQ?.correct || localQ?.correct_option_id || q.correct_option_id || 'A',
                            explanation: localQ?.explanation || ''
                        };
                    });
                }
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
    const courseCode = matchedCourse?.course_code || 'ทั่วไป';
    const courseName = matchedCourse?.course_name || 'วิชาทั่วไป';
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
                ${isActive ? '🟢 เปิดสอบอยู่' : '⚪ ปิดสอบอยู่'}
            </span>
            <span class="ml-1 px-2.5 py-0.5 text-xs font-bold rounded-full ${isShowScore ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                ${isShowScore ? '👁️ แสดงคะแนน' : '🔒 ซ่อนคะแนน'}
            </span>
        `;
    }
    if (titleEl) titleEl.textContent = exam.title;
    if (metaEl) {
        metaEl.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 pt-1">
                <span class="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100/80 px-2.5 py-1 rounded-xl text-indigo-900 shadow-2xs">
                    <i class="far fa-clock text-indigo-600"></i> เวลาสอบ: <strong id="teacher-view-duration-display" class="font-bold text-indigo-700">${exam.duration_minutes || 60} นาที</strong>
                    <button type="button" onclick="openEditExamDurationModal('${exam.id}', ${exam.duration_minutes || 60}, '${escapeHtml(exam.title)}')" class="ml-1 px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition inline-flex items-center gap-1 shadow-xs" title="คลิกเพื่อเปลี่ยนเวลาทำข้อสอบ">
                        <i class="fas fa-pen-to-square"></i> แก้ไขเวลา
                    </button>
                </span>
                <button type="button" onclick="toggleExamShowScore('${exam.id}'); setTimeout(() => viewTeacherExam('${exam.id}'), 200);" class="px-3 py-1.5 ${isShowScore ? 'bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'} rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 shadow-xs" title="คลิกเพื่อเปิดหรือปิดการแสดงคะแนนให้นักเรียนเห็นทันทีหลังส่ง">
                    <i class="fas ${isShowScore ? 'fa-eye text-amber-600' : 'fa-eye-slash text-slate-500'}"></i>
                    <span>${isShowScore ? '👁️ แสดงคะแนนให้นักเรียน: เปิด' : '🔒 ซ่อนคะแนน: ปิดอยู่'}</span>
                </button>
                <span><i class="fas fa-list-check text-emerald-500"></i> ข้อสอบ: <strong>${questions.length} ข้อ</strong> (${totalPoints} คะแนน)</span>
                <span><i class="fas fa-bullseye text-amber-500"></i> <strong>${escapeHtml(exam.target_year || 'ทุกชั้น')} ${escapeHtml(exam.target_department || 'ทุกแผนก')} ${escapeHtml(exam.target_room || 'ทุกห้อง')}</strong></span>
                <span><i class="fas fa-shield-halved text-purple-500"></i> สลับจอ: <strong>${exam.max_tab_switches_allowed || 3} ครั้ง</strong></span>
                <button type="button" onclick="closeTeacherExamViewModal(); openExamSubmissionsUnlockModal('${exam.id}')" class="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition inline-flex items-center gap-1 shadow-xs">
                    <i class="fas fa-rotate-left"></i> ผลสอบ & ให้สอบใหม่
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
                <h4 class="font-bold text-slate-800 text-base">ยังไม่มีคำถามในชุดข้อสอบนี้</h4>
                <p class="text-xs text-slate-500 max-w-sm mx-auto">คุณสามารถเพิ่มคำถามแบบข้อต่อข้อ หรือนำเข้าข้อสอบพร้อมกันจากไฟล์ Excel (.xlsx) ได้ทันที</p>
                <div class="flex items-center justify-center gap-2 pt-2">
                    <button onclick="closeTeacherExamViewModal(); openAddQuestionForExam('${exam.id}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-plus"></i> เพิ่มโจทย์แรก
                    </button>
                    <button onclick="closeTeacherExamViewModal(); openExcelImportForExam('${exam.id}')" class="px-4 py-2 btn-excel text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5">
                        <i class="fas fa-file-excel"></i> นำเข้า Excel
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
                                <i class="fas fa-check"></i> เฉลย
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
                                ข้อที่ ${qNum}
                            </span>
                            <span class="text-xs text-slate-400">(${points} คะแนน)</span>
                        </div>
                        <button onclick="deleteTeacherQuestion('${q.id}', '${exam.id}', ${qNum})" class="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded-lg transition font-medium flex items-center gap-1">
                            <i class="fas fa-trash-can"></i> ลบข้อนี้
                        </button>
                    </div>

                    ${parsed.image ? `
                        <div class="p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3">
                            <img src="${parsed.image}" alt="ภาพโจทย์" class="w-24 h-24 object-contain bg-white rounded-lg border border-slate-200 shadow-2xs cursor-pointer" onclick="openImageZoomModal('${parsed.image}')">
                            <div class="text-xs text-slate-500">
                                <div class="font-bold text-slate-700 mb-1"><i class="far fa-image text-indigo-600 mr-1"></i> มีรูปภาพประกอบโจทย์</div>
                                <button type="button" onclick="openImageZoomModal('${parsed.image}')" class="text-[11px] text-indigo-600 hover:underline font-semibold">
                                    <i class="fas fa-magnifying-glass-plus"></i> คลิกเพื่อดูรูปขนาดใหญ่
                                </button>
                            </div>
                        </div>
                    ` : ''}

                    <div class="text-sm font-bold text-slate-900 leading-snug">
                        ${escapeHtml(parsed.text || (parsed.image ? '(ดูโจทย์จากภาพด้านบน)' : ''))}
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        ${optionsHtml}
                    </div>

                    ${q.explanation ? `
                        <div class="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-900 mt-2">
                            <strong class="text-amber-800"><i class="fas fa-lightbulb text-amber-600 mr-1"></i> คำอธิบาย:</strong> ${escapeHtml(q.explanation)}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

    }
}


window.deleteTeacherQuestion = async function(questionId, examId, qIndex) {
    showCustomConfirm({
        title: 'ยืนยันการลบคำถาม',
        message: `คุณต้องการลบคำถามข้อที่ ${qIndex} ใช่หรือไม่?\n(ข้อมูลจะไม่สามารถกู้คืนได้)`,
        icon: 'fas fa-trash-can',
        confirmText: 'ลบคำถาม',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            const allQ = getLocalQuestions().filter(q => q.id !== questionId);
            localStorage.setItem('EXAM_LOCAL_QUESTIONS', JSON.stringify(allQ));

            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    const { error } = await state.supabaseClient.from('questions').delete().eq('id', questionId);
                    if (error) {
                        console.error('[deleteTeacherQuestion] Supabase error:', error);
                        showToast('ลบจากเซิร์ฟเวอร์ไม่สำเร็จ (ติดสิทธิ์ RLS): ' + error.message, 'warning');
                    }
                    await state.supabaseClient.from('exam_answers').delete().eq('question_id', questionId);
                } catch (e) {
                    console.error('[deleteTeacherQuestion] Error:', e);
                }
            }

            showToast(`ลบคำถามข้อที่ ${qIndex} เรียบร้อยแล้ว`, 'info');
            await viewTeacherExam(examId);
            await loadTeacherExamsList();
        }
    });
};

window.deleteExam = function(examId, examTitle) {
    showCustomConfirm({
        title: 'ยืนยันการลบชุดข้อสอบ',
        message: `คุณต้องการลบชุดข้อสอบ "${examTitle}" ใช่หรือไม่?\n(คำถามและข้อมูลทั้งหมดของชุดนี้จะถูกลบออกจากระบบ)`,
        icon: 'fas fa-trash-can',
        confirmText: 'ลบชุดข้อสอบ',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            closeTeacherExamViewModal();
            deleteLocalExam(examId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    const { error } = await state.supabaseClient.from('exams').delete().eq('id', examId);
                    if (error) {
                        console.error('[deleteExam] Supabase error:', error);
                        showToast('ลบจากเซิร์ฟเวอร์ไม่สำเร็จ (ติดสิทธิ์ RLS): ' + error.message, 'warning');
                    }
                } catch (e) {
                    console.error('[deleteExam] Error:', e);
                }
            }
            showToast(`ลบชุดข้อสอบ "${examTitle}" เรียบร้อยแล้ว`, 'info');
            await loadTeacherExamsList();
            populateTeacherExamSelects();
        }
    });
};

function populateCourseSelects() {
    const courseSelect = document.getElementById('create-exam-course-select');
    if (!courseSelect) return;

    if (state.courses.length === 0) {
        courseSelect.innerHTML = `<option value="">(ไม่มีรายวิชา - กรุณาสร้างรายวิชาก่อน)</option>`;
        return;
    }

    courseSelect.innerHTML = state.courses.map(c => `
        <option value="${c.id}" data-year="${escapeHtml(c.target_year || 'ทั้งหมด')}" data-dept="${escapeHtml(c.target_department || 'ทั้งหมด')}">[${escapeHtml(c.course_code)}] ${escapeHtml(c.course_name)} (${escapeHtml(c.target_year || 'ทุกชั้น')})</option>
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
            // ดึงชุดข้อสอบทั้งหมด
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

    // ใช้ localExams ที่สร้างไว้จริง
    if (exams.length === 0 && Array.isArray(state.localExams) && state.localExams.length > 0) {
        exams = state.localExams;
    }

    // 🔒 Teacher Isolation: แสดงเฉพาะชุดข้อสอบของตนเอง
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
            select.innerHTML = `<option value="">-- ยังไม่มีชุดข้อสอบ (กรุณาสร้างชุดข้อสอบก่อน) --</option>`;
            return;
        }

        let html = exams.map(exam => {
            const coursePrefix = exam.course?.course_code ? `[${exam.course.course_code}] ` : (exam.course?.course_name ? `[${exam.course.course_name}] ` : '');
            const targetTag = ` (${exam.target_year || 'ทุกชั้น'} ${exam.target_room || 'ทุกห้อง'})`;
            return `<option value="${exam.id}">${escapeHtml(coursePrefix + exam.title + targetTag)}</option>`;
        }).join('');

        select.innerHTML = html;

        // Auto-select: ถ้ามีค่าเดิมที่ตรงให้คงไว้ มิฉะนั้นเลือกชุดแรกให้อัตโนมัติทันที
        if (currentVal && exams.some(e => e.id === currentVal)) {
            select.value = currentVal;
        } else if (exams.length > 0) {
            select.value = exams[0].id;
        }
    });

    if (showToastFeedback) {
        showToast(`โหลดรายการชุดข้อสอบแล้ว (${exams.length} ชุด)`, 'info');
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
    loadAdminExamsList();
}

// 8.1.1 จัดการชุดข้อสอบทั้งหมดในหน้าแอดมิน (Admin Exam Management)
let _adminAllExamsCache = [];

window.loadAdminExamsList = async function() {
    const tableBody = document.getElementById('admin-exams-table-body');
    const badgeCount = document.getElementById('admin-exams-count-badge');
    const teacherFilter = document.getElementById('admin-exam-teacher-filter');
    if (!tableBody) return;

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
            console.warn('[loadAdminExamsList] Remote fetch notice:', err);
        }
    }

    _adminAllExamsCache = exams;

    // เติมรายชื่ออาจารย์ลงใน Dropdown Filter
    if (teacherFilter) {
        const currentTeacherFilter = teacherFilter.value;
        const teacherNames = Array.from(new Set(exams.map(e => (e.teacher_name || '').trim()).filter(Boolean))).sort();
        teacherFilter.innerHTML = `<option value="ทั้งหมด">อาจารย์: ทั้งหมด</option>` + teacherNames.map(name => `
            <option value="${escapeHtml(name)}">${escapeHtml(name)}</option>
        `).join('');
        if (teacherNames.includes(currentTeacherFilter)) {
            teacherFilter.value = currentTeacherFilter;
        }
    }

    renderAdminExamsTable(exams);
};

window.filterAdminExamsList = function() {
    const search = (document.getElementById('admin-exam-search-input')?.value || '').trim().toLowerCase();
    const teacher = document.getElementById('admin-exam-teacher-filter')?.value || 'ทั้งหมด';

    let filtered = _adminAllExamsCache || [];

    if (teacher !== 'ทั้งหมด') {
        filtered = filtered.filter(e => (e.teacher_name || '').trim().toLowerCase() === teacher.toLowerCase());
    }

    if (search) {
        filtered = filtered.filter(e => 
            (e.title || '').toLowerCase().includes(search) ||
            (e.teacher_name || '').toLowerCase().includes(search) ||
            (e.target_year || '').toLowerCase().includes(search) ||
            (e.target_department || '').toLowerCase().includes(search)
        );
    }

    renderAdminExamsTable(filtered);
};

function renderAdminExamsTable(exams) {
    const tableBody = document.getElementById('admin-exams-table-body');
    const badgeCount = document.getElementById('admin-exams-count-badge');
    if (!tableBody) return;

    if (badgeCount) badgeCount.textContent = `${exams.length} ชุดข้อสอบ`;

    if (!exams || exams.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-8 text-slate-400">
                    <i class="fas fa-folder-open text-2xl text-slate-300 mb-2 block"></i>
                    ไม่พบรายการชุดข้อสอบในระบบ
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = exams.map((e, idx) => {
        const teacherDisplayName = e.teacher_name ? escapeHtml(e.teacher_name) : '<span class="text-slate-400 italic">ไม่ระบุอาจารย์ (ทั่วไป)</span>';
        const isActive = e.is_active !== false;
        const isShowScore = e.show_score_immediately !== false;

        return `
            <tr class="border-b border-slate-100 hover:bg-purple-50/30 transition">
                <td class="py-3 px-3 text-slate-400 font-mono">${idx + 1}</td>
                <td class="py-3 px-3">
                    <div class="font-bold text-slate-900 text-xs">${escapeHtml(e.title)}</div>
                    ${e.description ? `<div class="text-[11px] text-slate-400 line-clamp-1">${escapeHtml(e.description)}</div>` : ''}
                </td>
                <td class="py-3 px-3">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200/60 rounded-lg text-xs font-bold shadow-2xs">
                        <i class="fas fa-chalkboard-user text-emerald-600"></i> ${teacherDisplayName}
                    </span>
                </td>
                <td class="py-3 px-3">
                    <span class="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-md text-[11px] font-bold">
                        ${escapeHtml(e.target_year || 'ทุกชั้น')} | ${escapeHtml(e.target_department || 'ทุกแผนก')} ${escapeHtml(e.target_room || 'ทุกห้อง')}
                    </span>
                </td>
                <td class="py-3 px-3 text-slate-600 font-medium">
                    <div><i class="far fa-clock text-indigo-500 mr-1"></i>${e.duration_minutes || 60} นาที</div>
                    <div class="text-[11px] text-purple-600"><i class="fas fa-shield-halved mr-1"></i>สลับจอ: ${e.max_tab_switches_allowed || 3} ครั้ง</div>
                </td>
                <td class="py-3 px-3">
                    <div class="flex flex-col gap-1 items-start">
                        <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                            ${isActive ? '🟢 เปิดสอบ' : '⚪ ปิดสอบ'}
                        </span>
                        <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${isShowScore ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}">
                            ${isShowScore ? '👁️ แสดงคะแนน' : '🔒 ซ่อนคะแนน'}
                        </span>
                    </div>
                </td>
                <td class="py-3 px-3 text-right">
                    <button onclick="deleteExamByAdmin('${e.id}', '${escapeHtml(e.title)}', '${escapeHtml(e.teacher_name || 'ไม่ระบุอาจารย์')}')" class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-800 rounded-xl text-xs font-bold transition flex items-center gap-1 ml-auto shadow-2xs" title="ลบชุดข้อสอบนี้">
                        <i class="fas fa-trash-can"></i> ลบข้อสอบ
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

window.deleteExamByAdmin = function(examId, examTitle, teacherName) {
    showCustomConfirm({
        title: 'ยืนยันการลบชุดข้อสอบโดยแอดมิน',
        message: `คุณต้องการลบชุดข้อสอบ "${examTitle}"\nของอาจารย์: "${teacherName}" ใช่หรือไม่?\n\n(คำถามและข้อมูลการสอบทั้งหมดของชุดนี้จะถูกลบออกจากระบบอย่างถาวร)`,
        icon: 'fas fa-trash-can',
        confirmText: 'ลบชุดข้อสอบนี้',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalExam(examId);

            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    const { error } = await state.supabaseClient.from('exams').delete().eq('id', examId);
                    if (error) {
                        console.error('[deleteExamByAdmin] Supabase error:', error);
                        showToast('ลบจากเซิร์ฟเวอร์ไม่สำเร็จ (ติดสิทธิ์ RLS): ' + error.message, 'warning');
                    }
                } catch (e) {
                    console.error('[deleteExamByAdmin] Error:', e);
                }
            }

            showToast(`ลบชุดข้อสอบ "${examTitle}" ของอาจารย์ ${teacherName} เรียบร้อยแล้ว`, 'info');
            await loadAdminExamsList();
            if (typeof loadTeacherExamsList === 'function') loadTeacherExamsList();
            populateTeacherExamSelects();
        }
    });
};

// 8.1 จัดการรายชื่ออาจารย์ผู้สอนในหน้าแอดมิน (Admin Teacher Management)
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

    if (badgeCount) badgeCount.textContent = `${teachers.length} อาจารย์`;

    if (teachers.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-8 text-slate-400">
                    <i class="fas fa-user-xmark text-2xl text-slate-300 mb-2 block"></i>
                    ยังไม่มีรายชื่ออาจารย์ในระบบ คลิกปุ่ม "+ เพิ่มอาจารย์ใหม่" ด้านบนเพื่อเริ่มต้น
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
                    ${escapeHtml((t.name || 'อ').charAt(0))}
                </div>
                <span>${escapeHtml(t.name)}</span>
            </td>
            <td class="py-3 px-3 text-slate-600 font-mono">
                <span class="px-2 py-0.5 bg-slate-100 rounded text-[11px] font-semibold text-slate-700">
                    ${escapeHtml(t.teacher_code || t.code || '-')}
                </span>
            </td>
            <td class="py-3 px-3 text-slate-600">
                ${escapeHtml(t.department || t.dept || 'เทคโนโลยีธุรกิจดิจิทัล')}
            </td>
            <td class="py-3 px-3 font-mono text-slate-600">
                <div class="flex items-center gap-1.5">
                    <span id="teacher-pass-display-${t.id}">••••••••</span>
                    <button type="button" onclick="toggleTeacherPasswordRow('${t.id}', '${escapeHtml(t.password || 'teacher1234')}')" class="text-slate-400 hover:text-indigo-600 text-xs p-1" title="แสดง/ซ่อนรหัสผ่าน">
                        <i id="teacher-pass-icon-${t.id}" class="fas fa-eye text-[11px]"></i>
                    </button>
                </div>
            </td>
            <td class="py-3 px-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                    <button onclick="openTeacherModal('${t.id}')" class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="แก้ไขข้อมูล">
                        <i class="fas fa-pen-to-square"></i>
                    </button>
                    <button onclick="deleteTeacher('${t.id}', '${escapeHtml(t.name)}')" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="ลบอาจารย์">
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

    if (textEl.textContent === '••••••••') {
        textEl.textContent = realPassword;
        if (iconEl) iconEl.className = 'fas fa-eye-slash text-[11px] text-indigo-600';
    } else {
        textEl.textContent = '••••••••';
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
            if (title) title.innerHTML = '<i class="fas fa-user-pen text-indigo-600"></i> แก้ไขข้อมูลอาจารย์';
            if (modeInput) modeInput.value = 'edit';
            if (idInput) idInput.value = teacher.id;
            if (nameInput) nameInput.value = teacher.name || '';
            if (codeInput) codeInput.value = teacher.teacher_code || teacher.code || '';
            if (deptSelect) deptSelect.value = teacher.department || teacher.dept || 'เทคโนโลยีธุรกิจดิจิทัล';
            if (passInput) passInput.value = teacher.password || '';
        }
    } else {
        if (title) title.innerHTML = '<i class="fas fa-user-plus text-indigo-600"></i> เพิ่มข้อมูลอาจารย์ผู้สอน';
        if (modeInput) modeInput.value = 'create';
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (codeInput) codeInput.value = '';
        if (deptSelect) deptSelect.value = 'เทคโนโลยีธุรกิจดิจิทัล';
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
    const dept = document.getElementById('teacher-form-dept')?.value || 'เทคโนโลยีธุรกิจดิจิทัล';
    const password = document.getElementById('teacher-form-password')?.value.trim();

    if (!name || !code || !password) {
        showToast('กรุณากรอกข้อมูลอาจารย์ให้ครบถ้วน', 'warning');
        return;
    }

    const allTeachers = getLocalTeachers();
    if (mode === 'create') {
        const existCode = allTeachers.find(t => (t.teacher_code || t.code) === code);
        if (existCode) {
            showCustomAlert({
                title: 'รหัสอาจารย์ซ้ำ',
                message: `มีรหัสอาจารย์ / Username "${code}" (${existCode.name}) อยู่ในระบบแล้ว`,
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

    showToast(`บันทึกข้อมูล "${name}" เรียบร้อยแล้ว`, 'success');
    closeTeacherModal();
    loadAdminTeachersList();
};

window.deleteTeacher = function(teacherId, teacherName) {
    showCustomConfirm({
        title: 'ยืนยันการลบอาจารย์',
        message: `คุณต้องการลบรายชื่ออาจารย์ "${teacherName}" ใช่หรือไม่?\n(รายวิชาและชุดข้อสอบทั้งหมดที่อาจารย์ท่านนี้สร้างจะถูกลบออกจากระบบด้วย)`,
        icon: 'fas fa-user-xmark',
        confirmText: 'ลบอาจารย์และข้อมูลทั้งหมด',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalTeacher(teacherId, teacherName);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    // 1. ลบชุดข้อสอบทั้งหมดของอาจารย์ท่านนี้จาก Supabase
                    await state.supabaseClient.from('exams').delete().eq('teacher_name', teacherName);
                    // 2. ลบรายวิชาทั้งหมดของอาจารย์ท่านนี้จาก Supabase
                    await state.supabaseClient.from('courses').delete().eq('teacher_name', teacherName);
                    await state.supabaseClient.from('courses').delete().eq('teacher_id', teacherId);
                    // 3. ลบข้อมูลอาจารย์
                    await state.supabaseClient.from('teachers').delete().eq('id', teacherId);
                } catch (e) {
                    console.warn('[deleteTeacher] Remote delete notice:', e);
                }
            }
            showToast(`ลบข้อมูลอาจารย์ "${teacherName}" พร้อมรายวิชาและชุดข้อสอบเรียบร้อยแล้ว`, 'info');
            loadAdminTeachersList();
            if (typeof loadTeacherCourses === 'function') loadTeacherCourses();
            if (typeof loadTeacherExamsList === 'function') loadTeacherExamsList();
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
            showToast('กรุณากรอกทั้ง Supabase URL และ Key', 'warning');
            return;
        }

        const cleanUrl = cleanSupabaseUrl(rawUrl);
        document.getElementById('admin-config-url').value = cleanUrl;

        localStorage.setItem('EXAM_SUPABASE_URL', cleanUrl);
        localStorage.setItem('EXAM_SUPABASE_ANON_KEY', key);

        initSupabase();
        showToast('บันทึกการตั้งค่า Supabase สำเร็จแล้ว!', 'success');
    };
}

window.testSupabaseConnection = async function() {
    const rawUrl = document.getElementById('admin-config-url').value.trim();
    const key = document.getElementById('admin-config-key').value.trim();

    if (!rawUrl || !key) {
        showCustomAlert({
            title: 'กรุณากรอกข้อมูล',
            message: 'กรุณากรอกทั้ง Supabase Project URL และ Anon Key ก่อนกดทดสอบ',
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
                    title: 'เชื่อมต่อ Supabase สำเร็จ!',
                    message: '✅ เชื่อมต่อฐานข้อมูลสำเร็จแล้ว\n⚠️ แต่ยังไม่พบตารางข้อมูล กรุณานำโค้ดในไฟล์ supabase/schema.sql ไปกด Run ใน SQL Editor บนเว็บ Supabase เพื่อสร้างตาราง',
                    icon: 'fas fa-circle-info'
                });
                return;
            }
            throw error;
        }

        showCustomAlert({
            title: 'เชื่อมต่อสำเร็จ!',
            message: '🎉 การเชื่อมต่อกับฐานข้อมูล Supabase สำเร็จสมบูรณ์ 100%\nข้อมูลอาจารย์ ข้อสอบ และผลคะแนนจะถูกซิงก์แบบเรียลไทม์',
            icon: 'fas fa-plug-circle-check'
        });
    } catch (err) {
        showCustomAlert({
            title: 'เชื่อมต่อไม่สำเร็จ',
            message: '❌ ไม่สามารถเชื่อมต่อ Supabase ได้: ' + err.message + '\n\n💡 แนะนำ: ตรวจสอบว่า Project URL อยู่ในรูปแบบ https://xxxx.supabase.co',
            icon: 'fas fa-triangle-exclamation'
        });
    }
};

window.switchAdminToTeacher = function() {
    state.currentUser = {
        role: 'teacher',
        id: '11111111-0000-0000-0000-000000000001',
        name: 'ผู้ดูแลระบบ (สิทธิ์อาจารย์)'
    };
    loadTeacherDashboard();
};

// ==============================================================================
// 9. FORM EVENT LISTENERS (CREATE COURSE, CREATE EXAM, ADD QUESTION)
// ==============================================================================

function setupGlobalFormEvents() {
    // 9.1 ฟอร์มสร้างรายวิชาใหม่
    const formNewCourse = document.getElementById('form-create-course');
    if (formNewCourse) {
        formNewCourse.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('create-course-code').value.trim();
            const name = document.getElementById('create-course-name').value.trim();
            const year = document.getElementById('create-course-year')?.value || 'ทั้งหมด';
            const dept = document.getElementById('create-course-dept')?.value || 'ทั้งหมด';
            const desc = document.getElementById('create-course-desc').value.trim();

            if (!code || !name) {
                showToast('กรุณากรอกรหัสวิชาและชื่อรายวิชา', 'warning');
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
                teacher_name: state.currentUser?.name || 'อาจารย์ผู้สอน',
                created_at: new Date().toISOString()
            };

            // 1. บันทึกลง Local Cache / LocalStorage ทันที
            saveLocalCourse(newCourse);

            // 2. ถ้าต่อ Supabase อยู่ ให้ Sync ขึ้น DB
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient
                        .from('courses')
                        .insert(newCourse);
                } catch (dbErr) {
                    console.warn('[Supabase Sync Warning]', dbErr);
                }
            }

            showToast(`สร้างรายวิชา "${name}" สำเร็จ!`, 'success');
            formNewCourse.reset();
            document.getElementById('modal-create-course').classList.add('hidden');
            loadTeacherCourses();
            populateCourseSelects();
        });
    }

    // 9.2 ฟอร์มสร้างข้อสอบใหม่ (ระบุวิชาและกลุ่มเป้าหมาย)
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
                showToast('กรุณากรอกชื่อชุดข้อสอบ', 'warning');
                return;
            }

            const newExam = {
                id: generatePseudoUUID(),
                course_id: courseId || null,
                teacher_name: state.currentUser?.name || 'อาจารย์ผู้สอน',
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

            // 1. บันทึกลง Local Cache / LocalStorage ทันที
            saveLocalExam(newExam);

            // 2. ถ้าต่อ Supabase อยู่ ให้ Sync ขึ้น DB
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient
                        .from('exams')
                        .insert(newExam);
                } catch (dbErr) {
                    console.warn('[Supabase Sync Warning]', dbErr);
                }
            }

            showToast(`สร้างชุดข้อสอบ "${title}" สำเร็จ!`, 'success');
            formNewExam.reset();
            loadTeacherExamsList();
            await populateTeacherExamSelects();

            const modal = document.getElementById('modal-create-exam');
            if (modal) modal.classList.add('hidden');
        });
    }

    // 9.3 ฟอร์มเพิ่มโจทย์เดี่ยวของอาจารย์
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
                showToast('กรุณาเลือกชุดข้อสอบ', 'warning');
                return;
            }

            if (!qText && !attachedImg) {
                showToast('กรุณาพิมพ์ข้อความคำถาม หรืออัปโหลดรูปภาพโจทย์', 'warning');
                return;
            }

            if (!optA || !optB) {
                showToast('กรุณากรอกตัวเลือกอย่างน้อย A และ B', 'warning');
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

            // 1. บันทึกลง Local Storage ทันที
            saveLocalQuestion(newQ);

            // 2. ถ้าต่อ Supabase ได้ ให้ Sync
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

            showToast('เพิ่มโจทย์และเฉลยลับสำเร็จ!', 'success');
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
        title = 'ยืนยันการทำรายการ',
        message = 'คุณต้องการดำเนินการต่อใช่หรือไม่?',
        icon = 'fas fa-question',
        confirmText = 'ตกลง',
        cancelText = 'ยกเลิก',
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
        title = 'แจ้งเตือน',
        message = '',
        icon = 'fas fa-circle-exclamation',
        buttonText = 'ตกลง',
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
    // ล้างข้อมูลชุดทดสอบตัวอย่าง (Dummy) เก่าออกจาก LocalStorage
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

    // กู้คืน Session ของแท็บปัจจุบัน (เพื่อให้อาจารย์/นักเรียนไม่ต้องล็อกอินซ้ำเมื่อกด Refresh)
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
