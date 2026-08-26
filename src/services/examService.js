/**
 * ==============================================================================
 * ANTI-CHEATING ONLINE EXAM SYSTEM - BACKEND SERVICE LAYER
 * ==============================================================================
 * รวบรวมฟังก์ชันสำหรับทั้งฝั่งนักเรียน (ทำข้อสอบ/ส่งตรวจ) และฝั่งแอดมิน (จัดการข้อสอบ/ตรวจผล)
 */

import { supabase } from '../lib/supabaseClient.js';

// ==============================================================================
// 1. STUDENT API SERVICES (บริการฝั่งนักเรียน)
// ==============================================================================

/**
 * ดึงรายการชุดข้อสอบทั้งหมดที่เปิดใช้งานอยู่
 */
export async function fetchActiveExams() {
    try {
        const { data, error } = await supabase
            .from('exams')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return { data: data || [], error: null };
    } catch (err) {
        console.error('[fetchActiveExams] Error:', err);
        return { data: [], error: err };
    }
}

/**
 * ดึงรายละเอียดข้อมูลชุดข้อสอบ
 */
export async function fetchExamDetails(examId) {
    try {
        const { data, error } = await supabase
            .from('exams')
            .select('id, title, description, duration_minutes, is_active, max_tab_switches_allowed')
            .eq('id', examId)
            .single();

        if (error) throw error;
        return { data, error: null };
    } catch (err) {
        console.error('[fetchExamDetails] Error:', err);
        return { data: null, error: err };
    }
}

/**
 * ดึงรายการคำถามของข้อสอบ (Questions)
 * 🛡️ ปลอดภัย 100%: ไม่มีเฉลยปนอยู่ในตารางนี้
 */
export async function fetchExamQuestions(examId) {
    try {
        const { data, error } = await supabase
            .from('questions')
            .select('id, exam_id, question_text, options, points, order_seq')
            .eq('exam_id', examId)
            .order('order_seq', { ascending: true });

        if (error) throw error;
        return { data: data || [], error: null };
    } catch (err) {
        console.error('[fetchExamQuestions] Error:', err);
        return { data: [], error: err };
    }
}

/**
 * บันทึกคำตอบทีละข้อของนักเรียน พร้อมข้อมูล Anti-Cheating Metadata
 */
