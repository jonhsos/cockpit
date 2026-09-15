/**
 * Transcrição local. O Whisper roda aqui no servidor, com o runtime nativo do
 * ONNX — o runtime WebAssembly do navegador não consegue instanciar estes
 * modelos ("Can't create a session. ERROR_CODE: 1").
 *
 * O áudio não sai da máquina: o navegador decodifica para PCM e manda os bytes
 * crus para o localhost. Nenhum serviço externo é chamado depois que os pesos
 * do modelo são baixados na primeira vez.
 */

import { config } from "../config.ts";

type Transcritor = (audio: Float32Array, traduzir: boolean) => Promise<{ text: string }>;

let carregando: Promise<Transcritor> | null = null;

/** Pesado e demorado na primeira vez: só carrega quando alguém fala. */
function obter(): Promise<Transcritor> {
  carregando ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    console.log("[cockpit] carregando o modelo de voz (só na primeira vez)…");
    const asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-base");
    console.log("[cockpit] modelo de voz pronto");
    // "translate" é a tarefa nativa do Whisper e só traduz para inglês —
    // que é exatamente o caso: falar em português, mandar em inglês.
    return (audio: Float32Array, traduzir: boolean) =>
      asr(audio, {
        language: config.vozIdioma ?? "portuguese",
        task: traduzir ? "translate" : "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5,
      }) as Promise<{ text: string }>;
  })().catch((err: unknown) => {
    carregando = null; // guardar a promessa rejeitada travaria toda tentativa seguinte
    throw err;
  });
  return carregando;
}

export async function transcrever(pcm: Float32Array, traduzir = false): Promise<string> {
  if (pcm.length < 1600) return ""; // menos de 0,1s: não é fala
  const { text } = await (await obter())(pcm, traduzir);
  return text.trim();
}
