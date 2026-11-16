// Two spin-1/2 nuclei. Basis: |00>, |01>, |10>, |11>; A is the first bit.
// Frequencies J and offsets are in Hz; all times are in seconds.
export const complex = (re = 0, im = 0) => [re, im];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const scale = (a, s) => [a[0] * s, a[1] * s];
export const multiplyComplex = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const conjugate = a => [a[0], -a[1]];
export const magnitude = a => Math.hypot(...a);
export const identity = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => complex(i === j ? 1 : 0)));
export const dagger = a => a[0].map((_, j) => a.map(row => conjugate(row[j])));
export function multiply(a, b) {
  return a.map(row => b[0].map((_, j) => row.reduce((sum, value, k) => add(sum, multiplyComplex(value, b[k][j])), complex())));
}
export function tensor(a, b) {
  return a.flatMap(rowA => b.map(rowB => rowA.flatMap(value => rowB.map(other => multiplyComplex(value, other)))));
}
export const I = identity(2);
export const X = [[complex(), complex(1)], [complex(1), complex()]];
export const Y = [[complex(), complex(0, -1)], [complex(0, 1), complex()]];
export const Z = [[complex(1), complex()], [complex(), complex(-1)]];
export const H = [[complex(Math.SQRT1_2), complex(Math.SQRT1_2)], [complex(Math.SQRT1_2), complex(-Math.SQRT1_2)]];
export const onSpin = (operator, spin = 0) => spin === 0 ? tensor(operator, I) : tensor(I, operator);

export function rotation(axis, angle) {
  const length = Math.hypot(...axis);
  if (length === 0) return I;
  const [x, y, z] = axis.map(v => v / length);
  const c = Math.cos(angle / 2), s = Math.sin(angle / 2);
  return [[complex(c, -s * z), complex(-s * y, -s * x)], [complex(s * y, -s * x), complex(c, s * z)]];
}
export function inputVector(name) {
  const basis = { '00': 0, '01': 1, '10': 2, '11': 3 };
  if (name in basis) return Array.from({ length: 4 }, (_, i) => complex(i === basis[name] ? 1 : 0));
  if (name === 'plus0') return [complex(Math.SQRT1_2), complex(), complex(Math.SQRT1_2), complex()];
  if (name === 'plusplus') return Array.from({ length: 4 }, () => complex(0.5));
  throw new RangeError(`Unknown input state: ${name}`);
}
export function density(vector, epsilon = 1) {
  if (!(epsilon >= 0 && epsilon <= 1)) throw new RangeError('Polarization must lie between 0 and 1.');
  return vector.map((a, i) => vector.map((b, j) => add(scale(multiplyComplex(a, conjugate(b)), epsilon), complex(i === j ? (1 - epsilon) / 4 : 0))));
}
export const transform = (rho, u) => multiply(multiply(u, rho), dagger(u));
export const transformVector = (v, u) => multiply(u, v.map(a => [a])).map(row => row[0]);
export const populations = rho => rho.map((row, i) => Math.max(0, Math.min(1, row[i][0])));
export function fidelityWithPure(rho, vector) {
  const result = vector.reduce((sum, a, i) => add(sum, rho[i].reduce((s, b, j) => add(s, multiplyComplex(multiplyComplex(conjugate(a), b), vector[j])), complex())), complex())[0];
  return Math.max(0, Math.min(1, result));
}
export function purity(rho) {
  return rho.flat().reduce((sum, a) => sum + magnitude(a) ** 2, 0);
}
export function bloch(rho, spin = 0) {
  return [X, Y, Z].map(p => {
    const product = multiply(rho, onSpin(p, spin));
    return product.reduce((sum, row, i) => sum + row[i][0], 0);
  });
}
export const cnotVector = vector => [vector[0], vector[1], vector[3], vector[2]];

export function freeUnitary(time, j = 215, offsetA = 0, offsetB = 0) {
  const energies = [1, 1, -1, -1].map((za, i) => {
    const zb = i % 2 === 0 ? 1 : -1;
    return Math.PI * (offsetA * za + offsetB * zb + j * za * zb / 2);
  });
  return energies.map((energy, i) => energies.map((_, k) => i === k ? complex(Math.cos(energy * time), -Math.sin(energy * time)) : complex()));
}

// Positive J evolution gives exp(-i pi ZZ/4) at t = 1/(2J).
// Fixed local Z corrections convert it to CZ, up to a global phase.
export function cnotStages(rho, j = 215, ratio = 1) {
  const prepared = transform(rho, onSpin(H, 1));
  const coupled = transform(prepared, freeUnitary(ratio / (2 * j), j));
  const zCorrection = tensor(rotation([0, 0, 1], -Math.PI / 2), rotation([0, 0, 1], -Math.PI / 2));
  const output = transform(transform(coupled, zCorrection), onSpin(H, 1));
  return [rho, prepared, coupled, output];
}
export function rfUnitary(angle, phase = 0, detuningRatio = 0) {
  const axis = [Math.cos(phase), Math.sin(phase), detuningRatio];
  return onSpin(rotation(axis, angle * Math.hypot(...axis)), 0);
}
export function refocusStages(rho, time, j = 215, offset = 120, echo = true) {
  const half = freeUnitary(time / 2, j, offset);
  const pulse = echo ? onSpin(rotation([1, 0, 0], Math.PI), 0) : identity(4);
  const first = transform(rho, half);
  const middle = transform(first, pulse);
  const second = transform(middle, half);
  return [rho, first, middle, second, transform(second, pulse)];
}

// Independent pure dephasing on each spin; diagonals and trace stay unchanged.
// Here T2 is the coherence decay time (T1 is assumed infinite).
export function dephase(rho, time, t2) {
  return rho.map((row, i) => row.map((a, k) => {
    const bits = ((i ^ k) & 1) + (((i ^ k) >> 1) & 1);
    return scale(a, Math.exp(-bits * time / t2));
  }));
}
export function readoutState(rho, time, j = 215, offset = 100, t2 = 0.04) {
  return dephase(transform(rho, freeUnitary(time, j, offset)), time, t2);
}
// Complex receiver convention S = <X_A> + i<Y_A>. This is a quadrature
// choice, rather than the textbook's V proportional to <iX_A + Y_A>.
export function signal(rho) {
  return scale(add(rho[2][0], rho[3][1]), 2);
}
export function spectralLines(rho, j = 215, offset = 100) {
  return [
    { frequency: offset + j / 2, amplitude: scale(rho[2][0], 2), partner: 'B = 0' },
    { frequency: offset - j / 2, amplitude: scale(rho[3][1], 2), partner: 'B = 1' }
  ];
}
export function fidAt(time, lines, t2) {
  return scale(lines.reduce((sum, line) => {
    const phase = 2 * Math.PI * line.frequency * time;
    return add(sum, multiplyComplex(line.amplitude, complex(Math.cos(phase), Math.sin(phase))));
  }, complex()), Math.exp(-time / t2));
}
// Analytic infinite-acquisition Fourier transform of a decaying FID.
// Divided by T2, so a unit on-resonance coherence has unit peak height.
export function spectrumAt(frequency, lines, t2) {
  return lines.reduce((sum, line) => {
    const x = 2 * Math.PI * t2 * (frequency - line.frequency);
    return add(sum, multiplyComplex(line.amplitude, complex(1 / (1 + x * x), -x / (1 + x * x))));
  }, complex());
}
