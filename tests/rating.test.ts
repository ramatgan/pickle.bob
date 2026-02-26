import test from "node:test";
import assert from "node:assert/strict";
import { buildRatingEditAdjustments } from "../lib/rating";

test("rating edit adjustments apply only net delta differences per player", () => {
  const adjustments = buildRatingEditAdjustments({
    playerIds: ["p1", "p2", "p3", "p4"],
    oldDeltas: {
      p1: 0.1,
      p2: 0.1,
      p3: -0.1,
      p4: -0.1
    },
    newDeltas: {
      p1: 0.05,
      p2: 0.12,
      p3: -0.07,
      p4: -0.1
    }
  });

  assert.equal(adjustments.length, 3);
  assert.equal(adjustments[0].playerId, "p1");
  assert.equal(adjustments[1].playerId, "p2");
  assert.equal(adjustments[2].playerId, "p3");
  assert.ok(Math.abs(adjustments[0].delta - -0.05) < 1e-12);
  assert.ok(Math.abs(adjustments[1].delta - 0.02) < 1e-12);
  assert.ok(Math.abs(adjustments[2].delta - 0.03) < 1e-12);
});

test("rating edit adjustments drop effectively-zero delta changes", () => {
  const adjustments = buildRatingEditAdjustments({
    playerIds: ["p1"],
    oldDeltas: { p1: 0.2 },
    newDeltas: { p1: 0.2000000000001 }
  });

  assert.deepEqual(adjustments, []);
});
