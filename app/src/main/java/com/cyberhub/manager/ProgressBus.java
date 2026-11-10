package com.cyberhub.manager;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * r15 通用处理进度总线 —— 基于 MT2.26.11.apk 反编译还原。
 *
 * <p>MT 侧对应关系（见 mtre/MT_PROGRESS_RULES.md）：</p>
 * <ul>
 *   <li>{@code bin/mt/plugin/api/util/UIUpdater + UIUpdaterGroup}：ProgressDialog 注册
 *       title / message / progress / <b>secondaryProgress</b> 四个 updater；</li>
 *   <li>{@code DualProgressDialog}：额外提供 sub / <b>total</b> 两条进度与
 *       {@code {dual_progress_dialog_total}}（「总进度」）标签；</li>
 *   <li>{@code PluginProgressBar$Style}：HORIZONTAL / CIRCULAR / CIRCULAR_SMALL / CIRCULAR_LARGE；</li>
 *   <li>{@code BaseCancelableDialog}：cancelable / canceled / onCancelListener，
 *       配合「再按一次取消操作 → 正在取消操作… → 已取消操作」。</li>
 * </ul>
 *
 * <p>工具类依旧只调 {@link #report(int, String)} / {@link #stage(String)}，零签名改动；
 * 扩展字段通过 {@link Extras} 透传。worker 是 2 线程池，状态放 {@link ThreadLocal}；
 * 取消标志按 job 放在全局表，供另一个 worker 线程（cancelTask action）置位。</p>
 */
public final class ProgressBus {

    /** r15：MT 对话框的扩展上报字段。 */
    public static final class Extras {
        public int secondary = -1;      // setSecondaryProgress
        public int total = -1;          // DualProgressDialog.totalProgressBar
        public int totalMax = -1;       // setMaxTotalProgress
        public String style = null;     // HORIZONTAL / CIRCULAR / CIRCULAR_SMALL / CIRCULAR_LARGE
        public String state = null;     // preparing / loading / processing / canceling / canceled / oom
        public String detail = null;    // 阶段详情（当前文件名等）

        public String toJson() {
            StringBuilder b = new StringBuilder("{");
            b.append("\"secondary\":").append(secondary).append(',');
            b.append("\"total\":").append(total).append(',');
            b.append("\"totalMax\":").append(totalMax).append(',');
            if (style != null) b.append("\"style\":").append(quote(style)).append(',');
            if (state != null) b.append("\"state\":").append(quote(state)).append(',');
            if (detail != null) b.append("\"detail\":").append(quote(detail)).append(',');
            if (b.charAt(b.length() - 1) == ',') b.setLength(b.length() - 1);
            return b.append('}').toString();
        }

        /** 纯 JDK 字符串转义，避免本地 javac 依赖 org.json。 */
        private static String quote(String s) {
            StringBuilder o = new StringBuilder("\"");
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"': o.append("\\\""); break;
                    case '\\': o.append("\\\\"); break;
                    case '\n': o.append("\\n"); break;
                    case '\r': o.append("\\r"); break;
                    case '\t': o.append("\\t"); break;
                    default:
                        if (c < 0x20) o.append(String.format("\\u%04x", (int) c));
                        else o.append(c);
                }
            }
            return o.append('"').toString();
        }
    }

    public interface Sink {
        void report(int percent, String message);

        /** r15：MT 扩展字段。默认降级为普通 report，兼容全部既有调用点。 */
        default void report(int percent, String message, Extras extras) {
            report(percent, message);
        }
    }

    /** MT「已取消操作」：在下一个打点处中断任务，由 Bridge.request 捕获为错误文案。 */
    public static final class CancellationException extends RuntimeException {
        public CancellationException(String message) {
            super(message, null, false, false);
        }
    }

    private static final class State {
        Sink sink;
        String job;
        int lastPercent = -2;
        long lastAt = 0L;
    }

    private static final ThreadLocal<State> CURRENT = ThreadLocal.withInitial(State::new);
    private static final ConcurrentHashMap<String, AtomicBoolean> CANCELS = new ConcurrentHashMap<>();

    private ProgressBus() {}

    /** r14 兼容签名：绑定进度出口，不参与取消。 */
    public static void begin(Sink sink) {
        State s = CURRENT.get();
        s.sink = sink;
        s.lastPercent = -2;
        s.lastAt = 0L;
    }

    /** r15：额外绑定 job，使 cancelTask 能按 job 置位取消标志。 */
    public static void bindJob(String job) {
        State s = CURRENT.get();
        s.job = job;
        if (job != null && !job.isEmpty()) CANCELS.putIfAbsent(job, new AtomicBoolean(false));
    }

    public static void end() {
        State s = CURRENT.get();
        if (s.job != null) CANCELS.remove(s.job);
        s.sink = null;
        s.job = null;
        s.lastPercent = -2;
        s.lastAt = 0L;
    }

    public static boolean active() {
        return CURRENT.get().sink != null;
    }

    /** cancelTask action：置位取消标志；返回是否命中一个正在运行的任务。 */
    public static boolean requestCancel(String job) {
        if (job == null || job.isEmpty()) return false;
        AtomicBoolean flag = CANCELS.get(job);
        if (flag == null) return false;
        flag.set(true);
        return true;
    }

    public static boolean isCanceled() {
        State s = CURRENT.get();
        if (s.job == null) return false;
        AtomicBoolean flag = CANCELS.get(s.job);
        return flag != null && flag.get();
    }

    /** 每次打点检查取消，对应 MT 的 BaseCancelableDialog.isCanceled()。 */
    private static void checkCanceled() {
        if (isCanceled()) throw new CancellationException("已取消操作");
    }

    public static void report(int percent, String message) {
        report(percent, message, null);
    }

    /**
     * @param percent 0-100；-1 表示不确定进度（仅更新说明文字，进度条走动画）
     * @param message 说明文字，可为 null
     * @param extras  MT 扩展字段，可为 null
     */
    public static void report(int percent, String message, Extras extras) {
        checkCanceled();
        State s = CURRENT.get();
        if (s.sink == null) return;
        int p = percent < 0 ? -1 : Math.min(100, Math.max(0, percent));
        long now = System.currentTimeMillis();
        boolean plain = extras == null;
        if (plain) {
            if (p == s.lastPercent && message == null) return;
            if (p >= 0 && p < 100 && p == s.lastPercent && now - s.lastAt < 200) return;
            if (now - s.lastAt < 60) return;
        }
        s.lastPercent = p;
        s.lastAt = now;
        if (plain) s.sink.report(p, message);
        else s.sink.report(p, message, extras);
    }

    /** 只更新说明文字，进度条保持不确定动画。 */
    public static void stage(String message) {
        report(-1, message);
    }

    public static void stage(String message, Extras extras) {
        report(-1, message, extras);
    }

    /** MT DualProgressDialog.setTotalProgress / setMaxTotalProgress。 */
    public static void total(int percent, int max, String message) {
        Extras x = new Extras();
        x.total = percent;
        x.totalMax = max;
        report(-1, message, x);
    }

    /** MT ProgressDialog.setSecondaryProgress。 */
    public static void secondary(int percent, String message) {
        Extras x = new Extras();
        x.secondary = percent;
        report(-1, message, x);
    }

    /** MT PluginProgressBar$Style：HORIZONTAL / CIRCULAR / CIRCULAR_SMALL / CIRCULAR_LARGE。 */
    public static void style(String style, String message) {
        Extras x = new Extras();
        x.style = style;
        report(-1, message, x);
    }
}
