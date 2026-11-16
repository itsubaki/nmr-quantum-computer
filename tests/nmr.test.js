import test from 'node:test';
import assert from 'node:assert/strict';
import {
  complex, identity, multiply, dagger, inputVector, density, transform,
  transformVector, onSpin, rotation, H, rfUnitary, freeUnitary, cnotStages,
  cnotVector, refocusStages, readoutState, dephase, populations, purity,
  fidelityWithPure, bloch, signal, spectralLines, spectrumAt, fidAt
} from '../public/nmr.js';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function matrixNear(actual, expected, tolerance = 1e-10) {
  actual.forEach((row, i) => row.forEach((a, j) => a.forEach((v, k) => near(v, expected[i][j][k], tolerance))));
}
const state = (name, epsilon = 1) => density(inputVector(name), epsilon);

test('RF and free-evolution operators are unitary, including detuning', () => {
  [rfUnitary(1.7, 0.6, -1.8), freeUnitary(0.013, 215, 127, -52), onSpin(H, 1)].forEach(u => matrixNear(multiply(u, dagger(u)), identity(4)));
});

test('on-resonance pi pulse flips A; a y pi/2 pulse creates +x magnetization', () => {
  const flipped = transform(state('00'), rfUnitary(Math.PI));
  populations(flipped).forEach((p, i) => near(p, i === 2 ? 1 : 0));
  const tipped = transform(state('00'), rfUnitary(Math.PI / 2, Math.PI / 2));
  bloch(tipped, 0).forEach((v, i) => near(v, i === 0 ? 1 : 0));
  bloch(tipped, 1).forEach((v, i) => near(v, i === 2 ? 1 : 0));
});

test('off-resonance excitation agrees with the analytic Rabi formula', () => {
  for (const delta of [-2, -0.3, 0, 1.4]) {
    const angle = 2.1;
    const output = transform(state('00'), rfUnitary(angle, 0, delta));
    near(populations(output)[2], Math.sin(angle * Math.sqrt(1 + delta ** 2) / 2) ** 2 / (1 + delta ** 2));
  }
});

test('compiled Hadamard RF pulses agree with H up to global phase', () => {
  const compiled = multiply(rotation([0, 1, 0], Math.PI / 2), rotation([0, 0, 1], Math.PI));
  matrixNear(transform(state('plusplus'), onSpin(compiled, 1)), transform(state('plusplus'), onSpin(H, 1)));
});

test('CNOT truth table for all four inputs at t = 1/(2J)', () => {
  for (const [input, output] of [['00', '00'], ['01', '01'], ['10', '11'], ['11', '10']]) {
    const result = cnotStages(state(input), 215, 1).at(-1);
    matrixNear(result, state(output));
  }
});

test('CNOT preserves relative phases for complex superpositions and all polarizations', () => {
  const vector = [complex(0.5), complex(0, 0.5), complex(-0.5), complex(0, -0.5)];
  for (const epsilon of [0, 1e-5, 0.1, 1]) {
    for (const j of [10, 215, 300]) {
      matrixNear(cnotStages(density(vector, epsilon), j).at(-1), density(cnotVector(vector), epsilon));
    }
  }
});

test('|+0> produces Bell coherences, not only the correct populations', () => {
  const result = cnotStages(state('plus0')).at(-1);
  near(result[0][0][0], 0.5); near(result[3][3][0], 0.5);
  near(result[0][3][0], 0.5); near(result[0][3][1], 0);
  [0, 1].forEach(spin => bloch(result, spin).forEach(v => near(v, 0)));
  near(purity(result), 1);
});

test('half CNOT delay has the expected Bell-output overlap', () => {
  near(fidelityWithPure(cnotStages(state('plus0'), 215, 0.5).at(-1), cnotVector(inputVector('plus0'))), (2 + Math.SQRT2) / 4);
});

test('pseudopure populations, purity and ideal-output overlap include the identity background', () => {
  for (const epsilon of [0, 1e-5, 0.1, 1]) {
    const result = cnotStages(state('plus0', epsilon)).at(-1);
    near(purity(result), (1 + 3 * epsilon ** 2) / 4);
    near(fidelityWithPure(result, cnotVector(inputVector('plus0'))), (1 + 3 * epsilon) / 4);
    near(populations(result)[1], (1 - epsilon) / 4);
  }
  assert.throws(() => density(inputVector('00'), -0.1), RangeError);
});

