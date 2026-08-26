// ==============================================================================
// SUPABASE EDGE FUNCTION: grade-exam
// ==============================================================================
// Runtime: Deno (Supabase Edge Runtime)
// ฟังก์ชันนี้ทำงานบน Serverless Edge เพื่อตรวจข้อสอบอย่างปลอดภัยสูงสุด
// มีการเข้าถึงตาราง exam_answers โดยใช้ Service Role Key ภายใน Server เท่านั้น
// ==============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GradeExamRequest {
  student_id: string;
  exam_id: string;
}

serve(async (req: Request) => {
  // รองรับ CORS Preflight Request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase environment variables on Edge Function runtime.");
    }

    // สร้าง Supabase Admin Client ที่มีสิทธิ์เข้าถึงตาราง exam_answers ภายใน Server
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });

    const body: GradeExamRequest = await req.json();
    const { student_id, exam_id } = body;

    if (!student_id || !exam_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: student_id and exam_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. ดึงข้อมูลข้อสอบและกฎเกณฑ์ Anti-Cheating
    const { data: examData, error: examError } = await supabaseAdmin
      .from("exams")
      .select("id, title, duration_minutes, max_tab_switches_allowed")
      .eq("id", exam_id)
      .single();

    if (examError || !examData) {
      return new Response(
        JSON.stringify({ error: `Exam not found: ${examError?.message || "Invalid ID"}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const maxAllowedTabSwitches = examData.max_tab_switches_allowed ?? 3;

    // 2. ดึงคำถามทั้งหมดพร้อมคะแนนเต็ม
    const { data: questions, error: questionsError } = await supabaseAdmin
      .from("questions")
      .select("id, points")
      .eq("exam_id", exam_id);

    if (questionsError || !questions || questions.length === 0) {
      return new Response(
        JSON.stringify({ error: "No questions found for this exam" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const maxScore = questions.reduce((sum, q) => sum + Number(q.points || 0), 0);

    // 3. ดึงคำตอบที่นักเรียนส่งมา (Student Submissions)
    const { data: submissions, error: subError } = await supabaseAdmin
      .from("student_submissions")
      .select("question_id, selected_option_id, tab_switch_count, fullscreen_exit_count")
      .eq("student_id", student_id)
      .eq("exam_id", exam_id);

    if (subError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch submissions: ${subError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. 🔒 ดึงเฉลยข้อสอบความลับสูงจากตาราง exam_answers บน Server
    const questionIds = questions.map((q) => q.id);
    const { data: answers, error: ansError } = await supabaseAdmin
      .from("exam_answers")
      .select("question_id, correct_option_id, explanation")
      .in("question_id", questionIds);

    if (ansError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch confidential answers: ${ansError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // สร้าง Map เฉลยเพื่อการค้นหาที่รวดเร็ว O(1)
    const answerMap = new Map<string, string>();
    answers.forEach((ans) => {
      answerMap.set(ans.question_id, ans.correct_option_id);
    });

    const questionPointsMap = new Map<string, number>();
    questions.forEach((q) => {
      questionPointsMap.set(q.id, Number(q.points || 0));
    });

    // 5. คำนวณคะแนนและสถิติ Anti-Cheating
    let totalScore = 0;
    let totalTabSwitches = 0;
    let totalFullscreenExits = 0;

    submissions?.forEach((sub) => {
      totalTabSwitches += Number(sub.tab_switch_count || 0);
      totalFullscreenExits += Number(sub.fullscreen_exit_count || 0);

      const correctAnswer = answerMap.get(sub.question_id);
      const points = questionPointsMap.get(sub.question_id) || 0;

      if (correctAnswer && sub.selected_option_id === correctAnswer) {
        totalScore += points;
      }
    });

    const percentage = maxScore > 0 ? Number(((totalScore / maxScore) * 100).toFixed(2)) : 0;

    // 6. ตรวจสอบพฤติกรรมทุจริต (Anti-Cheating Analysis)
    let isFlagged = false;
    const cheatingReasons: string[] = [];

    if (totalTabSwitches > maxAllowedTabSwitches) {
      isFlagged = true;
      cheatingReasons.push(
        `สลับหน้าจอเกินกำหนด: ${totalTabSwitches} ครั้ง (อนุญาตไม่เกิน ${maxAllowedTabSwitches} ครั้ง)`
      );
    }

    if (totalFullscreenExits > 2) {
      isFlagged = true;
      cheatingReasons.push(`ออกจากโหมดเต็มหน้าจอเกินกำหนด: ${totalFullscreenExits} ครั้ง`);
    }

    const status = isFlagged ? "flagged_review" : "graded";

    // 7. บันทึกผลลัพธ์ลงใน exam_results (UPSERT)
    const { data: resultData, error: resultError } = await supabaseAdmin
      .from("exam_results")
      .upsert(
        {
          student_id,
          exam_id,
          total_score: totalScore,
          max_score: maxScore,
          percentage,
          total_tab_switches: totalTabSwitches,
          total_fullscreen_exits: totalFullscreenExits,
          is_flagged_cheating: isFlagged,
          cheating_reasons: cheatingReasons,
          status,
          graded_at: new Date().toISOString(),
        },
        { onConflict: "student_id,exam_id" }
      )
      .select()
      .single();

    if (resultError) {
      return new Response(
        JSON.stringify({ error: `Failed to save exam results: ${resultError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. ส่งผลสรุปกลับไปยัง Client (โดยไม่เปิดเผยเฉลยข้อสอบข้อที่ผิด)
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          result_id: resultData.id,
          student_id,
          exam_id,
          total_score: totalScore,
          max_score: maxScore,
          percentage,
          is_flagged_cheating: isFlagged,
          cheating_reasons: cheatingReasons,
          status,
          graded_at: resultData.graded_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
