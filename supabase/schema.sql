-- ==============================================================================
-- ANTI-CHEATING ONLINE EXAM SYSTEM - SUPABASE DATABASE SCHEMA & RLS
-- ==============================================================================
-- รองรับระบบรายวิชาของครู, การกำหนดกลุ่มเป้าหมาย (ระดับชั้น/แผนก/ห้องเรียน),
-- ป้องกันการโกง, แยกตารางเฉลยความลับสูง และ SheetJS Excel Import/Export
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABLES DEFINITIONS
-- ==============================================================================

-- 2.0 ตารางข้อมูลอาจารย์ผู้สอน (Teachers)
CREATE TABLE IF NOT EXISTS public.teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    department VARCHAR(100) DEFAULT 'เทคโนโลยีธุรกิจดิจิทัล',
    password VARCHAR(255) NOT NULL DEFAULT 'teacher1234',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2.1 ตารางรายวิชาของครูผู้สอน (Courses)
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_code VARCHAR(50) NOT NULL,
    course_name VARCHAR(255) NOT NULL,
    description TEXT,
    target_year VARCHAR(100) DEFAULT 'ทั้งหมด',
    target_department VARCHAR(100) DEFAULT 'ทั้งหมด',
    teacher_id UUID NOT NULL,
    teacher_name VARCHAR(255) NOT NULL DEFAULT 'อาจารย์ผู้สอน',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE IF EXISTS public.courses 
ADD COLUMN IF NOT EXISTS target_year VARCHAR(100) DEFAULT 'ทั้งหมด',
ADD COLUMN IF NOT EXISTS target_department VARCHAR(100) DEFAULT 'ทั้งหมด';

-- 2.2 ตารางชุดข้อสอบ (Exams)
CREATE TABLE IF NOT EXISTS public.exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
    teacher_name VARCHAR(255) DEFAULT 'อาจารย์ผู้สอน',
    title VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    is_active BOOLEAN NOT NULL DEFAULT true,
    max_tab_switches_allowed INTEGER DEFAULT 3,
    target_year VARCHAR(100) DEFAULT 'ทั้งหมด',
    target_department VARCHAR(100) DEFAULT 'ทั้งหมด',
    target_room VARCHAR(100) DEFAULT 'ทั้งหมด',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Auto-migration: เพิ่มคอลัมน์ในตาราง exams กรณีตารางมีอยู่แล้ว
ALTER TABLE IF EXISTS public.exams 
ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS teacher_name VARCHAR(255) DEFAULT 'อาจารย์ผู้สอน',
ADD COLUMN IF NOT EXISTS target_year VARCHAR(100) DEFAULT 'ทั้งหมด',
ADD COLUMN IF NOT EXISTS target_department VARCHAR(100) DEFAULT 'ทั้งหมด',
ADD COLUMN IF NOT EXISTS target_room VARCHAR(100) DEFAULT 'ทั้งหมด';

-- 2.3 ตารางคำถาม (Questions) - ปลอดภัยเมื่อ Client ดึงข้อมูล (ไม่มีเฉลย)
CREATE TABLE IF NOT EXISTS public.questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    options JSONB NOT NULL,
    points NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    order_seq INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2.4 ตารางเฉลยข้อสอบความลับสูง (Exam Answers) - ห้าม Client เข้าถึงโดยตรง
CREATE TABLE IF NOT EXISTS public.exam_answers (
    question_id UUID PRIMARY KEY REFERENCES public.questions(id) ON DELETE CASCADE,
    correct_option_id VARCHAR(50) NOT NULL,
    explanation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2.5 ตารางการส่งคำตอบของนักเรียน (Student Submissions) + Anti-Cheating Metadata
CREATE TABLE IF NOT EXISTS public.student_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL,
    student_name VARCHAR(255) DEFAULT 'นักเรียน',
    student_year VARCHAR(100) DEFAULT 'ไม่ระบุ',
    student_department VARCHAR(100) DEFAULT 'ไม่ระบุ',
    student_room VARCHAR(100) DEFAULT 'ไม่ระบุ',
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    selected_option_id VARCHAR(50) NOT NULL,
    tab_switch_count INTEGER NOT NULL DEFAULT 0,
    fullscreen_exit_count INTEGER NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_student_question_submission UNIQUE (student_id, exam_id, question_id)
);

