import {
  inputVector, density, transform, transformVector, onSpin, rotation, rfUnitary,
  cnotStages, cnotVector, refocusStages, readoutState, spectralLines, spectrumAt,
  fidAt, populations, purity, fidelityWithPure, bloch, magnitude
} from './nmr.js?v=1';

const $ = id => document.getElementById(id);
const colors = { green: '#6bd9ad', blue: '#6facfa', violet: '#b59afa', orange: '#ffbf77', muted: '#a1b1c6' };
const basis = ['00', '01', '10', '11'];
const modes = {
  cnot: { max: 2, value: 1, input: 'plus0', stages: ['Input', 'After Hʙ', 'After J', 'Output'], defaults: [0, 0.5, 1] },
  rf: { max: 2 * Math.PI, value: Math.PI / 2, input: '00', stages: ['Input', 'After RF'], defaults: [0, Math.PI / 2, Math.PI] },
  echo: { max: 0.02, value: 0.01, input: 'plus0', stages: ['Input', 'First wait', 'First π', 'Second wait', 'Final π'], defaults: [0, 0.005, 0.01] },
  fid: { max: 0.08, value: 0, input: '00', stages: ['Input', 'After read pulse', 'Acquisition'], defaults: [0, 0.02, 0.04] }
};
let mode = 'rf', stage = 1, playing = false, lastFrame = null, animation;
const number = id => Number($(id).value);
const tidy = (n, digits = 3) => Math.abs(n) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : n.toFixed(digits);
function complexText([re, im]) {
  if (Math.abs(im) < 0.0005) return tidy(re);
  return `${tidy(re)} ${im < 0 ? '−' : '+'} ${tidy(Math.abs(im))}i`;
}
function displayOverlap(value) {
  return value < 0.0001 && value > 0 ? value.toExponential(2) : value.toFixed(4);
}

function setMode(next, focus = false) {
  stop();
  mode = next;
  stage = modes[mode].stages.length - 1;
  document.querySelectorAll('[data-mode]').forEach(tab => {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });
  $('experiment').setAttribute('aria-labelledby', `tab-${mode}`);
  $('input').value = modes[mode].input;
  $('progress').max = modes[mode].max;
  $('progress').value = modes[mode].value;
  if (mode === 'echo') $('offset').value = '120';
  if (mode === 'fid') $('offset').value = '100';
  $('rf-settings').hidden = mode !== 'rf';
  $('j-settings').hidden = mode === 'rf';
  $('offset-settings').hidden = !['echo', 'fid'].includes(mode);
  $('echo-settings').hidden = mode !== 'echo';
  $('fid-settings').hidden = mode !== 'fid';
  $('readout-plots').hidden = mode !== 'fid';
  const labels = {
    cnot: ['J evolution t / t₍CNOT₎', ['0', '1 · CNOT', '2'], ['t = 0', '½ t₍CNOT₎', 't₍CNOT₎']],
    rf: ['Nominal RF angle θ = Ωt', ['0', 'π', '2π'], ['θ = 0', 'θ = π/2', 'θ = π']],
    echo: ['Total free-evolution time', ['0', '10 ms', '20 ms'], ['t = 0', 't = 5 ms', 't = 10 ms']],
    fid: ['Acquisition time', ['0', '40 ms', '80 ms'], ['t = 0', 't = 20 ms', 't = 40 ms']]
  }[mode];
  $('progress-label').textContent = labels[0];
  $('progress-ticks').innerHTML = labels[1].map(v => `<span>${v}</span>`).join('');
  ['zero', 'half', 'ideal'].forEach((id, i) => $(id).textContent = labels[2][i]);
  $('equations').innerHTML = {
    cnot: 'H<sub>J</sub>/ℏ = (πJ/2) ZᴀZʙ<div class="formula-line">t<sub>CNOT</sub> = 1/(2J)</div><div class="math-caption">¹H control · ¹³C target<br>Basis: |00⟩, |01⟩, |10⟩, |11⟩</div>',
    rf: 'H/ℏ = [ΔZ + Ω(cos φ X + sin φ Y)]/2<div class="formula-line">θ = Ωt · Ω/(2π) = 1 kHz</div><div class="math-caption">Only A is driven; B is a spectator.<br>Off resonance, the rotation axis tilts toward z.</div>',
    echo: 'H/ℏ = πδZᴀ + (πJ/2) ZᴀZʙ<div class="formula-line">Wait → πᴀ → Wait → πᴀ</div><div class="math-caption">Both waits last t/2. The second pulse returns the spin to its original frame.</div>',
    fid: 'S(t) = ⟨Xᴀ⟩ + i⟨Yᴀ⟩<div class="formula-line">f = δ ± J/2</div><div class="math-caption">The two possible line frequencies are conditional on B. A line needs nonzero coherence to be visible.</div>'
  }[mode];
  $('control-note').textContent = {
    cnot: 'Single-spin pulses are ideal and instantaneous. The local Z corrections stay fixed while the J evolution time changes.',
    rf: 'Ω is the angular Rabi frequency. At resonance, a π pulse takes 0.5 ms and flips |0⟩ to |1⟩.',
    echo: 'Disable the π pulses to compare unrefocused precession with the echo. No relaxation acts in this experiment.',
    fid: 'Try |++⟩ with no readout pulse to see both lines. Try |00⟩ with no pulse to see why longitudinal populations give no FID.'
  }[mode];
  render();
}

