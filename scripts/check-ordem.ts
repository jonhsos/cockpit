import assert from "node:assert/strict";
import { aplicarOrdem, moverAntesOuDepois, metadeDepois } from "../web/ordem.ts";

console.log("Verificando reordenação tipo Kanban...");

assert.deepEqual(aplicarOrdem(["a", "b", "c"], []), ["a", "b", "c"]);
assert.deepEqual(aplicarOrdem(["a", "b", "c"], ["c", "a"]), ["c", "a", "b"]);
assert.deepEqual(aplicarOrdem(["a", "b"], ["c", "a", "x"]), ["a", "b"]);
assert.deepEqual(aplicarOrdem(["a", "b", "c"], ["b", "b", "a"]), ["b", "a", "c"]);

assert.deepEqual(moverAntesOuDepois(["a", "b", "c"], "a", "c", false), ["b", "a", "c"]);
assert.deepEqual(moverAntesOuDepois(["a", "b", "c"], "a", "c", true), ["b", "c", "a"]);
assert.deepEqual(moverAntesOuDepois(["a", "b", "c"], "c", "a", false), ["c", "a", "b"]);
assert.deepEqual(moverAntesOuDepois(["a", "b", "c"], "a", "a", true), ["a", "b", "c"]);

const box = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 } as DOMRect;
assert.equal(metadeDepois({ clientX: 10, clientY: 80 }, box, "y"), true);
assert.equal(metadeDepois({ clientX: 10, clientY: 20 }, box, "y"), false);
assert.equal(metadeDepois({ clientX: 80, clientY: 10 }, box, "x"), true);

console.log("PASS: check-ordem.ts — arrastar missão e painel reordena a lista.");
