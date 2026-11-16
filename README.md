# Nuclear magnetic resonance simulator for quantum computation

A browser-based, two-spin teaching simulator for Nielsen & Chuang,
*Quantum Computation and Quantum Information*, §7.7 (Nuclear magnetic resonance).
The HTML/CSS follows the dark palette, panels, controls, and responsive layout of
the companion harmonic-oscillator and optical-photon simulators.

## Run locally

Requires Python 3. No installation, external fonts, JavaScript dependencies, or build step is needed.

```sh
make run
```

Open <http://127.0.0.1:3004/>. Use `make run PORT=3014` if port 3004 is occupied.
Keep the server running while using the page. ES modules require an HTTP server;
opening `public/index.html` directly with `file://` is not supported.

For numerical tests, use Node.js 18 or later:

```sh
make test
```

## Experiments

| Mode | Controls and observations | Textbook connection |
| --- | --- | --- |
| RF rotation | RF phase, nominal rotation angle, detuning; reduced Bloch vectors | §7.7.2, single-spin rotating-frame dynamics |
| J-coupled CNOT | J in Hz, interaction time, intermediate observation points; populations and complex density matrix | §7.7.3, controlled gates |
| Refocusing | Offset of A, wait time, pulses on/off; recovery of the input | §7.7.3, refocusing |
| NMR readout | Read pulse, J, offset, acquisition time, T2; FID and phase-sensitive spectrum | §7.7.2, magnetization readout and decoherence |

The interface uses English to match the companion simulators.

Suggested walkthrough:

1. In **J-coupled CNOT**, keep input `|+0⟩` and choose the CNOT time. Populations
   are 50% `|00⟩` and 50% `|11⟩`, with an off-diagonal coherence of 0.5. Each
   reduced Bloch vector vanishes, as expected for the Bell state.
2. Select a pseudopure preparation. Compare **Actual ρ** with **(ρ − I/4)/ε**.
   The latter also expands the Bloch vectors, but populations and the overlap
   always describe the actual state.
3. In **RF rotation**, apply a π pulse to `|00⟩`, then increase the detuning.
   On resonance, A flips; off resonance, excitation is suppressed.
4. In **Refocusing**, toggle the two π pulses. With pulses, both A's frequency
   offset and its coupling to B cancel after the complete sequence.
5. In **NMR readout**, `|00⟩` with a y read pulse gives one conditional line.
   Select `|++⟩` and no read pulse for a doublet separated by J. A longitudinal
   input without a read pulse gives no signal.

## Model and conventions

The basis is `|00⟩, |01⟩, |10⟩, |11⟩`; A (¹H) is the first bit and control,
and B (¹³C) is the second bit and target. Z is the Pauli matrix, with eigenvalues
+1 and −1. Two-spin states are full 4 × 4 complex density matrices.

Frequencies J and δ are in **Hz**, and simulation times are in **seconds**:

```text
Hfree / ℏ = π δA ZA + π δB ZB + (π J / 2) ZA ZB
U(t)      = exp(−i Hfree t / ℏ)
δB        = 0
```

This is the usual weak-coupling form `2π J IzA IzB`, where `Iz = Z/2`.
It corresponds to Eq. (7.138) with its coupling parameter expressed as an angular
frequency, `Jangular = 2π JHz`. Numerical values must be converted with this
convention before comparing expressions elsewhere in the chapter.
The default J = 215 Hz is the chloroform proton–carbon coupling discussed in §7.7.4.

### RF and CNOT

```text
HRF / ℏ = [Δ Z + Ω(cos φ X + sin φ Y)] / 2
θ = Ω t, Ω/(2π) = 1000 Hz

UZZ(t) = exp(−i π J t ZA ZB / 2)
tCNOT  = 1/(2J) = 2.32558… ms for J = 215 Hz
```