function calculate() {
  const vector = inputVector($('input').value), epsilon = number('preparation');
  const initial = density(vector, epsilon), j = number('j'), t = number('progress');
  let states, idealVector, time;
  if (mode === 'cnot') {
    states = cnotStages(initial, j, t);
    idealVector = cnotVector(vector);
    time = stage < 2 ? 0 : t / (2 * j);
  } else if (mode === 'rf') {
    states = [initial, transform(initial, rfUnitary(t, number('phase'), number('detuning')))];
    idealVector = transformVector(vector, rfUnitary(t, number('phase'), 0));
    time = stage === 0 ? 0 : t / (2 * Math.PI * 1000);
  } else if (mode === 'echo') {
    states = refocusStages(initial, t, j, number('offset'), $('echo').checked);
    idealVector = vector;
    time = stage === 0 ? 0 : stage <= 2 ? t / 2 : t;
  } else {
    const pulse = $('read-pulse').value === 'y' ? onSpin(rotation([0, 1, 0], Math.PI / 2), 0) : onSpin(rotation([0, 1, 0], 0), 0);
    const prepared = transform(initial, pulse);
    states = [initial, prepared, readoutState(prepared, t, j, number('offset'), number('t2') / 1000)];
    idealVector = transformVector(vector, pulse);
    time = stage === 2 ? t : 0;
  }
  return { rho: states[stage], states, initial, idealVector, time, epsilon, j, t };
}

function render() {
  try {
    const result = calculate();
    $('error').textContent = '';
    $('progress-value').textContent = mode === 'cnot' ? `${result.t.toFixed(3)} × t₍CNOT₎` : mode === 'rf' ? `${(result.t / Math.PI).toFixed(3)}π` : `${(result.t * 1000).toFixed(2)} ms`;
    $('j-value').textContent = number('j');
    $('offset-value').textContent = number('offset');
    $('detuning-value').textContent = number('detuning').toFixed(2);
    $('t2-value').textContent = number('t2');
    $('fidelity-label').textContent = { cnot: 'Overlap with ideal CNOT output', rf: 'Overlap with resonant RF output', echo: 'Overlap with original pure input', fid: 'Overlap with pure readout input' }[mode];
    $('fidelity').textContent = displayOverlap(fidelityWithPure(result.rho, result.idealVector));
    $('purity').textContent = purity(result.rho).toFixed(4);
    $('elapsed-label').textContent = { cnot: 'Accumulated J evolution', rf: 'Accumulated RF time', echo: 'Accumulated wait time', fid: 'Accumulated acquisition' }[mode];
    $('elapsed').textContent = `${(result.time * 1000).toFixed(3)} ms`;
    $('stages').innerHTML = modes[mode].stages.map((label, i) => `<button data-stage="${i}" aria-pressed="${i === stage}">${mode === 'echo' && !$('echo').checked && [2, 4].includes(i) ? 'No pulse' : label}</button>`).join('');
    $('stages').style.gridTemplateColumns = `repeat(${modes[mode].stages.length}, minmax(0, 1fr))`;
    $('stage-name').textContent = mode === 'echo' && !$('echo').checked && [2, 4].includes(stage) ? 'No pulse' : modes[mode].stages[stage];
    drawCircuit(result);
    renderBloch(result);
    renderPopulations(result.rho);
    renderMatrix(result);
    if (mode === 'fid') drawReadout(result);
  } catch (error) {
    $('error').textContent = `Simulation error: ${error.message}`;
    stop();
    console.error(error);
  }
}