export async function submitStudentAnswer({
    studentId,
    studentName = 'นักเรียน',
    examId,
    questionId,
    selectedOptionId,
    tabSwitchCount = 0,
    fullscreenExitCount = 0
}) {
    try {
        const payload = {
            student_id: studentId,
            student_name: studentName,
            exam_id: examId,
            question_id: questionId,
            selected_option_id: selectedOptionId,
            tab_switch_count: tabSwitchCount,
            fullscreen_exit_count: fullscreenExitCount,
            submitted_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('student_submissions')
            .upsert(payload, {
                onConflict: 'student_id,exam_id,question_id'
            })
            .select();

        if (error) throw error;
        return { data: data?.[0] || null, error: null };
    } catch (err) {
        console.error('[submitStudentAnswer] Error:', err);
        return { data: null, error: err };
    }
}

/**
 * บันทึกคำตอบทั้งหมดพร้อมกันแบบ Batch (ตอนกดส่งข้อสอบทั้งหมด)
 */
export async function batchSubmitAnswers({
    studentId,
    studentName = 'นักเรียน',
    examId,
    answers = []
}) {
    try {
        if (!answers || answers.length === 0) {
            return { data: [], error: new Error('No answers provided') };
        }

        const formattedSubmissions = answers.map((ans) => ({
            student_id: studentId,
            student_name: studentName,
            exam_id: examId,
            question_id: ans.questionId,
            selected_option_id: ans.selectedOptionId,
            tab_switch_count: ans.tabSwitchCount || 0,
            fullscreen_exit_count: ans.fullscreenExitCount || 0,
            submitted_at: new Date().toISOString()
        }));

        const { data, error } = await supabase
            .from('student_submissions')
            .upsert(formattedSubmissions, {
                onConflict: 'student_id,exam_id,question_id'
            })
            .select();

        if (error) throw error;
        return { data: data || [], error: null };
    } catch (err) {
        console.error('[batchSubmitAnswers] Error:', err);
        return { data: null, error: err };
    }
}

/**
 * บันทึก Log พฤติกรรมต้องสงสัยแบบ Real-Time (Anti-Cheating Telemetry)
 */
export async function logAntiCheatEvent({
    studentId,
    examId,
    eventType,
    eventPayload = {}
}) {
    try {
        const { error } = await supabase
            .from('anti_cheat_logs')
            .insert({
                student_id: studentId,
                exam_id: examId,
                event_type: eventType,
                event_payload: eventPayload,
                logged_at: new Date().toISOString()
            });

        if (error) throw error;
        return { success: true, error: null };
    } catch (err) {
        console.warn('[logAntiCheatEvent] Warning:', err);
        return { success: false, error: err };
    }
}

/**
 * สั่งตรวจข้อสอบแบบปลอดภัยผ่าน PostgreSQL Secure RPC (`grade_exam_secure`)
 */
export async function gradeExamViaRPC(studentId, examId, studentName = 'นักเรียน') {
    try {
        const { data, error } = await supabase.rpc('grade_exam_secure', {
            p_student_id: studentId,
            p_exam_id: examId,
            p_student_name: studentName
        });

        if (error) throw error;
        return { result: data, error: null };
    } catch (err) {
        console.error('[gradeExamViaRPC] RPC Error:', err);
        return { result: null, error: err };
    }
}

/**
 * ดึงผลคะแนนและสถานะการตรวจของนักเรียน
 */
export async function getStudentExamResult(studentId, examId) {
    try {
        const { data, error } = await supabase
            .from('exam_results')
            .select('*')
            .eq('student_id', studentId)
            .eq('exam_id', examId)
            .single();

        if (error) throw error;
        return { data, error: null };
    } catch (err) {
        console.error('[getStudentExamResult] Error:', err);
        return { data: null, error: err };
    }
}

// ==============================================================================
// 2. ADMIN API SERVICES (บริการฝั่งอาจารย์ / ผู้คุมสอบ)
// ==============================================================================

/**
 * ดึงรายชื่อข้อสอบทั้งหมด (รวมทั้งที่เปิดและปิดอยู่)
 */
export async function fetchAllExamsAdmin() {
    try {
        const { data, error } = await supabase
            .from('exams')
            .select(`
                *,
                questions:questions(count),
                results:exam_results(count)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return { data: data || [], error: null };
    } catch (err) {
        console.error('[fetchAllExamsAdmin] Error:', err);
        return { data: [], error: err };
    }
}

/**
 * สร้างชุดข้อสอบใหม่
 */
export async function createExam({
    title,
    description = '',
    durationMinutes = 60,
    maxTabSwitchesAllowed = 3,
    isActive = true
}) {
    try {
        const { data, error } = await supabase
            .from('exams')
            .insert({
                title,
                description,
                duration_minutes: Number(durationMinutes),
                max_tab_switches_allowed: Number(maxTabSwitchesAllowed),
                is_active: isActive
            })
            .select()
            .single();

        if (error) throw error;
        return { data, error: null };
    } catch (err) {
        console.error('[createExam] Error:', err);
        return { data: null, error: err };
    }
}

/**
 * เพิ่มคำถามพร้อมเฉลยลับในชุดข้อสอบ (ผ่าน Admin RPC create_question_with_answer)
 */
export async function addQuestionWithAnswer({
    examId,
    questionText,
    options,
    points = 1.0,
    correctOptionId,
    explanation = '',
    orderSeq = 0
}) {
    try {
        const { data, error } = await supabase.rpc('create_question_with_answer', {
            p_exam_id: examId,
            p_question_text: questionText,
            p_options: options,
            p_points: Number(points),
            p_correct_option_id: correctOptionId,
            p_explanation: explanation,
            p_order_seq: Number(orderSeq)
        });

        if (error) throw error;
        return { data, error: null };
    } catch (err) {
        console.error('[addQuestionWithAnswer] Error:', err);
        return { data: null, error: err };
    }
}

/**
 * ดึงรายการผู้เข้าสอบทั้งหมดและผลคะแนนในชุดข้อสอบนั้น (Admin Inspection)
 */
export async function fetchAdminSubmissions(examId) {
    try {
        let query = supabase
            .from('exam_results')
            .select(`
                *,
                exam:exams(title, duration_minutes, max_tab_switches_allowed)
            `)
            .order('graded_at', { ascending: false });

        if (examId && examId !== 'all') {
            query = query.eq('exam_id', examId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return { data: data || [], error: null };
    } catch (err) {
        console.error('[fetchAdminSubmissions] Error:', err);
        return { data: [], error: err };
    }
}

/**
 * ดึงรายงานการทำข้อสอบแบบละเอียดของนักเรียนรายบุคคล (ดูคำตอบเทียบเฉลย)
 */
export async function fetchAdminStudentDetail(studentId, examId) {
    try {
        const { data, error } = await supabase.rpc('get_admin_student_detail', {
            p_student_id: studentId,
            p_exam_id: examId
        });

        if (error) throw error;
        return { data, error: null };
    } catch (err) {
        console.error('[fetchAdminStudentDetail] Error:', err);
        return { data: null, error: err };
    }
}

/**
 * ปรับปรุงสถานะผลสอบของนักเรียน (เช่น ตัดสิทธิ์สอบ หรือ อนุมัติหลังตรวจสอบ)
 */
export async function updateSubmissionStatus(resultId, newStatus) {
    try {
        const { data, error } = await supabase
            .from('exam_results')
            .update({ status: newStatus })
            .eq('id', resultId)
            .select()
            .single();

        if (error) throw error;
        return { data, error: null };
    } catch (err) {
        console.error('[updateSubmissionStatus] Error:', err);
        return { data: null, error: err };
    }
}
