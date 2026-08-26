-- ==============================================================================
-- MIGRATION: ระบบรายวิชาของครู และกำหนดกลุ่มเป้าหมาย (ระดับชั้น / แผนก / ห้องเรียน)
-- คัดลอกโค้ดนี้ไปวางและกด RUN ใน Supabase Dashboard > SQL Editor
-- ==============================================================================

-- 1. สร้างตารางรายวิชา (Courses) พร้อมกำหนดระดับชั้นและแผนกประจำวิชา
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

-- 2. เพิ่มคอลัมน์กลุ่มเป้าหมายและรายวิชาในตารางชุดข้อสอบ (Exams)
ALTER TABLE IF EXISTS public.exams 
ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS teacher_name VARCHAR(255) DEFAULT 'อาจารย์ผู้สอน',
ADD COLUMN IF NOT EXISTS target_year VARCHAR(100) DEFAULT 'ทั้งหมด',
ADD COLUMN IF NOT EXISTS target_department VARCHAR(100) DEFAULT 'ทั้งหมด',
ADD COLUMN IF NOT EXISTS target_room VARCHAR(100) DEFAULT 'ทั้งหมด';

-- 3. เพิ่มคอลัมน์ข้อมูลนักเรียนในตารางการส่งคำตอบและผลคะแนน
ALTER TABLE IF EXISTS public.student_submissions 
ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) DEFAULT 'นักเรียน',
ADD COLUMN IF NOT EXISTS student_year VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_department VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_room VARCHAR(100) DEFAULT 'ไม่ระบุ';

ALTER TABLE IF EXISTS public.exam_results 
ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) DEFAULT 'นักเรียน',
ADD COLUMN IF NOT EXISTS student_year VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_department VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS student_room VARCHAR(100) DEFAULT 'ไม่ระบุ',
ADD COLUMN IF NOT EXISTS course_name VARCHAR(255) DEFAULT '-';

-- 4. เปิดใช้งาน RLS และนโยบายความปลอดภัยสำหรับตาราง courses
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public courses are viewable by everyone" ON public.courses;
CREATE POLICY "Public courses are viewable by everyone"
ON public.courses FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow insert courses" ON public.courses;
CREATE POLICY "Allow insert courses"
ON public.courses FOR INSERT
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update courses" ON public.courses;
CREATE POLICY "Allow update courses"
ON public.courses FOR UPDATE
USING (true);

DROP POLICY IF EXISTS "Allow delete courses" ON public.courses;
CREATE POLICY "Allow delete courses"
ON public.courses FOR DELETE
USING (true);

-- เปิดใช้งาน Realtime สำหรับบันทึกการทุจริตและรายวิชา
DO $$ 
BEGIN 
    ALTER PUBLICATION supabase_realtime ADD TABLE public.anti_cheat_logs;
EXCEPTION WHEN OTHERS THEN 
    NULL;
END $$;

-- 5. ล้างฟังก์ชันเดิมและสร้าง Stored Procedure grade_exam_secure ที่รองรับข้อมูลชั้น/แผนก/ห้อง
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

    -- 3. คำนวณคะแนนที่นักเรียนได้
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

    -- 5. ตรวจสอบพฤติกรรมสลับหน้าจอ / Anti-Cheat
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

-- 6. ข้อมูลตัวอย่างรายวิชาเริ่มต้น (Sample Courses)
INSERT INTO public.courses (id, course_code, course_name, description, teacher_id, teacher_name)
VALUES 
    ('33333333-3333-3333-3333-333333333331', 'ว20201', 'เทคโนโลยีสารสนเทศและวิทยาการคำนวณ', 'การเขียนโปรแกรมและการใช้งานระบบคลาวด์', '11111111-0000-0000-0000-000000000001', 'อาจารย์ผู้สอน'),
    ('33333333-3333-3333-3333-333333333332', 'ค31101', 'คณิตศาสตร์พื้นฐาน', 'ความรู้พื้นฐานเซต ตรรกศาสตร์ และฟังก์ชัน', '11111111-0000-0000-0000-000000000001', 'อาจารย์ผู้สอน')
ON CONFLICT (id) DO NOTHING;

-- ผูกข้อสอบเริ่มต้นเข้ากับรายวิชาแรก
UPDATE public.exams 
SET course_id = '33333333-3333-3333-3333-333333333331',
    teacher_name = 'อาจารย์ผู้สอน',
    target_year = 'ทั้งหมด',
    target_department = 'ทั้งหมด',
    target_room = 'ทั้งหมด'
WHERE id = '11111111-1111-1111-1111-111111111111';