function drawCircuit({ t, j }) {
  const yA = 60, yB = 128;
  const gate = (x, y, label, width = 62, violet = false) => `<rect x="${x - width / 2}" y="${y - 21}" width="${width}" height="42" rx="7" class="${violet ? 'kerr-box' : 'optical-box'}"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="svg-label">${label}</text>`;
  const joint = (x, label, sub, width = 130) => `<rect x="${x - width / 2}" y="35" width="${width}" height="117" rx="9" class="kerr-box"/><text x="${x}" y="83" text-anchor="middle" class="svg-label">${label}</text><text x="${x}" y="106" text-anchor="middle" class="svg-small">${sub}</text>`;
  let drawing = '', caption = '';
  let markers = [];
  if (mode === 'cnot') {
    drawing = gate(145, yB, 'H') + joint(278, 'J coupling', `${(t / (2 * j) * 1000).toFixed(3)} ms`) + gate(410, yA, 'Z −π/2', 88) + gate(410, yB, 'Z −π/2', 88) + gate(513, yB, 'H');
    markers = [83, 190, 353, 571];
    caption = `At t = 1/(2J) = ${(1000 / (2 * j)).toFixed(3)} ms, the complete sequence is CNOT up to global phase. The pure component |+0⟩ becomes (|00⟩ + |11⟩)/√2.`;
  } else if (mode === 'rf') {
    drawing = gate(300, yA, `RF · ${(t / Math.PI).toFixed(2)}π`, 180) + '<text x="300" y="155" text-anchor="middle" class="svg-small">B is not driven · coupling neglected during pulse</text>';
    markers = [120, 530];
    caption = `Rotating frame: drive A about (cos φ, sin φ, Δ/Ω). Nominal angle θ = Ωt; actual rotation angle is θ√(1 + (Δ/Ω)²).`;
  } else if (mode === 'echo') {
    drawing = joint(185, 'Wait t/2', `${(t * 500).toFixed(2)} ms`, 108) + gate(279, yA, $('echo').checked ? 'X π' : 'Off', 57) + joint(390, 'Wait t/2', `${(t * 500).toFixed(2)} ms`, 108) + gate(495, yA, $('echo').checked ? 'X π' : 'Off', 57);
    markers = [85, 246, 318, 453, 558];
    caption = $('echo').checked ? 'The first π pulse reverses the offset of A and its ZZ coupling. The final π pulse restores the input frame. With δʙ = 0 and no relaxation, the input state is recovered.' : 'Both pulses are disabled. A precesses freely under its offset and the conditional frequency shift from B.';
  } else {
    drawing = gate(178, yA, $('read-pulse').value === 'y' ? 'Y π/2' : 'No RF', 90) + joint(375, 'Acquire FID', `${(t * 1000).toFixed(2)} ms · T₂ = ${number('t2')} ms`, 230);
    markers = [82, 250, 558];
    caption = 'A pickup coil detects transverse magnetization of A. T₂ dephasing damps the coherence without changing computational-basis populations during acquisition.';
  }
  $('circuit').innerHTML = `<svg viewBox="0 0 620 190" role="img" aria-label="${{ cnot: 'Hadamard on B, J interaction, Z corrections on both spins, Hadamard on B', rf: 'Selective RF pulse on spin A', echo: 'Two free evolution intervals separated and followed by pi pulses on A', fid: 'Readout pulse on A followed by free induction decay acquisition' }[mode]}"><text x="20" y="${yA + 5}" class="svg-label">A · ¹H</text><text x="20" y="${yB + 5}" class="svg-label">B · ¹³C</text><path d="M78 ${yA}H592 M78 ${yB}H592" class="rail"/>${drawing}<line x1="${markers[stage]}" x2="${markers[stage]}" y1="20" y2="166" stroke="${colors.green}" stroke-dasharray="4 4" opacity=".85"/><circle cx="${markers[stage]}" cy="14" r="4" fill="${colors.green}"/></svg>`;
  $('circuit-caption').textContent = caption;
}

