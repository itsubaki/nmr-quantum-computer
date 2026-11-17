const basis = ['00', '01', '10', '11'];

// Orthographic projection: columns run right, rows run left, positive values up.
export function matrixBarSvg(matrix, component = 0, representation = 'ρ') {
  const project = (column, row, value = 0) => [230 + 36 * (column - row), 190 + 17 * (column + row) - 110 * value];
  const point = p => p.join(',');
  const path = points => points.map((p, i) => `${i ? 'L' : 'M'}${point(p)}`).join('');
  const line = (a, b, extra = '') => `<path d="${path([a, b])}" ${extra}/>`;
  const text = (p, value, extra = '') => `<text x="${p[0]}" y="${p[1]}" ${extra}>${value}</text>`;
  const polygon = (points, fill) => `<polygon points="${points.map(point).join(' ')}" fill="${fill}"/>`;
  const label = `${component === 0 ? 'Real' : 'Imaginary'} part of ${representation}`;
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    grid += line(project(i, 0), project(i, 4)) + line(project(0, i), project(4, i));
  }
  let ticks = '';
  for (const value of [-1, -0.5, 0, 0.5, 1]) {
    ticks += line(project(-0.35, 0, value), project(-0.35, 4, value), 'stroke-dasharray="3 4" opacity=".5"');
    ticks += line(project(-0.5, 4, value), project(-0.35, 4, value));
    const p = project(-0.65, 4, value);
    ticks += text([p[0] - 4, p[1] + 4], value.toFixed(1), 'text-anchor="end"');
  }
  let labels = '';
  basis.forEach((b, i) => {
    const column = project(i + 0.5, 5), row = project(5, i + 0.5);
    // Keep basis labels below negative coherences at the edges of the grid.
    labels += text([column[0], column[1] + 65], `|${b}⟩`, 'text-anchor="middle"') + text([row[0], row[1] + 65], `⟨${b}|`, 'text-anchor="middle"');
  });
  labels += text([135, 435], 'Column', 'text-anchor="middle"') + text([325, 435], 'Row', 'text-anchor="middle"');
  const entries = matrix.flatMap((row, r) => row.map((entry, c) => ({ r, c, value: entry[component] })));
  // Paint the farthest cells first so the front bars occlude the back bars.
  entries.sort((a, b) => (a.r + a.c) - (b.r + b.c) || a.r - b.r);
  const bars = entries.map(({ r, c, value }) => {
    const x = c + 0.12, y = r + 0.12, endX = c + 0.88, endY = r + 0.88;
    const positive = value >= 0;
    const palette = positive ? ['#80baff', '#467db4', '#315b86'] : ['#c7b0ff', '#8c70bf', '#63518b'];
    const bottom = Math.min(0, value), top = Math.max(0, value);
    const face = polygon([project(x, endY, bottom), project(endX, endY, bottom), project(endX, endY, top), project(x, endY, top)], palette[1])
      + polygon([project(endX, y, bottom), project(endX, endY, bottom), project(endX, endY, top), project(endX, y, top)], palette[2])
      + polygon([project(x, y, top), project(endX, y, top), project(endX, endY, top), project(x, endY, top)], Math.abs(value) < 1e-12 ? '#182637' : palette[0]);
    const formatted = Math.abs(value) < 1e-12 ? '0' : Number(value.toPrecision(6)).toString();
    return `<g class="matrix-bar" data-row="${r}" data-column="${c}" data-value="${value}" aria-label="Row ${basis[r]}, column ${basis[c]}: ${formatted}"><title>Row ${basis[r]}, column ${basis[c]}: ${formatted}</title>${face}</g>`;
  }).join('');
  return `<svg viewBox="0 0 460 500" role="img" aria-label="${label}; signed 3D bars with a fixed scale from minus one to one"><title>${label}</title><g class="matrix-chart-grid">${ticks}${line(project(-0.35, 4, -1), project(-0.35, 4, 1))}${grid}</g>${bars}<g class="matrix-chart-labels">${labels}${text([230, 30], label, 'text-anchor="middle" class="matrix-chart-title"')}</g></svg>`;
}
