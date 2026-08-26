/**
 * ==============================================================================
 * ANTI-CHEATING ONLINE EXAM SYSTEM - BACKEND USAGE DEMO
 * ==============================================================================
 * ตัวอย่างการเรียกใช้งานฟังก์ชัน Backend ทั้งหมด (Logic-Only)
 * สามารถนำโค้ดในตัวอย่างนี้ไปผูกกับปุ่มหรือ Event ใน UI ของคุณได้ทันที
 */

import {
    fetchExamDetails,
    fetchExamQuestions,
    submitStudentAnswer,
    batchSubmitAnswers,
    gradeExamViaRPC,
    gradeExamViaEdgeFunction,
    getStudentExamResult
} from '../src/services/examService.js';

async function runExamFlowDemo() {
    const TEST_STUDENT_ID = '99999999-9999-9999-9999-999999999999';
    const TEST_EXAM_ID = '11111111-1111-1111-1111-111111111111';

    console.log('--- 1. ดึงข้อมูลข้อสอบ ---');
    const { data: exam, error: examErr } = await fetchExamDetails(TEST_EXAM_ID);
    if (examErr) {
        console.error('Error fetching exam:', examErr);
        return;
    }
    console.log('ข้อมูลข้อสอบ:', exam.title, `(เวลา: ${exam.duration_minutes} นาที)`);

    console.log('\n--- 2. ดึงรายการคำถาม (ไม่มีเฉลยปนมา ปลอดภัย 100%) ---');
    const { data: questions, error: qErr } = await fetchExamQuestions(TEST_EXAM_ID);
    if (qErr) {
        console.error('Error fetching questions:', qErr);
        return;
    }
    console.log(`พบคำถามทั้งหมด ${questions.length} ข้อ:`);
    questions.forEach((q, idx) => {
        console.log(` ข้อ ${idx + 1}: ${q.question_text} (${q.points} คะแนน)`);
    });

    console.log('\n--- 3. จำลองการส่งคำตอบของนักเรียนทีละข้อ หรือส่งแบบ Batch ---');
    // สมมติตอบ: ข้อ 1 ตอบ 'C' (ถูก), ข้อ 2 ตอบ 'A' (ถูก), ข้อ 3 ตอบ 'D' (ผิด)
    // พร้อมสถิติการสลับหน้าจอ (Tab Switches)
    const sampleAnswers = [
        { questionId: questions[0].id, selectedOptionId: 'C', tabSwitchCount: 1, fullscreenExitCount: 0 },
        { questionId: questions[1].id, selectedOptionId: 'A', tabSwitchCount: 0, fullscreenExitCount: 0 },
        { questionId: questions[2].id, selectedOptionId: 'D', tabSwitchCount: 1, fullscreenExitCount: 0 }
    ];

    const { data: submitted, error: subErr } = await batchSubmitAnswers({
        studentId: TEST_STUDENT_ID,
        examId: TEST_EXAM_ID,
        answers: sampleAnswers
    });

    if (subErr) {
        console.error('Error submitting answers:', subErr);
        return;
    }
    console.log(`บันทึกคำตอบเรียบร้อยแล้ว: ${submitted.length} ข้อ`);

    console.log('\n--- 4. สั่งตรวจข้อสอบผ่าน Secure Server-Side RPC ---');
    const { result: gradeResult, error: gradeErr } = await gradeExamViaRPC(TEST_STUDENT_ID, TEST_EXAM_ID);
    if (gradeErr) {
        console.error('Grading Error:', gradeErr);
        return;
    }
    console.log('ผลการตรวจข้อสอบอย่างปลอดภัย:', gradeResult);

    console.log('\n--- 5. ดึงผลคะแนนและรายงานความซื่อสัตย์ (Anti-Cheating Audit) ---');
    const { data: finalResult, error: resErr } = await getStudentExamResult(TEST_STUDENT_ID, TEST_EXAM_ID);
    if (resErr) {
        console.error('Error fetching result:', resErr);
        return;
    }

    console.log('สรุปผลการสอบ:');
    console.log(`- คะแนนที่ได้: ${finalResult.total_score} / ${finalResult.max_score} (${finalResult.percentage}%)`);
    console.log(`- จำนวนการสลับหน้าจอทั้งหมด: ${finalResult.total_tab_switches} ครั้ง`);
    console.log(`- พบพฤติกรรมน่าสงสัยหรือไม่: ${finalResult.is_flagged_cheating ? '⚠️ ใช่ (ถูก Flag)' : '✅ ไม่พบ'}`);
    if (finalResult.is_flagged_cheating) {
        console.log(`- สาเหตุ:`, finalResult.cheating_reasons);
    }
}

// export เพื่อนำไปทดสอบ
export { runExamFlowDemo };