function renderBloch({ rho, epsilon }) {
  const normalized = $('matrix-view').value === 'deviation' && epsilon > 0;
  $('bloch-label').textContent = normalized ? 'Reduced Bloch vectors · r/ε (expanded deviation)' : 'Reduced Bloch vectors · actual state';
  const vectors = [bloch(rho, 0), bloch(rho, 1)];
  vectors.forEach((actual, spin) => {
    const v = actual.map(n => normalized ? n / epsilon : n);
    const project = ([x, y, z]) => [130 + 60 * (x + 0.48 * y), 90 - 60 * (z + 0.3 * y)];
    const [vx, vy] = project(v), color = spin === 0 ? colors.green : colors.blue;
    const axis = (v, label) => { const [x, y] = project(v); return `<path d="M130 90L${x} ${y}" stroke="#56708a"/><text x="${x + 4}" y="${y - 4}" class="svg-small">${label}</text>`; };
    const length = Math.hypot(...v);
    $(`bloch-${spin === 0 ? 'a' : 'b'}`).innerHTML = `<svg viewBox="0 0 260 196" role="img" aria-label="Spin ${spin === 0 ? 'A' : 'B'} ${normalized ? 'expanded' : 'actual'} Bloch vector: x ${tidy(v[0])}, y ${tidy(v[1])}, z ${tidy(v[2])}"><defs><marker id="arrow-${spin}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker></defs><circle cx="130" cy="90" r="60" fill="#0d1725" stroke="#32465d"/><ellipse cx="130" cy="90" rx="60" ry="17" fill="none" stroke="#32465d" stroke-dasharray="3 3"/><ellipse cx="130" cy="90" rx="23" ry="60" fill="none" stroke="#25384d"/>${axis([1.16, 0, 0], 'x')}${axis([0, 1.6, 0], 'y')}${axis([0, 0, 1.15], '|0⟩')}<text x="136" y="163" class="svg-small">|1⟩</text>${length > 0.012 ? `<path d="M130 90L${vx} ${vy}" stroke="${color}" stroke-width="2.5" marker-end="url(#arrow-${spin})"/>` : ''}<circle cx="${vx}" cy="${vy}" r="4" fill="${color}"/><text x="12" y="20" class="svg-label">${spin === 0 ? 'A · ¹H' : 'B · ¹³C'}</text><text x="130" y="186" text-anchor="middle" class="svg-small">(${v.map(n => tidy(n, 2)).join(', ')}) · |r${normalized ? '/ε' : ''}| = ${tidy(length)}</text></svg>`;
  });
  $('bloch-note').textContent = mode === 'cnot' && $('input').value === 'plus0' ? 'At the ideal Bell output, both reduced Bloch vectors vanish. The two-spin correlations remain visible as off-diagonal entries of the density matrix.' : 'A sphere shows one spin’s reduced state. A short vector indicates a mixed reduced state; the two-spin state can still have correlations.';
}

function renderPopulations(rho) {
  $('probability-bars').innerHTML = populations(rho).map((p, i) => `<div class="bar-item"><span class="ket">|${basis[i]}⟩</span><div class="bar-bg" role="meter" aria-label="Population of ${basis[i]}" aria-valuemin="0" aria-valuemax="1" aria-valuenow="${p}"><div class="bar-fill" style="width:${p * 100}%"></div></div><span class="val">${(p * 100).toFixed(2)}%</span></div>`).join('');
}

