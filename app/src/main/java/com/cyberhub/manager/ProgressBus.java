package com.cyberhub.manager;

/**
 * r14 通用处理进度总线。
 *
 * <p>DataEngine 在 worker 线程执行耗时操作时绑定一个 {@link Sink}，各工具类只需调用
 * {@link #report(int, String)} / {@link #stage(String)} 即可上报进度，无需逐个修改方法签名。
 * worker 是 2 线程池，状态全部放在 {@link ThreadLocal}，互不干扰。</p>
 *
 * <p>节流：同一线程 60ms 内最多推送一次；进度未变化且无新文案时不重复推送，避免
 * 每个文件都触发一次 evaluateJavascript 拖慢主线程。</p>
 */
public final class ProgressBus {
    public interface Sink { void report(int percent, String message); }

    private static final class State {
        Sink sink;
        int lastPercent = -2;
        long lastAt = 0L;
    }

    private static final ThreadLocal<State> CURRENT = ThreadLocal.withInitial(State::new);

    private ProgressBus() {}

    public static void begin(Sink sink) {
        State s = CURRENT.get();
        s.sink = sink;
        s.lastPercent = -2;
        s.lastAt = 0L;
    }

    public static void end() {
        State s = CURRENT.get();
        s.sink = null;
        s.lastPercent = -2;
        s.lastAt = 0L;
    }

    public static boolean active() {
        return CURRENT.get().sink != null;
    }

    /**
     * @param percent 0-100；传 -1 表示「不确定进度」（仅更新说明文字，进度条走动画）
     * @param message 说明文字，可为 null
     */
    public static void report(int percent, String message) {
        State s = CURRENT.get();
        if (s.sink == null) return;
        int p = percent < 0 ? -1 : Math.min(100, Math.max(0, percent));
        long now = System.currentTimeMillis();
        if (p == s.lastPercent && message == null) return;
        if (p >= 0 && p < 100 && p == s.lastPercent && now - s.lastAt < 200) return;
        if (now - s.lastAt < 60) return;
        s.lastPercent = p;
        s.lastAt = now;
        s.sink.report(p, message);
    }

    /** 只更新说明文字，进度条保持不确定动画。 */
    public static void stage(String message) {
        report(-1, message);
    }
}
