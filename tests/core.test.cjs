const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../extension/core");
const at = (h, m = 0, d = 4) => +new Date(2026, 10, d, h, m);
function state() {
  const s = C.initial();
  s.welcomeAvailable = false;
  return s;
}
function frozen(s, now = at(9)) {
  s.session.phase = "loading";
  C.freeze(s, [{ id: "123" }], now);
}
test("scheduled start requires deliberate action, one session per slot", () => {
  const s = state();
  assert.equal(C.availability(s, at(8)).current, null);
  assert.throws(() => C.begin(s, at(8), 1));
  assert.ok(C.availability(s, at(9)).current);
  C.begin(s, at(9), 1);
  assert.throws(() => C.begin(s, at(9, 1), 2));
  frozen(s);
  s.session.ended = true;
  assert.throws(() => C.begin(s, at(9, 2), 2));
  assert.equal(C.availability(s, at(9, 2)).next.start, at(18));
  C.begin(s, at(18), 2);
  frozen(s, at(18));
  assert.equal(s.used.length, 2);
});
test("refresh and browser restart retain the batch and consumed slot", () => {
  const s = state();
  C.begin(s, at(9), 1);
  s.session.phase = "frozen";
  s.session.posts = [{ id: "123" }];
  const loaded = JSON.parse(JSON.stringify(s));
  assert.deepEqual(C.view(loaded, at(9, 2)).session.posts, [{ id: "123" }]);
  loaded.session.ended = true;
  assert.equal(C.view(loaded, at(9, 3)).available, false);
});
test("active time is shared, duplicate tab heartbeats do not multiply it", () => {
  const s = state();
  C.begin(s, at(9), 1);
  frozen(s);
  C.pulse(s, at(9) + 1000);
  C.pulse(s, at(9) + 1000);
  assert.equal(s.session.activeMs, 1000);
  C.pulse(s, at(9, 5));
  assert.equal(s.session.activeMs, 3000); // returning after absence counts at most two seconds
  s.session.activeMs = 599500;
  C.pulse(s, at(9, 5) + 1000);
  assert.equal(s.session.ended, true);
});
test("wall clock safety limit ends an abandoned edition", () => {
  const s = state();
  C.begin(s, at(9), 1);
  frozen(s);
  C.settle(s, at(10));
  assert.equal(s.session.ended, true);
});
test("schedule changes after a consumed session wait until next local day", () => {
  const s = state();
  const changed = { ...C.DEFAULTS, times: ["13:00"] };
  C.saveSettings(s, changed, at(8));
  assert.deepEqual(s.settings.times, ["13:00"]);
  C.begin(s, at(13), 1);
  frozen(s, at(13));
  s.session.ended = true;
  C.saveSettings(s, { ...C.DEFAULTS, times: ["14:00"] }, at(13, 5));
  assert.deepEqual(s.settings.times, ["13:00"]);
  assert.equal(C.availability(s, at(14)).current, null);
  C.settle(s, at(0, 0, 5));
  assert.deepEqual(s.settings.times, ["14:00"]);
  assert.equal(s.pending, null);
});
test("overlapping windows cannot unlock a previous slot after finishing", () => {
  const s = state();
  s.settings.times = ["09:00", "09:30"];
  C.begin(s, at(9, 40), 1);
  frozen(s, at(9, 40));
  s.session.ended = true;
  assert.equal(C.availability(s, at(9, 41)).current, null);
});
test("overnight window belongs to its starting day", () => {
  const s = state();
  s.settings.times = ["23:30"];
  C.begin(s, at(0, 10, 5), 1);
  assert.match(s.session.id, /2026-11-04\/23:30/);
});
test("validation refuses impossible limits and malformed schedules", () => {
  for (const times of [
    [],
    ["25:00"],
    ["9:00"],
    Array(7)
      .fill("")
      .map((_, i) => `0${i}:00`),
  ])
    assert.throws(() => C.validate({ ...C.DEFAULTS, times }));
  for (const activeMinutes of [0, 31, NaN, 2.5])
    assert.throws(() => C.validate({ ...C.DEFAULTS, activeMinutes }));
});

test("late starts get the full active budget, separate from opening window", () => {
  const s = state();
  C.begin(s, at(9, 59), 1);
  frozen(s, at(9, 59));
  C.settle(s, at(10, 2));
  assert.equal(s.session.ended, false);
  assert.equal(s.session.endsAt, at(10, 44));
});
test("failed capture never consumes a scheduled edition", () => {
  const s = state();
  C.begin(s, at(9), 1);
  C.settle(s, at(9) + 21000);
  assert.equal(s.session.phase, "error");
  assert.deepEqual(s.used, []);
  s.session.ended = true;
  assert.ok(C.availability(s, at(9, 1)).current);
  C.begin(s, at(9, 1), 1);
});
test("only the frozen batch consumes the slot; expired captures cannot freeze", () => {
  const s = state();
  C.begin(s, at(9), 1);
  assert.equal(C.freeze(s, [{ id: "1" }], at(9)), false);
  s.session.phase = "loading";
  assert.equal(C.freeze(s, [], at(9)), false);
  assert.deepEqual(s.used, []);
});

test("first use is available immediately, once; failed captures preserve it", () => {
  const s = C.initial();
  assert.equal(C.view(s, at(8)).firstUse, true);
  C.begin(s, at(8), 1);
  C.settle(s, at(8) + 21000);
  assert.equal(s.welcomeAvailable, true);
  s.session.ended = true;
  C.begin(s, at(8, 1), 1);
  frozen(s, at(8, 1));
  s.session.ended = true;
  const loaded = JSON.parse(JSON.stringify(s));
  assert.equal(C.view(loaded, at(8, 2)).available, false);
  assert.equal(C.view(loaded, at(8, 2)).nextAt, at(9));
});