function renderMatrix({ rho, epsilon }) {
  const option = $('matrix-view').querySelector('[value="deviation"]');
  option.disabled = epsilon === 0;
  if (epsilon === 0) $('matrix-view').value = 'actual';
  const deviation = $('matrix-view').value === 'deviation';
  const matrix = rho.map((row, i) => row.map((a, k) => deviation ? [(a[0] - (i === k ? 0.25 : 0)) / epsilon, a[1] / epsilon] : a));
  const max = Math.max(0.25, ...matrix.flat().map(a => magnitude(a)));
  $('density-matrix').innerHTML = `<div class="matrix-row" role="row"><span role="columnheader"></span>${basis.map(b => `<span class="matrix-label" role="columnheader">|${b}⟩</span>`).join('')}</div>${matrix.map((row, i) => `<div class="matrix-row" role="row"><span class="matrix-label" role="rowheader">⟨${basis[i]}|</span>${row.map((a, k) => `<span role="cell" class="matrix-cell" style="background:rgba(${a[0] >= 0 ? '70,139,203' : '151,115,217'},${0.04 + 0.42 * Math.abs(a[0]) / max})" title="${deviation ? 'Expanded deviation' : 'ρ'}[${basis[i]},${basis[k]}] = ${complexText(a)}">${complexText(a)}</span>`).join('')}</div>`).join('')}`;
  $('matrix-note').textContent = deviation ? 'Expanded deviation (ρ − I/4)/ε, with zero trace. This is not a normalized density matrix. Bloch vectors above are also divided by ε. Populations and overlap still use the actual ρ.' : `Actual ρ, with trace 1. Entries show real and imaginary parts; blue is positive real, violet negative real. ε = ${epsilon === 0.00001 ? '10⁻⁵' : epsilon}.`;
}

function linePlot(id, { xMin, xMax, yMax = 1, xLabel, ticks, series, marker, verticals = [] }) {
  const canvas = $(id), box = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  const width = Math.max(280, box.width), height = 245;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
  const margin = { left: 43, right: 16, top: 20, bottom: 44 };
  const w = width - margin.left - margin.right, h = height - margin.top - margin.bottom;
  const px = x => margin.left + (x - xMin) / (xMax - xMin) * w;
  const py = y => margin.top + (1 - y / yMax) * h / 2;
  ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  [-1, -0.5, 0, 0.5, 1].forEach(f => {
    const y = f * yMax;
    ctx.strokeStyle = f === 0 ? '#42566e' : '#233449'; ctx.beginPath(); ctx.moveTo(margin.left, py(y)); ctx.lineTo(width - margin.right, py(y)); ctx.stroke();
    ctx.fillStyle = colors.muted; ctx.textAlign = 'right'; ctx.fillText(tidy(y, 1), margin.left - 8, py(y) + 4);
  });
  ticks.forEach(tick => {
    ctx.fillStyle = colors.muted; ctx.textAlign = 'center'; ctx.fillText(tick.label, px(tick.value), height - 26);
  });
  ctx.textAlign = 'center'; ctx.fillStyle = colors.muted; ctx.fillText(xLabel, margin.left + w / 2, height - 8);
  ctx.save(); ctx.beginPath(); ctx.rect(margin.left, margin.top, w, h); ctx.clip();
  verticals.forEach(x => { ctx.strokeStyle = '#42566e'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(px(x), margin.top); ctx.lineTo(px(x), margin.top + h); ctx.stroke(); ctx.setLineDash([]); });
  series.forEach(({ points, color }) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.65; ctx.beginPath();
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(px(x), py(y)) : ctx.lineTo(px(x), py(y)));
    ctx.stroke();
  });
  if (marker !== undefined) { ctx.strokeStyle = colors.orange; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px(marker), margin.top); ctx.lineTo(px(marker), margin.top + h); ctx.stroke(); }
  ctx.restore();
}

