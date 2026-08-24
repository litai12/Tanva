import assert from "node:assert/strict";
import {
  isLoopbackHostname,
  originsShareHost,
  resolveOriginHostname,
} from "./cors-origin";

assert.equal(
  originsShareHost("http://localhost:5174", "http://127.0.0.1:5174"),
  true
);
assert.equal(
  originsShareHost("http://localhost:5174", "http://[::1]:5174"),
  true
);
assert.equal(
  originsShareHost("https://tanvas.cn", "https://attacker.example"),
  false
);
assert.equal(resolveOriginHostname("HTTP://LOCALHOST:5174/path"), "localhost");
assert.equal(isLoopbackHostname("[::1]"), true);

console.log("cors origin helper tests passed");
