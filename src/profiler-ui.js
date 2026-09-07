// Hidden by default; F3 shows diagnostics. ?profile also captures startup.
export function mountProfiler(profiler, snapshot) {
  let panel, timer;
  function refresh() {
    if (!panel || panel.hidden) return;
    const report = snapshot(),
      metrics = report.metrics;
    const format = (key) => {
      const s = metrics[key];
      return s ? `${s.p50.toFixed(2)} / ${s.p95.toFixed(2)} ms (${s.n})` : '—';
    };
    panel.querySelector('pre').textContent = [
      `${profiler.enabled ? 'Mäter' : 'Stoppad'} · ${report.frames} bildrutor`,
      'Median / p95 · antal prov',
      `CPU bildruta   ${format('cpu.frame')}`,
      `GPU passumma   ${format('gpu.passSum')}`,
      `GPU värld      ${format('gpu.world')}`,
      `GPU skuggor    ${format('gpu.shadows')}`,
      `GPU AO         ${format('gpu.AO')}`,
      `GPU slutbild   ${format('gpu.Render Pipeline')}`,
      `CPU tillämpning ${format('cpu.build.apply')}`,
      `Worker bygge    ${format('worker.cpu.build.total')}`,
      `Bygglatens      ${format('async.build.latency')}`,
      `CPU pektest    ${format('cpu.input.raycast')}`,
      '',
      report.gpuSupported
        ? `GPU: ${report.gpuFrames} prov · ${report.droppedGPUFrames} överhoppade`
        : 'GPU-tidsstämplar stöds inte på denna enhet.',
      `Mätfel: ${report.gpuErrors.length} · query overflow: ${report.queryOverflow}`,
      'GPU: var tredje bildruta samt vid geometriändring.',
      'Slutbild inkluderar AO-brusreducering.',
      'F3 döljer panelen; mätningen fortsätter.',
    ].join('\n');
  }
  function create() {
    panel = document.createElement('section');
    panel.id = 'profiler';
    panel.setAttribute('aria-label', 'Prestandamätning');
    panel.style.cssText =
      'position:fixed;left:16px;top:65px;z-index:1000;background:#142b2bef;color:#edf2e7;padding:16px;border-radius:12px;max-width:calc(100vw - 32px);box-sizing:border-box;box-shadow:0 5px 30px #0003;font:12px/1.7 monospace;pointer-events:auto';
    const title = document.createElement('strong');
    title.textContent = 'Riviera · CPU / GPU';
    panel.append(title, document.createElement('pre'));
    for (const [label, action] of [
      ['Ny mätning', () => profiler.start('interactive')],
      [
        'Stoppa',
        async () => {
          await profiler.stop();
        },
      ],
      [
        'Spara JSON',
        () => {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }),
          );
          const a = document.createElement('a');
          a.href = url;
          a.download = 'riviera-performance.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      ],
    ]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.style.cssText =
        'font:inherit;margin:0 6px 0 0;padding:5px 9px;border-radius:5px;border:1px solid #9ca;color:inherit;background:#34504d;cursor:pointer';
      button.onclick = async () => {
        await action();
        refresh();
      };
      panel.append(button);
    }
    document.body.append(panel);
  }
  addEventListener('keydown', (event) => {
    if (event.key !== 'F3') return;
    event.preventDefault();
    if (!panel) {
      create();
      if (!profiler.enabled) profiler.start('interactive');
    } else panel.hidden = !panel.hidden;
    clearInterval(timer);
    if (!panel.hidden) {
      refresh();
      timer = setInterval(refresh, 750);
    }
  });
}
