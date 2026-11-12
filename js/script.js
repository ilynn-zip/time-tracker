(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const el = {
        modes: document.querySelectorAll('.mode'),
        task: $('task'),
        clockMain: $('clockMain'),
        clockCs: $('clockCs'),
        progress: $('progress'), progressFill: $('progressFill'),
        setup: $('setup'), presets: $('presets'),
        inH: $('inH'), inMin: $('inMin'), inSec: $('inSec'),
        btnStart: $('btnStart'), btnReset: $('btnReset'), btnSave: $('btnSave'),
        list: $('list'), empty: $('empty'), total: $('total'), btnClear: $('btnClear'),
        btnToggle: $('btnToggle'),
        btnFilter: $('btnFilter'),
        logFilter: $('logFilter'),
        toast: $('toast'), today: $('today')
    };

    const LS_STATE = 'tick.state.v16';
    const LS_HIST = 'tick.history.v16';

    let mode = 'stopwatch';
    let running = false;
    let elapsed = 0;
    let startTs = 0;
    let duration = 25 * 60 * 1000;
    let saved = {
        stopwatch: { running: false, elapsed: 0, startTs: 0 },
        timer: { running: false, elapsed: 0, startTs: 0 }
    };
    let rafId = null;
    let lastTitleSec = -1;
    let lastAlmost = false;
    let history = [];
    let audioCtx = null;
    let historyExpanded = false;
    let activeFilter = 'all';
    let filterOpen = false;

    const pad = n => String(n).padStart(2, '0');

    function splitMs(ms) {
        ms = Math.max(0, ms);
        return {
            h: Math.floor(ms / 3600000),
            m: Math.floor(ms / 60000) % 60,
            s: Math.floor(ms / 1000) % 60,
            cs: Math.floor(ms / 10) % 100
        };
    }

    function getDateKey(ts) {
        const d = new Date(ts);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function formatFilterLabel(key) {
        if (key === 'all') return 'All';
        const today = getDateKey(Date.now());
        const yesterday = getDateKey(Date.now() - 86400000);
        if (key === today) return 'Today';
        if (key === yesterday) return 'Yesterday';
        const [y, m, d] = key.split('-').map(Number);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const curYear = new Date().getFullYear();
        return d + ' ' + months[m - 1] + (y !== curYear ? ' ' + String(y).slice(-2) : '');
    }


    function formatShort(ms) {
        const total = Math.round(ms / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor(total / 60) % 60;
        const s = total % 60;
        if (h) return h + 'h ' + m + 'm';
        if (m) return m + 'm ' + s + 's';
        return s + 's';
    }
    const currentMs = () => elapsed + (running ? Math.max(0, Date.now() - startTs) : 0);

    let toastTimer = null;
    function toast(msg) {
        el.toast.textContent = msg;
        el.toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2000);
    }

    function saveState() {
        saved[mode] = { running, elapsed, startTs };
        try {
            localStorage.setItem(LS_STATE, JSON.stringify({
                mode, saved, duration, task: el.task.value
            }));
        } catch (e) { }
    }
    function loadState() {
        try {
            const s = JSON.parse(localStorage.getItem(LS_STATE) || 'null');
            if (s) {
                mode = s.mode === 'timer' ? 'timer' : 'stopwatch';
                duration = (Number(s.duration) > 0) ? Number(s.duration) : 25 * 60 * 1000;
                el.task.value = s.task || '';

                if (s.saved) {
                    if (s.saved.stopwatch) Object.assign(saved.stopwatch, s.saved.stopwatch);
                    if (s.saved.timer) Object.assign(saved.timer, s.saved.timer);
                } else {
                    // migrate from old flat format
                    saved[mode] = {
                        running: !!s.running && s.startTs > 0 && s.startTs <= Date.now() + 2000,
                        elapsed: Number(s.elapsed) || 0,
                        startTs: Number(s.startTs) || 0
                    };
                }

                ['stopwatch', 'timer'].forEach(m => {
                    const st = saved[m];
                    if (st.running && (st.startTs <= 0 || st.startTs > Date.now() + 2000)) {
                        st.running = false;
                    }
                });

                running = saved[mode].running;
                elapsed = saved[mode].elapsed;
                startTs = saved[mode].startTs;
            }
            const h = JSON.parse(localStorage.getItem(LS_HIST) || '[]');
            if (Array.isArray(h)) history = h.filter(x => x && typeof x.ms === 'number');
        } catch (e) { }
    }
    function saveHistory() {
        try { localStorage.setItem(LS_HIST, JSON.stringify(history)); } catch (e) { }
    }

    function render() {
        const total = currentMs();
        const shown = mode === 'timer' ? Math.max(0, duration - total) : total;
        const t = splitMs(shown);

        el.clockMain.textContent = pad(t.h) + ':' + pad(t.m) + ':' + pad(t.s);
        el.clockCs.textContent = '.' + pad(t.cs);

        if (mode === 'timer') {
            el.progress.classList.add('show');
            const p = duration > 0 ? Math.min(1, total / duration) : 0;
            el.progressFill.style.width = (p * 100).toFixed(2) + '%';

            const remaining = duration - total;
            const almost = running && remaining > 0 && remaining <= Math.min(60000, duration * 0.1);
            if (almost !== lastAlmost) {
                lastAlmost = almost;
                document.body.classList.toggle('almost-up', almost);
            }
        } else {
            el.progress.classList.remove('show');
            if (lastAlmost) {
                lastAlmost = false;
                document.body.classList.remove('almost-up');
            }
        }

        const key = Math.floor(shown / 1000);
        if (key !== lastTitleSec) {
            lastTitleSec = key;
            const name = el.task.value.trim();
            document.title = (running ? '▶ ' : '') + pad(t.h) + ':' + pad(t.m) + ':' + pad(t.s) +
                (name ? ' · ' + name : '') + ' — Time Tracker';
        }
    }

    function updateButtons() {
        el.btnStart.textContent = running ? 'Pause' : 'Start';
        el.btnStart.classList.toggle('running', running);
        document.body.classList.toggle('running', running);
        el.inH.disabled = el.inMin.disabled = el.inSec.disabled = running;
        el.setup.querySelectorAll('.step').forEach(b => b.disabled = running);
        el.presets.querySelectorAll('button').forEach(b => b.disabled = running);
        lastTitleSec = -1;
        updateTabIndicators();
    }

    function updateTabIndicators() {
        el.modes.forEach(tab => {
            const m = tab.dataset.mode;
            const isRunning = (m === mode) ? running : saved[m].running;
            tab.classList.toggle('background-running', isRunning);
        });
    }

    function applyMode(m) {
        document.body.dataset.mode = m;
        el.modes.forEach(t => t.classList.toggle('active', t.dataset.mode === m));
        el.setup.classList.toggle('show', m === 'timer');
        document.body.classList.remove('almost-up');
        lastAlmost = false;
    }

    function loop() {
        rafId = null;
        render();
        if (running) {
            if (mode === 'timer' && currentMs() >= duration) { finishTimer(); return; }
            rafId = requestAnimationFrame(loop);
        }
    }
    function startLoop() { if (rafId === null) rafId = requestAnimationFrame(loop); }
    function stopLoop() { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; } }

    function start() {
        if (running) return;
        if (mode === 'timer') {
            if (elapsed >= duration) elapsed = 0;
            if (duration <= 0) { toast('Duration must be above zero'); return; }
        }
        unlockAudio();
        running = true;
        startTs = Date.now();
        updateButtons();
        startLoop();
        saveState();
    }
    function pause() {
        if (!running) return;
        elapsed = currentMs();
        running = false;
        stopLoop();
        render();
        updateButtons();
        saveState();
    }
    function toggle() { running ? pause() : start(); }
    function reset() {
        running = false;
        elapsed = 0;
        stopLoop();
        document.body.classList.remove('almost-up');
        lastAlmost = false;
        render();
        updateButtons();
        saveState();
    }
    function finishTimer() {
        running = false;
        elapsed = duration;
        stopLoop();
        render();
        updateButtons();
        saveState();
        beep();
        document.title = '⏰ Time is up!';
        lastTitleSec = -1;
        if (navigator.vibrate) navigator.vibrate([220, 100, 220]);
        toast('Time is up');
    }

    function unlockAudio() {
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
        }
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }
    function beep() {
        if (!audioCtx) return;
        try {
            let t = audioCtx.currentTime;
            for (let i = 0; i < 3; i++) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.value = i === 2 ? 1180 : 880;
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
                osc.start(t); osc.stop(t + 0.4);
                t += 0.1;
            }
        } catch (e) { }
    }

    function renderFilter() {
        const seen = new Set();
        const dates = [];
        history.forEach(item => {
            const k = getDateKey(item.ts);
            if (!seen.has(k)) { seen.add(k); dates.push(k); }
        });

        if (dates.length <= 1) {
            if (activeFilter !== 'all') activeFilter = 'all';
            el.btnFilter.style.display = 'none';
            el.btnFilter.classList.remove('open');
            el.logFilter.classList.remove('open');
            return;
        }
        el.btnFilter.style.display = '';

        if (activeFilter !== 'all' && !seen.has(activeFilter)) {
            activeFilter = 'all';
        }

        // Build button content
        el.btnFilter.innerHTML = '';
        const label = document.createElement('span');
        label.textContent = formatFilterLabel(activeFilter);
        el.btnFilter.appendChild(label);

        const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        chev.setAttribute('viewBox', '0 0 10 6');
        chev.setAttribute('width', '8');
        chev.setAttribute('height', '5');
        chev.classList.add('filter-btn-chevron');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M1 1l4 4 4-4');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        chev.appendChild(path);
        el.btnFilter.appendChild(chev);

        el.btnFilter.classList.toggle('has-filter', activeFilter !== 'all');

        // Build chips row
        el.logFilter.innerHTML = '';
        const items = [{ key: 'all', label: 'All' }];
        dates.forEach(k => items.push({ key: k, label: formatFilterLabel(k) }));

        items.forEach(it => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'filter-chip' + (activeFilter === it.key ? ' active' : '');
            b.textContent = it.label;
            b.addEventListener('click', () => {
                activeFilter = it.key;
                closeFilter();
                renderHistory();
            });
            el.logFilter.appendChild(b);
        });
    }

    function openFilter() {
        if (el.btnFilter.style.display === 'none') return;
        el.logFilter.classList.add('open');
        el.btnFilter.classList.add('open');
    }

    function closeFilter() {
        el.logFilter.classList.remove('open');
        el.btnFilter.classList.remove('open');
    }

    function toggleFilter() {
        if (el.logFilter.classList.contains('open')) closeFilter();
        else openFilter();
    }

    function renderHistory() {
        renderFilter();

        el.list.innerHTML = '';

        const filtered = activeFilter === 'all'
            ? history
            : history.filter(item => getDateKey(item.ts) === activeFilter);

        el.empty.style.display = filtered.length ? 'none' : 'block';

        const totalAll = filtered.reduce((a, b) => a + b.ms, 0);
        el.total.textContent = filtered.length ? 'Σ ' + formatShort(totalAll) : '';

        const visible = historyExpanded ? filtered : filtered.slice(0, 1);
        const hiddenCount = filtered.length - visible.length;

        visible.forEach(item => {
            const isTimer = item.mode === 'timer';
            const li = document.createElement('li');
            li.className = 'log-item';
            li.setAttribute('data-mode', isTimer ? 'timer' : 'stopwatch');

            const dot = document.createElement('span');
            dot.className = 'log-dot';

            const body = document.createElement('div');
            body.className = 'log-body';

            const name = document.createElement('div');
            name.className = 'log-name';
            name.textContent = item.name || 'Untitled';
            name.title = 'Click to edit';
            name.addEventListener('click', () => startEditName(name, item));

            const meta = document.createElement('div');
            meta.className = 'log-meta';
            meta.textContent = (isTimer ? 'Timer' : 'Stopwatch') + ' · ' +
                new Date(item.ts).toLocaleString('en-US', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                });

            body.append(name, meta);

            const time = document.createElement('span');
            time.className = 'log-time';
            time.textContent = formatShort(item.ms);

            const del = document.createElement('button');
            del.className = 'log-remove';
            del.type = 'button';
            del.setAttribute('aria-label', 'Delete');
            del.textContent = '×';
            del.addEventListener('click', () => {
                history = history.filter(x => x.id !== item.id);
                saveHistory();
                renderHistory();
            });

            li.append(dot, body, time, del);
            el.list.appendChild(li);
        });

        if (filtered.length > 1) {
            el.btnToggle.classList.add('show');
            el.btnToggle.textContent = historyExpanded
                ? 'Show less'
                : 'Show ' + hiddenCount + ' more';
        } else {
            el.btnToggle.classList.remove('show');
        }
    }

    function saveSession() {
        const ms = mode === 'timer' ? Math.min(currentMs(), duration) : currentMs();
        if (ms < 500) { toast('Too short to save'); return; }

        history.unshift({
            id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            name: el.task.value.trim(),
            ms: Math.round(ms),
            ts: Date.now(),
            mode: mode
        });
        saveHistory();
        renderHistory();
        reset();
        el.task.focus();
        toast('Saved · ' + formatShort(ms));
    }

    function readTimerInputs() {
        const h = Math.max(0, Math.min(99, parseInt(el.inH.value, 10) || 0));
        const m = Math.max(0, Math.min(59, parseInt(el.inMin.value, 10) || 0));
        const s = Math.max(0, Math.min(59, parseInt(el.inSec.value, 10) || 0));
        duration = (h * 3600 + m * 60 + s) * 1000;
    }
    function syncTimerInputs() {
        el.inH.value = pad(Math.floor(duration / 3600000));
        el.inMin.value = pad(Math.floor(duration / 60000) % 60);
        el.inSec.value = pad(Math.floor(duration / 1000) % 60);
        updateActivePreset();
    }

    function stepUnit(unit, delta) {
        if (running) return;
        readTimerInputs();
        const totalSec = Math.round(duration / 1000);
        const stepSec = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
        const maxSec = 99 * 3600 + 59 * 60 + 59;
        const nextSec = Math.max(0, Math.min(maxSec, totalSec + delta * stepSec));
        duration = nextSec * 1000;
        syncTimerInputs();
        elapsed = 0;
        render();
        updateButtons();
        saveState();
    }

    function bindStep(btn) {
        const unit = btn.dataset.unit;
        const delta = parseInt(btn.dataset.step, 10);
        let holdTimer = null;
        let repeatTimer = null;

        const fire = () => stepUnit(unit, delta);

        const start = (e) => {
            e.preventDefault();
            fire();
            holdTimer = setTimeout(() => {
                repeatTimer = setInterval(fire, 70);
            }, 400);
        };
        const stop = () => {
            clearTimeout(holdTimer);
            clearInterval(repeatTimer);
            holdTimer = null;
            repeatTimer = null;
        };

        btn.addEventListener('pointerdown', start);
        btn.addEventListener('pointerup', stop);
        btn.addEventListener('pointerleave', stop);
        btn.addEventListener('pointercancel', stop);
        btn.addEventListener('contextmenu', e => e.preventDefault());
    }

    function updateActivePreset() {
        el.presets.querySelectorAll('button').forEach(b => {
            const sec = parseInt(b.dataset.sec, 10);
            b.classList.toggle('active', sec * 1000 === duration);
        });
    }
    function setPreset(seconds) {
        if (running) return;
        duration = seconds * 1000;
        elapsed = 0;
        syncTimerInputs();
        render();
        updateButtons();
        saveState();
    }
    function setMode(next) {
        if (next === mode) return;

        saved[mode] = { running, elapsed, startTs };

        const s = saved[next];
        running = s.running;
        elapsed = s.elapsed;
        startTs = s.startTs;

        mode = next;
        applyMode(mode);
        if (mode === 'timer') syncTimerInputs();
        document.body.classList.remove('almost-up');
        lastAlmost = false;
        render();
        updateButtons();
        saveState();
        if (running) startLoop();
    }

    el.modes.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
    el.btnStart.addEventListener('click', toggle);
    el.btnReset.addEventListener('click', reset);
    el.btnSave.addEventListener('click', saveSession);

    el.btnToggle.addEventListener('click', () => {
        historyExpanded = !historyExpanded;
        renderHistory();
    });

    el.btnClear.addEventListener('click', () => {
        if (!history.length) return;
        if (confirm('Clear the entire log?')) {
            history = [];
            saveHistory();
            renderHistory();
        }
    });

    el.task.addEventListener('input', saveState);

    [el.inH, el.inMin, el.inSec].forEach(inp => {
        inp.addEventListener('input', () => {
            if (running) return;
            inp.value = inp.value.replace(/\D/g, '').slice(0, 2);
            readTimerInputs();
            updateActivePreset();
            elapsed = 0;
            render();
            updateButtons();
            saveState();
        });
        inp.addEventListener('blur', () => {
            if (mode !== 'timer' || running) return;
            readTimerInputs();
            syncTimerInputs();
        });
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') inp.blur();
        });
    });

    el.setup.querySelectorAll('.step').forEach(bindStep);

    el.presets.addEventListener('click', e => {
        const btn = e.target.closest('button[data-sec]');
        if (!btn) return;
        setPreset(parseInt(btn.dataset.sec, 10));
    });

    el.btnFilter.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFilter();
    });

    document.addEventListener('click', (e) => {
        if (!el.logFilter.classList.contains('open')) return;
        if (el.logFilter.contains(e.target)) return;
        if (el.btnFilter.contains(e.target)) return;
        closeFilter();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!el.logFilter.classList.contains('open')) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        closeFilter();
    });


    document.addEventListener('keydown', e => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
            if (e.key === 'Enter') e.target.blur();
            return;
        }
        if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
        const k = e.key.toLowerCase();
        if (k === 'r') { e.preventDefault(); reset(); }
        if (k === 's') { e.preventDefault(); saveSession(); }
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { render(); if (running && rafId === null) startLoop(); }
    });

    function init() {
        const d = new Date();
        el.today.textContent =
            d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() + ' · ' +
            d.getDate() + ' ' +
            d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();

        loadState();
        applyMode(mode);
        syncTimerInputs();
        renderHistory();
        render();
        updateButtons();

        if (running) {
            if (mode === 'timer' && currentMs() >= duration) finishTimer();
            else startLoop();
        }
    }

    init();

    setInterval(() => {
        if (mode !== 'timer' && saved.timer.running) {
            const t = saved.timer;
            const tMs = t.elapsed + (Date.now() - t.startTs);
            if (tMs >= duration) {
                t.running = false;
                t.elapsed = duration;
                beep();
                toast('Timer finished');
                saveState();
                updateTabIndicators();
            }
        }

        if (document.hidden && running) {
            render();
            if (mode === 'timer' && currentMs() >= duration) finishTimer();
        }
    }, 500);
})();