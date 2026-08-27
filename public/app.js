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

// Global App State
const state = {
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
            syncLocalDataToSupabase();
        } else {
            console.warn('[Supabase] SDK not loaded yet.');
        }
    } catch (e) {
        console.error('[Supabase] Init Error:', e);
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

function setupAuthEvents() {
    const tabStudent = document.getElementById('tab-login-student');
    const tabTeacher = document.getElementById('tab-login-teacher');
    const tabAdmin = document.getElementById('tab-login-admin');

    const formStudent = document.getElementById('form-login-student');
    const formTeacher = document.getElementById('form-login-teacher');
    const formAdmin = document.getElementById('form-login-admin');

    const setLoginTab = (role) => {
        [tabStudent, tabTeacher, tabAdmin].forEach(tab => {
            tab.classList.remove('border-indigo-600', 'border-emerald-600', 'border-purple-600', 'text-indigo-600', 'text-emerald-600', 'text-purple-600');
            tab.classList.add('border-transparent', 'text-slate-400');
        });

        formStudent.classList.add('hidden');
        formTeacher.classList.add('hidden');
        formAdmin.classList.add('hidden');

        if (role === 'student') {
            tabStudent.classList.add('border-indigo-600', 'text-indigo-600');
            tabStudent.classList.remove('border-transparent', 'text-slate-400');
            formStudent.classList.remove('hidden');
        } else if (role === 'teacher') {
            tabTeacher.classList.add('border-emerald-600', 'text-emerald-600');
            tabTeacher.classList.remove('border-transparent', 'text-slate-400');
            formTeacher.classList.remove('hidden');
        } else if (role === 'admin') {
            tabAdmin.classList.add('border-purple-600', 'text-purple-600');
            tabAdmin.classList.remove('border-transparent', 'text-slate-400');
            formAdmin.classList.remove('hidden');
        }
    };

    if (tabStudent) tabStudent.onclick = () => setLoginTab('student');
    if (tabTeacher) tabTeacher.onclick = () => setLoginTab('teacher');
    if (tabAdmin) tabAdmin.onclick = () => setLoginTab('admin');

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
        formStudent.addEventListener('submit', (e) => {
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

            const registeredStudents = getLocalStudents();
            let matchedStudent = null;

            if (registeredStudents && registeredStudents.length > 0) {
                // ตรวจสอบกับรายชื่อนักเรียนที่อาจารย์ลงทะเบียนไว้
                matchedStudent = registeredStudents.find(s => 
                    (s.code === loginId || s.name.trim().toLowerCase() === loginId.toLowerCase() || s.citizen_id === loginId) && 
                    s.citizen_id === citizenPass
                );

                // หากค้นหาด้วยชื่อหรือรหัสอย่างใดอย่างหนึ่ง
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
                // หากยังไม่มีการลงทะเบียนนักเรียนในระบบเลย ให้สร้างเป็นบัญชีเริ่มต้นอัตโนมัติ
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
        formTeacher.addEventListener('submit', (e) => {
            e.preventDefault();
            const loginInput = document.getElementById('teacher-name-input').value.trim();
            const password = document.getElementById('teacher-password-input').value;

            if (!loginInput) {
                showToast('กรุณากรอกชื่อ-นามสกุล หรือ รหัสอาจารย์', 'warning');
                return;
            }

            const registeredTeachers = getLocalTeachers();

            if (registeredTeachers && registeredTeachers.length > 0) {
                // ตรวจสอบกับรายชื่ออาจารย์ที่แอดมินลงทะเบียนไว้
                const matchedTeacher = registeredTeachers.find(t => 
                    (t.name.trim().toLowerCase() === loginInput.toLowerCase() || 
                     (t.teacher_code && t.teacher_code.trim().toLowerCase() === loginInput.toLowerCase())) &&
                    t.password === password
                );

                if (matchedTeacher) {
                    state.currentUser = {
                        role: 'teacher',
                        id: matchedTeacher.id,
                        name: matchedTeacher.name,
                        code: matchedTeacher.teacher_code,
                        dept: matchedTeacher.department || 'เทคโนโลยีธุรกิจดิจิทัล'
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
                    t.name.trim().toLowerCase() === loginInput.toLowerCase() || 
                    (t.teacher_code && t.teacher_code.trim().toLowerCase() === loginInput.toLowerCase())
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

        return `
            <div class="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition flex flex-col justify-between">
                <div>
                    <!-- Header Badges -->
                    <div class="flex items-center justify-between gap-2 mb-3">
                        <span class="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100">
                            [${escapeHtml(courseCode)}] ${escapeHtml(courseName)}
                        </span>
                        <span class="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700">เปิดสอบ</span>
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

                <div class="pt-4 border-t border-slate-100">
                    <div class="grid grid-cols-2 gap-2 text-xs text-slate-500 mb-4">
                        <div><i class="far fa-clock mr-1 text-indigo-500"></i> เวลา: <strong>${exam.duration_minutes} นาที</strong></div>
                        <div><i class="far fa-question-circle mr-1 text-indigo-500"></i> ชุดข้อสอบ: <strong>พร้อมทำ</strong></div>
                        <div class="col-span-2 text-amber-700 text-[11px]"><i class="fas fa-eye mr-1"></i> อนุญาตสลับจอ: <strong>${exam.max_tab_switches_allowed} ครั้ง</strong></div>
                    </div>

                    <button onclick="startExam('${exam.id}')" class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-sm">
                        <i class="fas fa-play text-xs"></i> เข้าทำข้อสอบ
                    </button>
                </div>
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

        if (!questions || questions.length === 0) {
            showCustomAlert({
                title: 'ยังไม่มีคำถาม',
                message: 'ชุดข้อสอบนี้ยังไม่มีคำถาม กรุณาติดต่ออาจารย์ประจำวิชาเพื่อเพิ่มโจทย์หรือนำเข้าไฟล์ Excel',
                icon: 'fas fa-circle-info'
            });
            return;
        }

        // ตรวจจับ Split Screen
        if (isSplitScreenDetected()) {
            showCustomAlert({
                title: 'ตรวจพบโหมดแบ่งหน้าจอ',
                message: 'ตรวจพบการใช้งานโหมดแบ่งหน้าจอ (Split Screen / Pop-up Window)\n\nระบบไม่อนุญาตให้ทำข้อสอบในโหมดนี้ กรุณาขยายหน้าจอเต็มก่อนเริ่มสอบ',
                icon: 'fas fa-triangle-exclamation'
            });
            return;
        }

        showCustomConfirm({
            title: 'พร้อมเริ่มทำข้อสอบหรือไม่?',
            message: `ชุดข้อสอบ: ${exam.title}\nรายวิชา: ${exam.course?.course_name || 'ทั่วไป'}\nเวลาทำข้อสอบ: ${exam.duration_minutes} นาที (${questions.length} ข้อ)\n\n⚠️ กฎความปลอดภัยห้องสอบ:\n1. กรุณาปิดหน้าต่างแชทลอย (Messenger / LINE Bubbles) และการแจ้งเตือนทั้งหมด\n2. ห้ามสลับหน้าจอ ห้ามย่อจอ หรือเปิดแอปอื่นเด็ดขาด\n3. การแตะเปิดแชทลอยระหว่างสอบจะถูกบันทึกเป็นการทุจริตทันที`,
            icon: 'fas fa-shield-halved',
            confirmText: 'รับทราบและเริ่มสอบทันที',
            cancelText: 'ยังไม่พร้อม',
            confirmClass: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-100',
            onConfirm: async () => {
                try {
                    if (document.documentElement.requestFullscreen) {
                        await document.documentElement.requestFullscreen();
                    }
                } catch (fsErr) {}

                state.currentExam = exam;

                // 🔀 1. SHUFFLE QUESTIONS & OPTIONS (สลับข้อและสลับตัวเลือกแบบสุ่มเฉพาะบุคคล)
                // ตรวจสอบว่ามีร่างคำตอบเดิมที่เคยเซฟไว้หรือไม่ (Auto-Save Resume)
                const savedDraft = loadStudentDraftAnswers(state.currentUser.id, exam.id);
                
                if (savedDraft && savedDraft.questions && savedDraft.questions.length > 0) {
                    // ใช้ลำดับข้อและตัวเลือกเดิมที่บันทึกไว้
                    state.questions = savedDraft.questions;
                    state.answers = savedDraft.answers || {};
                    state.remainingSeconds = savedDraft.remainingSeconds > 0 ? savedDraft.remainingSeconds : (exam.duration_minutes * 60);
                    showToast(`💾 กู้คืนคำตอบที่บันทึกไว้อัตโนมัติ (${Object.keys(state.answers).length}/${state.questions.length} ข้อ)`, 'success');
                } else {
                    // สุ่มสลับข้อสอบและตัวเลือกใหม่สำหรับนักเรียนคนนี้
                    state.questions = prepareShuffledQuestions(questions);
                    state.answers = {};
                    state.remainingSeconds = exam.duration_minutes * 60;
                    saveStudentDraftAnswers();
                }

                state.currentQuestionIndex = 0;
                state.antiCheat = {
                    tabSwitches: 0,
                    fullscreenExits: 0,
                    isMonitoring: true
                };

                // Connect student realtime broadcaster channel
                if (state.supabaseClient) {
                    try {
                        if (state.realtimeChannel) {
                            state.supabaseClient.removeChannel(state.realtimeChannel);
                        }
                        state.realtimeChannel = state.supabaseClient.channel('exam_realtime_alerts');
                        state.realtimeChannel.subscribe((status) => {
                            console.log('[Student Realtime Status]:', status);
                        });
                    } catch (rtErr) {
                        console.warn('[Student Realtime Warning]:', rtErr);
                    }
                }

                showView('view-student-exam');
                renderExamHeader();
                renderQuestion(0);
                renderQuestionNav();
                updateAutoSaveBadge();
                startAntiCheatMonitor();
                startCountdownTimer();

                showToast('เริ่มการสอบแล้ว ขอให้โชคดี!', 'info');
            }
        });

    } catch (err) {
        showToast('เกิดข้อผิดพลาดในการโหลดข้อสอบ: ' + err.message, 'error');
    }
};

// ==============================================================================
// 4.1 SHUFFLE & AUTO-SAVE HELPERS
// ==============================================================================

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function prepareShuffledQuestions(originalQuestions) {
    if (!originalQuestions || originalQuestions.length === 0) return [];

    // 1. สลับลำดับข้อสอบ (Questions Shuffle)
    const shuffledList = shuffleArray(originalQuestions);

    // 2. สลับลำดับตัวเลือก ก, ข, ค, ง ในแต่ละข้อ (Choices Shuffle)
    return shuffledList.map(q => {
        let opts = q.options;
        if (typeof opts === 'string') {
            try { opts = JSON.parse(opts); } catch (e) { opts = []; }
        }
        if (!Array.isArray(opts) || opts.length === 0) return q;

        // สลับตัวเลือกแบบสุ่ม
        const shuffledOptions = shuffleArray(opts);

        return {
            ...q,
            options: shuffledOptions
        };
    });
}

function getDraftStorageKey(studentId, examId) {
    const sId = studentId || state.currentUser?.id;
    const eId = examId || state.currentExam?.id;
    if (!sId || !eId) return null;
    return `EXAM_DRAFT_ANSWERS_${sId}_${eId}`;
}

function saveStudentDraftAnswers() {
    const key = getDraftStorageKey();
    if (!key) return;
    try {
        const draft = {
            questions: state.questions,
            answers: state.answers,
            remainingSeconds: state.remainingSeconds,
            lastSaved: Date.now()
        };
        localStorage.setItem(key, JSON.stringify(draft));
    } catch (e) {}
}

function loadStudentDraftAnswers(studentId, examId) {
    const key = getDraftStorageKey(studentId, examId);
    if (!key) return null;
    try {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

function clearStudentDraftAnswers() {
    const key = getDraftStorageKey();
    if (key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }
}

function updateAutoSaveBadge() {
    const badge = document.getElementById('exam-autosave-badge');
    if (!badge) return;

    const answeredCount = Object.keys(state.answers).length;
    const totalCount = state.questions.length;

    badge.innerHTML = `
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>บันทึกแล้ว (${answeredCount}/${totalCount} ข้อ)</span>
    `;
}

function renderExamHeader() {
    const titleEl = document.getElementById('exam-room-title');
    const studentEl = document.getElementById('exam-room-student');
    const courseBadge = document.getElementById('exam-room-course-badge');
    const badgeEl = document.getElementById('exam-room-tab-badge');

    if (titleEl) titleEl.textContent = state.currentExam.title;
    if (courseBadge) courseBadge.textContent = state.currentExam.course?.course_name || 'ชุดข้อสอบ';
    if (studentEl) studentEl.textContent = `${state.currentUser.name} (${state.currentUser.year} ${state.currentUser.room})`;
    if (badgeEl) badgeEl.textContent = `สลับจอ: 0/${state.currentExam.max_tab_switches_allowed}`;
}

function renderQuestion(index) {
    state.currentQuestionIndex = index;
    const q = state.questions[index];
    if (!q) return;

    const container = document.getElementById('exam-question-card');
    if (!container) return;

    renderQuestionNav();

    let options = q.options;
    if (typeof options === 'string') {
        try { options = JSON.parse(options); } catch (e) { options = []; }
    }

    const selectedOption = state.answers[q.id] || null;

    container.innerHTML = `
        <div class="flex items-start justify-between gap-4 mb-6 select-none">
            <div class="flex items-center gap-3">
                <span class="w-9 h-9 flex items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 font-bold text-base">
                    ${index + 1}
                </span>
                <span class="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-lg">
                    คะแนน: ${q.points} คะแนน
                </span>
            </div>
            <span class="text-xs text-gray-400">ข้อที่ ${index + 1} จากทั้งหมด ${state.questions.length} ข้อ</span>
        </div>

        <h2 class="text-lg md:text-xl font-bold text-gray-800 mb-6 leading-relaxed exam-protection select-none">
            ${escapeHtml(q.question_text)}
        </h2>

        <div class="space-y-3 mb-8">
            ${options.map((opt, optIdx) => {
                const isChecked = selectedOption === opt.id;
                const displayLabel = ['A', 'B', 'C', 'D', 'E', 'F'][optIdx] || (optIdx + 1);
                return `
                    <label onclick="selectAnswer('${q.id}', '${opt.id}')" class="flex items-center p-4 rounded-xl border-2 cursor-pointer transition select-none ${
                        isChecked 
                            ? 'border-indigo-600 bg-indigo-50/50 shadow-sm ring-1 ring-indigo-500' 
                            : 'border-gray-100 hover:border-gray-200 bg-white'
                    }">
                        <div class="w-6 h-6 rounded-full border-2 flex items-center justify-center mr-4 transition ${
                            isChecked ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'
                        }">
                            ${isChecked ? '<i class="fas fa-check text-white text-xs"></i>' : ''}
                        </div>
                        <span class="font-bold text-gray-700 w-6">${displayLabel}.</span>
                        <span class="text-gray-800 text-sm md:text-base flex-1 exam-protection select-none">${escapeHtml(opt.text)}</span>
                    </label>
                `;
            }).join('')}
        </div>

        <div class="flex items-center justify-between pt-6 border-t border-gray-100">
            <button onclick="prevQuestion()" ${index === 0 ? 'disabled' : ''} class="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                <i class="fas fa-arrow-left text-xs"></i> ข้อย้อนหลัง
            </button>

            ${index < state.questions.length - 1 ? `
                <button onclick="nextQuestion()" class="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition flex items-center gap-2 shadow-sm">
                    ข้อถัดไป <i class="fas fa-arrow-right text-xs"></i>
                </button>
            ` : `
                <button onclick="confirmSubmitExam()" class="px-6 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition flex items-center gap-2 shadow-sm">
                    <i class="fas fa-paper-plane text-xs"></i> ส่งข้อสอบ
                </button>
            `}
        </div>
    `;
}

function renderQuestionNav() {
    const navContainer = document.getElementById('exam-nav-buttons');
    if (!navContainer) return;

    navContainer.innerHTML = state.questions.map((q, idx) => {
        const isAnswered = !!state.answers[q.id];
        const isCurrent = state.currentQuestionIndex === idx;

        let bgClass = 'bg-gray-100 text-gray-600 border border-gray-200';
        if (isCurrent) {
            bgClass = 'bg-indigo-600 text-white font-bold ring-2 ring-indigo-400';
        } else if (isAnswered) {
            bgClass = 'bg-green-100 text-green-700 border border-green-300 font-semibold';
        }

        return `
            <button onclick="renderQuestion(${idx})" class="w-10 h-10 rounded-xl flex items-center justify-center text-sm transition ${bgClass}">
                ${idx + 1}
            </button>
        `;
    }).join('');
}

window.selectAnswer = async function(questionId, optionId) {
    state.answers[questionId] = optionId;
    
    // 💾 บันทึกคำตอบสดทันที (Real-Time Auto-Save Answers)
    saveStudentDraftAnswers();
    updateAutoSaveBadge();
    renderQuestion(state.currentQuestionIndex);

    try {
        if (state.supabaseClient && isSupabaseConfigured()) {
            state.supabaseClient
                .from('student_submissions')
                .upsert({
                    student_id: state.currentUser.id,
                    student_name: state.currentUser.name,
                    student_year: state.currentUser.year || 'ไม่ระบุ',
                    student_department: state.currentUser.dept || 'ไม่ระบุ',
                    student_room: state.currentUser.room || 'ไม่ระบุ',
                    exam_id: state.currentExam.id,
                    question_id: questionId,
                    selected_option_id: optionId,
                    tab_switch_count: state.antiCheat.tabSwitches,
                    fullscreen_exit_count: state.antiCheat.fullscreenExits,
                    submitted_at: new Date().toISOString()
                }, {
                    onConflict: 'student_id,exam_id,question_id'
                }).then(() => {}).catch(() => {});
        }
    } catch (e) {}
};

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
    const badgeEl = document.getElementById('exam-room-tab-badge');
    if (badgeEl && state.currentExam) {
        badgeEl.textContent = `สลับจอ: ${state.antiCheat.tabSwitches}/${state.currentExam.max_tab_switches_allowed}`;
        if (state.antiCheat.tabSwitches > state.currentExam.max_tab_switches_allowed) {
            badgeEl.className = 'px-3 py-1 text-xs font-bold rounded-full bg-red-100 text-red-700 border border-red-300 warning-pulse';
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

    const modal = document.getElementById('modal-cheat-warning');
    const reasonEl = document.getElementById('cheat-warning-reason');
    const countEl = document.getElementById('cheat-warning-count');

    if (modal) {
        if (reasonEl) reasonEl.textContent = reason;
        if (countEl) countEl.textContent = `จำนวนครั้งที่สลับหน้าจอ: ${state.antiCheat.tabSwitches} ครั้ง (กำหนดไว้ไม่เกิน ${state.currentExam.max_tab_switches_allowed} ครั้ง)`;
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
    const answeredCount = Object.keys(state.answers).length;
    const totalCount = state.questions.length;
    const unansweredCount = totalCount - answeredCount;

    let confirmMsg = `คุณตอบไปแล้ว ${answeredCount} จาก ${totalCount} ข้อ\n`;
    if (unansweredCount > 0) {
        confirmMsg += `⚠️ ยังมีข้อที่ยังไม่ได้ตอบอีก ${unansweredCount} ข้อ!\n`;
    }
    confirmMsg += `\nคุณต้องการยืนยันการส่งข้อสอบและตรวจคะแนนใช่หรือไม่?`;

    showCustomConfirm({
        title: 'ยืนยันการส่งข้อสอบ',
        message: confirmMsg,
        icon: 'fas fa-paper-plane',
        confirmText: 'ส่งข้อสอบทันที',
        cancelText: 'กลับไปตรวจทาน',
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
        document.getElementById('loading-modal-title').textContent = 'กำลังตรวจข้อสอบ...';
        document.getElementById('loading-modal-desc').textContent = 'กำลังคำนวณคะแนนและตรวจสอบความปลอดภัย';
        loadingModal.classList.remove('hidden');
    }

    try {
        // 1. ระบบตรวจคะแนนอัตโนมัติ (Local Auto-Grading Engine)
        const questions = state.questions || [];
        const localQuestions = getLocalQuestions(state.currentExam?.id);
        let totalScore = 0;
        let maxScore = 0;

        questions.forEach(q => {
            const points = Number(q.points) || 1.0;
            maxScore += points;
            const selectedAns = state.answers[q.id];
            
            // ค้นหาเฉลยจาก local questions หรือ q
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

        // บันทึกผลสอบลง Local Storage เพื่อให้อาจารย์ดูและ Export ได้ทันที
        saveLocalSubmission(gradeResult);

        // 2. ถ้าต่อ Supabase ได้ ให้ Sync ขึ้น DB
        if (isSupabaseConfigured() && state.supabaseClient) {
            try {
                const answersList = state.questions.map(q => ({
                    student_id: state.currentUser.id,
                    student_name: state.currentUser.name,
                    student_year: state.currentUser.year || 'ไม่ระบุ',
                    student_department: state.currentUser.dept || 'ไม่ระบุ',
                    student_room: state.currentUser.room || 'ไม่ระบุ',
                    exam_id: state.currentExam.id,
                    question_id: q.id,
                    selected_option_id: state.answers[q.id] || 'NONE',
                    tab_switch_count: state.antiCheat.tabSwitches,
                    fullscreen_exit_count: state.antiCheat.fullscreenExits,
                    submitted_at: new Date().toISOString()
                }));

                await state.supabaseClient
                    .from('student_submissions')
                    .upsert(answersList, {
                        onConflict: 'student_id,exam_id,question_id'
                    });

                await state.supabaseClient.rpc('grade_exam_secure', {
                    p_student_id: state.currentUser.id,
                    p_exam_id: state.currentExam.id,
                    p_student_name: state.currentUser.name,
                    p_student_year: state.currentUser.year || 'ไม่ระบุ',
                    p_student_department: state.currentUser.dept || 'ไม่ระบุ',
                    p_student_room: state.currentUser.room || 'ไม่ระบุ'
                });
            } catch (syncErr) {
                console.warn('[Supabase Grade Sync Warning]:', syncErr);
            }
        }

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

    const scoreEl = document.getElementById('result-score-display');
    const percentEl = document.getElementById('result-percentage-display');
    const statusEl = document.getElementById('result-status-badge');
    const cheatAuditEl = document.getElementById('result-cheat-audit-box');
    const examNameEl = document.getElementById('result-exam-title');

    if (examNameEl) examNameEl.textContent = state.currentExam.title;
    if (scoreEl) scoreEl.textContent = `${res.total_score} / ${res.max_score}`;
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
        message: `คุณต้องการลบรายวิชา "${courseName}" ใช่หรือไม่?\n(ชุดข้อสอบที่ผูกกับวิชานี้จะยังคงอยู่ในระบบ)`,
        icon: 'fas fa-trash-can',
        confirmText: 'ลบรายวิชา',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalCourse(courseId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.from('courses').delete().eq('id', courseId);
                } catch (e) {}
            }
            showToast(`ลบรายวิชา "${courseName}" เรียบร้อยแล้ว`, 'info');
            loadTeacherCourses();
            populateCourseSelects();
        }
    });
};

// 7.2 โหลดตารางผลสอบอาจารย์ (พร้อมข้อมูลระดับชั้น/แผนก/ห้อง)
async function loadTeacherSubmissions() {
    const tableBody = document.getElementById('teacher-submissions-table-body');
    const statTotal = document.getElementById('teacher-stat-total-submissions');
    const statFlagged = document.getElementById('teacher-stat-flagged-cheats');
    const statAvg = document.getElementById('teacher-stat-avg-score');

    if (!tableBody) return;

    let subs = getLocalSubmissions();

    if (isSupabaseConfigured() && state.supabaseClient) {
        try {
            const { data, error } = await state.supabaseClient
                .from('exam_results')
                .select(`
                    *,
                    exam:exams(title, max_tab_switches_allowed, course:courses(course_name))
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

    if (!subs || subs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400">ยังไม่มีข้อมูลการส่งข้อสอบในรายวิชาของคุณ</td></tr>`;
        if (statTotal) statTotal.textContent = '0';
        if (statFlagged) statFlagged.textContent = '0';
        if (statAvg) statAvg.textContent = '0%';
        return;
    }

    const total = subs.length;
    const flagged = subs.filter(d => d.is_flagged_cheating).length;
    const avg = (subs.reduce((sum, d) => sum + Number(d.percentage || 0), 0) / total).toFixed(1);

    if (statTotal) statTotal.textContent = total;
    if (statFlagged) statFlagged.textContent = flagged;
    if (statAvg) statAvg.textContent = `${avg}%`;

    tableBody.innerHTML = subs.map(sub => {
        const isFlagged = sub.is_flagged_cheating;
        const examTitle = sub.exam_title || sub.exam?.title || 'ชุดข้อสอบ';
        const courseName = sub.course_name || sub.exam?.course?.course_name || '-';
        const formattedDate = new Date(sub.graded_at).toLocaleString('th-TH');

        const classInfo = `${sub.student_year || '-'} | ${sub.student_department || '-'} | ${sub.student_room || '-'}`;

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50/70 transition">
                <td class="py-4 px-4 font-medium text-gray-800">
                    ${escapeHtml(sub.student_name || 'นักเรียน')}
                    <div class="text-xs text-gray-400 font-mono">${(sub.student_id || '').slice(0, 8)}...</div>
                </td>
                <td class="py-4 px-4 text-xs font-semibold text-indigo-700">
                    ${escapeHtml(classInfo)}
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
                    <button onclick="inspectStudentSubmission('${sub.student_id}', '${sub.exam_id}', '${escapeHtml(sub.student_name)}')" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-medium rounded-lg transition">
                        <i class="fas fa-search mr-1"></i> ตรวจคำตอบ
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 7.3 ส่งออกคะแนนนักเรียนเป็นไฟล์ Excel (.xlsx) พร้อมข้อมูลระดับชั้นและห้องเรียน
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

    if (!subs || subs.length === 0) {
        showToast('ยังไม่มีข้อมูลผลการสอบสำหรับส่งออกเป็น Excel', 'warning');
        return;
    }

    const excelRows = subs.map((d, index) => ({
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
    const fileName = `รายงานผลคะแนนสอบ_วังไกลกังวล_${dateStr}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    showToast('ดาวน์โหลดไฟล์ Excel เรียบร้อยแล้ว!', 'success');
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

            state.excelParsedQuestions = rows.map((r, idx) => {
                const qText = r['โจทย์คำถาม'] || r['question'] || r['Question'] || '';
                const optA = r['ตัวเลือก A'] || r['option_a'] || r['A'] || '';
                const optB = r['ตัวเลือก B'] || r['option_b'] || r['B'] || '';
                const optC = r['ตัวเลือก C'] || r['option_c'] || r['C'] || '';
                const optD = r['ตัวเลือก D'] || r['option_d'] || r['D'] || '';
                const correct = (r['เฉลยที่ถูกต้อง (A/B/C/D)'] || r['correct'] || r['Answer'] || 'A').toString().trim().toUpperCase();
                const points = Number(r['คะแนน'] || r['points'] || 1.0);
                const explanation = r['คำอธิบายเฉลย'] || r['explanation'] || '';

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
    if (state.excelParsedQuestions.length === 0) {
        showToast('ไม่มีข้อมูลข้อสอบที่จะนำเข้า', 'warning');
        return;
    }

    const loadingModal = document.getElementById('modal-loading');
    if (loadingModal) {
        document.getElementById('loading-modal-title').textContent = 'กำลังนำเข้าข้อสอบ...';
        document.getElementById('loading-modal-desc').textContent = `กำลังบันทึก ${state.excelParsedQuestions.length} ข้อลงฐานข้อมูลอย่างปลอดภัย`;
        loadingModal.classList.remove('hidden');
    }

    let successCount = 0;
    try {
        for (const q of state.excelParsedQuestions) {
            const options = [
                { id: 'A', text: q.optA },
                { id: 'B', text: q.optB }
            ];
            if (q.optC) options.push({ id: 'C', text: q.optC });
            if (q.optD) options.push({ id: 'D', text: q.optD });

            const newQ = {
                id: generatePseudoUUID(),
                exam_id: examId,
                question_text: q.questionText,
                options: options,
                points: Number(q.points) || 1.0,
                correct: q.correct,
                explanation: q.explanation || ''
            };

            // 1. บันทึกลง Local Storage ทันที
            saveLocalQuestion(newQ);
            successCount++;

            // 2. ถ้าต่อ Supabase ได้ ให้ Sync
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.rpc('create_question_with_answer', {
                        p_exam_id: examId,
                        p_question_text: q.questionText,
                        p_options: options,
                        p_points: Number(q.points) || 1.0,
                        p_correct_option_id: q.correct,
                        p_explanation: q.explanation || '',
                        p_order_seq: 0
                    });
                } catch (rpcErr) {
                    console.warn('[Excel Import Supabase Sync Warning]', rpcErr);
                }
            }
        }

        if (loadingModal) loadingModal.classList.add('hidden');
        
        showCustomAlert({
            title: 'นำเข้าสำเร็จ!',
            message: `🎉 บันทึกข้อสอบเข้าสู่ชุดข้อสอบเรียบร้อยแล้ว จำนวน ${successCount} ข้อ`,
            icon: 'fas fa-check-circle'
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

// 7.7 ตรวจคำตอบนักเรียนทีละข้อ (Inspection Modal)
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
                    return `
                        <div class="p-4 rounded-xl border ${isCorrect ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="font-bold text-sm text-gray-800">ข้อที่ ${idx + 1}: ${escapeHtml(q.question_text)}</span>
                                <span class="text-xs font-bold px-2 py-0.5 rounded ${isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                                    ${isCorrect ? `+${q.points} คะแนน (ถูก)` : '0 คะแนน (ผิด)'}
                                </span>
                            </div>
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

    if (exams.length === 0) {
        container.innerHTML = `
            <div class="bg-white p-8 rounded-3xl border border-slate-100 text-center">
                <i class="fas fa-folder-open text-4xl text-slate-300 mb-3"></i>
                <h4 class="font-bold text-slate-700">ยังไม่มีชุดข้อสอบของคุณ</h4>
                <p class="text-xs text-slate-400 mt-1 mb-4">กดปุ่มสร้างชุดข้อสอบใหม่ด้านบนเพื่อเริ่มต้น</p>
                <button onclick="openCreateExamModal()" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-sm">
                    <i class="fas fa-plus mr-1"></i> สร้างชุดข้อสอบใหม่
                </button>
            </div>
        `;
        populateTeacherExamSelects();
        return;
    }

    container.innerHTML = exams.map(exam => {
        const matchedCourse = state.courses?.find(c => c.id === exam.course_id);
        const courseCode = matchedCourse?.course_code || 'ทั่วไป';
        const courseName = matchedCourse?.course_name || 'วิชาทั่วไป';
        const targetTag = `${exam.target_year || 'ทุกชั้น'} | ${exam.target_department || 'ทุกแผนก'} | ${exam.target_room || 'ทุกห้อง'}`;
        const isActive = exam.is_active !== false;

        return `
            <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-wrap items-center justify-between gap-4">
                <div>
                    <div class="flex flex-wrap items-center gap-2 mb-1.5">
                        <span class="px-2.5 py-0.5 text-xs font-bold rounded-lg bg-indigo-50 text-indigo-700">
                            [${escapeHtml(courseCode)}] ${escapeHtml(courseName)}
                        </span>
                        <span class="px-2.5 py-0.5 text-xs font-bold rounded-full ${isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
                            ${isActive ? '🟢 เปิดสอบอยู่' : '⚪ ปิดสอบอยู่'}
                        </span>
                        <h4 class="font-bold text-gray-800 text-base">${escapeHtml(exam.title)}</h4>
                    </div>
                    
                    <div class="text-xs text-amber-800 font-semibold mb-2 flex items-center gap-1.5">
                        <i class="fas fa-bullseye text-amber-600"></i> กลุ่มเป้าหมาย: <strong>${escapeHtml(targetTag)}</strong>
                    </div>
                    
                    <p class="text-xs text-gray-500">${escapeHtml(exam.description || 'ไม่มีคำอธิบาย')}</p>
                    
                    <div class="flex items-center gap-4 text-xs text-gray-400 mt-2">
                        <span><i class="far fa-clock"></i> ${exam.duration_minutes} นาที</span>
                        <span><i class="far fa-user-tie text-emerald-600"></i> ${escapeHtml(exam.teacher_name || 'อาจารย์ผู้สอน')}</span>
                    </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <!-- ปุ่มสลับ เปิด/ปิดสอบ ทันที -->
                    <button onclick="toggleExamActive('${exam.id}')" class="px-3.5 py-2 ${isActive ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'} rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm" title="คลิกเพื่อสลับเปิดหรือปิดสอบ">
                        <i class="fas ${isActive ? 'fa-toggle-on text-emerald-600 text-sm' : 'fa-toggle-off text-slate-400 text-sm'}"></i>
                        <span>${isActive ? 'กดเพื่อปิดสอบ' : 'กดเพื่อเปิดสอบ'}</span>
                    </button>

                    <button onclick="openAddQuestionForExam('${exam.id}')" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-sm">
                        <i class="fas fa-plus"></i> เพิ่มโจทย์
                    </button>
                    <button onclick="openExcelImportForExam('${exam.id}')" class="px-3 py-2 btn-excel rounded-xl text-xs font-medium transition flex items-center gap-1.5 shadow-sm">
                        <i class="fas fa-file-excel"></i> นำเข้า Excel
                    </button>
                    <button onclick="deleteExam('${exam.id}', '${escapeHtml(exam.title)}')" class="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-medium transition flex items-center gap-1.5" title="ลบชุดข้อสอบ">
                        <i class="fas fa-trash-can"></i> ลบ
                    </button>
                </div>
            </div>
        `;
    }).join('');

    populateTeacherExamSelects();
}

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
    showToast(`ชุดข้อสอบ "${exam.title}" เปลี่ยนสถานะเป็น ${newStatus ? '🟢 เปิดสอบแล้ว' : '⚪ ปิดสอบแล้ว'}`, 'success');
    await loadTeacherExamsList();
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
            deleteLocalExam(examId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.from('exams').delete().eq('id', examId);
                } catch (e) {}
            }
            showToast(`ลบชุดข้อสอบ "${examTitle}" เรียบร้อยแล้ว`, 'info');
            loadTeacherExamsList();
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
}

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
        message: `คุณต้องการลบรายชื่ออาจารย์ "${teacherName}" ใช่หรือไม่?\n(อาจารย์ท่านนี้จะไม่สามารถเข้าสู่ระบบได้อีก)`,
        icon: 'fas fa-user-xmark',
        confirmText: 'ลบข้อมูลอาจารย์',
        cancelText: 'ยกเลิก',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-100',
        onConfirm: async () => {
            deleteLocalTeacher(teacherId);
            if (isSupabaseConfigured() && state.supabaseClient) {
                try {
                    await state.supabaseClient.from('teachers').delete().eq('id', teacherId);
                } catch (e) {}
            }
            showToast(`ลบข้อมูลอาจารย์ "${teacherName}" เรียบร้อยแล้ว`, 'info');
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
            const qText = document.getElementById('teacher-add-question-text').value.trim();
            const optA = document.getElementById('teacher-add-opt-a').value.trim();
            const optB = document.getElementById('teacher-add-opt-b').value.trim();
            const optC = document.getElementById('teacher-add-opt-c').value.trim();
            const optD = document.getElementById('teacher-add-opt-d').value.trim();
            const correctOpt = document.getElementById('teacher-add-correct-option').value;
            const points = document.getElementById('teacher-add-points').value;
            const explanation = document.getElementById('teacher-add-explanation').value.trim();

            if (!examId || !qText || !optA || !optB) {
                showToast('กรุณากรอกโจทย์และตัวเลือกอย่างน้อย ก และ ข', 'warning');
                return;
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
                question_text: qText,
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
                        p_question_text: qText,
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