function drawReadout({ states, epsilon, j, t }) {
  const prepared = states[1], offset = number('offset'), t2 = number('t2') / 1000;
  const divisor = epsilon || 1;
  const lines = spectralLines(prepared, j, offset);
  const samples = Array.from({ length: 641 }, (_, i) => {
    const time = i * 0.08 / 640;
    return { time, value: fidAt(time, lines, t2).map(x => x / divisor) };
  });
  linePlot('fid-chart', {
    xMin: 0, xMax: 80, yMax: 1.05, marker: stage === 2 ? t * 1000 : 0, xLabel: 'Acquisition time / ms',
    ticks: [0, 20, 40, 60, 80].map(x => ({ value: x, label: x })),
    series: [0, 1].map((part, i) => ({ color: i === 0 ? colors.green : colors.blue, points: samples.map(p => [p.time * 1000, p.value[part]]) }))
  });
  const range = Math.max(90, j / 2 + 4 / (Math.PI * t2));
  const fMin = offset - range, fMax = offset + range;
  const spectrum = Array.from({ length: 1001 }, (_, i) => {
    const f = fMin + i / 1000 * (fMax - fMin);
    return { f, value: spectrumAt(f, lines, t2).map(x => x / divisor) };
  });
  linePlot('spectrum-chart', {
    xMin: fMin, xMax: fMax, yMax: 1.05, xLabel: 'Frequency offset from A carrier / Hz',
    ticks: [fMin, offset, fMax].map(f => ({ value: f, label: f.toFixed(0) })),
    verticals: lines.map(l => l.frequency),
    series: [0, 1].map((part, i) => ({ color: i === 0 ? colors.green : colors.violet, points: spectrum.map(p => [p.f, p.value[part]]) }))
  });
  $('spectrum-note').textContent = `Allowed lines: ${(offset - j / 2).toFixed(1)} and ${(offset + j / 2).toFixed(1)} Hz. Active coherences: ${lines.filter(l => magnitude(l.amplitude) > Math.max(1e-12, epsilon * 1e-6)).length} of 2. Linewidth 1/(πT₂) = ${(1 / (Math.PI * t2)).toFixed(2)} Hz. Spectrum divided by εT₂.`;
}

function stop() {
  playing = false; lastFrame = null;
  cancelAnimationFrame(animation);
  $('play').textContent = '▶ Sweep evolution';
  $('play').setAttribute('aria-pressed', 'false');
}
function animate(timestamp) {
  if (!playing) return;
  if (lastFrame !== null) {
    const slider = $('progress'), max = modes[mode].max;
    slider.value = (number('progress') + Math.min(timestamp - lastFrame, 100) / 10000 * max);
    if (number('progress') >= max) { render(); stop(); return; }
    render();
  }
  lastFrame = timestamp;
  animation = requestAnimationFrame(animate);
}
$('play').addEventListener('click', () => {
  if (playing) return stop();
  if (number('progress') >= modes[mode].max) $('progress').value = 0;
  stage = modes[mode].stages.length - 1;
  playing = true;
  $('play').textContent = 'Ⅱ Pause evolution';
  $('play').setAttribute('aria-pressed', 'true');
  animation = requestAnimationFrame(animate);
});
document.querySelectorAll('[data-mode]').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
document.querySelector('.mode-switch').addEventListener('keydown', event => {
  const tabs = [...document.querySelectorAll('[data-mode]')];
  let index = tabs.findIndex(tab => tab.dataset.mode === mode);
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.length - 1;
  else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  setMode(tabs[index].dataset.mode, true);
});
$('stages').addEventListener('click', event => {
  const button = event.target.closest('[data-stage]');
  if (!button) return;
  stop(); stage = Number(button.dataset.stage); render();
});
['input', 'preparation', 'progress', 'phase', 'detuning', 'j', 'offset', 'echo', 't2', 'read-pulse', 'matrix-view'].forEach(id => {
  $(id).addEventListener(['SELECT', 'INPUT'].includes($(id).tagName) && $(id).type !== 'checkbox' ? 'input' : 'change', () => {
    stop();
    if (id === 'preparation' && number('preparation') === 0) $('matrix-view').value = 'actual';
    render();
  });
});
['zero', 'half', 'ideal'].forEach((id, i) => $(id).addEventListener('click', () => {
  stop(); $('progress').value = modes[mode].defaults[i]; stage = modes[mode].stages.length - 1; render();
}));
$('reset').addEventListener('click', () => {
  $('preparation').value = '1'; $('j').value = '215'; $('phase').value = '0'; $('detuning').value = '0';
  $('offset').value = '100'; $('echo').checked = true; $('t2').value = '40'; $('read-pulse').value = 'y'; $('matrix-view').value = 'actual';
  setMode(mode);
});
let resizeFrame;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
setMode(mode);
