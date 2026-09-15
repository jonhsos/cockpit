import { Router } from "express";
import express from "express";
import { transcrever } from "../providers/voz.ts";

export function createVoiceRouter(): Router {
  const router = Router();

  // PCM cru: o navegador já decodificou para mono 16kHz, então aqui não é
  // preciso codec nenhum. 30s de fala dão ~2MB.
  router.post(
    "/voz",
    express.raw({ type: "application/octet-stream", limit: "40mb" }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Payload de áudio inválido ou vazio" });
        return;
      }
      const bytes = req.body as Buffer;
      const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      transcrever(pcm, req.query.traduzir === "1").then(
        (texto) => res.json({ texto }),
        (err: Error) => res.status(400).json({ error: err instanceof Error ? err.message : String(err) }),
      );
    },
  );

  return router;
}