ALTER TABLE IF EXISTS public.student_submissions 
ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) DEFAULT 'นักเรียน',
ADD COLUMN IF NOT EXISTS student_year VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_department VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_room VARCHAR(100) DEFAULT 'ไม่ระบุ';

-- 2.6 ตารางผลคะแนนและรายงานความซื่อสัตย์ในการสอบ (Exam Results & Cheating Audit)
CREATE TABLE IF NOT EXISTS public.exam_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL,
    student_name VARCHAR(255) DEFAULT 'นักเรียน',
    student_year VARCHAR(100) DEFAULT 'ไม่ระบุ',
    student_department VARCHAR(100) DEFAULT 'ไม่ระบุ',
    student_room VARCHAR(100) DEFAULT 'ไม่ระบุ',
    course_name VARCHAR(255) DEFAULT '-',
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    total_score NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    max_score NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    total_tab_switches INTEGER NOT NULL DEFAULT 0,
    total_fullscreen_exits INTEGER NOT NULL DEFAULT 0,
    is_flagged_cheating BOOLEAN NOT NULL DEFAULT false,
    cheating_reasons TEXT[] DEFAULT ARRAY[]::TEXT[],
    status VARCHAR(50) NOT NULL DEFAULT 'graded',
    graded_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT unique_student_exam_result UNIQUE (student_id, exam_id)
);

ALTER TABLE IF EXISTS public.exam_results 
ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) DEFAULT 'นักเรียน',
ADD COLUMN IF NOT EXISTS student_year VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_department VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_room VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS course_name VARCHAR(255) DEFAULT '-';

-- 2.7 ตารางบันทึก Log เหตุการณ์ต้องสงสัยแบบ Real-Time (Anti-Cheat Logs)
CREATE TABLE IF NOT EXISTS public.anti_cheat_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL,
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_payload JSONB DEFAULT '{}'::JSONB,
    logged_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ==============================================================================
