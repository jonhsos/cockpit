import assert from "node:assert/strict";
import { atalhoDeColar, atalhoDeCopiar } from "../web/clipboard.ts";

function tecla(init: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }) {
  return { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init };
}

console.log("Verificando atalhos de copiar/colar...");

assert.equal(atalhoDeCopiar(tecla({ key: "c", ctrlKey: true })), true);
assert.equal(atalhoDeCopiar(tecla({ key: "C", ctrlKey: true, shiftKey: true })), true);
assert.equal(atalhoDeCopiar(tecla({ key: "Insert", ctrlKey: true })), true);
assert.equal(atalhoDeCopiar(tecla({ key: "c" })), false);
assert.equal(atalhoDeCopiar(tecla({ key: "c", ctrlKey: true, altKey: true })), false);

assert.equal(atalhoDeColar(tecla({ key: "v", ctrlKey: true, shiftKey: true })), true);
assert.equal(atalhoDeColar(tecla({ key: "Insert", shiftKey: true })), true);
assert.equal(atalhoDeColar(tecla({ key: "v", ctrlKey: true })), false);

console.log("PASS: check-clipboard.ts — atalhos de copiar e colar verificados.");
