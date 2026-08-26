-- ==============================================================================
-- FIX & MIGRATION: ลบฟังก์ชันซ้ำซ้อนและอัปเดตตารางให้สมบูรณ์ 100%
-- คัดลอกโค้ดนี้ไปวางและกด RUN ใน Supabase Dashboard > SQL Editor
-- ==============================================================================

-- 1. เพิ่มคอลัมน์ student_name ลงในตารางเดิม (หากยังไม่มี)
ALTER TABLE IF EXISTS public.student_submissions 
ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) DEFAULT 'นักเรียน';

ALTER TABLE IF EXISTS public.exam_results 
ADD COLUMN IF NOT EXISTS student_name VARCHAR(255) DEFAULT 'นักเรียน';

-- 2. ลบฟังก์ชันเวอร์ชันเก่าทั้งหมดเพื่อป้องกัน Function Overloading ชนกัน
DROP FUNCTION IF EXISTS public.grade_exam_secure(UUID, UUID);
DROP FUNCTION IF EXISTS public.grade_exam_secure(UUID, UUID, VARCHAR);

-- 3. สร้าง Stored Procedure grade_exam_secure เวอร์ชั่นใหม่ตัวเดียว
CREATE OR REPLACE FUNCTION public.grade_exam_secure(
    p_student_id UUID,
    p_exam_id UUID,
    p_student_name VARCHAR DEFAULT 'นักเรียน'
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
    v_response JSONB;
BEGIN
    -- 1. ตรวจสอบข้อมูลข้อสอบและขีดจำกัดการสลับหน้าจอ
    SELECT COALESCE(max_tab_switches_allowed, 3)
    INTO v_max_allowed_tab_switches
    FROM public.exams
    WHERE id = p_exam_id;

    -- 2. คำนวณคะแนนเต็มของข้อสอบทั้งหมด (Max Possible Score)
    SELECT COALESCE(SUM(points), 0.00)
    INTO v_max_score
    FROM public.questions
    WHERE exam_id = p_exam_id;

    -- 3. คำนวณคะแนนที่นักเรียนได้โดยเทียบกับตาราง exam_answers ที่เป็นความลับ
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

    -- 4. คำนวณเปอร์เซ็นต์
    IF v_max_score > 0 THEN
        v_percentage := ROUND((v_total_score / v_max_score) * 100, 2);
    ELSE
        v_percentage := 0.00;
    END IF;

    -- 5. Anti-Cheating Audit: ตรวจสอบพฤติกรรมสงสัย
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

    -- 7. สร้าง JSON Response สรุปผล
    v_response := jsonb_build_object(
        'success', true,
        'result_id', v_result_id,
        'student_id', p_student_id,
        'student_name', p_student_name,
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
