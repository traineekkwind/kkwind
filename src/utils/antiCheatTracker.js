/**
 * ==============================================================================
 * ANTI-CHEATING CLIENT MONITOR (Headless / Logic-Only)
 * ==============================================================================
 * ยูทิลิตี้นี้ใช้จับพฤติกรรมระหว่างการสอบ (Event Listeners) โดยไม่แตะต้อง UI/CSS ใดๆ
 * นักพัฒนาฝั่ง Frontend สามารถเรียกใช้งานเพื่อส่ง Metadata มายัง Backend ได้โดยตรง
 */

import { logAntiCheatEvent } from '../services/examService.js';

export class AntiCheatMonitor {
    /**
     * @param {Object} config
     * @param {string} config.studentId - รหัสนักเรียน
     * @param {string} config.examId - รหัสชุดข้อสอบ
     * @param {Function} [config.onWarning] - Callback เมื่อเกิดเหตุการณ์ผิดปกติ (เช่น แจ้งเตือนใน UI ของคุณเอง)
     * @param {Function} [config.onDisqualify] - Callback เมื่อทำผิดกฎเกินเกณฑ์กำหนด
     */
    constructor({ studentId, examId, onWarning = null, onDisqualify = null }) {
        this.studentId = studentId;
        this.examId = examId;
        this.onWarning = onWarning;
        this.onDisqualify = onDisqualify;

        this.tabSwitchCount = 0;
        this.fullscreenExitCount = 0;
        this.copyAttemptCount = 0;
        this.isActive = false;

        this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
        this._handleWindowBlur = this._handleWindowBlur.bind(this);
        this._handleFullscreenChange = this._handleFullscreenChange.bind(this);
        this._handleCopyPaste = this._handleCopyPaste.bind(this);
    }

    /**
     * เริ่มการตรวจจับพฤติกรรม
     */
    start() {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        this.isActive = true;

        document.addEventListener('visibilitychange', this._handleVisibilityChange);
        window.addEventListener('blur', this._handleWindowBlur);
        document.addEventListener('fullscreenchange', this._handleFullscreenChange);
        document.addEventListener('copy', this._handleCopyPaste);
        document.addEventListener('paste', this._handleCopyPaste);
        document.addEventListener('contextmenu', this._handleContextMenu);

        console.log('[AntiCheatMonitor] Monitoring active for student:', this.studentId);
    }

    /**
     * หยุดการตรวจจับ
     */
    stop() {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        this.isActive = false;

        document.removeEventListener('visibilitychange', this._handleVisibilityChange);
        window.removeEventListener('blur', this._handleWindowBlur);
        document.removeEventListener('fullscreenchange', this._handleFullscreenChange);
        document.removeEventListener('copy', this._handleCopyPaste);
        document.removeEventListener('paste', this._handleCopyPaste);
        document.removeEventListener('contextmenu', this._handleContextMenu);

        console.log('[AntiCheatMonitor] Monitoring stopped.');
    }

    /**
     * ดึงสถิติ Anti-Cheating ปัจจุบันเพื่อแนบไปกับคำตอบ
     */
    getTelemetry() {
        return {
            tabSwitchCount: this.tabSwitchCount,
            fullscreenExitCount: this.fullscreenExitCount,
            copyAttemptCount: this.copyAttemptCount
        };
    }

    // --- Private Handlers ---

    _handleVisibilityChange() {
        if (document.hidden) {
            this.tabSwitchCount++;
            this._recordViolation('tab_hidden', { total_switches: this.tabSwitchCount });
        }
    }

    _handleWindowBlur() {
        // บางกรณีที่ผู้ใช้คลิกโปรแกรมอื่นนอก Browser
        this._recordViolation('window_blur', { total_switches: this.tabSwitchCount });
    }

    _handleFullscreenChange() {
        if (!document.fullscreenElement) {
            this.fullscreenExitCount++;
            this._recordViolation('fullscreen_exit', { total_exits: this.fullscreenExitCount });
        }
    }

    _handleCopyPaste(e) {
        this.copyAttemptCount++;
        this._recordViolation(e.type, { count: this.copyAttemptCount });
    }

    _handleContextMenu(e) {
        // สามารถป้องกันหรือบันทึก Log การกดคลิกขวา
        this._recordViolation('context_menu', {});
    }

    _recordViolation(eventType, payload) {
        if (!this.isActive) return;

        // บันทึก Log ไปยัง Supabase แบบ Asynchronous
        logAntiCheatEvent({
            studentId: this.studentId,
            examId: this.examId,
            eventType,
            eventPayload: payload
        }).catch(() => {});

        if (typeof this.onWarning === 'function') {
            this.onWarning({
                type: eventType,
                payload,
                telemetry: this.getTelemetry()
            });
        }
    }
}