-- 3. INDEXES FOR HIGH PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_courses_teacher ON public.courses(teacher_id);
CREATE INDEX IF NOT EXISTS idx_exams_course ON public.exams(course_id);
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON public.questions(exam_id, order_seq);
CREATE INDEX IF NOT EXISTS idx_submissions_lookup ON public.student_submissions(student_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_results_lookup ON public.exam_results(student_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_anticheat_lookup ON public.anti_cheat_logs(student_id, exam_id, event_type);

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anti_cheat_logs ENABLE ROW LEVEL SECURITY;

-- 4.0 ตาราง teachers
DROP POLICY IF EXISTS "Public teachers are viewable by everyone" ON public.teachers;
CREATE POLICY "Public teachers are viewable by everyone" ON public.teachers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert teachers" ON public.teachers;
CREATE POLICY "Allow insert teachers" ON public.teachers FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update teachers" ON public.teachers;
CREATE POLICY "Allow update teachers" ON public.teachers FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow delete teachers" ON public.teachers;
CREATE POLICY "Allow delete teachers" ON public.teachers FOR DELETE USING (true);

-- 4.1 ตาราง courses
DROP POLICY IF EXISTS "Public courses are viewable by everyone" ON public.courses;
CREATE POLICY "Public courses are viewable by everyone" ON public.courses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert courses" ON public.courses;
CREATE POLICY "Allow insert courses" ON public.courses FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update courses" ON public.courses;
CREATE POLICY "Allow update courses" ON public.courses FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow delete courses" ON public.courses;
CREATE POLICY "Allow delete courses" ON public.courses FOR DELETE USING (true);

-- 4.2 ตาราง exams
DROP POLICY IF EXISTS "Public exams are viewable by everyone" ON public.exams;
CREATE POLICY "Public exams are viewable by everyone" ON public.exams FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert exams" ON public.exams;
CREATE POLICY "Allow insert exams" ON public.exams FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update exams" ON public.exams;
CREATE POLICY "Allow update exams" ON public.exams FOR UPDATE USING (true);

-- 4.3 ตาราง questions
DROP POLICY IF EXISTS "Questions are viewable by test takers" ON public.questions;
CREATE POLICY "Questions are viewable by test takers" ON public.questions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert questions" ON public.questions;
CREATE POLICY "Allow insert questions" ON public.questions FOR INSERT WITH CHECK (true);

-- 4.4 ตาราง exam_answers: 🚨 ความลับสูงสุด
DROP POLICY IF EXISTS "Block all public access to exam answers" ON public.exam_answers;

-- 4.5 ตาราง student_submissions
DROP POLICY IF EXISTS "Students can insert own submissions" ON public.student_submissions;
CREATE POLICY "Students can insert own submissions" ON public.student_submissions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Students can view own submissions" ON public.student_submissions;
CREATE POLICY "Students can view own submissions" ON public.student_submissions FOR SELECT USING (true);

-- 4.6 ตาราง exam_results
DROP POLICY IF EXISTS "Students can view own exam results" ON public.exam_results;
CREATE POLICY "Students can view own exam results" ON public.exam_results FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow update exam results" ON public.exam_results;
CREATE POLICY "Allow update exam results" ON public.exam_results FOR UPDATE USING (true);

-- 4.7 ตาราง anti_cheat_logs
DROP POLICY IF EXISTS "Students can insert anti cheat logs" ON public.anti_cheat_logs;
CREATE POLICY "Students can insert anti cheat logs" ON public.anti_cheat_logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Students can view anti cheat logs" ON public.anti_cheat_logs;
CREATE POLICY "Students can view anti cheat logs" ON public.anti_cheat_logs FOR SELECT USING (true);

-- ==============================================================================
-- 5. SECURE SERVER-SIDE STORED PROCEDURES (SECURITY DEFINER)
-- ==============================================================================

-- 5.1 ฟังก์ชันตรวจข้อสอบอัตโนมัติ (Grading Engine)
DROP FUNCTION IF EXISTS public.grade_exam_secure(UUID, UUID);
DROP FUNCTION IF EXISTS public.grade_exam_secure(UUID, UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.grade_exam_secure(UUID, UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR);

CREATE OR REPLACE FUNCTION public.grade_exam_secure(
    p_student_id UUID,
    p_exam_id UUID,
    p_student_name VARCHAR DEFAULT 'นักเรียน',
    p_student_year VARCHAR DEFAULT 'ไม่ระบุ',
    p_student_department VARCHAR DEFAULT 'ไม่ระบุ',
    p_student_room VARCHAR DEFAULT 'ไม่ระบุ'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total_score NUMERIC(6, 2) := 0.00;
    v_max_score NUMERIC(6, 2) := 0.00;
    v_percentage NUMERIC(5, 2) := 0.00;
    v_total_tab_switches INTEGER := 0;
    v_total_fullscreen_exits INTEGER := 0;
    v_max_allowed_tab_switches INTEGER := 3;
    v_is_flagged BOOLEAN := false;
    v_reasons TEXT[] := ARRAY[]::TEXT[];
    v_result_status VARCHAR(50) := 'graded';
    v_result_id UUID;
    v_course_name VARCHAR(255) := '-';
    v_response JSONB;
BEGIN
    -- 1. ดึงข้อมูลข้อสอบและชื่อรายวิชา
    SELECT 
        COALESCE(e.max_tab_switches_allowed, 3),
        COALESCE(c.course_name, '-')
    INTO 
        v_max_allowed_tab_switches,
        v_course_name
    FROM public.exams e
    LEFT JOIN public.courses c ON e.course_id = c.id
    WHERE e.id = p_exam_id;

    -- 2. คำนวณคะแนนเต็ม
    SELECT COALESCE(SUM(points), 0.00)
    INTO v_max_score
    FROM public.questions
    WHERE exam_id = p_exam_id;

    -- 3. คำนวณคะแนนที่ได้
    SELECT 
        COALESCE(SUM(
            CASE 
                WHEN s.selected_option_id = a.correct_option_id THEN q.points
                ELSE 0.00
            END
        ), 0.00),
        COALESCE(SUM(s.tab_switch_count), 0),
        COALESCE(SUM(s.fullscreen_exit_count), 0)
    INTO 
        v_total_score,
        v_total_tab_switches,
        v_total_fullscreen_exits
    FROM public.student_submissions s
    JOIN public.questions q ON s.question_id = q.id
    JOIN public.exam_answers a ON q.id = a.question_id
    WHERE s.student_id = p_student_id
      AND s.exam_id = p_exam_id;

    -- 4. คำนวณร้อยละ
    IF v_max_score > 0 THEN
        v_percentage := ROUND((v_total_score / v_max_score) * 100, 2);
    ELSE
        v_percentage := 0.00;
    END IF;

    -- 5. ตรวจสอบพฤติกรรมสงสัย
    IF v_total_tab_switches > v_max_allowed_tab_switches THEN
        v_is_flagged := true;
        v_reasons := array_append(v_reasons, format('สลับหน้าจอเกินกำหนด: %s ครั้ง (กำหนดไว้ไม่เกิน %s ครั้ง)', v_total_tab_switches, v_max_allowed_tab_switches));
    END IF;

    IF v_total_fullscreen_exits > 2 THEN
        v_is_flagged := true;
        v_reasons := array_append(v_reasons, format('ออกจากโหมดเต็มหน้าจอ: %s ครั้ง', v_total_fullscreen_exits));
    END IF;

    IF v_is_flagged THEN
        v_result_status := 'flagged_review';
    END IF;

    -- 6. บันทึกผลลงในตาราง exam_results (UPSERT)
    INSERT INTO public.exam_results (
        student_id,
        student_name,
        student_year,
        student_department,
        student_room,
        course_name,
        exam_id,
        total_score,
        max_score,
        percentage,
        total_tab_switches,
        total_fullscreen_exits,
        is_flagged_cheating,
        cheating_reasons,
        status,
        graded_at
    )
    VALUES (
        p_student_id,
        p_student_name,
        p_student_year,
        p_student_department,
        p_student_room,
        v_course_name,
        p_exam_id,
        v_total_score,
        v_max_score,
        v_percentage,
        v_total_tab_switches,
        v_total_fullscreen_exits,
        v_is_flagged,
        v_reasons,
        v_result_status,
        timezone('utc'::text, now())
    )
    ON CONFLICT (student_id, exam_id) 
    DO UPDATE SET
        student_name = EXCLUDED.student_name,
        student_year = EXCLUDED.student_year,
        student_department = EXCLUDED.student_department,
        student_room = EXCLUDED.student_room,
        course_name = EXCLUDED.course_name,
        total_score = EXCLUDED.total_score,
        max_score = EXCLUDED.max_score,
        percentage = EXCLUDED.percentage,
        total_tab_switches = EXCLUDED.total_tab_switches,
        total_fullscreen_exits = EXCLUDED.total_fullscreen_exits,
        is_flagged_cheating = EXCLUDED.is_flagged_cheating,
        cheating_reasons = EXCLUDED.cheating_reasons,
        status = EXCLUDED.status,
        graded_at = EXCLUDED.graded_at
    RETURNING id INTO v_result_id;

    -- 7. คืนค่า JSON สรุปผล
    v_response := jsonb_build_object(
        'success', true,
        'result_id', v_result_id,
        'student_id', p_student_id,
        'student_name', p_student_name,
        'student_year', p_student_year,
        'student_department', p_student_department,
        'student_room', p_student_room,
        'course_name', v_course_name,
        'exam_id', p_exam_id,
        'total_score', v_total_score,
        'max_score', v_max_score,
        'percentage', v_percentage,
        'total_tab_switches', v_total_tab_switches,
        'total_fullscreen_exits', v_total_fullscreen_exits,
        'is_flagged_cheating', v_is_flagged,
        'cheating_reasons', v_reasons,
        'status', v_result_status
    );

    RETURN v_response;
END;
$$;

-- 5.2 ฟังก์ชันเพิ่มโจทย์คำถามพร้อมเฉลยลับ
CREATE OR REPLACE FUNCTION public.create_question_with_answer(
    p_exam_id UUID,
    p_question_text TEXT,
    p_options JSONB,
    p_points NUMERIC(5,2),
    p_correct_option_id VARCHAR(50),
    p_explanation TEXT DEFAULT '',
    p_order_seq INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_question_id UUID;
    v_calculated_order INTEGER := p_order_seq;
BEGIN
    IF v_calculated_order = 0 THEN
        SELECT COALESCE(MAX(order_seq), 0) + 1
        INTO v_calculated_order
        FROM public.questions
        WHERE exam_id = p_exam_id;
    END IF;

    INSERT INTO public.questions (
        exam_id,
        question_text,
        options,
        points,
        order_seq
    )
    VALUES (
        p_exam_id,
        p_question_text,
        p_options,
        p_points,
        v_calculated_order
    )
    RETURNING id INTO v_question_id;

    INSERT INTO public.exam_answers (
        question_id,
        correct_option_id,
        explanation
    )
    VALUES (
        v_question_id,
        p_correct_option_id,
        p_explanation
    );

    RETURN jsonb_build_object(
        'success', true,
        'question_id', v_question_id,
        'exam_id', p_exam_id,
        'order_seq', v_calculated_order
    );
END;
$$;

-- 5.3 ฟังก์ชันดึงรายละเอียดการทำข้อสอบของนักเรียนทีละข้อพร้อมเฉลย
CREATE OR REPLACE FUNCTION public.get_admin_student_detail(
    p_student_id UUID,
    p_exam_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
    v_items JSONB;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'question_id', q.id,
            'order_seq', q.order_seq,
            'question_text', q.question_text,
            'options', q.options,
            'points', q.points,
            'student_selected', s.selected_option_id,
            'correct_answer', a.correct_option_id,
            'explanation', a.explanation,
            'is_correct', (s.selected_option_id = a.correct_option_id),
            'tab_switches', s.tab_switch_count,
            'fullscreen_exits', s.fullscreen_exit_count
        ) ORDER BY q.order_seq ASC
    )
    INTO v_items
    FROM public.questions q
    LEFT JOIN public.student_submissions s ON q.id = s.question_id AND s.student_id = p_student_id AND s.exam_id = p_exam_id
    LEFT JOIN public.exam_answers a ON q.id = a.question_id
    WHERE q.exam_id = p_exam_id;

    SELECT to_jsonb(r)
    INTO v_result
    FROM public.exam_results r
    WHERE r.student_id = p_student_id AND r.exam_id = p_exam_id;

    RETURN jsonb_build_object(
        'success', true,
        'summary', v_result,
        'questions_breakdown', COALESCE(v_items, '[]'::JSONB)
    );
END;
$$;

-- ==============================================================================
-- 6. SAMPLE SEED DATA
-- ==============================================================================
DO $$
BEGIN
    -- รายวิชาทดสอบ
    INSERT INTO public.courses (id, course_code, course_name, description, teacher_id, teacher_name)
    VALUES 
        ('33333333-3333-3333-3333-333333333331', 'ว20201', 'เทคโนโลยีสารสนเทศและวิทยาการคำนวณ', 'การเขียนโปรแกรมและการใช้งานระบบคลาวด์', '11111111-0000-0000-0000-000000000001', 'อาจารย์ผู้สอน')
    ON CONFLICT (id) DO NOTHING;

    -- ชุดข้อสอบทดสอบ
    INSERT INTO public.exams (id, course_id, teacher_name, title, description, duration_minutes, is_active, max_tab_switches_allowed, target_year, target_department, target_room)
    VALUES (
        '11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333331',
        'อาจารย์ผู้สอน',
        'ข้อสอบวัดความรู้พื้นฐานวิทยาศาสตร์และคอมพิวเตอร์ (Anti-Cheating Pro)',
        'การสอบวัดผลแบบมีระบบป้องกันการทุจริต (Anti-Cheating Monitoring & Zero Leak)',
        15,
        true,
        3,
        'ทั้งหมด',
        'ทั้งหมด',
        'ทั้งหมด'
    )
    ON CONFLICT (id) DO NOTHING;

    -- คำถามข้อที่ 1
    INSERT INTO public.questions (id, exam_id, question_text, options, points, order_seq)
    VALUES (
        '22222222-2222-2222-2222-222222222221',
        '11111111-1111-1111-1111-111111111111',
        'ข้อใดคือโปรโตคอลความปลอดภัยสำหรับการส่งข้อมูลผ่านเว็บที่มีการเข้ารหัส?',
        '[
            {"id": "A", "text": "HTTP"},
            {"id": "B", "text": "FTP"},
            {"id": "C", "text": "HTTPS"},
            {"id": "D", "text": "SMTP"}
        ]'::JSONB,
        2.00,
        1
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.exam_answers (question_id, correct_option_id, explanation)
    VALUES (
        '22222222-2222-2222-2222-222222222221',
        'C',
        'HTTPS มีการเข้ารหัสข้อมูลผ่าน TLS/SSL'
    )
    ON CONFLICT (question_id) DO NOTHING;

    -- คำถามข้อที่ 2
    INSERT INTO public.questions (id, exam_id, question_text, options, points, order_seq)
    VALUES (
        '22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'ฟังก์ชันหลักของ Row Level Security (RLS) ใน Supabase/PostgreSQL คืออะไร?',
        '[
            {"id": "A", "text": "ควบคุมการเข้าถึงข้อมูลระดับแถวตามสิทธิ์ของผู้ใช้งาน"},
            {"id": "B", "text": "บีบอัดขนาดไฟล์ฐานข้อมูลให้เล็กลง"},
            {"id": "C", "text": "แปลงโค้ด SQL เป็น JavaScript อัตโนมัติ"},
            {"id": "D", "text": "เร่งความเร็วการประมวลผล GPU"}
        ]'::JSONB,
        3.00,
        2
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.exam_answers (question_id, correct_option_id, explanation)
    VALUES (
        '22222222-2222-2222-2222-222222222222',
        'A',
        'RLS ช่วยจำกัดสิทธิ์การ Query ข้อมูลในระดับ Row'
    )
    ON CONFLICT (question_id) DO NOTHING;
END;
$$;

-- 4.6.1 ปลดล็อกสิทธิ์ DELETE สำหรับ exam_results และ student_submissions
DROP POLICY IF EXISTS "Allow delete exam results" ON public.exam_results;
CREATE POLICY "Allow delete exam results" ON public.exam_results FOR DELETE USING (true);

DROP POLICY IF EXISTS "Allow delete student submissions" ON public.student_submissions;
CREATE POLICY "Allow delete student submissions" ON public.student_submissions FOR DELETE USING (true);

-- 5.3 ฟังก์ชันปลดล็อกให้นักเรียนเข้าทำข้อสอบใหม่ (Security Definer Reset Engine)
CREATE OR REPLACE FUNCTION public.reset_student_exam_attempt(
    p_student_id TEXT,
    p_exam_id UUID,
    p_student_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.exam_results 
    WHERE exam_id = p_exam_id 
      AND (student_id::TEXT = p_student_id OR student_name = p_student_name);

    DELETE FROM public.student_submissions 
    WHERE exam_id = p_exam_id 
      AND (student_id::TEXT = p_student_id);

    DELETE FROM public.anti_cheat_logs 
    WHERE exam_id = p_exam_id 
      AND (student_id::TEXT = p_student_id);

    RETURN jsonb_build_object('success', true, 'message', 'Reset successful');
END;
$$;