The chronological sequence is `HB → UZZ(t) → RAz(−π/2) RBz(−π/2) → HB`.
At the CNOT time this equals CNOT up to a global phase. The Hadamards can be
compiled as `H ∝ Ry(π/2) Rz(π)`, with Z as an ideal frame rotation. These local
corrections remain fixed when sweeping t, so the complete sequence at t = 0 is
not the identity.

RF pulses act selectively and ignore free evolution during the pulse. The RF
mode includes detuning exactly for a constant rotating-frame drive. Gate modes
use instantaneous ideal pulses and exclude relaxation.

### Refocusing

The time-ordered sequence is `wait t/2 → RxA(π) → wait t/2 → RxA(π)`.
The X pulses reverse both `ZA` and `ZA ZB`, canceling their evolution over the
whole sequence up to a global phase. A nonzero `ZB` term would survive; it is
zero here. The last pulse restores the original spin frame.

### Pseudopure states

```text
ρ = (1 − ε) I/4 + ε |ψ⟩⟨ψ|
```

Prepared pseudopure inputs are provided; thermal equilibrium, labeling protocols,
and polarization from a particular temperature/field are not simulated.
ε = 0.1 exaggerates the signal for teaching; ε = 10⁻⁵ illustrates small polarization.
The expanded deviation `(ρ − I/4)/ε` has trace zero and is not a density matrix.
It does not remove the mixed-state background from actual probabilities or fidelity.
For a Bell component this family is entangled only when ε > 1/3.

The displayed overlap is `F = ⟨ψideal|ρ|ψideal⟩`, with a pure reference:
ideal CNOT output, resonant RF output at the same nominal angle, original input
for refocusing, or the just-prepared readout input. It is not a process fidelity.
At an ideal pseudopure output, `F = (1 + 3ε)/4` and `Tr(ρ²) = (1 + 3ε²)/4`.

### FID and spectrum

The receiver convention is `S = ⟨XA⟩ + i⟨YA⟩`, differing from the textbook's
`⟨iXA + YA⟩` by phase and conjugation. For a prepared density matrix:

```text
S(t) = exp(−t/T2) [2ρ20 exp(i2π(δA + J/2)t)
                  + 2ρ31 exp(i2π(δA − J/2)t)]
```

Each index is a decimal basis index (0 through 3). Independent pure dephasing on
both spins damps a matrix entry by `exp(−d t/T2)`, where d is the Hamming distance
between its row and column basis states. T1 is infinite; populations do not change.

The spectrum is the **analytic infinite-time Fourier transform**, using
`exp(−i2πft)`, divided by `ε T2`. It is not a discrete FFT of the visible 80 ms
FID window. The real and imaginary parts give absorptive and dispersive lines;
the absorptive full width at half maximum is `1/(π T2)`. A transition with zero
coherence has no visible line. For ε = 0 all signals are zero, and the expanded
deviation option is disabled.

## Implementation and validation

- `public/nmr.js`: dependency-free complex linear algebra and two-spin physics.
- `public/app.js`: controls, pulse sequences, Bloch spheres, matrices, and plots.
- `public/styles.css`: responsive styling shared in spirit with the companion projects.
- `tests/nmr.test.js`: 17 numerical tests covering complex CNOT coherences,
  Rabi oscillations, pseudopure states, refocusing, dephasing, and readout.

The full apparatus, labeling, tomography reconstruction, quantum search,
relaxation during gates, imperfect selectivity, and pulse calibration are outside
this model. This is a teaching simulator, not spectrometer control software.

## 日本語

ニールセン＆チャンの7.7節にある核スピンの回転、J結合によるCNOT、
リフォーカシング、NMR信号の読み出しを、2量子ビットの密度行列で計算します。
既存の調和振動子・光子シミュレータと配色やレイアウトをそろえています。
`make run` で起動し、上記のローカルURLを開いてください。
擬純粋状態の「偏差を拡大した表示」と実際の状態を区別して観察できます。
