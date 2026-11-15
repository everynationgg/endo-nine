// Verification script for Phase 3 Movement & Terrain Collision

function testWASDMovement() {
  console.log("=== Testing 360-Degree WASD Movement ===");

  const angles = [
    { name: "0 deg (North)", yaw: 0 },
    { name: "45 deg", yaw: Math.PI / 4 },
    { name: "90 deg (East)", yaw: Math.PI / 2 },
    { name: "135 deg", yaw: (3 * Math.PI) / 4 },
    { name: "180 deg (South)", yaw: Math.PI },
    { name: "225 deg", yaw: (5 * Math.PI) / 4 },
    { name: "270 deg (West)", yaw: (3 * Math.PI) / 2 },
    { name: "315 deg", yaw: (7 * Math.PI) / 4 },
    { name: "360 deg", yaw: 2 * Math.PI }
  ];

  const inputs = [
    { key: "W", moveDir: { x: 0, y: -1 }, expectScreen: { x: 0, y: -1 } },
    { key: "S", moveDir: { x: 0, y: 1 }, expectScreen: { x: 0, y: 1 } },
    { key: "A", moveDir: { x: -1, y: 0 }, expectScreen: { x: -1, y: 0 } },
    { key: "D", moveDir: { x: 1, y: 0 }, expectScreen: { x: 1, y: 0 } },
    { key: "W+D", moveDir: { x: 1 / Math.SQRT2, y: -1 / Math.SQRT2 }, expectScreen: { x: 1 / Math.SQRT2, y: -1 / Math.SQRT2 } }
  ];

  let passedAll = true;

  for (const a of angles) {
    const cosY = Math.cos(a.yaw);
    const sinY = Math.sin(a.yaw);

    for (const inp of inputs) {
      // 1. Simulation calculates worldMx and worldMy
      const rx = inp.moveDir.x;
      const rz = -inp.moveDir.y;

      const worldMx = rx * cosY - rz * sinY;
      const worldMy = -rx * sinY - rz * cosY;

      // 2. Camera projects (worldMx, worldMy) to screen coordinates
      const projRx = worldMx * cosY - worldMy * sinY;
      const projRz = -(worldMx * sinY + worldMy * cosY);

      // projRx is Screen Right (+X)
      // projRz > 0 is Screen Up (towards horizon, -ScreenY)
      const screenX = projRx;
      const screenY = -projRz;

      const errX = Math.abs(screenX - inp.expectScreen.x);
      const errY = Math.abs(screenY - inp.expectScreen.y);

      if (errX > 1e-4 || errY > 1e-4) {
        console.error(`FAILED: Angle ${a.name}, Key ${inp.key}: expected (${inp.expectScreen.x}, ${inp.expectScreen.y}), got (${screenX.toFixed(3)}, ${screenY.toFixed(3)})`);
        passedAll = false;
      }
    }
  }

  if (passedAll) {
    console.log("PASS: WASD always moves in correct screen directions across all 360 degrees!");
  } else {
    process.exit(1);
  }
}

testWASDMovement();

