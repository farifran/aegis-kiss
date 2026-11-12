/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file listeners/overscroll.ts
 * @description Efeito elástico (overscroll) visual para o container de hábitos.
 * Quando o usuário tenta rolar além do topo/fundo, o container desloca-se até
 * `MAX_OVERSCROLL_PX` e retorna com animação elástica.
 */

import { triggerHaptic, stopHaptic } from '../utils';

const MAX_OVERSCROLL_PX = 10; // deslocamento máximo visual
const SCALE_FACTOR = 0.35; // reduz impacto do delta do gesto
const TRANSITION_MS = 220; // duração da transição de retorno
const TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function setupOverscroll(container: HTMLElement) {
    if (!container) return;

    // Idempotency: don't attach twice
    if ((container as any).__overscroll_attached) return;

    // Use direct children as transform targets (avoid DOM rewrap that would break flex layout)
    const targets = Array.from(container.children).filter((n): n is HTMLElement => n.nodeType === 1);

    // Pre-warm compositor for smoother first-frame transforms:
    try {
        const comp = getComputedStyle(container).transform;
        if (!comp || comp === 'none') {
            // translateZ(0) promotes to a composite layer without visual shift.
            container.style.transform = 'translateZ(0)';
        }
    } catch (e) {}
    // Hint the browser early that we'll animate transform to reduce jank.
    container.style.willChange = 'transform';

    let activeOffset = 0; // px, + = downwards, - = upwards
    let lastTouchY = 0;
    let isTouching = false;
    let wheelResetTimer: number | null = null;
    let limitVibrationTimer: number | null = null;
    let lastFeedbackStep = 0;

    let pendingTransition = false;
    let rafId: number | null = null;
    let queuedOffset: number | null = null;
    const hasTypedOM = typeof window !== 'undefined' && !!(window.CSS && (window as any).CSSTranslate && (CSS as any).px);

    function commitOffset() {
        rafId = null;
        if (queuedOffset === null) return;
        const val = queuedOffset;
        queuedOffset = null;
        for (const t of targets) {
            if (hasTypedOM && t.attributeStyleMap) {
                try {
                    t.attributeStyleMap.set('transform', new (window as any).CSSTranslate!(CSS.px(0), CSS.px(val)));
                } catch (_) {
                    t.style.transform = `translateY(${val}px)`;
                }
            } else {
                t.style.transform = `translateY(${val}px)`;
            }
            t.style.willChange = 'transform';
        }
    }

    function applyOffset(px: number) {
        activeOffset = Math.max(-MAX_OVERSCROLL_PX, Math.min(MAX_OVERSCROLL_PX, px));
        // queue and batch the visual update via RAF
        queuedOffset = activeOffset;
        if (!rafId) rafId = requestAnimationFrame(commitOffset);
    }

    function _stopLimitVibration() {
        if (limitVibrationTimer) {
            clearInterval(limitVibrationTimer);
            limitVibrationTimer = null;
            stopHaptic();
        }
    }

    function resetOffsetWithAnimation() {
        if (activeOffset === 0 || pendingTransition) return;
        _stopLimitVibration();
        pendingTransition = true;
        // apply a lightweight transition back to 0 (no bounce overshoot) on the target
        for (const t of targets) t.style.transition = `transform ${TRANSITION_MS}ms ${TRANSITION_EASING}`;
        // use first target to detect end of transition
        const primary = targets[0];
        if (primary) primary.style.willChange = 'transform';

        const onTransitionEnd = (ev: TransitionEvent) => {
            if (ev.propertyName !== 'transform') return;
            pendingTransition = false;
            for (const tt of targets) {
                tt.style.transition = '';
                tt.style.transform = '';
                tt.style.willChange = '';
            }
            activeOffset = 0;
            primary.removeEventListener('transitionend', onTransitionEnd as EventListener);
        };

        if (primary) primary.addEventListener('transitionend', onTransitionEnd as EventListener);
        // trigger the transition to zero
        queuedOffset = 0;
        if (!rafId) rafId = requestAnimationFrame(commitOffset);
    }

    // TOUCH HANDLERS
    function onTouchStart(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        isTouching = true;
        lastTouchY = e.touches[0].clientY;
        if (wheelResetTimer) { clearTimeout(wheelResetTimer); wheelResetTimer = null; }
    }

    function readEdges() {
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        return { maxScroll, atTop: container.scrollTop <= 0, atBottom: container.scrollTop >= maxScroll - 0.5 };
    }

    /**
     * Feedback tátil do elástico: granulado enquanto o usuário puxa e contínuo
     * ao encostar no limite. Toque e roda da mesma forma, por isso vive aqui.
     */
    function applyHaptics(target: number) {
        if (Math.abs(target) >= MAX_OVERSCROLL_PX - 0.001) {
            if (!limitVibrationTimer) {
                triggerHaptic('heavy');
                limitVibrationTimer = window.setInterval(() => triggerHaptic('medium'), 120);
            }
            return;
        }

        _stopLimitVibration();
        const HAPTIC_GRAIN = 3;
        const absTarget = Math.min(Math.abs(target), MAX_OVERSCROLL_PX);
        const currentStep = Math.floor(absTarget / HAPTIC_GRAIN);
        if (currentStep === lastFeedbackStep) return;

        if (currentStep > lastFeedbackStep) {
            triggerHaptic(absTarget / MAX_OVERSCROLL_PX > 0.6 ? 'light' : 'selection');
        }
        lastFeedbackStep = currentStep;
    }

    function onTouchMove(e: TouchEvent) {
        if (!isTouching) return;
        if (e.touches.length !== 1) return;

        const touchY = e.touches[0].clientY;
        const dy = touchY - lastTouchY; // positive = pulling down
        lastTouchY = touchY;

        const { atTop, atBottom } = readEdges();

        // If the user attempts to scroll beyond bounds, activate overscroll visual
        if ((atTop && dy > 0) || (atBottom && dy < 0)) {
            // Prevent native overscroll & page scroll
            e.preventDefault();
            const sign = dy > 0 ? 1 : -1;
            const additional = Math.abs(dy) * SCALE_FACTOR;
            const target = activeOffset + sign * additional;
            applyHaptics(target);

            applyOffset(target);
        } else if (activeOffset !== 0) {
            // User moved back into range: reduce offset smoothly
            applyOffset(activeOffset * 0.6);
        }
    }

    function onTouchEnd() {
        isTouching = false;
        _stopLimitVibration();
        lastFeedbackStep = 0;
        resetOffsetWithAnimation();
    }

    // WHEEL HANDLER (desktop)
    function onWheel(e: WheelEvent) {
        if (e.deltaY === 0) return;
        const { maxScroll, atTop, atBottom } = readEdges();

        if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0) || maxScroll === 0) {
            // Prevent default scrolling beyond bounds and show overscroll effect
            e.preventDefault();
            const sign = e.deltaY > 0 ? -1 : 1; // wheel down -> negative offset
            const delta = Math.abs(e.deltaY) * 0.02; // gentle mapping
            const target = activeOffset + sign * delta;
            applyHaptics(target);

            applyOffset(target);

            // Reset after user stops wheel (debounced)
            if (wheelResetTimer) clearTimeout(wheelResetTimer);
            wheelResetTimer = window.setTimeout(() => {
                wheelResetTimer = null;
                _stopLimitVibration();
                lastFeedbackStep = 0;
                resetOffsetWithAnimation();
            }, 120);
        }
    }

    // Respect interaction and dragging modes
    const shouldIgnore = () => document.body.classList.contains('is-dragging-active') || document.body.classList.contains('is-interaction-active') || container.classList.contains('is-dragging');

    // Wrapped handlers with guard
    const _onTouchStart = (e: TouchEvent) => { if (shouldIgnore()) return; onTouchStart(e); };
    const _onTouchMove = (e: TouchEvent) => { if (shouldIgnore()) return; onTouchMove(e); };
    // Sem guard: o encerramento precisa zerar o offset mesmo se o gesto virou drag.
    const _onTouchEnd = () => onTouchEnd();
    const _onWheel = (e: WheelEvent) => { if (shouldIgnore()) return; onWheel(e); };

    container.addEventListener('touchstart', _onTouchStart, { passive: true });
    // touchmove must be non-passive so we can preventDefault when overscrolling
    container.addEventListener('touchmove', _onTouchMove as EventListener, { passive: false });
    container.addEventListener('touchend', _onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', _onTouchEnd, { passive: true });

    // wheel needs to be non-passive to call preventDefault
    container.addEventListener('wheel', _onWheel as EventListener, { passive: false });
    // mark attached
    try { (container as any).__overscroll_attached = true; } catch (_) {}
}

// Export only named to avoid unused default export
