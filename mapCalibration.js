const MAP_CALIBRATION = Object.freeze({
  width: 2048,
  height: 2048,
  uX: -0.00134396890,
  uY: 0.0000000676414083,
  u0: 831.454665,
  vX: -0.00000000142817301,
  vY: -0.00134384750,
  v0: 831.522683,
});

const SECTOR_ROWS = Object.freeze(['D', 'C', 'B', 'A', 'Z']);
const SECTOR_COLS = Object.freeze(['4', '3', '2', '1', '0']);

function worldToMap(x, y) {
  const wx = Number(x);
  const wy = Number(y);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  return {
    x: MAP_CALIBRATION.uX * wx + MAP_CALIBRATION.uY * wy + MAP_CALIBRATION.u0,
    y: MAP_CALIBRATION.vX * wx + MAP_CALIBRATION.vY * wy + MAP_CALIBRATION.v0,
  };
}

function mapToWorld(mapX, mapY) {
  const u = Number(mapX) - MAP_CALIBRATION.u0;
  const v = Number(mapY) - MAP_CALIBRATION.v0;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  const det = MAP_CALIBRATION.uX * MAP_CALIBRATION.vY - MAP_CALIBRATION.uY * MAP_CALIBRATION.vX;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  return {
    x: (u * MAP_CALIBRATION.vY - MAP_CALIBRATION.uY * v) / det,
    y: (MAP_CALIBRATION.uX * v - u * MAP_CALIBRATION.vX) / det,
  };
}

function mapPointData(x, y) {
  const point = worldToMap(x, y);
  if (!point) return null;
  if (point.x < 0 || point.y < 0 || point.x > MAP_CALIBRATION.width || point.y > MAP_CALIBRATION.height) return null;
  const tileW = MAP_CALIBRATION.width / 5;
  const tileH = MAP_CALIBRATION.height / 5;
  const col = Math.max(0, Math.min(4, Math.floor(point.x / tileW)));
  const row = Math.max(0, Math.min(4, Math.floor(point.y / tileH)));
  return {
    map_x: point.x,
    map_y: point.y,
    sector_col: col,
    sector_row: row,
    sector: `${SECTOR_ROWS[row]}${SECTOR_COLS[col]}`,
    local_x_pct: ((point.x - col * tileW) / tileW) * 100,
    local_y_pct: ((point.y - row * tileH) / tileH) * 100,
  };
}

module.exports = { MAP_CALIBRATION, SECTOR_ROWS, SECTOR_COLS, worldToMap, mapToWorld, mapPointData };