test('refocusing cancels both A offset and ZZ coupling for arbitrary inputs and times', () => {
  const vector = [complex(0.5), complex(0, 0.5), complex(0.5), complex(0, -0.5)];
  for (const time of [0, 0.0003, 0.01, 0.019]) {
    for (const epsilon of [1e-5, 0.1, 1]) {
      const initial = density(vector, epsilon);
      matrixNear(refocusStages(initial, time, 215, -137, true).at(-1), initial);
      matrixNear(refocusStages(initial, time, 215, -137, false).at(-1), transform(initial, freeUnitary(time, 215, -137)));
    }
  }
});

test('refocusing is distinct from free precession for a transverse spin', () => {
  const initial = state('plus0');
  near(fidelityWithPure(refocusStages(initial, 0.007, 215, 100, true).at(-1), inputVector('plus0')), 1);
  assert.ok(fidelityWithPure(refocusStages(initial, 0.007, 215, 100, false).at(-1), inputVector('plus0')) < 0.5);
});

test('pure dephasing preserves populations and damps two-spin coherence twice as fast', () => {
  const bell = cnotStages(state('plus0')).at(-1);
  const decayed = dephase(bell, 0.04, 0.04);
  near(decayed[0][3][0], 0.5 * Math.exp(-2));
  populations(decayed).forEach((v, i) => near(v, populations(bell)[i]));
  near(purity(decayed), (1 + Math.exp(-4)) / 2);
});

test('FID of one conditional coherence has frequency delta + J/2 and decay T2', () => {
  const prepared = transform(state('00', 0.1), rfUnitary(Math.PI / 2, Math.PI / 2));
  const t = 0.003, t2 = 0.04, f = 100 + 215 / 2;
  const s = signal(readoutState(prepared, t, 215, 100, t2));
  near(s[0], 0.1 * Math.exp(-t / t2) * Math.cos(2 * Math.PI * f * t));
  near(s[1], 0.1 * Math.exp(-t / t2) * Math.sin(2 * Math.PI * f * t));
});

test('|++> gives an equal doublet; longitudinal and maximally mixed inputs give no signal', () => {
  const lines = spectralLines(state('plusplus'), 215, 100);
  near(lines[0].frequency - lines[1].frequency, 215);
  lines.forEach(line => near(line.amplitude[0], 0.5));
  for (const time of [0, 0.02, 0.08]) {
    signal(readoutState(state('00'), time)).forEach(v => near(v, 0));
    signal(readoutState(state('plusplus', 0), time)).forEach(v => near(v, 0));
  }
});

test('analytic spectrum has unit on-resonance height and FWHM 1/(pi T2)', () => {
  const t2 = 0.04;
  const lines = [{ frequency: 72, amplitude: complex(1) }];
  near(spectrumAt(72, lines, t2)[0], 1);
  near(spectrumAt(72, lines, t2)[1], 0);
  near(spectrumAt(72 + 1 / (2 * Math.PI * t2), lines, t2)[0], 0.5);
});

test('fast analytic FID matches full density-matrix propagation including complex coherences', () => {
  const prepared = transform(state('plusplus', 0.1), rfUnitary(1.2, 0.7, 0.3));
  const lines = spectralLines(prepared, 117, -87);
  for (const time of [0, 0.001, 0.01, 0.04, 0.08]) {
    const full = signal(readoutState(prepared, time, 117, -87, 0.02));
    fidAt(time, lines, 0.02).forEach((v, i) => near(v, full[i]));
  }
});

test('readout keeps density matrix Hermitian with trace 1', () => {
  const initial = transform(state('plusplus', 0.1), rfUnitary(1.2, 0.7, 0.3));
  for (const time of [0, 0.004, 0.08]) {
    const result = readoutState(initial, time);
    matrixNear(result, dagger(result));
    near(populations(result).reduce((a, b) => a + b), 1);
    assert.ok(purity(result) >= 0.25 - 1e-12 && purity(result) <= 1);
  }
});
