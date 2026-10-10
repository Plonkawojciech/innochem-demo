import test from "node:test";
import assert from "node:assert/strict";
import { isQaMail } from "../lib/server/qa-mail";

test("the explicit TEST subject marker is case-insensitive and address-independent", () => {
  for (const subject of [
    "[TEST] SMTP receipt",
    "  [test] SMTP receipt  ",
    "INNOCHEM — [TeSt] queued receipt",
    "INNOCHEM — receipt [TEST]",
  ])
    assert.equal(isQaMail(subject, "Synthetic body"), true, subject);
});

test("a TEST marker at the first nonempty body line marks automated QA", () => {
  for (const body of [
    "[TEST]\nSynthetic receipt",
    "  [test] Synthetic receipt  \nSecond line",
    "\n\t\n [TeSt] Synthetic receipt\nSecond line",
    "\r\n \r\n\t[TEST] Synthetic receipt",
    "\r \r[TEST] Synthetic receipt",
  ])
    assert.equal(isQaMail("INNOCHEM — receipt", body), true, body);
});

test("an ordinary customer order can quote TEST later without becoming QA", () => {
  for (const body of [
    "Zamówienie INNOCHEM 42\n\n[TEST] quoted customer note",
    "\n  \nZamówienie INNOCHEM 42\r\n[TeSt] quoted customer note",
    "Zamówienie INNOCHEM 42\nNotatka klienta: [TEST] próbka",
    "Customer quote: [TEST] is only quoted text on this line",
  ])
    assert.equal(isQaMail("INNOCHEM — zamówienie 42", body), false, body);
});

test("normal order, payment, shipment and account correspondence stays ordinary", () => {
  for (const subject of [
    "INNOCHEM — zamówienie 42",
    "INNOCHEM — płatność za zamówienie 42",
    "INNOCHEM — zamówienie 42 wysłane",
    "INNOCHEM — zmiana hasła",
    "Test produktu bez automatycznego markera",
  ])
    assert.equal(isQaMail(subject, "Zwykła wiadomość klienta"), false, subject);
  assert.equal(isQaMail("INNOCHEM", "\n \t\r\n"), false);
});
